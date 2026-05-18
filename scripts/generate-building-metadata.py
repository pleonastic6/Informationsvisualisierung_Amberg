#!/usr/bin/env python3
import csv
import json
import math
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILDINGS_PATH = ROOT / 'buildings.json'
FOOTPRINTS_PATH = ROOT / 'archive' / 'building_footprints.csv'
OUTPUT_PATH = ROOT / 'building-metadata.json'
GEOM_PATTERN = re.compile(r'(-?\d+\.\d+) (-?\d+\.\d+)')
HEIGHT_TOLERANCE = 0.2
GROUND_TOLERANCE = 0.2
SEED_MATCHES = 10000
SEARCH_RADIUS = 1
NAMED_SEARCH_DISTANCE = 5
NAMED_HEIGHT_TOLERANCE = 1
NAMED_GROUND_TOLERANCE = 1


def load_buildings():
    with BUILDINGS_PATH.open() as file:
        return json.load(file)['buildings']


def parse_centroid(geometry_text):
    coords = GEOM_PATTERN.findall(geometry_text)
    xs = [float(lon) for lon, _ in coords]
    ys = [float(lat) for _, lat in coords]
    return sum(xs) / len(xs), sum(ys) / len(ys)


def load_footprints():
    footprints = []
    with FOOTPRINTS_PATH.open(newline='', encoding='utf-8', errors='ignore') as file:
        reader = csv.DictReader(file)
        for row in reader:
            try:
                height = float(row['height_roof']) * 0.3048
                ground = float(row['ground_elevation']) * 0.3048
            except (TypeError, ValueError):
                continue

            lon, lat = parse_centroid(row['the_geom'])
            footprints.append({
                'bin': row['bin'] or '',
                'name': row['name'] or '',
                'height': height,
                'ground': ground,
                'lon': lon,
                'lat': lat
            })
    return footprints


def solve_3x3(matrix, vector):
    augmented = [matrix[row][:] + [vector[row]] for row in range(3)]
    for pivot_index in range(3):
        pivot_row = max(range(pivot_index, 3), key=lambda row: abs(augmented[row][pivot_index]))
        augmented[pivot_index], augmented[pivot_row] = augmented[pivot_row], augmented[pivot_index]
        pivot = augmented[pivot_index][pivot_index]
        if abs(pivot) < 1e-12:
            raise ValueError('Regression matrix is singular')
        for column in range(pivot_index, 4):
            augmented[pivot_index][column] /= pivot
        for row in range(3):
            if row == pivot_index:
                continue
            factor = augmented[row][pivot_index]
            for column in range(pivot_index, 4):
                augmented[row][column] -= factor * augmented[pivot_index][column]
    return [augmented[row][3] for row in range(3)]


def fit_axis(pairs, key):
    s_lonlon = s_lonlat = s_lon = 0.0
    s_latlat = s_lat = s_target = 0.0
    s_target_lon = s_target_lat = 0.0
    count = 0.0

    for lon, lat, x, z in pairs:
        target = x if key == 'x' else z
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


def seed_pairs(buildings, footprints):
    pairs = []
    building_index = 0
    footprint_index = 0

    while building_index < len(buildings) and footprint_index < len(footprints) and len(pairs) < SEED_MATCHES:
        building = buildings[building_index]
        footprint = footprints[footprint_index]
        if (
            abs(building['h'] - footprint['height']) <= HEIGHT_TOLERANCE
            and abs(building['g'] - footprint['ground']) <= GROUND_TOLERANCE
        ):
            pairs.append((footprint['lon'], footprint['lat'], building['x'], building['z']))
            building_index += 1
        footprint_index += 1

    if len(pairs) < 5000:
        raise RuntimeError(f'Not enough seed matches found ({len(pairs)})')

    return pairs


def apply_transform(footprints, coef_x, coef_z):
    for footprint in footprints:
        lon = footprint['lon']
        lat = footprint['lat']
        footprint['x'] = coef_x[0] * lon + coef_x[1] * lat + coef_x[2]
        footprint['z'] = coef_z[0] * lon + coef_z[1] * lat + coef_z[2]


def build_buckets(footprints):
    buckets = defaultdict(list)
    for index, footprint in enumerate(footprints):
        buckets[(round(footprint['x']), round(footprint['z']))].append(index)
    return buckets


def match_buildings(buildings, footprints):
    buckets = build_buckets(footprints)
    used = set()
    metadata = []
    matched = 0

    for building in buildings:
        best_index = None
        best_score = None
        base_x = round(building['x'])
        base_z = round(building['z'])

        for dx in range(-SEARCH_RADIUS, SEARCH_RADIUS + 1):
            for dz in range(-SEARCH_RADIUS, SEARCH_RADIUS + 1):
                for footprint_index in buckets.get((base_x + dx, base_z + dz), []):
                    if footprint_index in used:
                        continue
                    footprint = footprints[footprint_index]
                    if abs(footprint['height'] - building['h']) > HEIGHT_TOLERANCE:
                        continue
                    if abs(footprint['ground'] - building['g']) > GROUND_TOLERANCE:
                        continue

                    distance_score = (footprint['x'] - building['x']) ** 2 + (footprint['z'] - building['z']) ** 2
                    height_penalty = ((footprint['height'] - building['h']) * 8) ** 2
                    ground_penalty = ((footprint['ground'] - building['g']) * 8) ** 2
                    score = distance_score + height_penalty + ground_penalty

                    if best_score is None or score < best_score:
                        best_score = score
                        best_index = footprint_index

        if best_index is None:
            metadata.append(['', ''])
            continue

        used.add(best_index)
        matched += 1
        footprint = footprints[best_index]
        metadata.append([footprint['bin'], footprint['name']])

    return metadata, matched


def attach_missing_named_footprints(buildings, footprints, metadata):
    existing_names = {name for _, name in metadata if name}

    for footprint in footprints:
        if not footprint['name'] or footprint['name'] in existing_names:
            continue

        best_index = None
        best_score = None
        for index, building in enumerate(buildings):
            if metadata[index][1]:
                continue

            distance = math.hypot(building['x'] - footprint['x'], building['z'] - footprint['z'])
            height_delta = abs(building['h'] - footprint['height'])
            ground_delta = abs(building['g'] - footprint['ground'])

            if distance > NAMED_SEARCH_DISTANCE:
                continue
            if height_delta > NAMED_HEIGHT_TOLERANCE or ground_delta > NAMED_GROUND_TOLERANCE:
                continue

            score = distance + height_delta * 5 + ground_delta * 2
            if best_score is None or score < best_score:
                best_score = score
                best_index = index

        if best_index is None:
            continue

        metadata[best_index] = [footprint['bin'], footprint['name']]
        existing_names.add(footprint['name'])


def main():
    buildings = load_buildings()
    footprints = load_footprints()
    pairs = seed_pairs(buildings, footprints)
    coef_x = fit_axis(pairs, 'x')
    coef_z = fit_axis(pairs, 'z')
    apply_transform(footprints, coef_x, coef_z)
    metadata, matched = match_buildings(buildings, footprints)
    attach_missing_named_footprints(buildings, footprints, metadata)

    OUTPUT_PATH.write_text(json.dumps({'buildings': metadata}, separators=(',', ':')))
    print(f'Wrote {OUTPUT_PATH}')
    print(f'Matched {matched} / {len(buildings)} buildings')


if __name__ == '__main__':
    main()
