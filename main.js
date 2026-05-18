import {
    buildBuildings,
    buildRankingView,
    setMapHighlight,
    setRankingHighlight
} from './js/buildings.js';
import { createControls } from './js/controls.js';
import { createHoverController } from './js/interaction.js';
import { createScene } from './js/scene.js';
import { buildStreets } from './js/streets.js';
import {
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
    pinnedMapMeta: null,
    searchEntries: []
};

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
    if (context?.type === 'map') {
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

    if (state.streetGroup) {
        state.streetGroup.visible = mapAlpha > 0.02;
        state.streetGroup.children.forEach((child) => {
            child.material.opacity = (child.userData.baseOpacity ?? child.material.opacity) * mapAlpha;
        });
        state.streetGroup.position.y = -state.transitionProgress * 6;
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

createHoverController({
    camera,
    getInteractiveState: () => ({
        viewMode: state.viewMode,
        mapMesh: state.mesh,
        mapMeta: state.buildingMeta,
        rankingItems: state.rankingItems,
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
    const [buildingResponse, metadataResponse] = await Promise.all([
        fetch('buildings.json'),
        fetch('building-metadata.json').catch(() => null)
    ]);
    const [buildingData, metadataData] = await Promise.all([
        buildingResponse.json(),
        metadataResponse?.ok ? metadataResponse.json() : Promise.resolve(null)
    ]);
    const buildings = buildingData.buildings;
    const metadata = metadataData?.buildings ?? [];
    state.sourceBuildings = buildings;

    const heights = buildings.map((building) => building.h);
    const grounds = buildings.map((building) => building.g);

    state.maxHeight = Math.max(...heights);
    state.minGround = Math.min(...grounds);
    state.maxGround = Math.max(...grounds);
    setSliderMax(state.maxHeight);

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

    modeController.applyMode(state.currentMode);
    viewController.applyViewMode(state.viewMode);
    controls.transitionToView('map');
    updateViewTransition();
    finishLoading();
}

init();
