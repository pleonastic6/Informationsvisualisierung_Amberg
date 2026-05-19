#!/usr/bin/env python3
import json
import math
import subprocess
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform_bounds

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'
DGM_DIR = DATA_DIR / 'dgm1'
TERRAIN_PATH = ROOT / 'terrain.json'
BUILDINGS_PATH = ROOT / 'buildings.json'
META4_URL = 'https://geodaten.bayern.de/odd/a/dgm/dgm1/meta/metalink/09361000.meta4'
USER_AGENT = 'openclaw/iv-amberg'
GRID_WIDTH = 128
GRID_HEIGHT = 128
VERTICAL_SCALE = 0.02


def load_building_meta():
    with BUILDINGS_PATH.open() as f:
        return json.load(f)['meta']


def fetch_bytes(url):
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=240) as response:
        return response.read()


def parse_meta4_urls(meta4_bytes):
    root = ET.fromstring(meta4_bytes)
    ns = {'m': 'urn:ietf:params:xml:ns:metalink'}
    urls = []
    for file_el in root.findall('m:file', ns):
        url_el = file_el.find('m:url', ns)
        if url_el is not None and url_el.text:
            urls.append((file_el.attrib['name'], url_el.text.strip()))
    return urls


def ensure_tiles():
    DGM_DIR.mkdir(parents=True, exist_ok=True)
    meta4_path = DGM_DIR / '09361000.meta4'
    if not meta4_path.exists():
        meta4_path.write_bytes(fetch_bytes(META4_URL))
    urls = parse_meta4_urls(meta4_path.read_bytes())
    paths = []
    for name, url in urls:
        path = DGM_DIR / name
        if not path.exists():
            path.write_bytes(fetch_bytes(url))
        paths.append(path)
    return paths


def build_resampled_geotiff(tile_paths, bounds_src):
    vrt_path = DGM_DIR / 'amberg_dgm1.vrt'
    clipped_path = DGM_DIR / 'amberg_dgm1_terrain_128.tif'
    subprocess.run(['gdalbuildvrt', str(vrt_path), *map(str, tile_paths)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    xmin, ymin, xmax, ymax = bounds_src
    subprocess.run([
        'gdalwarp',
        '-te', str(xmin), str(ymin), str(xmax), str(ymax),
        '-ts', str(GRID_WIDTH), str(GRID_HEIGHT),
        '-r', 'bilinear',
        '-overwrite',
        str(vrt_path),
        str(clipped_path),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return clipped_path


def build_dataset(building_meta, tile_paths):
    lon_min = building_meta['lon_min']
    lon_max = building_meta['lon_max']
    lat_min = building_meta['lat_min']
    lat_max = building_meta['lat_max']
    projection = building_meta['projection']
    center = projection['center']
    scale = projection['scale_meters_to_scene']
    meters_per_lon = 111320.0 * math.cos(math.radians(center['lat']))
    meters_per_lat = 110540.0

    with rasterio.open(tile_paths[0]) as src0:
        src_crs = src0.crs
    bounds_src = transform_bounds('EPSG:4326', src_crs, lon_min, lat_min, lon_max, lat_max, densify_pts=21)
    clipped_path = build_resampled_geotiff(tile_paths, bounds_src)

    with rasterio.open(clipped_path) as ds:
        band = ds.read(1).astype('float32')
        nodata = ds.nodata

    invalid = ~np.isfinite(band)
    if nodata is not None:
        invalid |= band == nodata
    invalid |= band < -1000

    if invalid.any():
        valid_values = band[~invalid]
        fallback = float(valid_values.min()) if valid_values.size else 0.0
        band[invalid] = fallback

    x_min = (lon_min - center['lon']) * meters_per_lon * scale
    x_max = (lon_max - center['lon']) * meters_per_lon * scale
    z_min = (lat_min - center['lat']) * meters_per_lat * scale
    z_max = (lat_max - center['lat']) * meters_per_lat * scale

    elevations = [round(float(v), 2) for v in band.reshape(-1)]
    return {
        'meta': {
            'source': 'Bayerische Vermessungsverwaltung DGM1',
            'download': META4_URL,
            'query_area': building_meta.get('query_area', 'Amberg'),
            'width': GRID_WIDTH,
            'height': GRID_HEIGHT,
            'lon_min': lon_min,
            'lon_max': lon_max,
            'lat_min': lat_min,
            'lat_max': lat_max,
            'x_min': round(min(x_min, x_max), 3),
            'x_max': round(max(x_min, x_max), 3),
            'z_min': round(min(z_min, z_max), 3),
            'z_max': round(max(z_min, z_max), 3),
            'elevation_min': round(float(band.min()), 2),
            'elevation_max': round(float(band.max()), 2),
            'vertical_scale': VERTICAL_SCALE,
            'tiles': len(tile_paths),
        },
        'elevations': elevations,
    }


def main():
    building_meta = load_building_meta()
    tile_paths = ensure_tiles()
    dataset = build_dataset(building_meta, tile_paths)
    TERRAIN_PATH.write_text(json.dumps(dataset, ensure_ascii=False, separators=(',', ':')))
    print(f'Wrote {TERRAIN_PATH}')
    print(f"Tiles: {dataset['meta']['tiles']}")
    print(f"Grid: {dataset['meta']['width']} x {dataset['meta']['height']}")
    print(f"Elevation: {dataset['meta']['elevation_min']} .. {dataset['meta']['elevation_max']} m")


if __name__ == '__main__':
    main()
