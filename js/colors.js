const THREE = window.THREE;

export const ERA_COLORS = [
    new THREE.Color(0x4b5563),
    new THREE.Color(0x7c4a03),
    new THREE.Color(0xc2410c),
    new THREE.Color(0xca8a04),
    new THREE.Color(0x0ea5a4),
    new THREE.Color(0x2563eb)
];

export const ERA_LABELS = [
    'Unbekannt',
    'Vor 1900',
    '1900–1939',
    '1940–1969',
    '1970–1999',
    '2000+'
];

export function heightColor(t) {
    const c = new THREE.Color();
    if (t < 0.2) {
        const s = t / 0.2;
        c.setRGB(0.12 + s * 0.12, 0.06 + s * 0.04, 0.16 + s * 0.12);
    } else if (t < 0.45) {
        const s = (t - 0.2) / 0.25;
        c.setRGB(0.24 + s * 0.22, 0.10 + s * 0.06, 0.28 + s * 0.18);
    } else if (t < 0.7) {
        const s = (t - 0.45) / 0.25;
        c.setRGB(0.46 + s * 0.22, 0.16 + s * 0.06, 0.46 + s * 0.16);
    } else if (t < 0.88) {
        const s = (t - 0.7) / 0.18;
        c.setRGB(0.68 + s * 0.18, 0.22 + s * 0.10, 0.62 + s * 0.18);
    } else {
        const s = (t - 0.88) / 0.12;
        c.setRGB(0.86 + s * 0.12, 0.32 + s * 0.12, 0.80 + s * 0.16);
    }
    return c;
}

export function groundColor(t) {
    const c = new THREE.Color();
    if (t < 0.4) {
        const s = t / 0.4;
        c.setRGB(0.18 + s * 0.18, 0.06 + s * 0.05, 0.20 + s * 0.16);
    } else if (t < 0.75) {
        const s = (t - 0.4) / 0.35;
        c.setRGB(0.36 + s * 0.26, 0.11 + s * 0.07, 0.36 + s * 0.24);
    } else {
        const s = (t - 0.75) / 0.25;
        c.setRGB(0.62 + s * 0.24, 0.18 + s * 0.12, 0.60 + s * 0.24);
    }
    return c;
}

export function drawLegendBar(fn, canvasId = 'legend-bar') {
    const cv = document.getElementById(canvasId);
    const ctx = cv.getContext('2d');

    for (let i = 0; i < 180; i++) {
        const col = fn(i / 179);
        ctx.fillStyle = `rgb(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)})`;
        ctx.fillRect(i, 0, 1, 4);
    }
}
