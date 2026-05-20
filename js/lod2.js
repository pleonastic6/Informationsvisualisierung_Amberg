const THREE = window.THREE;

const SURFACE_STYLE = {
    roof: { color: new THREE.Color(0xf472b6), opacity: 1, roughness: 0.76 },
    wall: { color: new THREE.Color(0xec4899), opacity: 1, roughness: 0.84 },
    ground: { color: new THREE.Color(0xbe185d), opacity: 1, roughness: 0.9 },
};

const HIGHLIGHT_COLOR = new THREE.Color(0xffc4e2);
const INCLUDE_GROUND_SURFACES = false;

function pushTriangle(target, a, b, c) {
    target.push(a[0], a[1], -a[2]);
    target.push(b[0], b[1], -b[2]);
    target.push(c[0], c[1], -c[2]);
}

function triangulateFan(points, target) {
    if (!points || points.length < 3) return 0;
    let triangles = 0;
    for (let i = 1; i < points.length - 1; i++) {
        pushTriangle(target, points[0], points[i], points[i + 1]);
        triangles += 1;
    }
    return triangles;
}

function buildSurfaceMesh(kind, vertices) {
    if (!vertices.length) return null;
    const style = SURFACE_STYLE[kind] || SURFACE_STYLE.wall;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
        color: style.color,
        roughness: style.roughness,
        metalness: 0.08,
        transparent: style.opacity < 1,
        opacity: style.opacity,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.surfaceKind = kind;
    mesh.userData.baseOpacity = material.opacity;
    return mesh;
}

function buildHighlightMesh(meta) {
    const vertices = [];
    for (const surface of meta.surfaces || []) {
        for (const polygon of surface.polygons || []) {
            triangulateFan(polygon, vertices);
        }
    }

    if (!vertices.length) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();

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

function createBuildingMeta(building, buildingIndex) {
    const centerX = Number(building.center?.x ?? 0);
    const centerZ = Number(building.center?.z ?? 0);
    const baseY = Number(building.baseY ?? 0);
    const topY = Number(building.topY ?? baseY);
    const functionCode = normalizeFunctionCode(building.function);
    const roofType = normalizeFunctionCode(building.roofType);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const surface of building.surfaces || []) {
        for (const polygon of surface.polygons || []) {
            for (const point of polygon || []) {
                minX = Math.min(minX, point[0]);
                maxX = Math.max(maxX, point[0]);
                minZ = Math.min(minZ, point[2]);
                maxZ = Math.max(maxZ, point[2]);
            }
        }
    }

    const footprintRadius = Number.isFinite(minX)
        ? Math.max(8, Math.hypot(maxX - minX, maxZ - minZ) * 0.5)
        : 18;

    return {
        id: building.id || `lod2-${buildingIndex}`,
        kind: 'lod2',
        title: building.id || `LoD2-Gebäude ${buildingIndex + 1}`,
        centerX,
        centerZ,
        height: Math.max(0, topY - baseY) * 10,
        baseSceneY: baseY,
        baseY,
        topY,
        footprintRadius,
        roofType,
        roofTypeLabel: labelLod2RoofType(roofType),
        functionCode,
        functionLabel: labelLod2Function(functionCode),
        surfaces: building.surfaces || [],
        triangleRanges: {
            roof: null,
            wall: null,
            ground: null,
        }
    };
}

export function findLod2MetaByFaceIndex(buildingMeta, faceToBuilding, kind, faceIndex) {
    if (faceIndex == null || faceIndex < 0) return null;
    const buildingIndex = faceToBuilding?.[kind]?.[faceIndex];
    return Number.isInteger(buildingIndex) ? (buildingMeta?.[buildingIndex] ?? null) : null;
}

export function setLod2Highlight(group, currentMesh, meta) {
    if (currentMesh) {
        currentMesh.parent?.remove(currentMesh);
        currentMesh.geometry?.dispose?.();
        currentMesh.material?.dispose?.();
    }

    if (!group || !meta) return null;

    const mesh = buildHighlightMesh(meta);
    if (!mesh) return null;
    mesh.name = 'lod2-highlight';
    group.add(mesh);
    return mesh;
}

export function buildLod2Group(sceneOrParent, data, options = {}) {
    const group = new THREE.Group();
    group.name = 'lod2-group';
    if (options.tileId) group.userData.tileId = options.tileId;

    const buffers = { roof: [], wall: [], ground: [] };
    const triangleOffsets = { roof: 0, wall: 0, ground: 0 };
    const faceToBuilding = { roof: [], wall: [], ground: [] };
    const buildingMeta = [];
    let polygonCount = 0;
    let triangleCount = 0;

    for (const [buildingIndex, building] of (data.buildings || []).entries()) {
        const meta = createBuildingMeta(building, buildingIndex);

        for (const surface of meta.surfaces) {
            const kind = surface.kind in buffers ? surface.kind : 'wall';
            if (!INCLUDE_GROUND_SURFACES && kind === 'ground') continue;
            let start = triangleOffsets[kind];

            for (const polygon of surface.polygons || []) {
                polygonCount += 1;
                const triangles = triangulateFan(polygon, buffers[kind]);
                for (let i = 0; i < triangles; i++) faceToBuilding[kind].push(buildingIndex);
                triangleOffsets[kind] += triangles;
                triangleCount += triangles;
            }

            if (triangleOffsets[kind] > start) {
                const range = meta.triangleRanges[kind];
                if (!range) meta.triangleRanges[kind] = { start, end: triangleOffsets[kind] };
                else range.end = triangleOffsets[kind];
            }
        }

        buildingMeta.push(meta);
    }

    for (const kind of Object.keys(buffers)) {
        const mesh = buildSurfaceMesh(kind, buffers[kind]);
        if (!mesh) continue;
        if (options.tileId) mesh.userData.tileId = options.tileId;
        group.add(mesh);
    }

    sceneOrParent.add(group);
    return {
        group,
        buildingMeta,
        faceToBuilding,
        stats: {
            buildingCount: data.meta?.building_count ?? data.buildings?.length ?? 0,
            polygonCount,
            triangleCount,
        },
    };
}
