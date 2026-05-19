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

3. **LoD2 Bayern für 3D-Gebäude**
   - amtliche 3D-Gebäude mit Dachformen
   - deutlich detailreicher als OSM-Extrusionen
   - Import ist komplexer wegen CityGML/GML, ist hier aber inzwischen umgesetzt

## Aktueller Stand

- **Aktiv eingebunden:** OpenStreetMap-Gebäude für Amberg über Overpass API
- **Boundary:** explizit die kreisfreie Stadt Amberg (`relation/62772`)
- **Rohdaten-Cache:** `data/amberg-osm-buildings-overpass.json`
- **Importer:** `scripts/fetch_amberg_osm_buildings.py`
- **Straßen-Importer:** `scripts/fetch_amberg_osm_streets.py`
- **POI-Importer:** `scripts/fetch_amberg_osm_pois.py`
- **Terrain-Importer:** `scripts/fetch_amberg_terrain.py`
- **LoD2-Bundler:** `scripts/build_lod2_amberg_bundle.py`
- **Generierte Zieldateien:** `buildings.json`, `building-metadata.json`, `streets.json`, `pois.json`, `terrain.json`

Stand des letzten Abrufs:

- ca. **13.490** Gebäude als `way`
- ca. **6.059** Straßen-/Wege-Linien
- ca. **174** kuratierte POIs (u. a. Bildung, Gesundheit, Gastro, Kultur)
- Terrain aus **DGM1 Bayern**, für die App auf **128 × 128** resampelt
- LoD2-Bundle für **ganz Amberg** mit **23 Kacheln**
- ca. **35.335** LoD2-Gebäude
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

### `data/lod2-amberg/amberg-full-lod2.scene.json`

Kompaktes Szenenformat für den LoD2-Layer. Enthält auf Szenenkoordinaten transformierte Dach-, Wand- und Bodenpolygone für ganz Amberg.

## Nächste sinnvolle Schritte

1. Hover/Selektion auch für LoD2-Geometrien ergänzen
2. Optional LoD2 nach Dachtyp/Funktion einfärbbar machen
3. Performance im Browser mit echten Zielgeräten messen
4. Thematische Fragestellung für die IV schärfen
