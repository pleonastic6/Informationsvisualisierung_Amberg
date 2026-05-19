const THREE = window.THREE;

const SURFACE_STYLE = {
    roof: { color: new THREE.Color(0xf472b6), opacity: 0.98 },
    wall: { color: new THREE.Color(0xfbcfe8), opacity: 0.94 },
    ground: { color: new THREE.Color(0x7f1d5a), opacity: 0.9 },
};

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
        roughness: kind === 'roof' ? 0.72 : 0.88,
        metalness: 0.08,
        transparent: true,
        opacity: style.opacity,
        side: THREE.DoubleSide,
    });

    return new THREE.Mesh(geometry, material);
}

export function buildLod2Group(scene, data) {
    const group = new THREE.Group();
    group.name = 'lod2-group';

    const buffers = { roof: [], wall: [], ground: [] };
    let polygonCount = 0;
    let triangleCount = 0;

    for (const building of data.buildings || []) {
        for (const surface of building.surfaces || []) {
            const kind = surface.kind in buffers ? surface.kind : 'wall';
            for (const polygon of surface.polygons || []) {
                polygonCount += 1;
                triangleCount += triangulateFan(polygon, buffers[kind]);
            }
        }
    }

    for (const kind of Object.keys(buffers)) {
        const mesh = buildSurfaceMesh(kind, buffers[kind]);
        if (!mesh) continue;
        mesh.userData.baseOpacity = mesh.material.opacity;
        group.add(mesh);
    }

    scene.add(group);
    return {
        group,
        stats: {
            buildingCount: data.meta?.building_count ?? data.buildings?.length ?? 0,
            polygonCount,
            triangleCount,
        },
    };
}
