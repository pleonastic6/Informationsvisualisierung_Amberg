const THREE = window.THREE;

import { drawLegendBar, groundColor, heightColor } from './colors.js';
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

            document.getElementById('height-legend').style.display = mode === 'era' ? 'none' : 'block';
            document.getElementById('era-legend').style.display = mode === 'era' ? 'block' : 'none';

            if (mode === 'ground') setLegendForGround(state.maxGround);
            else if (mode === 'height') setLegendForHeight(state.maxHeight);

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

            if (state.mesh) state.mesh.visible = true;
            if (state.streetGroup) state.streetGroup.visible = true;
            if (state.rankingGroup) state.rankingGroup.visible = true;
            if (state.lod2Group) state.lod2Group.visible = true;

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
            status.textContent = 'Suche per OSM-ID oder Name';
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
                <span class="search-result-title">${item.name || `OSM ${item.bin}`}</span>
                <span class="search-result-meta">${item.bin ? `OSM ${item.bin}` : 'Ohne OSM-ID'} · ${Math.round(item.height)} m</span>
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
            input.value = item.bin || item.name || '';
            status.textContent = item.name ? `${item.name}${item.bin ? ` · OSM ${item.bin}` : ''}` : `OSM ${item.bin}`;
            results.innerHTML = '';
            activeResults = [];
        }
    };
}
