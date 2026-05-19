#!/usr/bin/env python3
import json
import math
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree

from osgeo import osr

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data' / 'lod2-amberg'
META4_PATH = DATA_DIR / '09361000.meta4'
BUILDINGS_PATH = ROOT / 'buildings.json'
TERRAIN_PATH = ROOT / 'terrain.json'
OUTPUT_PATH = DATA_DIR / 'amberg-central-lod2.scene.json'
FULL_OUTPUT_PATH = DATA_DIR / 'amberg-full-lod2.scene.json'
TILE_OUTPUT_DIR = DATA_DIR / 'scene-tiles'
MANIFEST_PATH = DATA_DIR / 'amberg-lod2.manifest.json'
META4_URL = 'https://geodaten.bayern.de/odd/a/lod2/citygml/meta/metalink/09361000.meta4'
USER_AGENT = 'openclaw/iv-amberg'
DEFAULT_TILE_COUNT = 4

NS = {
    'core': 'http://www.opengis.net/citygml/1.0',
    'gml': 'http://www.opengis.net/gml',
    'bldg': 'http://www.opengis.net/citygml/building/1.0',
}
SURFACE_TAGS = {
    'RoofSurface': 'roof',
    'WallSurface': 'wall',
    'GroundSurface': 'ground',
}


def fetch_bytes(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=240) as response:
        return response.read()


def ensure_meta4():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not META4_PATH.exists():
        META4_PATH.write_bytes(fetch_bytes(META4_URL))
    return META4_PATH


def load_scene_meta():
    with BUILDINGS_PATH.open() as f:
        meta = json.load(f)['meta']
    with TERRAIN_PATH.open() as f:
        terrain_meta = json.load(f)['meta']
    projection = meta['projection']
    center = projection['center']
    scale = projection['scale_meters_to_scene']
    meters_per_lon = 111320.0 * math.cos(math.radians(center['lat']))
    meters_per_lat = 110540.0
    return {
        'center': center,
        'scale': scale,
        'meters_per_lon': meters_per_lon,
        'meters_per_lat': meters_per_lat,
        'vertical_scale': terrain_meta['vertical_scale'],
        'vertical_offset': -0.2,
    }


def build_lonlat_utm_transformers():
    lonlat = osr.SpatialReference(); lonlat.ImportFromEPSG(4326)
    utm = osr.SpatialReference(); utm.ImportFromEPSG(25832)
    try:
        lonlat.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        utm.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    except AttributeError:
        pass
    to_utm = osr.CoordinateTransformation(lonlat, utm)
    to_lonlat = osr.CoordinateTransformation(utm, lonlat)
    return to_utm, to_lonlat


def scene_projector(scene_meta):
    _, to_lonlat = build_lonlat_utm_transformers()
    center = scene_meta['center']
    scale = scene_meta['scale']
    meters_per_lon = scene_meta['meters_per_lon']
    meters_per_lat = scene_meta['meters_per_lat']
    vertical_scale = scene_meta['vertical_scale']
    vertical_offset = scene_meta['vertical_offset']

    def project(x, y, z):
        lon, lat, _ = to_lonlat.TransformPoint(x, y, z)
        scene_x = (lon - center['lon']) * meters_per_lon * scale
        scene_z = (lat - center['lat']) * meters_per_lat * scale
        scene_y = z * vertical_scale + vertical_offset
        return [round(scene_x, 3), round(scene_y, 3), round(scene_z, 3)]

    return project


def parse_meta4(meta4_path):
    root = ET.fromstring(meta4_path.read_bytes())
    ns = {'m': 'urn:ietf:params:xml:ns:metalink'}
    rows = []
    for f in root.findall('m:file', ns):
        rows.append({
            'name': f.attrib['name'],
            'size': int(f.findtext('m:size', default='0', namespaces=ns)),
            'url': f.findtext('m:url', default='', namespaces=ns),
        })
    return rows


def select_tiles(meta4_rows, scene_meta, tile_count):
    to_utm, _ = build_lonlat_utm_transformers()
    cx, cy, _ = to_utm.TransformPoint(scene_meta['center']['lon'], scene_meta['center']['lat'])
    ranked = []
    for row in meta4_rows:
        a, b = row['name'].replace('.gml', '').split('_')
        tx = int(a) * 1000
        ty = int(b) * 1000
        tile_cx = tx + 500
        tile_cy = ty + 500
        dist = math.hypot(tile_cx - cx, tile_cy - cy)
        ranked.append((dist, row))
    return [row for _, row in sorted(ranked, key=lambda x: x[0])[:tile_count]]


def ensure_tiles(tile_rows):
    paths = []
    for row in tile_rows:
        path = DATA_DIR / row['name']
        if not path.exists():
            path.write_bytes(fetch_bytes(row['url']))
        paths.append(path)
    return paths


def parse_poslist(text):
    vals = [float(v) for v in text.strip().split()]
    coords = []
    for i in range(0, len(vals), 3):
        coords.append((vals[i], vals[i + 1], vals[i + 2]))
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]
    return coords


def parse_surface(surface_el, project):
    kind = SURFACE_TAGS.get(surface_el.tag.rsplit('}', 1)[-1], 'wall')
    polygons = []
    for pos_list in surface_el.findall('.//gml:posList', NS):
        coords = parse_poslist(pos_list.text or '')
        if len(coords) >= 3:
            polygons.append([project(x, y, z) for x, y, z in coords])
    return {'kind': kind, 'polygons': polygons}


def center_from_ground(surfaces):
    points = [p for s in surfaces if s['kind'] == 'ground' for poly in s['polygons'] for p in poly]
    if not points:
        points = [p for s in surfaces for poly in s['polygons'][:1] for p in poly]
    if not points:
        return {'x': 0, 'z': 0}
    return {
        'x': round(sum(p[0] for p in points) / len(points), 3),
        'z': round(sum(p[2] for p in points) / len(points), 3),
    }


def minmax_y(surfaces):
    ys = [p[1] for s in surfaces for poly in s['polygons'] for p in poly]
    return (round(min(ys), 3), round(max(ys), 3)) if ys else (0, 0)


def parse_tile(path, project):
    root = ElementTree.parse(path).getroot()
    buildings = []
    roof_counter = Counter()
    function_counter = Counter()
    for member in root.findall('core:cityObjectMember', NS):
        building = member.find('bldg:Building', NS)
        if building is None:
            continue
        surfaces = []
        for bounded in building.findall('bldg:boundedBy', NS):
            for child in list(bounded):
                local = child.tag.rsplit('}', 1)[-1]
                if local in SURFACE_TAGS:
                    surfaces.append(parse_surface(child, project))
        roof_type = building.findtext('bldg:roofType', default='', namespaces=NS)
        function_code = building.findtext('bldg:function', default='', namespaces=NS)
        roof_counter[roof_type or 'unknown'] += 1
        function_counter[function_code or 'unknown'] += 1
        base_y, top_y = minmax_y(surfaces)
        buildings.append({
            'id': building.attrib.get('{http://www.opengis.net/gml}id', ''),
            'roofType': roof_type,
            'function': function_code,
            'center': center_from_ground(surfaces),
            'baseY': base_y,
            'topY': top_y,
            'surfaces': surfaces,
        })
    return buildings, roof_counter, function_counter


def scene_bounds(buildings):
    min_x = math.inf
    max_x = -math.inf
    min_z = math.inf
    max_z = -math.inf

    for building in buildings:
        for surface in building.get('surfaces', []):
            for polygon in surface.get('polygons', []):
                for point in polygon:
                    min_x = min(min_x, point[0])
                    max_x = max(max_x, point[0])
                    min_z = min(min_z, point[2])
                    max_z = max(max_z, point[2])

    if not math.isfinite(min_x):
        return {
            'min_x': 0,
            'max_x': 0,
            'min_z': 0,
            'max_z': 0,
            'center_x': 0,
            'center_z': 0,
        }

    return {
        'min_x': round(min_x, 3),
        'max_x': round(max_x, 3),
        'min_z': round(min_z, 3),
        'max_z': round(max_z, 3),
        'center_x': round((min_x + max_x) * 0.5, 3),
        'center_z': round((min_z + max_z) * 0.5, 3),
    }


def build_output(scene_meta, tile_names, buildings, roof_counter, function_counter, source_label='Bayern LoD2-BY (selected Amberg tiles)'):
    return {
        'meta': {
            'source': source_label,
            'tile_count': len(tile_names),
            'tiles': tile_names,
            'building_count': len(buildings),
            'scene_projection': {
                'center': scene_meta['center'],
                'scale_meters_to_scene': scene_meta['scale'],
                'vertical_scale': scene_meta['vertical_scale'],
                'vertical_offset': scene_meta['vertical_offset'],
            },
            'roof_type_counts': dict(roof_counter),
            'function_counts': dict(function_counter),
        },
        'buildings': buildings,
    }


def write_json(path, payload):
    out_path = Path(path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    return out_path


def write_split_tiles(scene_meta, tile_paths, project):
    TILE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_tiles = []
    total_buildings = 0
    total_roof_counter = Counter()
    total_function_counter = Counter()

    for path in tile_paths:
        buildings, roof_counter, function_counter = parse_tile(path, project)
        total_buildings += len(buildings)
        total_roof_counter.update(roof_counter)
        total_function_counter.update(function_counter)
        output_name = f'{path.stem}.scene.lod2.json'
        output_path = TILE_OUTPUT_DIR / output_name
        payload = build_output(
            scene_meta,
            [path.name],
            buildings,
            roof_counter,
            function_counter,
            source_label='Bayern LoD2-BY (Amberg tile)'
        )
        write_json(output_path, payload)
        manifest_tiles.append({
            'tile': path.stem,
            'gml': path.name,
            'path': f'data/lod2-amberg/scene-tiles/{output_name}',
            'building_count': len(buildings),
            'roof_type_counts': dict(roof_counter),
            'function_counts': dict(function_counter),
            'scene_bounds': scene_bounds(buildings),
            'bytes': output_path.stat().st_size,
        })
        print(f'Wrote {output_path} ({len(buildings)} buildings)')

    manifest = {
        'meta': {
            'source': 'Bayern LoD2-BY (Amberg split scene tiles)',
            'tile_count': len(manifest_tiles),
            'building_count': total_buildings,
            'scene_projection': {
                'center': scene_meta['center'],
                'scale_meters_to_scene': scene_meta['scale'],
                'vertical_scale': scene_meta['vertical_scale'],
                'vertical_offset': scene_meta['vertical_offset'],
            },
            'roof_type_counts': dict(total_roof_counter),
            'function_counts': dict(total_function_counter),
        },
        'tiles': manifest_tiles,
    }
    manifest_path = write_json(MANIFEST_PATH, manifest)
    print(f'Wrote {manifest_path}')
    print('tile_files', len(manifest_tiles))
    print('buildings', total_buildings)
    print('roof_types', dict(total_roof_counter))
    print('functions', dict(total_function_counter))


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--tile-count', type=int, default=DEFAULT_TILE_COUNT)
    parser.add_argument('--all', action='store_true', help='Use all Amberg tiles from the meta4 file')
    parser.add_argument('--split', action='store_true', help='Write one scene JSON per tile plus a manifest')
    parser.add_argument('--output', default=str(OUTPUT_PATH))
    args = parser.parse_args()

    scene_meta = load_scene_meta()
    meta4_path = ensure_meta4()
    meta4_rows = parse_meta4(meta4_path)
    if args.all:
        selected_rows = meta4_rows
        if args.output == str(OUTPUT_PATH):
            args.output = str(FULL_OUTPUT_PATH)
    else:
        selected_rows = select_tiles(meta4_rows, scene_meta, args.tile_count)
    tile_paths = ensure_tiles(selected_rows)
    project = scene_projector(scene_meta)

    if args.split:
        write_split_tiles(scene_meta, tile_paths, project)
        return

    all_buildings = []
    roof_counter = Counter()
    function_counter = Counter()
    for path in tile_paths:
        buildings, roofs, functions = parse_tile(path, project)
        all_buildings.extend(buildings)
        roof_counter.update(roofs)
        function_counter.update(functions)

    output = build_output(scene_meta, [path.name for path in tile_paths], all_buildings, roof_counter, function_counter)
    out_path = write_json(args.output, output)
    print(f'Wrote {out_path}')
    print('tiles', [p.name for p in tile_paths])
    print('buildings', len(all_buildings))
    print('roof_types', dict(roof_counter))
    print('functions', dict(function_counter))


if __name__ == '__main__':
    main()
