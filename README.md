# IV Amberg

Gebäudevisualisierung für Amberg auf Basis von OpenStreetMap-Daten.

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

## Lokal starten

Da ES-Module und `fetch()` genutzt werden, über einen lokalen Webserver starten:

```bash
python3 -m http.server 8000
```

Dann öffnen: <http://localhost:8000>

## Nächste Schritte

1. Optional Straßen/POIs für Amberg ergänzen
2. Optional Terrain (DGM1) anbinden
3. Visualisierung thematisch weiter auf Amberg zuschneiden

## Datensatz neu erzeugen

```bash
./scripts/fetch_amberg_osm_buildings.py
```

Nur aus dem vorhandenen Rohdaten-Cache neu bauen:

```bash
./scripts/fetch_amberg_osm_buildings.py --use-cache
```
