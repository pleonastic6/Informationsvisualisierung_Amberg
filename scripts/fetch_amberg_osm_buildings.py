#!/usr/bin/env python3
import json
import math
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / 'data'
RAW_PATH = RAW_DIR / 'amberg-osm-buildings-overpass.json'
BUILDINGS_PATH = ROOT / 'buildings.json'
METADATA_PATH = ROOT / 'building-metadata.json'
BOUNDARY_RELATION_ID = 62772

OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
USER_AGENT = 'openclaw/iv-amberg'
SCENE_SIZE = 1000.0
DEFAULT_LEVEL_HEIGHT = 3.2
ERA_LABELS = {
    0: 'Unbekannt',
    1: 'Vor 1900',
    2: '1900–1939',
    3: '1940–1969',
    4: '1970–1999',
    5: '2000+'
}
HEIGHT_DEFAULTS = {
    'garage': 3.2,
    'garages': 3.2,
    'shed': 3.0,
    'hut': 3.0,
    'service': 3.5,
    'carport': 3.0,
    'kiosk': 3.5,
    'roof': 2.8,
    'house': 8.5,
    'detached': 8.5,
    'semidetached_house': 8.5,
    'residential': 10.5,
    'apartments': 14.0,
    'terrace': 9.5,
    'farm': 10.0,
    'farm_auxiliary': 6.0,
    'barn': 8.0,
    'industrial': 11.0,
    'warehouse': 10.0,
    'retail': 9.0,
    'commercial': 12.0,
    'office': 14.0,
    'supermarket': 8.5,
    'school': 12.0,
    'university': 14.0,
    'hospital': 18.0,
    'hotel': 16.0,
    'public': 14.0,
    'civic': 14.0,
    'government': 16.0,
    'church': 18.0,
    'chapel': 10.0,
    'cathedral': 24.0,
    'mosque': 16.0,
    'synagogue': 14.0,
    'train_station': 11.0,
    'transportation': 9.0,
    'sports_centre': 12.0,
    'grandstand': 9.0,
    'stadium': 18.0,
    'construction': 9.0,
    'yes': 10.0,
}
HEIGHT_RE = re.compile(r'-?\d+(?:[.,]\d+)?')
YEAR_RE = re.compile(r'(\d{4})')

OVERPASS_QUERY = '''
[out:json][timeout:180];
rel(62772);
map_to_area;
(
  way["building"](area);
);
out tags geom;
'''.strip()


def fetch_raw():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        OVERPASS_URL,
        data=OVERPASS_QUERY.encode('utf-8'),
        headers={
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': USER_AGENT,
        },
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=240) as response:
        payload = json.load(response)
    RAW_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    return payload


def load_raw():
    return json.loads(RAW_PATH.read_text())


def parse_numeric(text):
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    value = str(text).strip().lower()
    if not value:
        return None
    match = HEIGHT_RE.search(value)
    if not match:
        return None
    number = float(match.group(0).replace(',', '.'))
    if 'ft' in value or 'feet' in value or "'" in value:
        return number * 0.3048
    return number


def parse_levels(tags):
    levels = parse_numeric(tags.get('building:levels'))
    if levels is None:
        return None
    roof_levels = parse_numeric(tags.get('roof:levels')) or 0.0
    min_level = parse_numeric(tags.get('building:min_level')) or 0.0
    return max(0.0, levels + roof_levels - min_level)


def estimate_height(tags):
    explicit = parse_numeric(tags.get('height'))
    if explicit and explicit > 1.5:
        return explicit, 'height'

    levels = parse_levels(tags)
    if levels and levels > 0:
        return max(3.0, levels * DEFAULT_LEVEL_HEIGHT), 'levels'

    building_type = (tags.get('building') or '').strip().lower()
    if building_type in HEIGHT_DEFAULTS:
        return HEIGHT_DEFAULTS[building_type], 'default:' + building_type

    return 10.0, 'default:generic'


def parse_year(tags):
    for key in ('start_date', 'building:start_date', 'construction_date', 'year_of_construction'):
        value = tags.get(key)
        if not value:
            continue
        match = YEAR_RE.search(str(value))
        if match:
            return int(match.group(1))
    return None


def era_from_year(year):
    if not year or year <= 0:
        return 0
    if year < 1900:
        return 1
    if year < 1940:
        return 2
    if year < 1970:
        return 3
    if year < 2000:
        return 4
    return 5


def normalize_ring(points):
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    if len(points) < 3:
        return None
    return points


def signed_area(points):
    total = 0.0
    for i, (x1, y1) in enumerate(points):
        x2, y2 = points[(i + 1) % len(points)]
        total += x1 * y2 - x2 * y1
    return total * 0.5


def centroid(points):
    area_acc = 0.0
    x_acc = 0.0
    y_acc = 0.0
    for i, (x1, y1) in enumerate(points):
        x2, y2 = points[(i + 1) % len(points)]
        cross = x1 * y2 - x2 * y1
        area_acc += cross
        x_acc += (x1 + x2) * cross
        y_acc += (y1 + y2) * cross
    area = area_acc * 0.5
    if abs(area) < 1e-9:
        return (
            sum(x for x, _ in points) / len(points),
            sum(y for _, y in points) / len(points),
        )
    return x_acc / (6 * area), y_acc / (6 * area)


def point_in_ring(point, ring):
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def assign_holes(rings):
    outers = []
    holes = []
    for ring in rings:
        area = signed_area(ring)
        if abs(area) < 1e-9:
            continue
        if area > 0:
            outers.append({'ring': ring, 'holes': []})
        else:
            holes.append(list(reversed(ring)))

    if not outers and rings:
        largest = max(rings, key=lambda ring: abs(signed_area(ring)))
        outers = [{'ring': largest if signed_area(largest) > 0 else list(reversed(largest)), 'holes': []}]
        holes = []
        leftovers = [ring for ring in rings if ring is not largest]
        holes.extend([ring if signed_area(ring) > 0 else list(reversed(ring)) for ring in leftovers])

    for hole in holes:
        hole_center = centroid(hole)
        owner = None
        owner_area = None
        for outer in outers:
            if point_in_ring(hole_center, outer['ring']):
                area = abs(signed_area(outer['ring']))
                if owner is None or area < owner_area:
                    owner = outer
                    owner_area = area
        if owner is not None:
            owner['holes'].append(hole)

    return outers


def extract_way_rings(element):
    geometry = element.get('geometry') or []
    points = [(node['lon'], node['lat']) for node in geometry if 'lon' in node and 'lat' in node]
    ring = normalize_ring(points)
    return [ring] if ring else []


def extract_relation_rings(element):
    rings = []
    for member in element.get('members', []):
        if member.get('type') != 'way':
            continue
        geometry = member.get('geometry') or []
        points = [(node['lon'], node['lat']) for node in geometry if 'lon' in node and 'lat' in node]
        ring = normalize_ring(points)
        if ring:
            rings.append(ring)
    return rings


def flatten(points):
    out = []
    for x, z in points:
        out.append(round(x, 3))
        out.append(round(z, 3))
    return out


def local_projector(all_points):
    lons = [lon for lon, _ in all_points]
    lats = [lat for _, lat in all_points]
    lon_center = (min(lons) + max(lons)) / 2.0
    lat_center = (min(lats) + max(lats)) / 2.0
    lat_center_rad = math.radians(lat_center)
    meters_per_lon = 111320.0 * math.cos(lat_center_rad)
    meters_per_lat = 110540.0

    projected = [
        ((lon - lon_center) * meters_per_lon, (lat - lat_center) * meters_per_lat)
        for lon, lat in all_points
    ]
    xs = [x for x, _ in projected]
    zs = [z for _, z in projected]
    span = max(max(xs) - min(xs), max(zs) - min(zs), 1.0)
    scale = SCENE_SIZE / span

    def project(lon, lat):
        x = (lon - lon_center) * meters_per_lon * scale
        z = (lat - lat_center) * meters_per_lat * scale
        return x, z

    meta = {
        'lon_min': min(lons),
        'lon_max': max(lons),
        'lat_min': min(lats),
        'lat_max': max(lats),
        'scene_size': SCENE_SIZE,
        'scale_meters_to_scene': scale,
        'center': {'lon': lon_center, 'lat': lat_center},
    }
    return project, meta


def choose_name(tags):
    for key in ('name', 'alt_name', 'official_name', 'short_name', 'addr:housename'):
        value = (tags.get(key) or '').strip()
        if value:
            return value
    return ''


def build_dataset(payload):
    raw_elements = payload.get('elements', [])
    candidate_elements = []
    all_points = []
    for element in raw_elements:
        if element.get('type') == 'way':
            rings = extract_way_rings(element)
        elif element.get('type') == 'relation':
            rings = extract_relation_rings(element)
        else:
            continue
        if not rings:
            continue
        candidate_elements.append((element, rings))
        for ring in rings:
            all_points.extend(ring)

    if not all_points:
        raise RuntimeError('No geometry found in Overpass payload')

    project, projection_meta = local_projector(all_points)
    buildings = []
    metadata = []
    height_sources = Counter()
    type_counter = Counter()
    relation_count = 0

    for element, rings in candidate_elements:
        if element.get('type') == 'relation':
            relation_count += 1
        projected_rings = []
        for ring in rings:
            projected = [project(lon, lat) for lon, lat in ring]
            if len(projected) >= 3:
                projected_rings.append(projected)
        if not projected_rings:
            continue

        grouped = assign_holes(projected_rings)
        if not grouped:
            continue
        outer = max(grouped, key=lambda item: abs(signed_area(item['ring'])))
        outer_ring = outer['ring']
        hole_rings = outer['holes'] or None
        cx, cz = centroid(outer_ring)

        tags = element.get('tags', {})
        height, height_source = estimate_height(tags)
        year = parse_year(tags)
        building_type = (tags.get('building') or '').strip().lower()
        type_counter[building_type or 'unknown'] += 1
        height_sources[height_source] += 1

        building_id = f"osm-{element.get('type')}-{element.get('id')}"
        name = choose_name(tags)
        buildings.append({
            'id': building_id,
            'x': round(cx, 3),
            'z': round(cz, 3),
            'h': round(height, 2),
            'g': 0,
            'era': era_from_year(year),
            'ext': flatten(outer_ring),
            'holes': [flatten(ring) for ring in hole_rings] if hole_rings else None,
            'source': 'OpenStreetMap',
            'buildingType': building_type or 'unknown',
        })
        metadata.append([building_id, name])

    heights = [building['h'] for building in buildings]
    output = {
        'meta': {
            'source': 'OpenStreetMap via Overpass API',
            'query_area': 'Amberg',
            'boundary_relation_id': BOUNDARY_RELATION_ID,
            'count': len(buildings),
            'scene_size': projection_meta['scene_size'],
            'lon_min': projection_meta['lon_min'],
            'lon_max': projection_meta['lon_max'],
            'lat_min': projection_meta['lat_min'],
            'lat_max': projection_meta['lat_max'],
            'height_range': [round(min(heights), 2), round(max(heights), 2)] if heights else [0, 0],
            'era_legend': {str(k): v for k, v in ERA_LABELS.items()},
            'projection': {
                'type': 'local-equirectangular-scaled',
                'center': projection_meta['center'],
                'scale_meters_to_scene': projection_meta['scale_meters_to_scene'],
            },
            'stats': {
                'relations_included': relation_count,
                'height_sources': dict(height_sources),
                'top_building_types': type_counter.most_common(12),
            },
        },
        'buildings': buildings,
    }
    return output, {'buildings': metadata}


def main():
    use_cache = '--use-cache' in sys.argv
    if use_cache and RAW_PATH.exists():
        payload = load_raw()
    else:
        payload = fetch_raw()

    buildings_output, metadata_output = build_dataset(payload)
    BUILDINGS_PATH.write_text(json.dumps(buildings_output, ensure_ascii=False, separators=(',', ':')))
    METADATA_PATH.write_text(json.dumps(metadata_output, ensure_ascii=False, separators=(',', ':')))

    print(f'Wrote {BUILDINGS_PATH}')
    print(f'Wrote {METADATA_PATH}')
    print(f'Raw cache: {RAW_PATH}')
    print(f"Buildings: {buildings_output['meta']['count']}")
    print(f"Height range: {buildings_output['meta']['height_range']}")
    print(f"Height sources: {buildings_output['meta']['stats']['height_sources']}")


if __name__ == '__main__':
    main()
