const THREE = window.THREE;

const FILL_COLOR = new THREE.Color(0xc97898);
const HIGHLIGHT_COLOR = new THREE.Color(0xffe5f1);

const LOD2_FUNCTION_LABELS = {
    '31001_1000': 'Wohngebäude',
    '31001_2000': 'Gebäude für Wirtschaft oder Gewerbe',
    '31001_2072': 'Jugendherberge',
    '31001_2461': 'Parkhaus',
    '31001_2463': 'Garage',
    '31001_2465': 'Tiefgarage',
    '31001_2513': 'Wasserbehälter',
    '31001_2523': 'Umformer',
    '31001_3000': 'Gebäude für öffentliche Zwecke',
    '31001_3012': 'Rathaus',
    '31001_3017': 'Kreisverwaltung',
    '31001_3020': 'Gebäude für Bildung und Forschung',
    '31001_3031': 'Schloss',
    '31001_3041': 'Kirche',
    '31001_3042': 'Synagoge',
    '31001_3043': 'Kapelle',
    '31001_3048': 'Kloster',
    '31001_3051': 'Krankenhaus',
    '31001_3052': 'Heilanstalt, Pflegeanstalt, Pflegestation',
    '31001_3065': 'Kinderkrippe, Kindergarten, Kindertagesstätte',
    '31001_3071': 'Polizei',
    '31001_3072': 'Feuerwehr',
    '31001_3073': 'Kaserne',
    '31001_3075': 'Justizvollzugsanstalt',
    '31001_3091': 'Bahnhofsgebäude',
    '31001_3290': 'Touristisches Informationszentrum',
    '31001_9998': 'Nach Quellenlage nicht zu spezifizieren',
    '51007_1500': 'Historische Mauer',
    '51009_1610': 'Überdachung',
    '51009_1700': 'Mauer',
    '53001_1800': 'Brücke',
    '53009_2050': 'Wehr',
};

function normalizeFunctionCode(value) {
    return value ? String(value).trim() : '';
}

export function labelLod2Function(code) {
    const normalized = String(code || '').trim();
    if (!normalized) return '—';
    if (LOD2_FUNCTION_LABELS[normalized]) return LOD2_FUNCTION_LABELS[normalized];
    return `Funktion ${normalized}`;
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

function groundPoints(building) {
    const ground = [];
    for (const surface of building.surfaces || []) {
        if (surface.kind !== 'ground') continue;
        for (const polygon of surface.polygons || []) {
            for (const point of polygon) ground.push(point);
        }
    }
    if (ground.length) return ground;
    return (building.surfaces || []).flatMap((surface) => (surface.polygons || []).slice(0, 1)).flat();
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

function createBuildingMeta(building, index, terrainSampler = null) {
    const centerX = Number(building.center?.x ?? 0);
    const centerZ = Number(building.center?.z ?? 0);
    const { minY, maxY } = minMaxY(building.surfaces || []);
    const basePoints = groundPoints(building);
    const sampledBase = terrainSampler && basePoints.length
        ? basePoints.reduce((sum, point) => sum + terrainSampler.sampleSceneY(point[0], point[2]), 0) / basePoints.length + 0.12
        : minY;
    const offsetY = sampledBase - minY;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const point of basePoints) {
        minX = Math.min(minX, point[0]);
        maxX = Math.max(maxX, point[0]);
        minZ = Math.min(minZ, point[2]);
        maxZ = Math.max(maxZ, point[2]);
    }

    const functionCode = normalizeFunctionCode(building.function);
    const roofType = normalizeFunctionCode(building.roofType);

    return {
        id: building.id || `lod2-${index}`,
        kind: 'lod2',
        title: building.id || `LoD2-Gebäude ${index + 1}`,
        centerX,
        centerZ,
        height: Math.max(0, maxY - minY) * 10,
        baseSceneY: sampledBase,
        baseY: minY,
        topY: maxY + offsetY,
        offsetY,
        footprintRadius: Number.isFinite(minX) ? Math.max(8, Math.hypot(maxX - minX, maxZ - minZ) * 0.5) : 18,
        roofType,
        roofTypeLabel: labelLod2RoofType(roofType),
        functionCode,
        functionLabel: labelLod2Function(functionCode),
        surfaces: building.surfaces || [],
        triangleStart: 0,
        triangleEnd: 0,
    };
}

function buildHighlightMesh(meta) {
    const vertices = [];
    for (const surface of meta.surfaces || []) {
        for (const polygon of surface.polygons || []) {
            const shifted = polygon.map((point) => [point[0], point[1] + meta.offsetY, point[2]]);
            triangulateFan(shifted, vertices);
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
    if (!mesh) return null;
    mesh.name = 'lod2-highlight';
    group.add(mesh);
    return mesh;
}

export function buildLod2Group(sceneOrParent, data, options = {}) {
    const group = new THREE.Group();
    group.name = 'lod2-group';

    const vertices = [];
    const buildingMeta = [];
    let polygonCount = 0;
    let triangleCount = 0;

    for (const [index, building] of (data.buildings || []).entries()) {
        const meta = createBuildingMeta(building, index, options.terrainSampler);
        let start = triangleCount;
        for (const surface of meta.surfaces || []) {
            for (const polygon of surface.polygons || []) {
                polygonCount += 1;
                const shifted = polygon.map((point) => [point[0], point[1] + meta.offsetY, point[2]]);
                triangleCount += triangulateFan(shifted, vertices);
            }
        }
        if (triangleCount === start) continue;
        meta.triangleStart = start;
        meta.triangleEnd = triangleCount;
        buildingMeta.push(meta);
    }

    if (vertices.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            color: FILL_COLOR,
            roughness: 0.82,
            metalness: 0.08,
            transparent: false,
            opacity: 1,
            side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.baseOpacity = 1;
        mesh.userData.surfaceKind = 'building';
        group.add(mesh);
    }

    sceneOrParent.add(group);
    return {
        group,
        buildingMeta,
        stats: {
            buildingCount: buildingMeta.length,
            polygonCount,
            triangleCount,
        },
    };
}
