const THREE = window.THREE;

import { groundColor } from './colors.js';

export function createTerrainSampler(data) {
    const meta = data.meta;
    const width = meta.width;
    const height = meta.height;
    const elev = data.elevations;
    const xMin = meta.x_min;
    const xMax = meta.x_max;
    const zMin = meta.z_min;
    const zMax = meta.z_max;
    const verticalScale = meta.vertical_scale;

    function sampleElevation(x, z) {
        const tx = (x - xMin) / Math.max(1e-9, (xMax - xMin));
        const tz = (z - zMin) / Math.max(1e-9, (zMax - zMin));
        const gx = Math.max(0, Math.min(width - 1, tx * (width - 1)));
        const gz = Math.max(0, Math.min(height - 1, (1 - tz) * (height - 1)));
        const x0 = Math.floor(gx);
        const z0 = Math.floor(gz);
        const x1 = Math.min(width - 1, x0 + 1);
        const z1 = Math.min(height - 1, z0 + 1);
        const fx = gx - x0;
        const fz = gz - z0;
        const q11 = elev[z0 * width + x0];
        const q21 = elev[z0 * width + x1];
        const q12 = elev[z1 * width + x0];
        const q22 = elev[z1 * width + x1];
        const top = q11 * (1 - fx) + q21 * fx;
        const bottom = q12 * (1 - fx) + q22 * fx;
        return top * (1 - fz) + bottom * fz;
    }

    return {
        sampleElevation,
        sampleSceneY(x, z) {
            return sampleElevation(x, z) * verticalScale;
        },
        meta,
    };
}

export function buildTerrain(scene, data) {
    const meta = data.meta;
    const width = meta.width;
    const height = meta.height;
    const xMin = meta.x_min;
    const xMax = meta.x_max;
    const zMin = meta.z_min;
    const zMax = meta.z_max;
    const verticalScale = meta.vertical_scale;
    const elevations = data.elevations;
    const elevMin = meta.elevation_min;
    const elevMax = meta.elevation_max;

    const positions = new Float32Array(width * height * 3);
    const colors = new Float32Array(width * height * 3);
    const indices = new Uint32Array((width - 1) * (height - 1) * 6);

    let p = 0;
    for (let row = 0; row < height; row++) {
        const rowT = row / Math.max(1, height - 1);
        const z = zMax + (zMin - zMax) * rowT;
        for (let col = 0; col < width; col++) {
            const colT = col / Math.max(1, width - 1);
            const x = xMin + (xMax - xMin) * colT;
            const elevation = elevations[row * width + col];
            const y = elevation * verticalScale;
            positions[p] = x;
            positions[p + 1] = y;
            positions[p + 2] = -z;

            const ratio = (elevation - elevMin) / Math.max(1e-9, elevMax - elevMin);
            const color = groundColor(ratio);
            colors[p] = color.r;
            colors[p + 1] = color.g;
            colors[p + 2] = color.b;
            p += 3;
        }
    }

    let k = 0;
    for (let row = 0; row < height - 1; row++) {
        for (let col = 0; col < width - 1; col++) {
            const a = row * width + col;
            const b = a + 1;
            const c = a + width;
            const d = c + 1;
            indices[k++] = a;
            indices[k++] = c;
            indices[k++] = b;
            indices[k++] = b;
            indices[k++] = c;
            indices[k++] = d;
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0.04,
        transparent: true,
        opacity: 0.92,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = false;
    mesh.position.y = -0.2;
    scene.add(mesh);
    return mesh;
}
