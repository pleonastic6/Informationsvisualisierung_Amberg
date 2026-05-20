const THREE = window.THREE;

import { findBuildingMetaByFaceIndex } from './buildings.js';
import { findLod2MetaByFaceIndex } from './lod2.js';

const HOVER_SAMPLE_MS = 90;
const MAP_HOVER_SAMPLE_MS = 140;
const HOVER_DELAY_MS = 320;

export function createHoverController({ camera, getInteractiveState, onHover, onLeave }) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovering = false;
    let pointerDown = null;
    let cachedRankingItems = [];
    let cachedRankingMeshes = [];
    let sampleTimer = null;
    let lastEvent = null;
    let lastHoverMeta = null;
    let lastHoverType = null;
    let pendingMeta = null;
    let pendingType = null;
    let pendingItem = null;
    let pendingSince = 0;

    function resetPending() {
        pendingMeta = null;
        pendingType = null;
        pendingItem = null;
        pendingSince = 0;
    }

    function clearHover() {
        resetPending();
        lastHoverMeta = null;
        lastHoverType = null;
        if (sampleTimer) {
            clearTimeout(sampleTimer);
            sampleTimer = null;
        }
        if (!hovering) return;
        hovering = false;
        onLeave();
    }

    function updatePointer(event) {
        pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
        pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    function isInteractiveTarget(target) {
        const tag = target?.tagName?.toLowerCase();
        return tag === 'button' || tag === 'input' || tag === 'textarea' || target?.closest?.('#hud, #loading, #ranking-labels');
    }

    function resolveLod2Hit(state) {
        if (!state.lod2Visible || !state.lod2Meshes?.length) return null;
        const lod2Hits = raycaster.intersectObjects(state.lod2Meshes, false);
        const lod2Hit = lod2Hits[0];
        if (!lod2Hit || !lod2Hit.object.visible) return null;
        const kind = lod2Hit.object.userData.surfaceKind;
        const tileId = lod2Hit.object.userData.tileId;
        const tileEntry = state.lod2TileCache?.get?.(tileId);
        const meta = findLod2MetaByFaceIndex(
            tileEntry?.render?.buildingMeta,
            tileEntry?.render?.faceToBuilding,
            kind,
            lod2Hit.faceIndex
        );
        return meta ? { meta, item: lod2Hit.object, type: 'lod2' } : null;
    }

    function scheduleSample(delay = HOVER_SAMPLE_MS) {
        if (sampleTimer) return;
        sampleTimer = setTimeout(processHover, delay);
    }

    function processHover() {
        sampleTimer = null;
        const event = lastEvent;
        if (!event) return;

        const state = getInteractiveState();
        if (!state) return clearHover();

        raycaster.setFromCamera(pointer, camera);

        let meta = null;
        let type = null;
        let item = null;

        if (state.viewMode === 'ranking') {
            if (cachedRankingItems !== state.rankingItems) {
                cachedRankingItems = state.rankingItems;
                cachedRankingMeshes = cachedRankingItems.map((entry) => entry.mesh);
            }
            const hits = raycaster.intersectObjects(cachedRankingMeshes, false);
            const hit = hits[0];
            if (hit && hit.object.visible) {
                item = hit.object.userData.rankingItem ?? null;
                meta = hit.object.userData.meta;
                type = 'ranking';
            }
        } else if (state.cameraBusy) {
            return clearHover();
        } else if (state.poiVisible && state.poiMeshes?.length) {
            const poiHits = raycaster.intersectObjects(state.poiMeshes, false);
            const poiHit = poiHits[0];
            if (poiHit && poiHit.object.visible && poiHit.object.userData.meta) {
                item = poiHit.object;
                meta = poiHit.object.userData.meta;
                type = 'poi';
            }
        }

        if (!meta && !type && !state.cameraBusy) {
            const lod2Hit = resolveLod2Hit(state);
            if (lod2Hit) {
                meta = lod2Hit.meta;
                item = lod2Hit.item;
                type = lod2Hit.type;
            }
        }

        if (!meta && !type && !state.cameraBusy && state.mapMesh && state.mapMesh.visible) {
            const hits = raycaster.intersectObject(state.mapMesh, false);
            const hit = hits[0];
            if (hit) {
                const foundMeta = findBuildingMetaByFaceIndex(state.mapMeta, hit.faceIndex);
                if (foundMeta && foundMeta.height >= state.minHeight) {
                    meta = foundMeta;
                    type = 'map';
                }
            }
        }

        if (!meta || !type) return clearHover();

        const now = performance.now();
        if (pendingMeta !== meta || pendingType !== type) {
            pendingMeta = meta;
            pendingType = type;
            pendingItem = item;
            pendingSince = now;
            if (hovering && (lastHoverMeta !== meta || lastHoverType !== type)) {
                hovering = false;
                onLeave();
            }
            scheduleSample(type === 'map' ? MAP_HOVER_SAMPLE_MS : HOVER_SAMPLE_MS);
            return;
        }

        if (!hovering && now - pendingSince < HOVER_DELAY_MS) {
            scheduleSample(type === 'map' ? MAP_HOVER_SAMPLE_MS : HOVER_SAMPLE_MS);
            return;
        }

        if (hovering && lastHoverMeta === meta && lastHoverType === type) return;

        hovering = true;
        lastHoverMeta = meta;
        lastHoverType = type;
        onHover(
            meta,
            { x: event.clientX, y: event.clientY },
            type === 'ranking' || type === 'poi' ? { type, item: pendingItem } : { type, meta }
        );
    }

    window.addEventListener('mousemove', (event) => {
        lastEvent = event;
        updatePointer(event);
        const state = getInteractiveState();
        const delay = state?.viewMode === 'map' ? MAP_HOVER_SAMPLE_MS : HOVER_SAMPLE_MS;
        scheduleSample(delay);
    });

    window.addEventListener('mousedown', (event) => {
        if (event.button !== 0 || isInteractiveTarget(event.target)) return;
        pointerDown = { x: event.clientX, y: event.clientY, t: performance.now() };
    });

    window.addEventListener('click', (event) => {
        if (event.button !== 0 || isInteractiveTarget(event.target)) return;
        if (!pointerDown) return;
        const move = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
        pointerDown = null;
        if (move > 6) return;

        const state = getInteractiveState();
        if (!state || state.cameraBusy || state.viewMode !== 'map') return;

        updatePointer(event);
        raycaster.setFromCamera(pointer, camera);

        const lod2Hit = resolveLod2Hit(state);
        if (lod2Hit && typeof onHover === 'function') {
            onHover(lod2Hit.meta, { x: event.clientX, y: event.clientY }, { type: 'lod2', item: lod2Hit.item, select: true });
        }
    });

    window.addEventListener('mouseleave', clearHover);
    window.addEventListener('blur', clearHover);

    return { clearHover };
}
