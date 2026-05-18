# IV Amberg

Port der bestehenden NYC-Gebäudevisualisierung auf einen Amberg-Datensatz.

## Herkunft

Dieses Repo wurde aus `Informationsvisualisierung_NYC_buildings` abgeleitet, damit der Amberg-Umbau sauber getrennt vom NYC-Projekt passieren kann.

## Aktueller Stand

- Three.js/HTML/CSS-Struktur übernommen
- NYC-Daten liegen noch als Platzhalter im Repo
- Nächster Schritt: Amberg-Datensatz definieren/importieren und Parser anpassen

## Lokal starten

Da ES-Module und `fetch()` genutzt werden, über einen lokalen Webserver starten:

```bash
python3 -m http.server 8000
```

Dann öffnen: <http://localhost:8000>

## Nächste Schritte

1. Amberg-Datenquelle festlegen: Gebäude, Straßen, POIs oder anderer IV-Datensatz
2. Datenformat auf `buildings.json` / `building-metadata.json` mappen
3. NYC-spezifische UI-Texte und Filter entfernen/ersetzen
4. Visualisierung thematisch auf Amberg zuschneiden
