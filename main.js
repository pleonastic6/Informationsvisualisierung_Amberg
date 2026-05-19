import {
    buildBuildings,
    buildRankingView,
    setMapHighlight,
    setRankingHighlight
} from './js/buildings.js';
import { createControls } from './js/controls.js';
import { createHoverController } from './js/interaction.js';
import { buildLod2Group } from './js/lod2.js';
import { buildPois, setPoiHighlight, setPoiVisibility } from './js/pois.js';
import { createScene } from './js/scene.js';
import { buildStreets } from './js/streets.js';
import { buildTerrain, createTerrainSampler } from './js/terrain.js';
import {
    bindLod2Toggle,
    bindPoiToggle,
    bindHeightFilter,
    createModeController,
    createRankingLabelController,
    createSearchController,
    createViewController,
    finishLoading,
    getMinHeightFilter,
    hideTooltip,
    setLegendForHeight,
    setProgress,
    setSliderMax,
    showTooltip,
    updateStats
} from './js/ui.js';

const state = {
    currentMode: 'height',
    viewMode: 'map',
    transitionProgress: 0,
    mesh: null,
    buildingMeta: [],
    rankingGroup: null,
    rankingItems: [],
    rankingBuildPromise: null,
    streetGroup: null,
    terrainMesh: null,
    poiGroup: null,
    lod2Group: null,
    lod2Visible: false,
    lod2Stats: null,
    poiMeshes: [],
    poisVisible: true,
    sourceBuildings: [],
    palettes: {
        height: [],
        era: [],
        ground: []
    },
    maxHeight: 1,
    minGround: 0,
    maxGround: 1,
    allStats: null,
    rankingStats: null,
    hoveredMapMeta: null,
    hoveredRankingItem: null,
    hoveredPoi: null,
    pinnedMapMeta: null,
    searchEntries: []
};

function applyDatasetBranding(meta = {}) {
    const areaName = meta.query_area || 'Amberg';
    const source = meta.source || 'OpenStreetMap';
    document.title = `${areaName} — Gebäudestruktur`;

    const loadingTitle = document.getElementById('loading-title');
    const loadingSub = document.getElementById('loading-sub');
    const hudTitle = document.querySelector('#hud-tl h1');
    const hudSub = document.querySelector('#hud-tl .sub');

    if (loadingTitle) loadingTitle.textContent = areaName;
    if (loadingSub) loadingSub.textContent = `Gebäudestruktur · ${source}`;
    if (hudTitle) hudTitle.textContent = areaName;
    if (hudSub) hudSub.textContent = 'Gebäudevisualisierung';
}

function applyTerrainToBuildings(buildings, sampler, sceneOffset = 0) {
    if (!sampler) return;
    buildings.forEach((building) => {
        building.g = Number(sampler.sampleElevation(building.x, building.z).toFixed(2));
        building.gScene = Number((sampler.sampleSceneY(building.x, building.z) + sceneOffset).toFixed(3));
    });
}

function applyTerrainToStreets(streetData, sampler) {
    if (!sampler || !streetData?.streets) return;
    streetData.streets.forEach((street) => {
        const y = [];
        for (let i = 0; i < street.c.length; i += 2) {
            y.push(Number((sampler.sampleSceneY(street.c[i], street.c[i + 1]) + 0.2).toFixed(3)));
        }
        street.y = y;
    });
}

function applyTerrainToPois(poiData, sampler) {
    if (!sampler || !poiData?.pois) return;
    poiData.pois.forEach((poi) => {
        poi.y = Number((sampler.sampleSceneY(poi.x, poi.z) + 4.6).toFixed(3));
    });
}

const { scene, camera, renderer } = createScene();
const controls = createControls(camera);
const rankingLabels = createRankingLabelController({ camera, getState: () => state });

function getFocusTarget(meta) {
    return { x: meta.centerX, z: -meta.centerZ };
}

function clearMapMetaHighlight(meta) {
    if (!meta || !state.mesh) return;
    setMapHighlight({
        mesh: state.mesh,
        meta,
        sourceColors: state.palettes[state.currentMode],
        minHeight: getMinHeightFilter(),
        active: false
    });
}

function setMapMetaHighlight(meta, active = true) {
    if (!meta || !state.mesh) return;
    setMapHighlight({
        mesh: state.mesh,
        meta,
        sourceColors: state.palettes[state.currentMode],
        minHeight: getMinHeightFilter(),
        active,
        mix: 0.4
    });
}

function updatePinnedPulse() {
    // bewusst leer: gepinnte Gebäude bleiben statisch hervorgehoben,
    // ohne per-frame Farb- oder Marker-Animation.
}

function createSearchEntries() {
    return state.buildingMeta
        .map((meta) => {
            const bin = meta.bin ?? '';
            const name = meta.name ?? '';
            return {
                ...meta,
                bin,
                name,
                searchBin: bin.toLowerCase(),
                searchName: name.toLowerCase()
            };
        })
        .filter((meta) => meta.bin || meta.name)
        .sort((a, b) => b.height - a.height);
}

function focusBuilding(meta) {
    if (!meta) return;
    if (state.pinnedMapMeta && state.pinnedMapMeta !== meta && state.pinnedMapMeta !== state.hoveredMapMeta) {
        clearMapMetaHighlight(state.pinnedMapMeta);
    }

    state.pinnedMapMeta = meta;
    const target = getFocusTarget(meta);
    state.viewMode = 'map';
    clearHighlights();
    hideTooltip();
    controls.transitionToView('map');
    controls.focusOnBuilding(meta, target);
    viewController.applyViewMode('map');
    setMapMetaHighlight(meta, true);
}

function updateVisibleStats() {
    const stats = state.viewMode === 'ranking'
        ? (state.rankingStats ?? state.allStats)
        : state.allStats;
    if (!stats) return;
    updateStats(stats);
}

async function ensureRankingView() {
    if (state.rankingGroup) return;
    if (state.rankingBuildPromise) return state.rankingBuildPromise;

    state.rankingBuildPromise = Promise.resolve().then(() => {
        const rankingResult = buildRankingView({
            scene,
            buildings: state.sourceBuildings,
            maxHeight: state.maxHeight,
            minGround: state.minGround,
            maxGround: state.maxGround
        });

        state.rankingGroup = rankingResult.group;
        state.rankingItems = rankingResult.items;
        state.rankingItems.forEach((item) => {
            const sourceMeta = state.buildingMeta[item.meta.sourceIndex];
            if (!sourceMeta) return;
            item.meta.bin = sourceMeta.bin;
            item.meta.name = sourceMeta.name;
        });
        rankingLabels.setItems(state.rankingItems);
        state.rankingStats = {
            count: rankingResult.items.length,
            maxHeight: rankingResult.items[0]?.meta.height ?? 0,
            averageHeight: rankingResult.items.reduce((sum, item) => sum + item.meta.height, 0) / Math.max(1, rankingResult.items.length),
            streetCount: 0
        };

        modeController.applyMode(state.currentMode);
        updateVisibleStats();
    }).finally(() => {
        state.rankingBuildPromise = null;
    });

    return state.rankingBuildPromise;
}

function clearHighlights() {
    if (state.hoveredPoi) {
        setPoiHighlight(state.hoveredPoi, false);
        state.hoveredPoi = null;
    }

    if (state.hoveredMapMeta && state.hoveredMapMeta !== state.pinnedMapMeta) {
        clearMapMetaHighlight(state.hoveredMapMeta);
        state.hoveredMapMeta = null;
    }

    if (state.hoveredRankingItem) {
        setRankingHighlight(state.hoveredRankingItem, false);
        state.hoveredRankingItem = null;
    }
}

function handleHover(meta, pointer, context) {
    if (context?.type === 'poi') {
        if (state.hoveredMapMeta && state.hoveredMapMeta !== state.pinnedMapMeta) {
            clearMapMetaHighlight(state.hoveredMapMeta);
            state.hoveredMapMeta = null;
        }

        if (state.hoveredRankingItem) {
            setRankingHighlight(state.hoveredRankingItem, false);
            state.hoveredRankingItem = null;
        }

        if (state.hoveredPoi && state.hoveredPoi !== context.item) {
            setPoiHighlight(state.hoveredPoi, false);
        }

        state.hoveredPoi = context.item;
        setPoiHighlight(context.item, true);
    }

    if (context?.type === 'map') {
        if (state.hoveredPoi) {
            setPoiHighlight(state.hoveredPoi, false);
            state.hoveredPoi = null;
        }

        if (state.hoveredRankingItem) {
            setRankingHighlight(state.hoveredRankingItem, false);
            state.hoveredRankingItem = null;
        }

        if (state.hoveredMapMeta && state.hoveredMapMeta !== meta && state.hoveredMapMeta !== state.pinnedMapMeta) {
            clearMapMetaHighlight(state.hoveredMapMeta);
        }

        state.hoveredMapMeta = meta;
        setMapMetaHighlight(meta, true);
    }

    if (context?.type === 'ranking') {
        if (state.hoveredPoi) {
            setPoiHighlight(state.hoveredPoi, false);
            state.hoveredPoi = null;
        }

        if (state.hoveredMapMeta && state.hoveredMapMeta !== state.pinnedMapMeta) {
            clearMapMetaHighlight(state.hoveredMapMeta);
            state.hoveredMapMeta = null;
        }

        if (state.hoveredRankingItem && state.hoveredRankingItem !== context.item) {
            setRankingHighlight(state.hoveredRankingItem, false);
        }

        state.hoveredRankingItem = context.item;
        setRankingHighlight(context.item, true);
    }

    showTooltip(meta, pointer);
}

function updateViewTransition() {
    const target = state.viewMode === 'ranking' ? 1 : 0;
    state.transitionProgress += (target - state.transitionProgress) * 0.08;
    if (Math.abs(target - state.transitionProgress) < 0.001) state.transitionProgress = target;

    const mapAlpha = 1 - state.transitionProgress;
    const rankingAlpha = state.transitionProgress;

    if (state.mesh) {
        state.mesh.material.opacity = Math.max(0.08, mapAlpha);
        state.mesh.visible = mapAlpha > 0.02;
        state.mesh.position.y = -state.transitionProgress * 10;
    }

    if (state.terrainMesh) {
        state.terrainMesh.material.opacity = Math.max(0.04, mapAlpha * 0.92);
        state.terrainMesh.visible = mapAlpha > 0.02;
    }

    if (state.lod2Group) {
        state.lod2Group.visible = state.lod2Visible && mapAlpha > 0.02;
        state.lod2Group.position.y = -state.transitionProgress * 10;
        state.lod2Group.children.forEach((child) => {
            child.material.opacity = (child.userData.baseOpacity ?? child.material.opacity) * mapAlpha;
        });
    }

    if (state.streetGroup) {
        state.streetGroup.visible = mapAlpha > 0.02;
        state.streetGroup.children.forEach((child) => {
            child.material.opacity = (child.userData.baseOpacity ?? child.material.opacity) * mapAlpha;
        });
        state.streetGroup.position.y = -state.transitionProgress * 6;
    }

    if (state.poiGroup) {
        state.poiGroup.visible = state.poisVisible && mapAlpha > 0.12;
        state.poiGroup.position.y = -state.transitionProgress * 6;
    }

    if (state.rankingGroup) {
        state.rankingGroup.visible = rankingAlpha > 0.02;
        state.rankingGroup.position.y = (1 - rankingAlpha) * 18;
        state.rankingGroup.scale.setScalar(0.92 + rankingAlpha * 0.08);
        state.rankingItems.forEach((item) => {
            item.mesh.material.opacity = item.mesh.visible ? Math.max(0.05, rankingAlpha) : 0;
        });
    }
}

const modeController = createModeController({
    getState: () => state,
    setMode: (mode) => {
        state.currentMode = mode;
        modeController.applyMode(mode);
        if (state.pinnedMapMeta) setMapMetaHighlight(state.pinnedMapMeta, true);
        clearHighlights();
        hideTooltip();
    }
});

const viewController = createViewController({
    getState: () => state,
    setViewMode: async (viewMode) => {
        if (viewMode === 'ranking') await ensureRankingView();
        state.viewMode = viewMode;
        clearHighlights();
        hideTooltip();
        controls.transitionToView(viewMode);
        viewController.applyViewMode(viewMode);
    },
    updateVisibleStats
});

const searchController = createSearchController({
    getSearchState: () => ({ searchEntries: state.searchEntries }),
    onSelect: (item) => {
        focusBuilding(item);
        searchController.setSelected(item);
    }
});

bindHeightFilter(() => ({
    mesh: state.mesh,
    buildingMeta: state.buildingMeta,
    sourceColors: state.palettes[state.currentMode],
    rankingItems: state.rankingItems,
    currentMode: state.currentMode
}), () => {
    clearHighlights();
    if (state.pinnedMapMeta) setMapMetaHighlight(state.pinnedMapMeta, true);
    hideTooltip();
    updateVisibleStats();
});

bindPoiToggle({
    getPoiState: () => ({ visible: state.poisVisible }),
    onToggle: (visible) => {
        state.poisVisible = visible;
        setPoiVisibility(state.poiGroup, state.poiMeshes, visible);
        if (!visible && state.hoveredPoi) {
            setPoiHighlight(state.hoveredPoi, false);
            state.hoveredPoi = null;
            hideTooltip();
        }
    }
});

bindLod2Toggle({
    getLod2State: () => ({ visible: state.lod2Visible }),
    onToggle: (visible) => {
        state.lod2Visible = visible;
        if (state.lod2Group) state.lod2Group.visible = visible && state.viewMode === 'map';
    }
});

createHoverController({
    camera,
    getInteractiveState: () => ({
        viewMode: state.viewMode,
        mapMesh: state.mesh,
        mapMeta: state.buildingMeta,
        rankingItems: state.rankingItems,
        poiMeshes: state.poiMeshes,
        poiVisible: state.poisVisible,
        minHeight: getMinHeightFilter(),
        cameraBusy: controls.isBusy()
    }),
    onHover: handleHover,
    onLeave: () => {
        clearHighlights();
        hideTooltip();
    }
});

function animate() {
    requestAnimationFrame(animate);
    controls.updateCamera();
    updateViewTransition();
    updatePinnedPulse();
    rankingLabels.update();
    renderer.render(scene, camera);
}

async function init() {
    setProgress(5, 'Three.js initialisieren…');
    animate();

    setProgress(15, 'Gebäudedaten laden…');
    const [buildingResponse, metadataResponse, poiResponse, terrainResponse, lod2Response] = await Promise.all([
        fetch('buildings.json'),
        fetch('building-metadata.json').catch(() => null),
        fetch('pois.json').catch(() => null),
        fetch('terrain.json').catch(() => null),
        fetch('data/lod2-amberg/704_5480.scene.lod2.json').catch(() => null)
    ]);
    const [buildingData, metadataData, poiData, terrainData, lod2Data] = await Promise.all([
        buildingResponse.json(),
        metadataResponse?.ok ? metadataResponse.json() : Promise.resolve(null),
        poiResponse?.ok ? poiResponse.json() : Promise.resolve(null),
        terrainResponse?.ok ? terrainResponse.json() : Promise.resolve(null),
        lod2Response?.ok ? lod2Response.json() : Promise.resolve(null)
    ]);
    const buildings = buildingData.buildings;
    const metadata = metadataData?.buildings ?? [];
    state.sourceBuildings = buildings;
    applyDatasetBranding(buildingData.meta);

    let terrainSampler = null;
    let terrainSceneOffset = 0;
    if (terrainData?.elevations?.length) {
        terrainSampler = createTerrainSampler(terrainData);
        state.terrainMesh = buildTerrain(scene, terrainData);
        terrainSceneOffset = state.terrainMesh.position.y || 0;
        applyTerrainToBuildings(buildings, terrainSampler, terrainSceneOffset);
        controls.setTerrainSampler(terrainSampler);
    }

    const heights = buildings.map((building) => building.h);
    const grounds = buildings.map((building) => building.g);

    state.maxHeight = Math.max(...heights);
    state.minGround = Math.min(...grounds);
    state.maxGround = Math.max(...grounds);
    setSliderMax(state.maxHeight);

    if (state.maxGround === state.minGround) {
        const groundButton = document.querySelector('.mode-btn[data-mode="ground"]');
        if (groundButton) groundButton.style.display = 'none';
        if (state.currentMode === 'ground') state.currentMode = 'height';
    } else {
        const groundButton = document.querySelector('.mode-btn[data-mode="ground"]');
        if (groundButton) groundButton.style.display = '';
    }

    state.allStats = {
        count: buildings.length,
        maxHeight: state.maxHeight,
        averageHeight: heights.reduce((sum, height) => sum + height, 0) / heights.length,
        streetCount: null
    };

    setLegendForHeight(state.maxHeight);
    updateVisibleStats();

    setProgress(30, 'Geometrien aufbauen…');
    const buildingResult = await buildBuildings({
        scene,
        buildings,
        maxHeight: state.maxHeight,
        minGround: state.minGround,
        maxGround: state.maxGround,
        setProgress
    });

    state.mesh = buildingResult.mesh;
    state.buildingMeta = buildingResult.buildingMeta;
    state.palettes = buildingResult.palettes;

    state.buildingMeta.forEach((meta, index) => {
        const [bin = '', name = ''] = metadata[index] ?? [];
        meta.bin = bin;
        meta.name = name;
    });

    state.searchEntries = createSearchEntries();

    modeController.applyMode(state.currentMode);
    viewController.applyViewMode(state.viewMode);

    setProgress(90, 'Straßen laden…');
    try {
        const streetResponse = await fetch('streets.json');
        if (streetResponse.ok) {
            const streetData = await streetResponse.json();
            applyTerrainToStreets(streetData, terrainSampler);
            state.streetGroup = buildStreets(scene, streetData);
            state.streetGroup.children.forEach((child) => {
                child.userData.baseOpacity = child.material.opacity;
            });
            state.allStats = {
                ...state.allStats,
                streetCount: streetData.meta.count
            };
            updateVisibleStats();
        }
    } catch {
        // ignore street loading failures
    }

    if (poiData?.pois?.length) {
        setProgress(94, 'POIs laden…');
        applyTerrainToPois(poiData, terrainSampler);
        const poiResult = buildPois(scene, poiData);
        state.poiGroup = poiResult.group;
        state.poiMeshes = poiResult.items;
        setPoiVisibility(state.poiGroup, state.poiMeshes, state.poisVisible);
    }

    if (lod2Data?.buildings?.length) {
        setProgress(97, 'LoD2-Prototyp laden…');
        const lod2Result = buildLod2Group(scene, lod2Data);
        state.lod2Group = lod2Result.group;
        state.lod2Stats = lod2Result.stats;
        state.lod2Group.visible = state.lod2Visible;
    }

    modeController.applyMode(state.currentMode);
    viewController.applyViewMode(state.viewMode);
    controls.transitionToView('map');
    updateViewTransition();
    finishLoading();
}

init();
