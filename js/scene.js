const THREE = window.THREE;

function createGroundGrid() {
    const group = new THREE.Group();

    const fineGrid = new THREE.GridHelper(1600, 32, 0x5d2748, 0x26141f);
    fineGrid.position.y = -0.4;
    fineGrid.material.transparent = true;
    fineGrid.material.opacity = 0.16;
    group.add(fineGrid);

    const coarseGrid = new THREE.GridHelper(1600, 8, 0xb35b89, 0x4a2138);
    coarseGrid.position.y = -0.35;
    coarseGrid.material.transparent = true;
    coarseGrid.material.opacity = 0.14;
    group.add(coarseGrid);

    const rings = new THREE.Group();
    const radii = [120, 240, 420, 680];
    for (const radius of radii) {
        const geometry = new THREE.RingGeometry(radius - 1.2, radius, 128);
        const material = new THREE.MeshBasicMaterial({
            color: radius < 300 ? 0x8d436f : 0x4c2238,
            transparent: true,
            opacity: radius < 300 ? 0.12 : 0.07,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(geometry, material);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -0.3;
        rings.add(ring);
    }
    group.add(rings);

    return group;
}

export function createScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0b11);
    scene.fog = new THREE.FogExp2(0x0a0b11, 0.00034);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 6000);

    scene.add(new THREE.AmbientLight(0xf5f7ff, 0.7));

    const sun = new THREE.DirectionalLight(0xe9efff, 1.45);
    sun.position.set(320, 620, 240);
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0xb8c4e6, 0.45);
    fill.position.set(-260, 180, -360);
    scene.add(fill);

    scene.add(new THREE.HemisphereLight(0x56627f, 0x0b0c12, 0.62));

    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(2200, 2200),
        new THREE.MeshStandardMaterial({
            color: 0x10131b,
            roughness: 0.92,
            metalness: 0.08
        })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    scene.add(ground);

    const groundGrid = createGroundGrid();
    scene.add(groundGrid);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return { scene, camera, renderer, ground, groundGrid };
}
