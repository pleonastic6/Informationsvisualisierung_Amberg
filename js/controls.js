const THREE = window.THREE;

const CAM_SPEED = 1.5;
const CAM_SENSITIVITY = 0.003;

const MAP_VIEW = {
    pos: new THREE.Vector3(-188.2, 38.92, 583.6),
    yaw: -3.341,
    pitch: 0.104
};

const SEARCH_FOCUS_DIRECTION = new THREE.Vector3(
    Math.sin(MAP_VIEW.yaw),
    0,
    Math.cos(MAP_VIEW.yaw)
).normalize();

const RANKING_VIEW = {
    pos: new THREE.Vector3(0, 125, 245),
    target: new THREE.Vector3(0, 16, 0)
};

function anglesFromLookAt(position, target) {
    const dir = target.clone().sub(position).normalize();
    return {
        yaw: Math.atan2(dir.x, dir.z),
        pitch: Math.asin(-dir.y)
    };
}

export function createControls(camera) {
    const keys = {};
    let mouseDown = false;
    let lastMouse = { x: 0, y: 0 };

    let camYaw = MAP_VIEW.yaw;
    let camPitch = MAP_VIEW.pitch;
    const camPos = MAP_VIEW.pos.clone();
    const lastCameraPos = camPos.clone();
    let lastCameraYaw = camYaw;
    let lastCameraPitch = camPitch;
    let lastInteractionAt = 0;
    let cameraMoving = false;

    let cinematicActive = false;
    const cinematicFrom = {
        pos: camPos.clone(),
        yaw: camYaw,
        pitch: camPitch
    };
    const cinematicTo = {
        pos: camPos.clone(),
        yaw: camYaw,
        pitch: camPitch
    };
    let cinematicProgress = 1;

    function markInteraction() {
        lastInteractionAt = performance.now();
    }

    function stopCinematic() {
        cinematicActive = false;
        cinematicProgress = 1;
        markInteraction();
    }

    function startCinematic(view) {
        const targetView = view === 'ranking' ? RANKING_VIEW : MAP_VIEW;
        const angles = targetView.target ? anglesFromLookAt(targetView.pos, targetView.target) : { yaw: targetView.yaw, pitch: targetView.pitch };

        cinematicFrom.pos.copy(camPos);
        cinematicFrom.yaw = camYaw;
        cinematicFrom.pitch = camPitch;
        cinematicTo.pos.copy(targetView.pos);
        cinematicTo.yaw = angles.yaw;
        cinematicTo.pitch = angles.pitch;
        cinematicProgress = 0;
        cinematicActive = true;
    }

    function getDirection() {
        return new THREE.Vector3(
            Math.sin(camYaw) * Math.cos(camPitch),
            -Math.sin(camPitch),
            Math.cos(camYaw) * Math.cos(camPitch)
        );
    }

    function isTypingTarget(target) {
        if (!target) return false;
        const tag = target.tagName?.toLowerCase();
        return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    }

    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function updateCamera() {
        if (cinematicActive) {
            markInteraction();
            cinematicProgress = Math.min(1, cinematicProgress + 0.035);
            const eased = easeInOutCubic(cinematicProgress);
            camPos.lerpVectors(cinematicFrom.pos, cinematicTo.pos, eased);
            camYaw = cinematicFrom.yaw + (cinematicTo.yaw - cinematicFrom.yaw) * eased;
            camPitch = cinematicFrom.pitch + (cinematicTo.pitch - cinematicFrom.pitch) * eased;
            if (cinematicProgress >= 1) cinematicActive = false;
        }

        const dir = getDirection();
        const flatDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
        const right = new THREE.Vector3(-Math.cos(camYaw), 0, Math.sin(camYaw));

        if (!cinematicActive) {
            if (keys.w || keys.W || keys.ArrowUp) camPos.addScaledVector(flatDir, CAM_SPEED);
            if (keys.s || keys.S || keys.ArrowDown) camPos.addScaledVector(flatDir, -CAM_SPEED);
            if (keys.a || keys.A || keys.ArrowLeft) camPos.addScaledVector(right, -CAM_SPEED);
            if (keys.d || keys.D || keys.ArrowRight) camPos.addScaledVector(right, CAM_SPEED);
            if (keys.q || keys.Q) camPos.y += CAM_SPEED;
            if (keys.e || keys.E) camPos.y -= CAM_SPEED;
        }

        camPos.y = Math.max(8, camPos.y);

        cameraMoving = cinematicActive
            || camPos.distanceToSquared(lastCameraPos) > 0.0001
            || Math.abs(camYaw - lastCameraYaw) > 0.0001
            || Math.abs(camPitch - lastCameraPitch) > 0.0001;

        lastCameraPos.copy(camPos);
        lastCameraYaw = camYaw;
        lastCameraPitch = camPitch;

        camera.position.copy(camPos);
        camera.lookAt(camPos.clone().addScaledVector(dir, 100));
    }

    document.addEventListener('keydown', (event) => {
        if (isTypingTarget(event.target)) return;
        stopCinematic();
        keys[event.key] = true;
        markInteraction();
    });

    document.addEventListener('keyup', (event) => {
        if (isTypingTarget(event.target)) return;
        keys[event.key] = false;
        markInteraction();
    });

    document.addEventListener('mousedown', (event) => {
        if (event.target.id === 'height-filter' || isTypingTarget(event.target)) return;
        stopCinematic();
        markInteraction();
        if (event.button === 0) {
            mouseDown = true;
            lastMouse = { x: event.clientX, y: event.clientY };
        }
    });

    document.addEventListener('mouseup', (event) => {
        if (event.button === 0) mouseDown = false;
        markInteraction();
    });

    document.addEventListener('mousemove', (event) => {
        if (!mouseDown) return;
        stopCinematic();
        markInteraction();
        const dx = event.clientX - lastMouse.x;
        const dy = event.clientY - lastMouse.y;
        lastMouse = { x: event.clientX, y: event.clientY };
        camYaw -= dx * CAM_SENSITIVITY;
        camPitch = Math.max(-1.4, Math.min(1.4, camPitch + dy * CAM_SENSITIVITY));
    });

    document.addEventListener('wheel', (event) => {
        if (isTypingTarget(event.target)) return;
        stopCinematic();
        markInteraction();
        camPos.addScaledVector(getDirection(), -event.deltaY * 0.3);
        camPos.y = Math.max(8, camPos.y);
    }, { passive: true });

    window.addEventListener('blur', () => {
        Object.keys(keys).forEach((key) => {
            keys[key] = false;
        });
        mouseDown = false;
    });

    document.addEventListener('contextmenu', (event) => event.preventDefault());

    updateCamera();

    return {
        updateCamera,
        transitionToView(view) {
            startCinematic(view);
        },
        focusOnBuilding(meta, targetOverride = null) {
            const baseHeight = meta.building.g * 0.02;
            const targetHeight = Math.max(10, Math.min(38, meta.height * 0.1));
            const cameraHeight = Math.max(30, Math.min(120, meta.height * 0.28 + 24));
            const distance = Math.max(50, Math.min(220, meta.footprintRadius * 2.8 + meta.height * 0.18 + 30));
            const target = new THREE.Vector3(
                targetOverride?.x ?? meta.centerX,
                baseHeight + targetHeight,
                targetOverride?.z ?? meta.centerZ
            );

            const pos = target.clone().addScaledVector(SEARCH_FOCUS_DIRECTION, -distance);
            pos.y = baseHeight + cameraHeight;
            const angles = anglesFromLookAt(pos, target);

            cinematicFrom.pos.copy(camPos);
            cinematicFrom.yaw = camYaw;
            cinematicFrom.pitch = camPitch;
            cinematicTo.pos.copy(pos);
            cinematicTo.yaw = angles.yaw;
            cinematicTo.pitch = angles.pitch;
            cinematicProgress = 0;
            cinematicActive = true;
        },
        isBusy() {
            return cameraMoving || mouseDown || (performance.now() - lastInteractionAt) < 180;
        },
        getDebugState() {
            return {
                x: camPos.x,
                y: camPos.y,
                z: camPos.z,
                yaw: camYaw,
                pitch: camPitch,
                busy: cameraMoving || mouseDown
            };
        }
    };
}
