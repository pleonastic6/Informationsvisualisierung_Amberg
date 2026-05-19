#!/usr/bin/env python3
import json
import math
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'
RAW_PATH = DATA_DIR / 'amberg-osm-pois-overpass.json'
BUILDINGS_PATH = ROOT / 'buildings.json'
POIS_PATH = ROOT / 'pois.json'
BOUNDARY_RELATION_ID = 62772
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
USER_AGENT = 'openclaw/iv-amberg'

OVERPASS_QUERY = r'''
[out:json][timeout:180];
rel(62772);
map_to_area;
(
  node["amenity"~"^(school|university|college|kindergarten|library|townhall|hospital|clinic|doctors|pharmacy|police|fire_station|post_office|restaurant|cafe|bar|pub|fast_food|biergarten|theatre|cinema|arts_centre|museum|marketplace)$"](area);
  way["amenity"~"^(school|university|college|kindergarten|library|townhall|hospital|clinic|doctors|pharmacy|police|fire_station|post_office|restaurant|cafe|bar|pub|fast_food|biergarten|theatre|cinema|arts_centre|museum|marketplace)$"](area);
  relation["amenity"~"^(school|university|college|kindergarten|library|townhall|hospital|clinic|doctors|pharmacy|police|fire_station|post_office|restaurant|cafe|bar|pub|fast_food|biergarten|theatre|cinema|arts_centre|museum|marketplace)$"](area);
  node["tourism"~"^(museum|attraction|hotel|hostel|guest_house|viewpoint|information)$"](area);
  way["tourism"~"^(museum|attraction|hotel|hostel|guest_house|viewpoint|information)$"](area);
  relation["tourism"~"^(museum|attraction|hotel|hostel|guest_house|viewpoint|information)$"](area);
  node["leisure"~"^(park|sports_centre|stadium)$"](area);
  way["leisure"~"^(park|sports_centre|stadium)$"](area);
  relation["leisure"~"^(park|sports_centre|stadium)$"](area);
  node["shop"~"^(supermarket|mall|bakery|butcher|convenience|department_store|books|clothes)$"](area);
  way["shop"~"^(supermarket|mall|bakery|butcher|convenience|department_store|books|clothes)$"](area);
  relation["shop"~"^(supermarket|mall|bakery|butcher|convenience|department_store|books|clothes)$"](area);
  node["historic"](area);
  way["historic"](area);
  relation["historic"](area);
  node["railway"~"^(station|halt)$"](area);
  way["railway"~"^(station|halt)$"](area);
  relation["railway"~"^(station|halt)$"](area);
);
out center tags;
'''.strip()

CATEGORY_CONFIG = {
    ('amenity', 'school'): ('education', 'Schule'),
    ('amenity', 'university'): ('education', 'Universität'),
    ('amenity', 'college'): ('education', 'Hochschule'),
    ('amenity', 'kindergarten'): ('education', 'Kita'),
    ('amenity', 'library'): ('culture', 'Bibliothek'),
    ('amenity', 'townhall'): ('civic', 'Rathaus'),
    ('amenity', 'hospital'): ('health', 'Krankenhaus'),
    ('amenity', 'clinic'): ('health', 'Klinik'),
    ('amenity', 'doctors'): ('health', 'Ärzte'),
    ('amenity', 'pharmacy'): ('health', 'Apotheke'),
    ('amenity', 'police'): ('civic', 'Polizei'),
    ('amenity', 'fire_station'): ('civic', 'Feuerwehr'),
    ('amenity', 'post_office'): ('civic', 'Post'),
    ('amenity', 'restaurant'): ('food', 'Restaurant'),
    ('amenity', 'cafe'): ('food', 'Café'),
    ('amenity', 'bar'): ('food', 'Bar'),
    ('amenity', 'pub'): ('food', 'Pub'),
    ('amenity', 'fast_food'): ('food', 'Fast Food'),
    ('amenity', 'biergarten'): ('food', 'Biergarten'),
    ('amenity', 'theatre'): ('culture', 'Theater'),
    ('amenity', 'cinema'): ('culture', 'Kino'),
    ('amenity', 'arts_centre'): ('culture', 'Kulturzentrum'),
    ('amenity', 'museum'): ('culture', 'Museum'),
    ('amenity', 'marketplace'): ('civic', 'Marktplatz'),
    ('tourism', 'museum'): ('culture', 'Museum'),
    ('tourism', 'attraction'): ('culture', 'Sehenswürdigkeit'),
    ('tourism', 'hotel'): ('lodging', 'Hotel'),
    ('tourism', 'hostel'): ('lodging', 'Hostel'),
    ('tourism', 'guest_house'): ('lodging', 'Pension'),
    ('tourism', 'viewpoint'): ('culture', 'Aussichtspunkt'),
    ('tourism', 'information'): ('civic', 'Info'),
    ('leisure', 'park'): ('leisure', 'Park'),
    ('leisure', 'sports_centre'): ('leisure', 'Sportzentrum'),
    ('leisure', 'stadium'): ('leisure', 'Stadion'),
    ('shop', 'supermarket'): ('retail', 'Supermarkt'),
    ('shop', 'mall'): ('retail', 'Einkaufszentrum'),
    ('shop', 'bakery'): ('retail', 'Bäckerei'),
    ('shop', 'butcher'): ('retail', 'Metzgerei'),
    ('shop', 'convenience'): ('retail', 'Kiosk'),
    ('shop', 'department_store'): ('retail', 'Warenhaus'),
    ('shop', 'books'): ('retail', 'Buchladen'),
    ('shop', 'clothes'): ('retail', 'Kleidung'),
    ('railway', 'station'): ('mobility', 'Bahnhof'),
    ('railway', 'halt'): ('mobility', 'Haltepunkt'),
}
CATEGORY_LABELS = {
    'education': 'Bildung',
    'health': 'Gesundheit',
    'civic': 'Öffentlich',
    'food': 'Gastro',
    'culture': 'Kultur',
    'lodging': 'Unterkunft',
    'leisure': 'Freizeit',
    'retail': 'Einzelhandel',
    'mobility': 'Mobilität',
    'historic': 'Historisch',
    'other': 'Sonstiges',
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


def classify(tags):
    if tags.get('historic'):
        return 'historic', 'Historisch', tags.get('historic')
    for key in ('amenity', 'tourism', 'leisure', 'shop', 'railway'):
        value = tags.get(key)
        if not value:
            continue
        category, subtype = CATEGORY_CONFIG.get((key, value), ('other', value.replace('_', ' ').title()))
        return category, subtype, value
    return 'other', 'POI', ''


def choose_name(tags, subtype_label):
    for key in ('name', 'brand', 'operator', 'official_name', 'short_name'):
        value = (tags.get(key) or '').strip()
        if value:
            return value
    return subtype_label


def coords_for(element):
    if element.get('type') == 'node' and 'lon' in element and 'lat' in element:
        return element['lon'], element['lat']
    center = element.get('center') or {}
    if 'lon' in center and 'lat' in center:
        return center['lon'], center['lat']
    return None


def build_dataset(payload):
    project = load_projection()
    pois = []
    cat_counter = Counter()
    sub_counter = Counter()

    for element in payload.get('elements', []):
        tags = element.get('tags') or {}
        coords = coords_for(element)
        if coords is None:
            continue
        category, subtype_label, subtype_key = classify(tags)
        lon, lat = coords
        x, z = project(lon, lat)
        poi_id = f"osm-{element['type']}-{element['id']}"
        title = choose_name(tags, subtype_label)
        poi = {
            'id': poi_id,
            'name': title,
            'category': category,
            'categoryLabel': CATEGORY_LABELS.get(category, 'Sonstiges'),
            'subtype': subtype_key,
            'subtypeLabel': subtype_label,
            'x': round(x, 3),
            'z': round(z, 3),
            'sourceType': element['type'],
        }
        pois.append(poi)
        cat_counter[category] += 1
        sub_counter[subtype_label] += 1

    pois.sort(key=lambda item: (item['categoryLabel'], item['name']))
    return {
        'meta': {
            'source': 'OpenStreetMap via Overpass API',
            'query_area': 'Amberg',
            'boundary_relation_id': BOUNDARY_RELATION_ID,
            'count': len(pois),
            'category_breakdown': dict(cat_counter),
            'subtype_breakdown': dict(sub_counter.most_common(20)),
        },
        'pois': pois,
    }


def main():
    import sys
    use_cache = '--use-cache' in sys.argv
    payload = load_raw() if use_cache and RAW_PATH.exists() else fetch_raw()
    dataset = build_dataset(payload)
    POIS_PATH.write_text(json.dumps(dataset, ensure_ascii=False, separators=(',', ':')))
    print(f'Wrote {POIS_PATH}')
    print(f'Raw cache: {RAW_PATH}')
    print(f"POIs: {dataset['meta']['count']}")
    print(f"Categories: {dataset['meta']['category_breakdown']}")


if __name__ == '__main__':
    main()
