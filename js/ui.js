const THREE = window.THREE;

import { drawLegendBar, groundColor, heightColor } from './colors.js';
import { getLod2LegendEntries } from './lod2.js';
import { applyBuildingColors, applyHeightFilter as applyMeshHeightFilter, updateRankingView } from './buildings.js';

export function setProgress(progress, message) {
    document.getElementById('loading-bar').style.width = `${progress}%`;
    document.getElementById('loading-msg').textContent = message;
}

export function finishLoading() {
    setProgress(100, 'Fertig');
    setTimeout(() => {
        const element = document.getElementById('loading');
        element.style.opacity = '0';
        setTimeout(() => element.remove(), 1000);
    }, 400);
}

export function updateStats({ count, maxHeight, averageHeight, streetCount }) {
    document.getElementById('s-count').textContent = count.toLocaleString('de-DE');
    document.getElementById('s-max').textContent = `${Math.round(maxHeight)} m`;
    document.getElementById('s-avg').textContent = `${Math.round(averageHeight)} m`;
    document.getElementById('s-streets').textContent = streetCount == null ? '—' : streetCount.toLocaleString('de-DE');
}

export function setSliderMax(maxHeight) {
    document.getElementById('height-filter').max = Math.round(maxHeight);
}

export function getMinHeightFilter() {
    return Number.parseFloat(document.getElementById('height-filter').value);
}

export function setLegendForHeight(maxHeight) {
    drawLegendBar(heightColor);
    document.getElementById('leg-max').textContent = `${Math.round(maxHeight)} m`;
    document.getElementById('leg-title-text').textContent = 'Dachhöhe';
}

export function setLegendForGround(maxGround) {
    drawLegendBar(groundColor);
    document.getElementById('leg-max').textContent = `${Math.round(maxGround)} m`;
    document.getElementById('leg-title-text').textContent = 'Geländehöhe';
}

export function updateLod2Legend({ visible, colorMode = 'uniform', maxHeight = 0, roofTypes = [], functions = [], baseMode = 'height' }) {
    const lod2Legend = document.getElementById('lod2-legend');
    const lod2Items = document.getElementById('lod2-legend-items');
    const lod2Scale = document.getElementById('lod2-legend-scale');
    const lod2Title = document.getElementById('lod2-leg-title');
    const lod2Max = document.getElementById('lod2-leg-max');
    const heightLegend = document.getElementById('height-legend');
    const eraLegend = document.getElementById('era-legend');
    if (!lod2Legend || !lod2Items || !lod2Scale || !lod2Title || !lod2Max || !heightLegend || !eraLegend) return;

    if (!visible) {
        lod2Legend.hidden = true;
        lod2Items.innerHTML = '';
        lod2Scale.hidden = true;
        heightLegend.style.display = baseMode === 'era' ? 'none' : 'block';
        eraLegend.style.display = baseMode === 'era' ? 'block' : 'none';
        return;
    }

    lod2Legend.hidden = false;
    heightLegend.style.display = 'none';
    eraLegend.style.display = 'none';
    lod2Items.innerHTML = '';

    if (colorMode === 'height') {
        lod2Title.textContent = 'LoD2 · Höhe';
        drawLegendBar(heightColor, 'lod2-legend-bar');
        lod2Scale.hidden = false;
        lod2Max.textContent = `${Math.round(maxHeight)} m`;
        return;
    }

    lod2Scale.hidden = true;
    if (colorMode === 'roof') {
        lod2Title.textContent = 'LoD2 · Dachtyp';
    } else if (colorMode === 'function') {
        lod2Title.textContent = 'LoD2 · Nutzung';
    } else {
        lod2Title.textContent = 'LoD2 · Standardfarbe';
        lod2Items.innerHTML = '<div class="lod2-legend-item"><div class="lod2-legend-swatch" style="background:#c97898"></div><span>Einheitsfarbe</span></div>';
        return;
    }

    const entries = getLod2LegendEntries(colorMode, colorMode === 'roof' ? roofTypes : functions).slice(0, 8);
    lod2Items.innerHTML = entries.map((entry) => {
        const color = `rgb(${Math.round(entry.color.r * 255)}, ${Math.round(entry.color.g * 255)}, ${Math.round(entry.color.b * 255)})`;
        return `<div class="lod2-legend-item"><div class="lod2-legend-swatch" style="background:${color}"></div><span>${entry.label}</span></div>`;
    }).join('');
}

function syncColorMode(getState) {
    const state = getState();
    const sourceColors = state.palettes[state.currentMode];

    applyBuildingColors({
        mesh: state.mesh,
        buildingMeta: state.buildingMeta,
        sourceColors
    });

    applyMeshHeightFilter({
        mesh: state.mesh,
        buildingMeta: state.buildingMeta,
        minHeight: getMinHeightFilter(),
        sourceColors
    });

    updateRankingView({
        rankingItems: state.rankingItems,
        mode: state.currentMode,
        minHeight: getMinHeightFilter()
    });
}

export function createModeController({ getState, setMode }) {
    const modeButtons = document.querySelectorAll('.mode-btn');

    modeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            setMode(button.dataset.mode);
        });
    });

    return {
        applyMode(mode) {
            const state = getState();
            modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));

            if (state.lod2Visible) {
                document.getElementById('height-legend').style.display = 'none';
                document.getElementById('era-legend').style.display = 'none';
            } else {
                document.getElementById('height-legend').style.display = mode === 'era' ? 'none' : 'block';
                document.getElementById('era-legend').style.display = mode === 'era' ? 'block' : 'none';
                if (mode === 'ground') setLegendForGround(state.maxGround);
                else if (mode === 'height') setLegendForHeight(state.maxHeight);
            }

            syncColorMode(getState);
        }
    };
}

export function createViewController({ getState, setViewMode, updateVisibleStats }) {
    const viewButtons = document.querySelectorAll('.view-btn');

    viewButtons.forEach((button) => {
        button.addEventListener('click', () => {
            setViewMode(button.dataset.view);
        });
    });

    return {
        applyViewMode(viewMode) {
            const state = getState();
            viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === viewMode));

            if (state.mesh) state.mesh.visible = !state.lod2Visible;
            if (state.streetGroup) state.streetGroup.visible = true;
            if (state.rankingGroup) state.rankingGroup.visible = true;
            if (state.lod2Group) state.lod2Group.visible = !!state.lod2Visible;

            updateVisibleStats();
        }
    };
}

export function bindHeightFilter(getFilterState, onAfterFilter) {
    const slider = document.getElementById('height-filter');
    const valueEl = document.getElementById('filter-val');

    slider.addEventListener('input', () => {
        const minHeight = Number.parseFloat(slider.value);
        valueEl.textContent = `${slider.value} m`;

        const { mesh, buildingMeta, sourceColors, rankingItems, currentMode } = getFilterState();
        applyMeshHeightFilter({ mesh, buildingMeta, minHeight, sourceColors });
        updateRankingView({ rankingItems, mode: currentMode, minHeight });
        onAfterFilter();
    });
}

export function showTooltip(meta, pointer) {
    const tooltip = document.getElementById('hover-tooltip');
    if (meta.kind === 'lod2') {
        tooltip.innerHTML = `
            <div class="tooltip-title">${meta.title || meta.id || 'LoD2-Gebäude'}</div>
            <div class="tooltip-row">Höhe <span>${meta.height.toFixed(1)} m</span></div>
            <div class="tooltip-row">Dach <span>${meta.roofTypeLabel || '—'}</span></div>
            <div class="tooltip-row">Nutzung <span>${meta.functionLabel || '—'}</span></div>
        `;
        tooltip.style.left = `${pointer.x + 16}px`;
        tooltip.style.top = `${pointer.y + 16}px`;
        tooltip.style.opacity = '1';
        return;
    }
    if (meta.kind === 'poi') {
        tooltip.innerHTML = `
            <div class="tooltip-title">${meta.title || meta.name || meta.subtypeLabel || 'POI'}</div>
            <div class="tooltip-row">Typ <span>${meta.subtypeLabel || meta.categoryLabel || 'POI'}</span></div>
            <div class="tooltip-row">Gruppe <span>${meta.categoryLabel || 'Sonstiges'}</span></div>
            <div class="tooltip-row">OSM-ID <span>${meta.osmId || '—'}</span></div>
        `;
        tooltip.style.left = `${pointer.x + 16}px`;
        tooltip.style.top = `${pointer.y + 16}px`;
        tooltip.style.opacity = '1';
        return;
    }
    const title = meta.name || (meta.rank ? `#${meta.rank}` : 'Gebäude');
    tooltip.innerHTML = `
        <div class="tooltip-title">${title}</div>
        ${meta.bin ? `<div class="tooltip-row">OSM-ID <span>${meta.bin}</span></div>` : ''}
        <div class="tooltip-row">Höhe <span>${meta.height.toFixed(1)} m</span></div>
        <div class="tooltip-row">Bauzeit <span>${meta.eraLabel}</span></div>
    `;
    tooltip.style.left = `${pointer.x + 16}px`;
    tooltip.style.top = `${pointer.y + 16}px`;
    tooltip.style.opacity = '1';
}

export function hideTooltip() {
    document.getElementById('hover-tooltip').style.opacity = '0';
}

export function updateSelectionPanel(meta) {
    const panel = document.getElementById('selection-panel');
    const kind = document.getElementById('selection-kind');
    const title = document.getElementById('selection-title');
    const details = document.getElementById('selection-details');
    if (!panel || !kind || !title || !details) return;

    if (!meta) {
        panel.hidden = true;
        details.innerHTML = '';
        return;
    }

    panel.hidden = false;

    if (meta.kind === 'lod2') {
        kind.textContent = 'LoD2-Gebäude';
        title.textContent = meta.id || meta.title || 'LoD2-Gebäude';
        details.innerHTML = `
            <div class="selection-row"><span>Höhe</span><span>${meta.height.toFixed(1)} m</span></div>
            <div class="selection-row"><span>Dachtyp</span><span>${meta.roofTypeLabel || '—'}</span></div>
            <div class="selection-row"><span>Nutzung</span><span>${meta.functionLabel || '—'}</span></div>
            <div class="selection-row"><span>Basis</span><span>${meta.baseSceneY.toFixed(1)} m</span></div>
        `;
        return;
    }

    if (meta.kind === 'poi') {
        kind.textContent = 'POI';
        title.textContent = meta.title || meta.name || meta.subtypeLabel || 'POI';
        details.innerHTML = `
            <div class="selection-row"><span>Typ</span><span>${meta.subtypeLabel || meta.categoryLabel || '—'}</span></div>
            <div class="selection-row"><span>Gruppe</span><span>${meta.categoryLabel || '—'}</span></div>
            <div class="selection-row"><span>OSM-ID</span><span>${meta.osmId || '—'}</span></div>
        `;
        return;
    }

    kind.textContent = 'OSM-Gebäude';
    title.textContent = meta.name || meta.bin || 'Gebäude';
    details.innerHTML = `
        <div class="selection-row"><span>OSM-ID</span><span>${meta.bin || '—'}</span></div>
        <div class="selection-row"><span>Höhe</span><span>${meta.height.toFixed(1)} m</span></div>
        <div class="selection-row"><span>Bauzeit</span><span>${meta.eraLabel || '—'}</span></div>
        <div class="selection-row"><span>Radius</span><span>${meta.footprintRadius.toFixed(1)} m</span></div>
    `;
}

export function clearSelectionPanel() {
    const panel = document.getElementById('selection-panel');
    const details = document.getElementById('selection-details');
    if (!panel || !details) return;
    panel.hidden = true;
    details.innerHTML = '';
}

export function bindPoiToggle({ getPoiState, onToggle }) {
    const button = document.getElementById('poi-toggle');
    if (!button) return;
    button.addEventListener('click', () => {
        const next = !getPoiState().visible;
        button.classList.toggle('active', next);
        onToggle(next);
    });
}

export function bindLod2Toggle({ getLod2State, onToggle }) {
    const button = document.getElementById('lod2-toggle');
    if (!button) return;
    button.addEventListener('click', () => {
        const next = !getLod2State().visible;
        button.classList.toggle('active', next);
        onToggle(next);
    });
}

export function createRankingLabelController({ camera, getState }) {
    const root = document.createElement('div');
    root.id = 'ranking-labels';
    document.body.appendChild(root);

    const labels = [];
    const temp = new THREE.Vector3();

    function makeLabel(item) {
        const el = document.createElement('div');
        el.className = 'ranking-label';
        el.innerHTML = `<span class="ranking-label-rank">#${item.meta.rank}</span><span class="ranking-label-height">${Math.round(item.meta.height)} m</span>`;
        root.appendChild(el);
        return { item, el };
    }

    return {
        setItems(items) {
            root.innerHTML = '';
            labels.length = 0;
            items.slice(0, 10).forEach((item) => labels.push(makeLabel(item)));
        },
        update() {
            const state = getState();
            const visible = state.transitionProgress > 0.55;

            labels.forEach(({ item, el }) => {
                if (!visible || !item.mesh.visible) {
                    el.style.opacity = '0';
                    return;
                }

                temp.set(0, item.meta.height * 0.12 + 6, 0);
                item.mesh.localToWorld(temp);
                temp.project(camera);

                if (temp.z < -1 || temp.z > 1) {
                    el.style.opacity = '0';
                    return;
                }

                const x = (temp.x * 0.5 + 0.5) * window.innerWidth;
                const y = (-temp.y * 0.5 + 0.5) * window.innerHeight;
                el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
                el.style.opacity = `${Math.max(0, Math.min(1, (state.transitionProgress - 0.55) / 0.35))}`;
            });
        }
    };
}

export function createSearchController({ getSearchState, onSelect }) {
    const input = document.getElementById('building-search-input');
    const results = document.getElementById('building-search-results');
    const status = document.getElementById('building-search-status');
    let activeResults = [];

    function render(items, query, totalCount = items.length) {
        activeResults = items;
        results.innerHTML = '';

        if (!query) {
            status.textContent = getSearchState().searchHint || 'Suche';
            return;
        }

        if (!items.length) {
            status.textContent = 'Nichts gefunden';
            return;
        }

        status.textContent = `${totalCount} Treffer${totalCount > items.length ? '+' : ''}`;

        items.forEach((item, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'search-result';
            button.innerHTML = `
                <span class="search-result-title">${item.displayTitle || item.name || `OSM ${item.bin}`}</span>
                <span class="search-result-meta">${item.displayMeta || (item.bin ? `OSM ${item.bin}` : 'Ohne OSM-ID')} · ${Math.round(item.height)} m</span>
            `;
            button.addEventListener('click', () => onSelect(item));
            if (index === 0) button.dataset.default = 'true';
            results.appendChild(button);
        });
    }

    function updateResults() {
        const query = input.value.trim().toLowerCase();
        const { searchEntries } = getSearchState();
        if (!query) return render([], '');

        const digitQuery = query.replace(/\s+/g, '');
        const matches = [];

        for (const entry of searchEntries) {
            const byBin = entry.searchBin && entry.searchBin.includes(digitQuery);
            const byName = entry.searchName && entry.searchName.includes(query);
            if (!byBin && !byName) continue;
            matches.push(entry);
        }

        matches.sort((a, b) => {
            const aExact = a.searchBin === digitQuery || a.searchName === query;
            const bExact = b.searchBin === digitQuery || b.searchName === query;
            if (aExact !== bExact) return aExact ? -1 : 1;
            const aStarts = a.searchBin?.startsWith(digitQuery) || a.searchName?.startsWith(query);
            const bStarts = b.searchBin?.startsWith(digitQuery) || b.searchName?.startsWith(query);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            return b.height - a.height;
        });

        render(matches.slice(0, 8), query, matches.length);
    }

    input.addEventListener('input', updateResults);
    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        const firstResult = activeResults[0];
        if (!firstResult) return;
        event.preventDefault();
        onSelect(firstResult);
    });

    return {
        setSelected(item) {
            input.value = item.selectedLabel || item.bin || item.name || item.id || '';
            status.textContent = item.statusLabel || item.displayTitle || item.name || item.id || item.bin || '';
            results.innerHTML = '';
            activeResults = [];
        }
    };
}

export function bindLod2Filters({ onColorModeChange, onRoofChange, onFunctionChange }) {
    const colorMode = document.getElementById('lod2-color-mode');
    const roof = document.getElementById('lod2-roof-filter');
    const func = document.getElementById('lod2-function-filter');
    if (!colorMode || !roof || !func) return;
    colorMode.addEventListener('change', () => onColorModeChange?.(colorMode.value));
    roof.addEventListener('change', () => onRoofChange(roof.value));
    func.addEventListener('change', () => onFunctionChange(func.value));
}

export function setLod2FilterVisibility(visible) {
    const panel = document.getElementById('lod2-filter-panel');
    if (panel) panel.hidden = !visible;
}

export function setLod2FilterOptions({ roofTypes = [], functions = [] }) {
    const colorMode = document.getElementById('lod2-color-mode');
    const roof = document.getElementById('lod2-roof-filter');
    const func = document.getElementById('lod2-function-filter');
    if (!colorMode || !roof || !func) return;

    const currentRoof = roof.value || 'all';
    const currentFunction = func.value || 'all';

    roof.innerHTML = '<option value="all">Alle Dachtypen</option>';
    func.innerHTML = '<option value="all">Alle Nutzungen</option>';

    for (const item of roofTypes) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        roof.appendChild(option);
    }

    for (const item of functions) {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        func.appendChild(option);
    }

    roof.value = [...roof.options].some((option) => option.value === currentRoof) ? currentRoof : 'all';
    func.value = [...func.options].some((option) => option.value === currentFunction) ? currentFunction : 'all';
}
