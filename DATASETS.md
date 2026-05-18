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

## Umbau-Reihenfolge

1. Projekt auf Amberg umbenennen und NYC-Texte entfernen
2. OSM-Gebäudeimport bauen
3. Gebäudeformat in bestehende Three.js-Pipeline einspeisen
4. Terrain-Mesh ergänzen
5. Gebäude auf Terrain-Höhe setzen
6. Optional LoD2/CityGML-Import prüfen
