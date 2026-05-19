#!/usr/bin/env python3
import json
import math
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'
RAW_PATH = DATA_DIR / 'amberg-osm-streets-overpass.json'
BUILDINGS_PATH = ROOT / 'buildings.json'
STREETS_PATH = ROOT / 'streets.json'
BOUNDARY_RELATION_ID = 62772
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
USER_AGENT = 'openclaw/iv-amberg'

OVERPASS_QUERY = '''
[out:json][timeout:180];
rel(62772);
map_to_area;
(
  way["highway"](area);
);
out tags geom;
'''.strip()

HIGHWAY_TO_TYPE = {
    'motorway': 'm',
    'motorway_link': 'm',
    'trunk': 'm',
    'trunk_link': 'm',
    'primary': 't',
    'primary_link': 't',
    'secondary': 'p',
    'secondary_link': 'p',
    'tertiary': 's',
    'tertiary_link': 's',
    'residential': 'e',
    'living_street': 'e',
    'unclassified': 'e',
    'service': 'e',
    'road': 'e',
    'pedestrian': 'r',
    'footway': 'r',
    'path': 'r',
    'cycleway': 'r',
    'track': 'r',
    'steps': 'r',
    'bridleway': 'r',
}
WIDTH_BY_TYPE = {
    'm': 1.3,
    't': 1.0,
    'p': 0.85,
    's': 0.7,
    'e': 0.55,
    'r': 0.4,
}


def fetch_raw():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        OVERPASS_URL,
        data=OVERPASS_QUERY.encode('utf-8'),
        headers={
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': USER_AGENT,
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=240) as response:
        payload = json.load(response)
    RAW_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    return payload


def load_raw():
    return json.loads(RAW_PATH.read_text())


def load_projection():
    meta = json.loads(BUILDINGS_PATH.read_text())['meta']['projection']
    center = meta['center']
    scale = meta['scale_meters_to_scene']
    meters_per_lon = 111320.0 * math.cos(math.radians(center['lat']))
    meters_per_lat = 110540.0

    def project(lon, lat):
        x = (lon - center['lon']) * meters_per_lon * scale
        z = (lat - center['lat']) * meters_per_lat * scale
        return x, z

    return project


def classify(highway):
    return HIGHWAY_TO_TYPE.get((highway or '').strip().lower(), 'e')


def build_dataset(payload):
    project = load_projection()
    streets = []
    highway_counter = Counter()
    type_counter = Counter()

    for element in payload.get('elements', []):
        geometry = element.get('geometry') or []
        if len(geometry) < 2:
            continue
        highway = (element.get('tags') or {}).get('highway', '')
        street_type = classify(highway)
        coords = []
        for node in geometry:
            if 'lon' not in node or 'lat' not in node:
                continue
            x, z = project(node['lon'], node['lat'])
            coords.extend([round(x, 3), round(z, 3)])
        if len(coords) < 4:
            continue
        streets.append({
            'id': f"osm-way-{element['id']}",
            'name': (element.get('tags') or {}).get('name', ''),
            'highway': highway,
            't': street_type,
            'w': WIDTH_BY_TYPE[street_type],
            'c': coords,
        })
        highway_counter[highway or 'unknown'] += 1
        type_counter[street_type] += 1

    return {
        'meta': {
            'source': 'OpenStreetMap via Overpass API',
            'query_area': 'Amberg',
            'boundary_relation_id': BOUNDARY_RELATION_ID,
            'count': len(streets),
            'highway_breakdown': dict(highway_counter.most_common(20)),
            'type_breakdown': dict(type_counter),
        },
        'streets': streets,
    }


def main():
    import sys
    use_cache = '--use-cache' in sys.argv
    payload = load_raw() if use_cache and RAW_PATH.exists() else fetch_raw()
    dataset = build_dataset(payload)
    STREETS_PATH.write_text(json.dumps(dataset, ensure_ascii=False, separators=(',', ':')))
    print(f'Wrote {STREETS_PATH}')
    print(f'Raw cache: {RAW_PATH}')
    print(f"Streets: {dataset['meta']['count']}")
    print(f"Types: {dataset['meta']['type_breakdown']}")


if __name__ == '__main__':
    main()
