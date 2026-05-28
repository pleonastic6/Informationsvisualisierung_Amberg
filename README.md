# IV Amberg

Gebäudevisualisierung für Amberg auf Basis von OpenStreetMap-, DGM1- und LoD2-Daten.

## Herkunft

Dieses Repo wurde aus `Informationsvisualisierung_NYC_buildings` abgeleitet und inzwischen auf einen Amberg-Datensatz umgestellt.

## Aktueller Stand

- Three.js/HTML/CSS-Struktur übernommen
- Amberg-Gebäudedaten aus OpenStreetMap/Overpass eingebunden
- Abfrage jetzt explizit auf die **kreisfreie Stadt Amberg** begrenzt
- Rohdaten-Cache liegt unter `data/amberg-osm-buildings-overpass.json`
- Importskript liegt unter `scripts/fetch_amberg_osm_buildings.py`
- Straßen-Import liegt unter `scripts/fetch_amberg_osm_streets.py`
- POI-Import liegt unter `scripts/fetch_amberg_osm_pois.py`
- Terrain-Import liegt unter `scripts/fetch_amberg_terrain.py`
- LoD2-Importer/Bundler liegt unter `scripts/build_lod2_amberg_bundle.py`
- OSM-Gebäude und LoD2 sind im Frontend als exklusive Layer schaltbar
- LoD2 wird erst bei Bedarf geladen, damit der Initial-Load klein bleibt

## Lokal starten

Da ES-Module und `fetch()` genutzt werden, über einen lokalen Webserver starten:

```bash
python3 -m http.server 8000
```

Dann öffnen: <http://localhost:8000>

## Status

- OSM-Gebäude für ganz Amberg
- Straßen- und POI-Layer
- Terrain aus DGM1 Bayern
- LoD2-Gebäudemodell für ganz Amberg als optionaler Detail-Layer

## Datensatz neu erzeugen

```bash
./scripts/fetch_amberg_osm_buildings.py
```

Nur aus dem vorhandenen Rohdaten-Cache neu bauen:

```bash
./scripts/fetch_amberg_osm_buildings.py --use-cache
```

Terrain erzeugen:

```bash
./scripts/fetch_amberg_terrain.py
```

Terrain für die komplette Kartenfläche (volle Ground-Plane) neu bauen:

```bash
./scripts/fetch_amberg_terrain.py --scene-half-extent 1100 --grid-width 448 --grid-height 448
```

LoD2-Bundle für den zentralen Bereich:

```bash
./scripts/build_lod2_amberg_bundle.py
```

LoD2-Bundle für ganz Amberg:

```bash
./scripts/build_lod2_amberg_bundle.py --all
```
