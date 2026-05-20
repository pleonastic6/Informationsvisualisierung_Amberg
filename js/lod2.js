const THREE = window.THREE;

const FILL_COLOR = new THREE.Color(0xec4899);
const HIGHLIGHT_COLOR = new THREE.Color(0xffc4e2);

function polygonArea2D(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += a.x * b.z - b.x * a.z;
    }
    return area * 0.5;
}

function ensureClockwise(points) {
    return polygonArea2D(points) > 0 ? [...points].reverse() : points;
}

function ensureCounterClockwise(points) {
    return polygonArea2D(points) < 0 ? [...points].reverse() : points;
}

function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x;
        const zi = polygon[i].z;
        const xj = polygon[j].x;
        const zj = polygon[j].z;
        const intersect = ((zi > point.z) !== (zj > point.z))
            && (point.x < ((xj - xi) * (point.z - zi)) / ((zj - zi) || 1e-9) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function toXZPolygon(points3d) {
    return points3d.map((point) => ({ x: point[0], z: point[2] }));
}

function extractFootprint(building) {
    const groundPolygons = (building.surfaces || [])
        .filter((surface) => surface.kind === 'ground')
        .flatMap((surface) => surface.polygons || [])
        .map(toXZPolygon)
        .filter((polygon) => polygon.length >= 3);

    const sourcePolygons = groundPolygons.length
        ? groundPolygons
        : (building.surfaces || [])
            .flatMap((surface) => (surface.polygons || []).slice(0, 1))
            .map(toXZPolygon)
            .filter((polygon) => polygon.length >= 3);

    if (!sourcePolygons.length) return null;

    const sorted = [...sourcePolygons].sort((a, b) => Math.abs(polygonArea2D(b)) - Math.abs(polygonArea2D(a)));
    const outer = ensureClockwise(sorted[0]);
    const holes = [];

    for (const polygon of sorted.slice(1)) {
        const normalized = ensureCounterClockwise(polygon);
        if (pointInPolygon(normalized[0], outer)) holes.push(normalized);
    }

    return { outer, holes };
}

function createShapeFromFootprint(footprint) {
    const shape = new THREE.Shape();
    const outer = footprint.outer;
    shape.moveTo(outer[0].x, outer[0].z);
    for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].z);
    shape.closePath();

    for (const hole of footprint.holes || []) {
        const path = new THREE.Path();
        path.moveTo(hole[0].x, hole[0].z);
        for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x, hole[i].z);
        path.closePath();
        shape.holes.push(path);
    }

    return shape;
}

function minMaxY(surfaces) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const surface of surfaces || []) {
        for (const polygon of surface.polygons || []) {
            for (const point of polygon) {
                minY = Math.min(minY, point[1]);
                maxY = Math.max(maxY, point[1]);
            }
        }
    }
    return {
        minY: Number.isFinite(minY) ? minY : 0,
        maxY: Number.isFinite(maxY) ? maxY : 0,
    };
}

function normalizeFunctionCode(value) {
    return value ? String(value).trim() : '';
}

export function labelLod2Function(code) {
    const labels = {
        '1000': 'Wohngebäude',
        '2000': 'Büro/Verwaltung',
        '3000': 'Einzelhandel',
        '4000': 'Gewerbe/Industrie',
        '5000': 'Öffentlich',
        '6000': 'Landwirtschaft',
        '1500': 'Kirche/Religiös',
        '1610': 'Schule',
        '1700': 'Krankenhaus/Gesundheit',
        '1800': 'Kultur/Freizeit',
        '2050': 'Gewerbliche Nutzung',
        '2461': 'Reihenhaus',
        '2463': 'Wohnhaus',
        '2465': 'Wohnblock',
        '2513': 'Bürogebäude',
        '2523': 'Verwaltung',
        '3012': 'Handel',
        '3017': 'Restaurant/Gastro',
        '3020': 'Laden',
        '3041': 'Werkstatt',
        '3043': 'Lager',
        '3048': 'Technik',
        '3051': 'Hotel',
        '3052': 'Sport',
        '3065': 'Parkhaus',
        '3071': 'Denkmal',
        '3072': 'Kirchlich',
        '3073': 'Kapelle',
        '3075': 'Burg/Schloss',
        '3091': 'Tribüne',
        '3290': 'Nebengebäude',
        '9998': 'Nicht klassifiziert',
        '9999': 'Sonstiges',
    };
    const normalized = String(code || '').trim();
    const suffix = normalized.includes('_') ? normalized.split('_').at(-1) : normalized;
    return labels[suffix] || labels[normalized] || (normalized ? `Funktion ${normalized}` : '—');
}

export function labelLod2RoofType(code) {
    const labels = {
        '1000': 'Flachdach',
        '2100': 'Pultdach',
        '2200': 'Versetztes Pultdach',
        '3100': 'Satteldach',
        '3200': 'Walmdach',
        '3300': 'Krüppelwalmdach',
        '3400': 'Mansarddach',
        '3500': 'Zeltdach',
        '3600': 'Kegeldach',
        '3700': 'Kuppeldach',
        '3800': 'Sheddach',
        '3900': 'Bogendach',
        '4000': 'Turmdach',
        '9999': 'Sonstiges Dach',
    };
    return labels[code] || (code ? `Dachtyp ${code}` : '—');
}

function createBuildingRecord(building, buildingIndex, terrainSampler = null) {
    const footprint = extractFootprint(building);
    if (!footprint) return null;

    const { minY, maxY } = minMaxY(building.surfaces || []);
    const rawHeightScene = Math.max(0.35, maxY - minY);
    const centerX = Number(building.center?.x ?? footprint.outer[0].x ?? 0);
    const centerZ = Number(building.center?.z ?? footprint.outer[0].z ?? 0);
    const sampledBase = terrainSampler
        ? (
            footprint.outer.reduce((sum, point) => sum + terrainSampler.sampleSceneY(point.x, point.z), 0)
            / Math.max(1, footprint.outer.length)
        ) + 0.12
        : minY;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of footprint.outer) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
    }

    const functionCode = normalizeFunctionCode(building.function);
    const roofType = normalizeFunctionCode(building.roofType);

    return {
        id: building.id || `lod2-${buildingIndex}`,
        kind: 'lod2',
        title: building.id || `LoD2-Gebäude ${buildingIndex + 1}`,
        centerX,
        centerZ,
        height: rawHeightScene * 10,
        baseSceneY: sampledBase,
        baseY: minY,
        topY: maxY,
        footprintRadius: Math.max(8, Math.hypot(maxX - minX, maxZ - minZ) * 0.5),
        roofType,
        roofTypeLabel: labelLod2RoofType(roofType),
        functionCode,
        functionLabel: labelLod2Function(functionCode),
        footprint,
        buildingHeightScene: rawHeightScene,
        triangleStart: 0,
        triangleEnd: 0,
    };
}

function buildGeometryForRecord(record) {
    const shape = createShapeFromFootprint(record.footprint);
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: record.buildingHeightScene,
        bevelEnabled: false,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, record.baseSceneY, 0);
    geometry.computeVertexNormals();
    return geometry;
}

function buildHighlightMesh(record) {
    const geometry = buildGeometryForRecord(record);
    return new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
            color: HIGHLIGHT_COLOR,
            emissive: HIGHLIGHT_COLOR.clone().multiplyScalar(0.35),
            roughness: 0.52,
            metalness: 0.12,
            transparent: true,
            opacity: 0.78,
            side: THREE.DoubleSide,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
        })
    );
}

export function findLod2MetaByFaceIndex(buildingMeta, faceIndex) {
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

export function setLod2Highlight(group, currentMesh, meta) {
    if (currentMesh) {
        currentMesh.parent?.remove(currentMesh);
        currentMesh.geometry?.dispose?.();
        currentMesh.material?.dispose?.();
    }

    if (!group || !meta) return null;

    const mesh = buildHighlightMesh(meta);
    mesh.name = 'lod2-highlight';
    group.add(mesh);
    return mesh;
}

export function buildLod2Group(sceneOrParent, data, options = {}) {
    const group = new THREE.Group();
    group.name = 'lod2-group';
    if (options.tileId) group.userData.tileId = options.tileId;

    const records = [];
    const geometries = [];
    let totalVertices = 0;
    let totalIndices = 0;

    for (const [index, building] of (data.buildings || []).entries()) {
        const record = createBuildingRecord(building, index, options.terrainSampler);
        if (!record) continue;
        const geometry = buildGeometryForRecord(record);
        const vertexCount = geometry.attributes.position.count;
        const indexCount = geometry.index ? geometry.index.count : vertexCount;
        record.vertexCount = vertexCount;
        record.indexCount = indexCount;
        records.push(record);
        geometries.push(geometry);
        totalVertices += vertexCount;
        totalIndices += indexCount;
    }

    const positions = new Float32Array(totalVertices * 3);
    const normals = new Float32Array(totalVertices * 3);
    const indices = new Uint32Array(totalIndices);

    let vertexOffset = 0;
    let indexOffset = 0;
    let triangleCount = 0;

    for (let i = 0; i < geometries.length; i++) {
        const geometry = geometries[i];
        const record = records[i];
        const attrOffset = vertexOffset * 3;
        positions.set(geometry.attributes.position.array, attrOffset);
        normals.set(geometry.attributes.normal.array, attrOffset);

        if (geometry.index) {
            const source = geometry.index.array;
            for (let k = 0; k < source.length; k++) {
                indices[indexOffset + k] = source[k] + vertexOffset;
            }
            record.triangleStart = indexOffset / 3;
            indexOffset += source.length;
            record.triangleEnd = indexOffset / 3;
        } else {
            for (let k = 0; k < record.vertexCount; k++) indices[indexOffset + k] = k + vertexOffset;
            record.triangleStart = indexOffset / 3;
            indexOffset += record.vertexCount;
            record.triangleEnd = indexOffset / 3;
        }

        triangleCount += record.triangleEnd - record.triangleStart;
        vertexOffset += record.vertexCount;
        geometry.dispose();
    }

    if (records.length) {
        const merged = new THREE.BufferGeometry();
        merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        merged.setIndex(new THREE.BufferAttribute(indices, 1));

        const material = new THREE.MeshStandardMaterial({
            color: FILL_COLOR,
            roughness: 0.82,
            metalness: 0.08,
            transparent: false,
            opacity: 1,
        });

        const mesh = new THREE.Mesh(merged, material);
        mesh.userData.surfaceKind = 'building';
        mesh.userData.baseOpacity = 1;
        if (options.tileId) mesh.userData.tileId = options.tileId;
        group.add(mesh);
    }

    sceneOrParent.add(group);
    return {
        group,
        buildingMeta: records,
        stats: {
            buildingCount: records.length,
            polygonCount: records.length,
            triangleCount,
        },
    };
}
