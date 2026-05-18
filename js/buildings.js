const THREE = window.THREE;

import { ERA_COLORS, ERA_LABELS, groundColor, heightColor } from './colors.js';

const RANKING_LIMIT = 100;
const GRID_COLUMNS = 10;
const GRID_SPACING = 36;
const MAP_HIGHLIGHT = new THREE.Color(0xffb3dc);

function copyPalette(target, offset, source) {
    target.set(source, offset);
}

function createShape(points, centerX = 0, centerZ = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0] - centerX, points[1] - centerZ);
    for (let i = 2; i < points.length; i += 2) shape.lineTo(points[i] - centerX, points[i + 1] - centerZ);
    shape.closePath();
    return shape;
}

function buildGeometry(building, { centered = false } = {}) {
    const centerX = centered ? building.x : 0;
    const centerZ = centered ? building.z : 0;
    const shape = createShape(building.ext, centerX, centerZ);

    if (building.holes) {
        for (const hole of building.holes) {
            const holePath = new THREE.Path();
            holePath.moveTo(hole[0] - centerX, hole[1] - centerZ);
            for (let i = 2; i < hole.length; i += 2) holePath.lineTo(hole[i] - centerX, hole[i + 1] - centerZ);
            holePath.closePath();
            shape.holes.push(holePath);
        }
    }

    const geometry = new THREE.ExtrudeGeometry(shape, { depth: building.h * 0.1, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, building.g * 0.02, 0);
    return geometry;
}

function createPaletteSet(building, maxHeight, minGround, maxGround, vertexCount) {
    const heightRatio = building.h / maxHeight;
    const groundRatio = maxGround > minGround ? (building.g - minGround) / (maxGround - minGround) : 0;
    const heightCol = heightColor(heightRatio);
    const eraCol = ERA_COLORS[building.era] ?? ERA_COLORS[0];
    const groundCol = groundColor(groundRatio);

    const palette = {
        height: new Float32Array(vertexCount * 3),
        era: new Float32Array(vertexCount * 3),
        ground: new Float32Array(vertexCount * 3)
    };

    for (let i = 0; i < vertexCount; i++) {
        const base = i * 3;
        palette.height[base] = heightCol.r;
        palette.height[base + 1] = heightCol.g;
        palette.height[base + 2] = heightCol.b;

        palette.era[base] = eraCol.r;
        palette.era[base + 1] = eraCol.g;
        palette.era[base + 2] = eraCol.b;

        palette.ground[base] = groundCol.r;
        palette.ground[base + 1] = groundCol.g;
        palette.ground[base + 2] = groundCol.b;
    }

    return palette;
}

function describeBuilding(building, rank = null, sourceIndex = null) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let areaAccumulator = 0;
    let centroidXAccumulator = 0;
    let centroidZAccumulator = 0;

    const pointCount = building.ext.length / 2;

    for (let i = 0; i < building.ext.length; i += 2) {
        const x = building.ext[i];
        const z = building.ext[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;

        const nextIndex = (i + 2) % building.ext.length;
        const nextX = building.ext[nextIndex];
        const nextZ = building.ext[nextIndex + 1];
        const cross = x * nextZ - nextX * z;
        areaAccumulator += cross;
        centroidXAccumulator += (x + nextX) * cross;
        centroidZAccumulator += (z + nextZ) * cross;
    }

    const footprintWidth = maxX - minX;
    const footprintDepth = maxZ - minZ;
    const polygonArea = areaAccumulator * 0.5;
    const centroidX = Math.abs(polygonArea) > 1e-6
        ? centroidXAccumulator / (6 * polygonArea)
        : building.x;
    const centroidZ = Math.abs(polygonArea) > 1e-6
        ? centroidZAccumulator / (6 * polygonArea)
        : building.z;

    return {
        building,
        rank,
        sourceIndex,
        bin: building.bin ?? '',
        name: building.name ?? '',
        height: building.h,
        era: building.era,
        eraLabel: ERA_LABELS[building.era] ?? ERA_LABELS[0],
        centerX: centroidX,
        centerZ: centroidZ,
        footprintWidth,
        footprintDepth,
        footprintRadius: Math.max(8, Math.hypot(footprintWidth, footprintDepth) * 0.5)
    };
}

function applySourceColorToMeta(target, sourceColors, meta) {
    for (let vertex = 0; vertex < meta.vertexCount; vertex++) {
        const base = (meta.vertexStart + vertex) * 3;
        target[base] = sourceColors[base];
        target[base + 1] = sourceColors[base + 1];
        target[base + 2] = sourceColors[base + 2];
    }
}

function createRankingStage(width, depth) {
    const group = new THREE.Group();

    const base = new THREE.Mesh(
        new THREE.BoxGeometry(width, 8, depth),
        new THREE.MeshStandardMaterial({
            color: 0x160d14,
            roughness: 0.88,
            metalness: 0.14
        })
    );
    base.position.y = -5.2;
    group.add(base);

    const top = new THREE.Mesh(
        new THREE.BoxGeometry(width - 6, 1.2, depth - 6),
        new THREE.MeshStandardMaterial({
            color: 0x26111d,
            roughness: 0.76,
            metalness: 0.16
        })
    );
    top.position.y = -0.8;
    group.add(top);

    const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(width - 4, 1.8, depth - 4)),
        new THREE.LineBasicMaterial({ color: 0xa85a86, transparent: true, opacity: 0.42 })
    );
    border.position.y = -0.35;
    group.add(border);

    return group;
}

export async function buildBuildings({ scene, buildings, maxHeight, minGround, maxGround, setProgress }) {
    const geoList = [];
    const paletteList = [];
    const CHUNK = 400;
    const buildingMeta = [];
    let totalVertices = 0;
    let totalIndices = 0;

    for (let off = 0; off < buildings.length; off += CHUNK) {
        const end = Math.min(off + CHUNK, buildings.length);

        for (let i = off; i < end; i++) {
            const building = buildings[i];
            const geometry = buildGeometry(building);
            const vertexCount = geometry.attributes.position.count;
            const palette = createPaletteSet(building, maxHeight, minGround, maxGround, vertexCount);

            geoList.push(geometry);
            paletteList.push(palette);
            totalVertices += vertexCount;
            totalIndices += geometry.index ? geometry.index.count : vertexCount;
            buildingMeta.push({
                ...describeBuilding(building, null, i),
                vertexStart: 0,
                vertexCount
            });
        }

        setProgress(30 + Math.round((end / buildings.length) * 55), `Geometrien ${end.toLocaleString()} / ${buildings.length.toLocaleString()}…`);
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    setProgress(87, 'Zusammenführen…');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const positions = new Float32Array(totalVertices * 3);
    const normals = new Float32Array(totalVertices * 3);
    const colors = new Float32Array(totalVertices * 3);
    const indices = new Uint32Array(totalIndices);
    const palettes = {
        height: new Float32Array(totalVertices * 3),
        era: new Float32Array(totalVertices * 3),
        ground: new Float32Array(totalVertices * 3)
    };

    let vertexOffset = 0;
    let indexOffset = 0;

    for (let i = 0; i < geoList.length; i++) {
        const geometry = geoList[i];
        const meta = buildingMeta[i];
        const palette = paletteList[i];
        const indicesStart = indexOffset;
        const colorOffset = vertexOffset * 3;

        positions.set(geometry.attributes.position.array, colorOffset);
        if (geometry.attributes.normal) normals.set(geometry.attributes.normal.array, colorOffset);
        copyPalette(palettes.height, colorOffset, palette.height);
        copyPalette(palettes.era, colorOffset, palette.era);
        copyPalette(palettes.ground, colorOffset, palette.ground);
        copyPalette(colors, colorOffset, palette.height);

        if (geometry.index) {
            const geometryIndices = geometry.index.array;
            for (let k = 0; k < geometryIndices.length; k++) indices[indexOffset + k] = geometryIndices[k] + vertexOffset;
            indexOffset += geometryIndices.length;
        } else {
            for (let k = 0; k < meta.vertexCount; k++) indices[indexOffset + k] = k + vertexOffset;
            indexOffset += meta.vertexCount;
        }

        meta.vertexStart = vertexOffset;
        meta.triangleStart = indicesStart / 3;
        meta.triangleEnd = indexOffset / 3;

        vertexOffset += meta.vertexCount;
        geometry.dispose();
    }

    const mergedGeometry = new THREE.BufferGeometry();
    mergedGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    mergedGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    mergedGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    mergedGeometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const mesh = new THREE.Mesh(mergedGeometry, new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.86,
        metalness: 0.12,
        transparent: true,
        opacity: 1
    }));
    scene.add(mesh);

    return {
        mesh,
        buildingMeta,
        palettes
    };
}

export function buildRankingView({ scene, buildings, maxHeight, minGround, maxGround }) {
    const group = new THREE.Group();
    group.visible = false;

    const topBuildings = buildings
        .map((building, index) => ({ building, sourceIndex: index }))
        .sort((a, b) => b.building.h - a.building.h)
        .slice(0, RANKING_LIMIT);

    const rowCount = Math.ceil(topBuildings.length / GRID_COLUMNS);
    const xOffset = ((GRID_COLUMNS - 1) * GRID_SPACING) / 2;
    const zOffset = ((rowCount - 1) * GRID_SPACING) / 2;
    const stageWidth = GRID_COLUMNS * GRID_SPACING + 44;
    const stageDepth = rowCount * GRID_SPACING + 44;

    const stage = createRankingStage(stageWidth, stageDepth);
    group.add(stage);

    const items = topBuildings.map(({ building, sourceIndex }, index) => {
        const geometry = buildGeometry(building, { centered: true });
        const paletteSet = createPaletteSet(building, maxHeight, minGround, maxGround, geometry.attributes.position.count);
        geometry.setAttribute('color', new THREE.BufferAttribute(paletteSet.height.slice(), 3));

        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.84,
            metalness: 0.1,
            emissive: new THREE.Color(0x000000),
            transparent: true,
            opacity: 1
        }));
        const column = index % GRID_COLUMNS;
        const row = Math.floor(index / GRID_COLUMNS);

        mesh.position.set(column * GRID_SPACING - xOffset, 0, row * GRID_SPACING - zOffset);
        mesh.rotation.y = 0;
        mesh.userData.meta = describeBuilding(building, index + 1, sourceIndex);
        group.add(mesh);

        const item = {
            mesh,
            meta: mesh.userData.meta,
            palettes: paletteSet
        };
        mesh.userData.rankingItem = item;
        return item;
    });

    scene.add(group);
    return { group, items, stage };
}

export function applyBuildingColors({ mesh, buildingMeta, sourceColors }) {
    if (!mesh) return;

    const colorAttribute = mesh.geometry.attributes.color;
    const target = colorAttribute.array;

    for (const meta of buildingMeta) applySourceColorToMeta(target, sourceColors, meta);

    colorAttribute.needsUpdate = true;
}

export function applyHeightFilter({ mesh, buildingMeta, minHeight, sourceColors }) {
    if (!mesh) return;

    const colorAttribute = mesh.geometry.attributes.color;
    const target = colorAttribute.array;

    for (const meta of buildingMeta) {
        const hide = meta.height < minHeight;
        if (hide) {
            for (let vertex = 0; vertex < meta.vertexCount; vertex++) {
                const base = (meta.vertexStart + vertex) * 3;
                target[base] = 0;
                target[base + 1] = 0;
                target[base + 2] = 0;
            }
        } else {
            applySourceColorToMeta(target, sourceColors, meta);
        }
    }

    colorAttribute.needsUpdate = true;
}

export function updateRankingView({ rankingItems, mode, minHeight }) {
    for (const item of rankingItems) {
        const colorAttribute = item.mesh.geometry.attributes.color;
        const target = colorAttribute.array;
        const source = item.palettes[mode];
        const hide = item.meta.height < minHeight;

        for (let i = 0; i < source.length; i += 3) {
            if (hide) {
                target[i] = 0;
                target[i + 1] = 0;
                target[i + 2] = 0;
            } else {
                target[i] = source[i];
                target[i + 1] = source[i + 1];
                target[i + 2] = source[i + 2];
            }
        }

        colorAttribute.needsUpdate = true;
        item.mesh.visible = !hide;
    }
}

export function setMapHighlight({ mesh, meta, sourceColors, minHeight, active, mix = 0.4 }) {
    if (!mesh || !meta) return;

    const colorAttribute = mesh.geometry.attributes.color;
    const target = colorAttribute.array;

    if (!active || meta.height < minHeight) {
        if (meta.height < minHeight) {
            for (let vertex = 0; vertex < meta.vertexCount; vertex++) {
                const base = (meta.vertexStart + vertex) * 3;
                target[base] = 0;
                target[base + 1] = 0;
                target[base + 2] = 0;
            }
        } else {
            applySourceColorToMeta(target, sourceColors, meta);
        }
        colorAttribute.needsUpdate = true;
        return;
    }

    const invMix = 1 - mix;
    for (let vertex = 0; vertex < meta.vertexCount; vertex++) {
        const base = (meta.vertexStart + vertex) * 3;
        target[base] = sourceColors[base] * invMix + MAP_HIGHLIGHT.r * mix;
        target[base + 1] = sourceColors[base + 1] * invMix + MAP_HIGHLIGHT.g * mix;
        target[base + 2] = sourceColors[base + 2] * invMix + MAP_HIGHLIGHT.b * mix;
    }

    colorAttribute.needsUpdate = true;
}

export function setRankingHighlight(item, active) {
    if (!item) return;
    item.mesh.material.emissive.set(active ? 0x3a1128 : 0x000000);
    item.mesh.material.emissiveIntensity = active ? 1.15 : 0;
    const scale = active ? 1.06 : 1;
    item.mesh.scale.setScalar(scale);
}

export function findBuildingMetaByFaceIndex(buildingMeta, faceIndex) {
    if (faceIndex == null) return null;

    let left = 0;
    let right = buildingMeta.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const meta = buildingMeta[mid];
        if (faceIndex < meta.triangleStart) right = mid - 1;
        else if (faceIndex >= meta.triangleEnd) left = mid + 1;
        else return meta;
    }

    return null;
}
