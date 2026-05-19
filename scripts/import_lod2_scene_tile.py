#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

from osgeo import osr

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GML = ROOT / 'data' / 'lod2-amberg' / '704_5480.gml'
DEFAULT_OUT = ROOT / 'data' / 'lod2-amberg' / '704_5480.scene.lod2.json'
BUILDINGS_PATH = ROOT / 'buildings.json'
TERRAIN_PATH = ROOT / 'terrain.json'

NS = {
    'core': 'http://www.opengis.net/citygml/1.0',
    'gml': 'http://www.opengis.net/gml',
    'bldg': 'http://www.opengis.net/citygml/building/1.0',
    'gen': 'http://www.opengis.net/citygml/generics/1.0',
}
SURFACE_TAGS = {
    'RoofSurface': 'roof',
    'WallSurface': 'wall',
    'GroundSurface': 'ground',
}


def load_scene_projection():
    with BUILDINGS_PATH.open() as f:
        meta = json.load(f)['meta']
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
    }


def load_terrain_scale():
    with TERRAIN_PATH.open() as f:
        meta = json.load(f)['meta']
    return meta['vertical_scale'], -0.2


def build_transformer():
    src = osr.SpatialReference()
    src.ImportFromEPSG(25832)
    dst = osr.SpatialReference()
    dst.ImportFromEPSG(4326)
    try:
        src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    except AttributeError:
        pass
    transform = osr.CoordinateTransformation(src, dst)
    return transform


def parse_generic_attributes(element):
    attrs = {}
    for attr in element.findall('gen:stringAttribute', NS):
        name = attr.attrib.get('name', '')
        value = attr.findtext('gen:value', default='', namespaces=NS)
        attrs[name] = value
    return attrs


def parse_poslist(text):
    vals = [float(v) for v in text.strip().split()]
    coords = []
    for i in range(0, len(vals), 3):
        coords.append((vals[i], vals[i + 1], vals[i + 2]))
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]
    return coords


def make_scene_projector(projection, vertical_scale, vertical_offset):
    center = projection['center']
    scale = projection['scale']
    meters_per_lon = projection['meters_per_lon']
    meters_per_lat = projection['meters_per_lat']
    transform = build_transformer()

    def project_utm32(x, y, z):
        lon, lat, _ = transform.TransformPoint(x, y, z)
        scene_x = (lon - center['lon']) * meters_per_lon * scale
        scene_z = (lat - center['lat']) * meters_per_lat * scale
        scene_y = z * vertical_scale + vertical_offset
        return [round(scene_x, 3), round(scene_y, 3), round(scene_z, 3)]

    return project_utm32


def parse_surface(surface_el, project):
    kind = SURFACE_TAGS.get(surface_el.tag.rsplit('}', 1)[-1], 'other')
    attrs = parse_generic_attributes(surface_el)
    polygons = []
    for pos_list in surface_el.findall('.//gml:posList', NS):
        coords = parse_poslist(pos_list.text or '')
        if len(coords) >= 3:
            polygons.append([project(x, y, z) for x, y, z in coords])
    return {
        'kind': kind,
        'gml_id': surface_el.attrib.get('{http://www.opengis.net/gml}id', ''),
        'attributes': attrs,
        'polygons': polygons,
    }


def building_center_from_ground(surfaces):
    points = []
    for surface in surfaces:
        if surface['kind'] != 'ground':
            continue
        for poly in surface['polygons']:
            points.extend(poly)
    if not points:
        for surface in surfaces:
            for poly in surface['polygons']:
                points.extend(poly)
                break
            if points:
                break
    if not points:
        return [0, 0]
    x = sum(p[0] for p in points) / len(points)
    z = sum(p[2] for p in points) / len(points)
    return [round(x, 3), round(z, 3)]


def minmax_height(surfaces):
    ys = [p[1] for s in surfaces for poly in s['polygons'] for p in poly]
    return (round(min(ys), 3), round(max(ys), 3)) if ys else (0, 0)


def import_tile(input_path: Path, output_path: Path):
    projection = load_scene_projection()
    vertical_scale, vertical_offset = load_terrain_scale()
    project = make_scene_projector(projection, vertical_scale, vertical_offset)

    root = ET.parse(input_path).getroot()
    lower = root.find('.//gml:lowerCorner', NS)
    upper = root.find('.//gml:upperCorner', NS)
    lx, ly, lz = [float(v) for v in lower.text.split()]
    ux, uy, uz = [float(v) for v in upper.text.split()]

    buildings = []
    roof_counts = {}
    for member in root.findall('core:cityObjectMember', NS):
        building = member.find('bldg:Building', NS)
        if building is None:
            continue
        attrs = parse_generic_attributes(building)
        surfaces = []
        for bounded in building.findall('bldg:boundedBy', NS):
            for child in list(bounded):
                if child.tag.rsplit('}', 1)[-1] in SURFACE_TAGS:
                    surfaces.append(parse_surface(child, project))
        center = building_center_from_ground(surfaces)
        base_y, top_y = minmax_height(surfaces)
        roof_type = building.findtext('bldg:roofType', default='', namespaces=NS)
        roof_counts[roof_type] = roof_counts.get(roof_type, 0) + 1
        buildings.append({
            'id': building.attrib.get('{http://www.opengis.net/gml}id', ''),
            'name': building.findtext('gml:name', default='', namespaces=NS),
            'function': building.findtext('bldg:function', default='', namespaces=NS),
            'roofType': roof_type,
            'attributes': attrs,
            'center': {'x': center[0], 'z': center[1]},
            'baseY': base_y,
            'topY': top_y,
            'surfaces': surfaces,
        })

    output = {
        'meta': {
            'source': input_path.name,
            'format': 'CityGML LoD2-BY scene import',
            'building_count': len(buildings),
            'bounds_utm32': {
                'min_x': lx, 'min_y': ly, 'min_z': lz,
                'max_x': ux, 'max_y': uy, 'max_z': uz,
            },
            'scene_projection': {
                'center': projection['center'],
                'scale_meters_to_scene': projection['scale'],
                'vertical_scale': vertical_scale,
                'vertical_offset': vertical_offset,
            },
            'roof_type_counts': roof_counts,
        },
        'buildings': buildings,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')))
    print(f'Wrote {output_path}')
    print(f'Buildings: {len(buildings)}')
    print(f'Roof types: {roof_counts}')


def main():
    input_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_GML
    output_path = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else DEFAULT_OUT
    import_tile(input_path, output_path)


if __name__ == '__main__':
    main()
