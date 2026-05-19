# Datensätze für IV Amberg

## Empfehlung

Für einen schnellen, sauberen Umbau:

1. **Gebäude zuerst über OpenStreetMap**
   - einfach abrufbar per Overpass API
   - enthält Gebäudegrundrisse und teils Tags wie `building`, `height`, `levels`
   - Höhen sind lückenhaft, können aber geschätzt werden

2. **Gelände über Bayern DGM1**
   - amtliches Digitales Geländemodell 1m für Bayern
   - sehr gut für echte Topografie
   - muss in ein leichtes Raster/Heightmap-Format für Three.js konvertiert werden

3. **Optional später: LoD2 Bayern**
   - amtliche 3D-Gebäude mit Dachformen
   - besser als OSM, aber Import ist deutlich komplexer wegen CityGML/GML

## Aktueller Stand

- **Aktiv eingebunden:** OpenStreetMap-Gebäude für Amberg über Overpass API
- **Boundary:** explizit die kreisfreie Stadt Amberg (`relation/62772`)
- **Rohdaten-Cache:** `data/amberg-osm-buildings-overpass.json`
- **Importer:** `scripts/fetch_amberg_osm_buildings.py`
- **Straßen-Importer:** `scripts/fetch_amberg_osm_streets.py`
- **POI-Importer:** `scripts/fetch_amberg_osm_pois.py`
- **Generierte Zieldateien:** `buildings.json`, `building-metadata.json`, `streets.json`, `pois.json`

Stand des letzten Abrufs:

- ca. **13.490** Gebäude als `way`
- ca. **6.059** Straßen-/Wege-Linien
- ca. **174** kuratierte POIs (u. a. Bildung, Gesundheit, Gastro, Kultur)
- `height` ist selten gepflegt, `building:levels` deutlich häufiger

## Quellen

- OSM Amberg: https://wiki.openstreetmap.org/wiki/Amberg
- Bayern DGM1 / Digitales Geländemodell: https://data.gov.de/suche/daten/digitales-gelandemodell-dgm-bayern
- Bayern LoD2 / 3D-Gebäudemodell: https://www.ldbv.bayern.de/vermessung/zshh/lod2-de.html
- BayernAtlas / OpenData Bayern: https://digitalisierung.bayern.de/produkte/dienste/bayernatlas.html

## Ziel-Datenformate im Projekt

### `buildings.json`

```json
{
  "buildings": [
    {
      "id": "osm-way-123",
      "name": "optional",
      "x": 0,
      "z": 0,
      "h": 12,
      "g": 0,
      "era": 0,
      "ext": [0, 0, 10, 0, 10, 10, 0, 10]
    }
  ]
}
```

### `terrain.json`

```json
{
  "width": 256,
  "height": 256,
  "cellSize": 5,
  "origin": { "lat": 49.441, "lon": 11.862 },
  "elevations": [0, 1, 2]
}
```

## Nächste sinnvolle Schritte

1. OSM-Gebäudeformat weiter verfeinern
2. Terrain-Mesh ergänzen
3. Gebäude auf Terrain-Höhe setzen
4. Optional POIs oder Straßennamen ergänzen
5. Optional LoD2/CityGML-Import prüfen
