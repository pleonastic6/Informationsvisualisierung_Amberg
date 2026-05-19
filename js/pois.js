const THREE = window.THREE;

const CATEGORY_COLORS = {
    education: 0x60a5fa,
    health: 0x34d399,
    civic: 0xfbbf24,
    food: 0xf472b6,
    culture: 0xa78bfa,
    lodging: 0xf59e0b,
    leisure: 0x22c55e,
    retail: 0xfb7185,
    mobility: 0x38bdf8,
    historic: 0x94a3b8,
    other: 0xe5e7eb,
};

function colorFor(category) {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
}

export function buildPois(scene, data) {
    const group = new THREE.Group();
    group.name = 'poi-group';
    const items = [];

    for (const poi of data.pois) {
        const color = colorFor(poi.category);
        const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.9, 0.9, 8, 10),
            new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: 0.18,
                roughness: 0.45,
                metalness: 0.15,
                transparent: true,
                opacity: 0.92,
            })
        );
        mesh.position.set(poi.x, 4.6, -poi.z);
        mesh.userData.meta = {
            kind: 'poi',
            title: poi.name,
            name: poi.name,
            category: poi.category,
            categoryLabel: poi.categoryLabel,
            subtype: poi.subtype,
            subtypeLabel: poi.subtypeLabel,
            osmId: poi.id,
            centerX: poi.x,
            centerZ: poi.z,
        };
        mesh.userData.baseY = 4.6;
        mesh.userData.baseOpacity = 0.92;
        mesh.userData.baseScale = 1;
        group.add(mesh);
        items.push(mesh);
    }

    scene.add(group);
    return { group, items };
}

export function setPoiHighlight(mesh, active) {
    if (!mesh) return;
    const material = mesh.material;
    if (active) {
        mesh.scale.setScalar(1.45);
        mesh.position.y = (mesh.userData.baseY || 4.6) + 2.2;
        material.emissiveIntensity = 0.55;
        material.opacity = 1;
    } else {
        mesh.scale.setScalar(mesh.userData.baseScale || 1);
        mesh.position.y = mesh.userData.baseY || 4.6;
        material.emissiveIntensity = 0.18;
        material.opacity = mesh.userData.baseOpacity || 0.92;
    }
}

export function setPoiVisibility(group, items, visible) {
    if (group) group.visible = visible;
    for (const item of items || []) {
        item.visible = visible;
    }
}
