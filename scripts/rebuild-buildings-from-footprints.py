#!/usr/bin/env python3
import csv
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEGACY_BUILDINGS_PATH = ROOT / 'buildings.json'
FOOTPRINTS_PATH = ROOT / 'archive' / 'building_footprints.csv'
OUTPUT_PATH = ROOT / 'buildings.json'

HEIGHT_TOLERANCE = 0.2
GROUND_TOLERANCE = 0.2
SEED_MATCHES = 10000
RING_PATTERN = re.compile(r'\(([^()]+)\)')


def feet_to_meters(value):
    return float(value) * 0.3048


def normalize_ring(points):
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    return points


def parse_multipolygon_rings(wkt):
    rings = []
    for ring_text in RING_PATTERN.findall(wkt):
        if 'MULTIPOLYGON' in ring_text:
            continue
        pairs = []
        for coord_text in ring_text.split(','):
            parts = coord_text.strip().split()
            if len(parts) < 2:
                continue
            lon = float(parts[0])
            lat = float(parts[1])
            pairs.append((lon, lat))
        pairs = normalize_ring(pairs)
        if len(pairs) >= 3:
            rings.append(pairs)
    return rings


def signed_area(points):
    area = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return area * 0.5


def centroid(points):
    area_acc = 0.0
    cx_acc = 0.0
    cy_acc = 0.0
    for index, (x1, y1) in enumerate(points):
        x2, y2 = points[(index + 1) % len(points)]
        cross = x1 * y2 - x2 * y1
        area_acc += cross
        cx_acc += (x1 + x2) * cross
        cy_acc += (y1 + y2) * cross
    area = area_acc * 0.5
    if abs(area) < 1e-9:
        avg_x = sum(x for x, _ in points) / len(points)
        avg_y = sum(y for _, y in points) / len(points)
        return avg_x, avg_y
    return cx_acc / (6 * area), cy_acc / (6 * area)


def era_from_year(year_text):
    try:
        year = int(float(year_text))
    except (TypeError, ValueError):
        return 0
    if year <= 0:
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


def load_legacy_buildings():
    with LEGACY_BUILDINGS_PATH.open() as file:
        return json.load(file)['buildings']


def load_footprints_raw():
    rows = []
    with FOOTPRINTS_PATH.open(newline='', encoding='utf-8', errors='ignore') as file:
        reader = csv.DictReader(file)
        for row in reader:
            try:
                height = feet_to_meters(row['height_roof'])
                ground = feet_to_meters(row['ground_elevation'])
            except (TypeError, ValueError):
                continue
            rings = parse_multipolygon_rings(row['the_geom'])
            if not rings:
                continue
            rows.append({
                'bin': (row['bin'] or '').strip(),
                'name': (row['name'] or '').strip(),
                'height': height,
                'ground': ground,
                'construction_year': row['construction_year'],
                'rings': rings
            })
    return rows


def seed_pairs(legacy_buildings, footprint_rows):
    pairs = []
    legacy_index = 0
    footprint_index = 0

    while legacy_index < len(legacy_buildings) and footprint_index < len(footprint_rows) and len(pairs) < SEED_MATCHES:
        legacy = legacy_buildings[legacy_index]
        footprint = footprint_rows[footprint_index]
        if (
            abs(legacy['h'] - footprint['height']) <= HEIGHT_TOLERANCE
            and abs(legacy['g'] - footprint['ground']) <= GROUND_TOLERANCE
        ):
            lon, lat = centroid(footprint['rings'][0])
            pairs.append((lon, lat, legacy['x'], legacy['z']))
            legacy_index += 1
        footprint_index += 1

    if len(pairs) < 5000:
        raise RuntimeError(f'Not enough seed matches found: {len(pairs)}')
    return pairs


def solve_3x3(matrix, vector):
    augmented = [matrix[row][:] + [vector[row]] for row in range(3)]
    for pivot_index in range(3):
        pivot_row = max(range(pivot_index, 3), key=lambda row: abs(augmented[row][pivot_index]))
        augmented[pivot_index], augmented[pivot_row] = augmented[pivot_row], augmented[pivot_index]
        pivot = augmented[pivot_index][pivot_index]
        if abs(pivot) < 1e-12:
            raise RuntimeError('Singular regression matrix')
        for column in range(pivot_index, 4):
            augmented[pivot_index][column] /= pivot
        for row in range(3):
            if row == pivot_index:
                continue
            factor = augmented[row][pivot_index]
            for column in range(pivot_index, 4):
                augmented[row][column] -= factor * augmented[pivot_index][column]
    return [augmented[row][3] for row in range(3)]


def fit_axis(pairs, axis):
    s_lonlon = s_lonlat = s_lon = 0.0
    s_latlat = s_lat = s_target = 0.0
    s_target_lon = s_target_lat = 0.0
    count = 0.0
    for lon, lat, x, z in pairs:
        target = x if axis == 'x' else z
        s_lonlon += lon * lon
        s_lonlat += lon * lat
        s_lon += lon
        s_latlat += lat * lat
        s_lat += lat
        s_target += target
        s_target_lon += target * lon
        s_target_lat += target * lat
        count += 1
    matrix = [
        [s_lonlon, s_lonlat, s_lon],
        [s_lonlat, s_latlat, s_lat],
        [s_lon, s_lat, count]
    ]
    vector = [s_target_lon, s_target_lat, s_target]
    return solve_3x3(matrix, vector)


def project_point(lon, lat, coef_x, coef_z):
    x = coef_x[0] * lon + coef_x[1] * lat + coef_x[2]
    z = coef_z[0] * lon + coef_z[1] * lat + coef_z[2]
    return x, z


def flatten_points(points):
    flat = []
    for x, z in points:
        flat.append(round(x, 3))
        flat.append(round(z, 3))
    return flat


def build_output_rows(footprint_rows, coef_x, coef_z):
    buildings = []
    named_count = 0
    for row in footprint_rows:
        projected_rings = []
        for ring in row['rings']:
            projected_rings.append([project_point(lon, lat, coef_x, coef_z) for lon, lat in ring])

        outer_ring = projected_rings[0]
        hole_rings = projected_rings[1:] or None
        cx, cz = centroid(outer_ring)

        building = {
            'bin': row['bin'],
            'name': row['name'],
            'x': round(cx, 3),
            'z': round(cz, 3),
            'h': round(row['height'], 2),
            'g': round(row['ground'], 2),
            'era': era_from_year(row['construction_year']),
            'ext': flatten_points(outer_ring),
            'holes': [flatten_points(ring) for ring in hole_rings] if hole_rings else None
        }
        buildings.append(building)
        if row['name']:
            named_count += 1
    return buildings, named_count


def main():
    legacy_buildings = load_legacy_buildings()
    footprint_rows = load_footprints_raw()
    pairs = seed_pairs(legacy_buildings, footprint_rows)
    coef_x = fit_axis(pairs, 'x')
    coef_z = fit_axis(pairs, 'z')
    buildings, named_count = build_output_rows(footprint_rows, coef_x, coef_z)

    OUTPUT_PATH.write_text(json.dumps({'buildings': buildings}, separators=(',', ':')))
    print(f'Wrote {OUTPUT_PATH}')
    print(f'Buildings: {len(buildings)} | named: {named_count}')
    print(f'coef_x={coef_x}')
    print(f'coef_z={coef_z}')


if __name__ == '__main__':
    main()
