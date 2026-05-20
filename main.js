import {
    buildBuildings,
    buildRankingView,
    setMapHighlight,
    setRankingHighlight
} from './js/buildings.js';
import { createControls } from './js/controls.js';
import { createHoverController } from './js/interaction.js';
import { buildLod2Group, labelLod2Function, labelLod2RoofType, setLod2Highlight } from './js/lod2.js';
import { buildPois, setPoiHighlight, setPoiVisibility } from './js/pois.js';
import { createScene } from './js/scene.js';
import { buildStreets } from './js/streets.js';
import { buildTerrain, createTerrainSampler } from './js/terrain.js';
import {
    bindLod2Toggle,
    bindLod2Filters,
    bindPoiToggle,
    bindHeightFilter,
    createModeController,
    createRankingLabelController,
    createSearchController,
    createViewController,
    finishLoading,
    getMinHeightFilter,
    hideTooltip,
    setLod2FilterOptions,
    setLod2FilterVisibility,
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
    lod2LoadPromise: null,
    terrainSampler: null,
    lod2Manifest: null,
    lod2TileCache: new Map(),
    lod2ActiveTiles: [],
    lod2LastTileSyncAt: 0,
    lod2LastTileCamera: null,
    lod2Meshes: [],
    lod2BuildingMeta: [],
    lod2HighlightMesh: null,
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
    hoveredLod2Meta: null,
    pinnedMapMeta: null,
    pinnedLod2Meta: null,
    lod2Filters: {
        roofType: 'all',
        functionCode: 'all'
    },
    searchHint: 'Suche per OSM-ID oder Name',
    searchEntries: []
};

const LOD2_MANIFEST_PATH = 'data/lod2-amberg/amberg-lod2.manifest.json';
const LOD2_TILE_LOAD_RADIUS = 230;
const LOD2_TILE_UNLOAD_RADIUS = 320;
const LOD2_TILE_SYNC_MS = 1200;
const LOD2_MAX_ACTIVE_TILES = 2;

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

function isOsmBuildingsVisible() {
    return !state.lod2Visible;
}

function setLod2ToggleLoading(isLoading) {
    const button = document.getElementById('lod2-toggle');
    if (!button) return;
    button.disabled = isLoading;
    button.textContent = isLoading ? 'LoD2 lädt…' : 'LoD2';
}

function extractLod2FilterOptions(buildings) {
    const roofMap = new Map();
    const functionMap = new Map();

    for (const building of buildings || []) {
        const roofType = String(building.roofType || '').trim();
        const functionCode = String(building.function || '').trim();
        if (roofType) roofMap.set(roofType, labelLod2RoofType(roofType));
        if (functionCode) functionMap.set(functionCode, labelLod2Function(functionCode));
    }

    return {
        roofTypes: [...roofMap.entries()]
            .sort((a, b) => a[1].localeCompare(b[1], 'de'))
            .map(([value, label]) => ({ value, label })),
        functions: [...functionMap.entries()]
            .sort((a, b) => a[1].localeCompare(b[1], 'de'))
            .map(([value, label]) => ({ value, label })),
    };
}

function getFilteredLod2Buildings(buildings) {
    return (buildings || []).filter((building) => {
        const roofType = String(building.roofType || '').trim();
        const functionCode = String(building.function || '').trim();
        if (state.lod2Filters.roofType !== 'all' && roofType !== state.lod2Filters.roofType) return false;
        if (state.lod2Filters.functionCode !== 'all' && functionCode !== state.lod2Filters.functionCode) return false;
        return true;
    });
}

function ensureLod2RootGroup() {
    if (state.lod2Group) return state.lod2Group;
    state.lod2Group = new THREE.Group();
    state.lod2Group.name = 'lod2-root-group';
    scene.add(state.lod2Group);
    return state.lod2Group;
}

function disposeLod2Render(render) {
    if (!render?.group) return;
    render.group.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry?.dispose?.();
        child.material?.dispose?.();
    });
    render.group.parent?.remove(render.group);
}

function buildLod2TileRender(tileId, tileData) {
    const root = ensureLod2RootGroup();
    const filteredBuildings = getFilteredLod2Buildings(tileData.buildings || []);
    const result = buildLod2Group(root, {
        meta: {
            ...(tileData.meta || {}),
            building_count: filteredBuildings.length,
        },
        buildings: filteredBuildings,
    }, {
        tileId,
        terrainSampler: state.terrainSampler,
    });
    result.group.visible = false;
    return result;
}

function refreshLod2DerivedState() {
    const activeEntries = state.lod2ActiveTiles
        .map((tileId) => state.lod2TileCache.get(tileId))
        .filter(Boolean);

    state.lod2Meshes = activeEntries.flatMap((entry) => entry.render?.group?.children.filter((child) => child.isMesh) || []);
    state.lod2BuildingMeta = activeEntries.flatMap((entry) => entry.render?.buildingMeta || []);
    state.lod2Stats = {
        buildingCount: state.lod2BuildingMeta.length,
        polygonCount: activeEntries.reduce((sum, entry) => sum + (entry.render?.stats?.polygonCount || 0), 0),
        triangleCount: activeEntries.reduce((sum, entry) => sum + (entry.render?.stats?.triangleCount || 0), 0),
    };
    refreshSearchEntries();
    updateVisibleStats();
}

function updateLod2TileVisibility() {
    if (!state.lod2Group) return;
    const activeSet = new Set(state.lod2ActiveTiles);
    for (const [tileId, entry] of state.lod2TileCache.entries()) {
        if (entry.render?.group) {
            entry.render.group.visible = activeSet.has(tileId) && state.lod2Visible && state.viewMode === 'map';
        }
    }
}

function rebuildLod2Group() {
    if (!state.lod2Manifest) return;
    ensureLod2RootGroup();
    state.hoveredLod2Meta = null;
    state.pinnedLod2Meta = null;
    state.lod2HighlightMesh = null;
    for (const [tileId, entry] of state.lod2TileCache.entries()) {
        if (entry.render) disposeLod2Render(entry.render);
        entry.render = buildLod2TileRender(tileId, entry.data);
    }
    updateLod2TileVisibility();
    refreshLod2DerivedState();
}

function pointToTileDistance(tile, x, z) {
    const bounds = tile.scene_bounds;
    if (!bounds) return Infinity;
    const dx = x < bounds.min_x ? bounds.min_x - x : (x > bounds.max_x ? x - bounds.max_x : 0);
    const dz = z < bounds.min_z ? bounds.min_z - z : (z > bounds.max_z ? z - bounds.max_z : 0);
    return Math.hypot(dx, dz);
}

function getRequiredLod2Tiles(cameraX, cameraZ) {
    const tiles = state.lod2Manifest?.tiles || [];
    return tiles
        .map((tile) => ({ tile, distance: pointToTileDistance(tile, cameraX, cameraZ) }))
        .filter((entry) => entry.distance <= LOD2_TILE_LOAD_RADIUS)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, LOD2_MAX_ACTIVE_TILES)
        .map((entry) => entry.tile);
}

async function loadLod2Tile(tile) {
    if (state.lod2TileCache.has(tile.tile)) return state.lod2TileCache.get(tile.tile);
    const response = await fetch(tile.path);
    if (!response.ok) {
        throw new Error(`LoD2 tile request failed: ${tile.path} (${response.status})`);
    }
    const data = await response.json();
    const entry = {
        tile,
        data,
        render: buildLod2TileRender(tile.tile, data),
    };
    state.lod2TileCache.set(tile.tile, entry);
    return entry;
}

async function syncVisibleLod2Tiles(force = false) {
    if (!state.lod2Manifest || !state.lod2Visible) return;
    if (!force && controls.isBusy()) return;

    const cameraState = controls.getDebugState();
    const cameraX = cameraState.x;
    const cameraZ = -cameraState.z;
    const now = performance.now();

    if (!force && state.lod2LastTileCamera) {
        const moved = Math.hypot(cameraX - state.lod2LastTileCamera.x, cameraZ - state.lod2LastTileCamera.z);
        if (moved < 80 && now - state.lod2LastTileSyncAt < LOD2_TILE_SYNC_MS) return;
    }

    const required = getRequiredLod2Tiles(cameraX, cameraZ);
    const keep = new Set(required.map((tile) => tile.tile));

    const retained = state.lod2ActiveTiles.filter((tileId) => {
        const tile = (state.lod2Manifest.tiles || []).find((entry) => entry.tile === tileId);
        if (!tile) return false;
        return keep.has(tileId) || pointToTileDistance(tile, cameraX, cameraZ) <= LOD2_TILE_UNLOAD_RADIUS;
    });

    for (const tile of required) {
        if (!retained.includes(tile.tile)) retained.push(tile.tile);
    }

    const missing = required.filter((tile) => !state.lod2TileCache.has(tile.tile));
    if (missing.length) {
        setLod2ToggleLoading(true);
        await Promise.all(missing.map((tile) => loadLod2Tile(tile)));
        setLod2ToggleLoading(false);
    }

    const nextActive = [...new Set(retained)];
    const changed = nextActive.length !== state.lod2ActiveTiles.length
        || nextActive.some((tileId, index) => tileId !== state.lod2ActiveTiles[index])
        || missing.length > 0
        || force;

    state.lod2ActiveTiles = nextActive;
    state.lod2LastTileCamera = { x: cameraX, z: cameraZ };
    state.lod2LastTileSyncAt = now;

    if (changed) {
        updateLod2TileVisibility();
        refreshLod2DerivedState();
    }
}

async function ensureLod2Loaded() {
    if (state.lod2Group) return state.lod2Group;
    if (state.lod2LoadPromise) return state.lod2LoadPromise;

    state.lod2LoadPromise = (async () => {
        setLod2ToggleLoading(true);
        const response = await fetch(LOD2_MANIFEST_PATH);
        if (!response.ok) {
            throw new Error(`LoD2 manifest request failed: ${response.status}`);
        }
        state.lod2Manifest = await response.json();
        const roofTypes = Object.keys(state.lod2Manifest.meta?.roof_type_counts || {})
            .filter((value) => value && value !== 'unknown')
            .map((value) => ({ value, label: labelLod2RoofType(value) }))
            .sort((a, b) => a.label.localeCompare(b.label, 'de'));
        const functions = Object.keys(state.lod2Manifest.meta?.function_counts || {})
            .filter((value) => value && value !== 'unknown')
            .map((value) => ({ value, label: labelLod2Function(value) }))
            .sort((a, b) => a.label.localeCompare(b.label, 'de'));
        setLod2FilterOptions({ roofTypes, functions });
        await syncVisibleLod2Tiles(true);
        return state.lod2Group;
    })().finally(() => {
        state.lod2LoadPromise = null;
        setLod2ToggleLoading(false);
    });

    return state.lod2LoadPromise;
}

const { scene, camera, renderer } = createScene();
const controls = createControls(camera);
const rankingLabels = createRankingLabelController({ camera, getState: () => state });

function getFocusTarget(meta) {
    return { x: meta.centerX, z: -meta.centerZ };
}

function clearMapMetaHighlight(meta) {
    if (!meta || !state.mesh || !isOsmBuildingsVisible()) return;
    setMapHighlight({
        mesh: state.mesh,
        meta,
        sourceColors: state.palettes[state.currentMode],
        minHeight: getMinHeightFilter(),
        active: false
    });
}

function setMapMetaHighlight(meta, active = true) {
    if (!meta || !state.mesh || !isOsmBuildingsVisible()) return;
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

function createOsmSearchEntries() {
    return state.buildingMeta
        .map((meta) => {
            const bin = meta.bin ?? '';
            const name = meta.name ?? '';
            return {
                ...meta,
                bin,
                name,
                displayTitle: name || `OSM ${bin}`,
                displayMeta: bin ? `OSM ${bin}` : 'Ohne OSM-ID',
                statusLabel: name ? `${name}${bin ? ` · OSM ${bin}` : ''}` : `OSM ${bin}`,
                selectedLabel: bin || name || '',
                searchBin: bin.toLowerCase(),
                searchName: name.toLowerCase()
            };
        })
        .filter((meta) => meta.bin || meta.name)
        .sort((a, b) => b.height - a.height);
}

function createLod2SearchEntries() {
    return state.lod2BuildingMeta
        .map((meta) => {
            const id = (meta.id || '').toLowerCase();
            const roof = (meta.roofTypeLabel || '').toLowerCase();
            const func = (meta.functionLabel || '').toLowerCase();
            return {
                ...meta,
                displayTitle: meta.id || meta.title,
                displayMeta: `${meta.roofTypeLabel || '—'} · ${meta.functionLabel || '—'}`,
                statusLabel: `${meta.id || meta.title} · ${meta.roofTypeLabel || '—'} · ${meta.functionLabel || '—'}`,
                selectedLabel: meta.id || meta.title || '',
                searchBin: id,
                searchName: `${id} ${roof} ${func}`.trim(),
            };
        })
        .sort((a, b) => b.height - a.height);
}

function refreshSearchEntries() {
    const input = document.getElementById('building-search-input');
    const status = document.getElementById('building-search-status');

    if (state.lod2Visible && state.lod2BuildingMeta.length) {
        state.searchHint = 'Suche per LoD2-ID, Dachtyp oder Nutzung';
        state.searchEntries = createLod2SearchEntries();
        if (input) input.placeholder = 'LoD2-ID, Dachtyp oder Nutzung';
    } else {
        state.searchHint = 'Suche per OSM-ID oder Name';
        state.searchEntries = createOsmSearchEntries();
        if (input) input.placeholder = 'OSM-ID oder Name';
    }

    if (input && status && !input.value.trim()) {
        status.textContent = state.searchHint;
    }
}

function focusBuilding(meta) {
    if (!meta || !isOsmBuildingsVisible()) return;
    state.pinnedLod2Meta = null;
    state.lod2HighlightMesh = setLod2Highlight(state.lod2Group, state.lod2HighlightMesh, null);
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

function focusLod2Building(meta) {
    if (!meta || !state.lod2Visible) return;
    state.pinnedLod2Meta = meta;
    state.pinnedMapMeta = null;
    state.viewMode = 'map';
    hideTooltip();
    controls.transitionToView('map');
    controls.focusOnBuilding(meta, { x: meta.centerX, z: -meta.centerZ });
    viewController.applyViewMode('map');
    state.lod2HighlightMesh = setLod2Highlight(state.lod2Group, state.lod2HighlightMesh, meta);
}

function updateVisibleStats() {
    if (state.lod2Visible && state.lod2Stats) {
        updateStats({
            count: state.lod2Stats.buildingCount,
            maxHeight: Math.max(0, ...state.lod2BuildingMeta.map((meta) => meta.height)),
            averageHeight: state.lod2BuildingMeta.reduce((sum, meta) => sum + meta.height, 0) / Math.max(1, state.lod2BuildingMeta.length),
            streetCount: state.allStats?.streetCount ?? null
        });
        return;
    }

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

    if (state.hoveredLod2Meta && state.hoveredLod2Meta !== state.pinnedLod2Meta) {
        state.lod2HighlightMesh = setLod2Highlight(state.lod2Group, state.lod2HighlightMesh, null);
        state.hoveredLod2Meta = null;
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
        state.pinnedLod2Meta = null;
        if (state.hoveredLod2Meta) {
            state.lod2HighlightMesh = setLod2Highlight(state.lod2Group, state.lod2HighlightMesh, null);
            state.hoveredLod2Meta = null;
        }

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
        state.pinnedLod2Meta = null;
        if (state.hoveredLod2Meta) {
            state.lod2HighlightMesh = setLod2Highlight(state.lod2Group, state.lod2HighlightMesh, null);
            state.hoveredLod2Meta = null;
        }

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

    if (context?.type === 'lod2') {
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

        state.hoveredLod2Meta = meta;
        state.lod2HighlightMesh = setLod2Highlight(state.lod2Group, state.lod2HighlightMesh, meta);
        if (context.select) {
            focusLod2Building(meta);
        }
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
        state.mesh.visible = isOsmBuildingsVisible() && mapAlpha > 0.02;
        state.mesh.position.y = -state.transitionProgress * 10;
    }

    if (state.terrainMesh) {
        state.terrainMesh.material.opacity = Math.max(0.04, mapAlpha * 0.92);
        state.terrainMesh.visible = mapAlpha > 0.02;
    }

    if (state.lod2Group) {
        state.lod2Group.visible = state.lod2Visible && mapAlpha > 0.02;
        state.lod2Group.position.y = -state.transitionProgress * 10;
        state.lod2Group.traverse((child) => {
            if (!child.isMesh || !child.material) return;
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
    getSearchState: () => ({ searchEntries: state.searchEntries, searchHint: state.searchHint }),
    onSelect: (item) => {
        if (item.kind === 'lod2') focusLod2Building(item);
        else focusBuilding(item);
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

bindLod2Filters({
    onRoofChange: (roofType) => {
        state.lod2Filters.roofType = roofType;
        if (!state.lod2Manifest) return;
        clearHighlights();
        hideTooltip();
        rebuildLod2Group();
    },
    onFunctionChange: (functionCode) => {
        state.lod2Filters.functionCode = functionCode;
        if (!state.lod2Manifest) return;
        clearHighlights();
        hideTooltip();
        rebuildLod2Group();
    }
});

bindLod2Toggle({
    getLod2State: () => ({ visible: state.lod2Visible }),
    onToggle: async (visible) => {
        if (visible) {
            try {
                await ensureLod2Loaded();
            } catch (error) {
                console.error('Failed to load LoD2 layer', error);
                const button = document.getElementById('lod2-toggle');
                if (button) button.classList.remove('active');
                return;
            }
        }

        state.lod2Visible = visible;
        clearHighlights();
        hideTooltip();
        state.pinnedMapMeta = null;
        state.pinnedLod2Meta = null;
        state.lod2HighlightMesh = setLod2Highlight(state.lod2Group, state.lod2HighlightMesh, null);
        setLod2FilterVisibility(visible);
        refreshSearchEntries();
        updateLod2TileVisibility();
        if (state.lod2Group) state.lod2Group.visible = visible && state.viewMode === 'map';
        if (state.mesh) state.mesh.visible = !visible && state.viewMode === 'map';
        updateVisibleStats();
    }
});

createHoverController({
    camera,
    getInteractiveState: () => ({
        viewMode: state.viewMode,
        mapMesh: isOsmBuildingsVisible() ? state.mesh : null,
        mapMeta: state.buildingMeta,
        rankingItems: state.rankingItems,
        poiMeshes: state.poiMeshes,
        poiVisible: state.poisVisible,
        lod2Visible: state.lod2Visible,
        lod2Meshes: state.lod2Meshes,
        lod2TileCache: state.lod2TileCache,
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
    if (state.lod2Visible && state.lod2Manifest && !state.lod2LoadPromise) {
        syncVisibleLod2Tiles().catch((error) => console.error('LoD2 tile sync failed', error));
    }
    updateViewTransition();
    updatePinnedPulse();
    rankingLabels.update();
    renderer.render(scene, camera);
}

async function init() {
    setProgress(5, 'Three.js initialisieren…');
    animate();

    setProgress(15, 'Gebäudedaten laden…');
    const [buildingResponse, metadataResponse, poiResponse, terrainResponse] = await Promise.all([
        fetch('buildings.json'),
        fetch('building-metadata.json').catch(() => null),
        fetch('pois.json').catch(() => null),
        fetch('terrain.json').catch(() => null)
    ]);
    const [buildingData, metadataData, poiData, terrainData] = await Promise.all([
        buildingResponse.json(),
        metadataResponse?.ok ? metadataResponse.json() : Promise.resolve(null),
        poiResponse?.ok ? poiResponse.json() : Promise.resolve(null),
        terrainResponse?.ok ? terrainResponse.json() : Promise.resolve(null)
    ]);
    const buildings = buildingData.buildings;
    const metadata = metadataData?.buildings ?? [];
    state.sourceBuildings = buildings;
    applyDatasetBranding(buildingData.meta);

    let terrainSampler = null;
    let terrainSceneOffset = 0;
    if (terrainData?.elevations?.length) {
        terrainSampler = createTerrainSampler(terrainData);
        state.terrainSampler = terrainSampler;
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

    refreshSearchEntries();
    setLod2FilterVisibility(false);

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

    modeController.applyMode(state.currentMode);
    viewController.applyViewMode(state.viewMode);
    controls.transitionToView('map');
    updateViewTransition();
    finishLoading();
}

init();
