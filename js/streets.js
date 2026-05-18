const THREE = window.THREE;

const STREET_COLORS = {
    m: 0xf08cc5,
    t: 0xd56aa8,
    p: 0xb6538f,
    s: 0x8d436f,
    e: 0x5f304c,
    r: 0x311826
};

export function buildStreets(scene, data) {
    const streetGroup = new THREE.Group();
    const groupedByType = {};

    for (const street of data.streets) {
        if (!groupedByType[street.t]) groupedByType[street.t] = [];
        groupedByType[street.t].push(street);
    }

    for (const [type, streets] of Object.entries(groupedByType)) {
        const points = [];

        for (const street of streets) {
            for (let i = 0; i < street.c.length - 2; i += 2) {
                points.push(new THREE.Vector3(street.c[i], 0.5, -street.c[i + 1]));
                points.push(new THREE.Vector3(street.c[i + 2], 0.5, -street.c[i + 3]));
            }
        }

        if (points.length === 0) continue;

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const opacity = type === 'r' ? 0.2 : type === 'e' ? 0.3 : type === 's' ? 0.42 : 0.58;
        const material = new THREE.LineBasicMaterial({
            color: STREET_COLORS[type] || 0x1a3a6a,
            opacity,
            transparent: true
        });

        streetGroup.add(new THREE.LineSegments(geometry, material));
    }

    scene.add(streetGroup);
    return streetGroup;
}
