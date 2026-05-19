#!/usr/bin/env python3
import json
import sys
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT_PATH = ROOT / 'data' / 'lod2-test' / 'unpacked' / 'Testdaten_LoD2_UTM32_citygml' / '713_5322.xml'

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


def parse_poslist(text):
    values = [float(v) for v in text.strip().split()]
    coords = []
    for i in range(0, len(values), 3):
        coords.append((values[i], values[i + 1], values[i + 2]))
    if len(coords) > 1 and coords[0] == coords[-1]:
        coords = coords[:-1]
    return coords


def parse_generic_attributes(element):
    attrs = {}
    for attr in element.findall('gen:stringAttribute', NS):
        name = attr.attrib.get('name', '')
        value = attr.findtext('gen:value', default='', namespaces=NS)
        attrs[name] = value
    return attrs


def localize_ring(coords, origin_x, origin_y):
    localized = []
    for x, y, z in coords:
        localized.append([
            round(x - origin_x, 3),
            round(z, 3),
            round(y - origin_y, 3),
        ])
    return localized


def parse_surface(surface_el, origin_x, origin_y):
    surface_kind = SURFACE_TAGS.get(surface_el.tag.rsplit('}', 1)[-1], 'other')
    attrs = parse_generic_attributes(surface_el)
    polygons = []
    for pos_list in surface_el.findall('.//gml:posList', NS):
        coords = parse_poslist(pos_list.text or '')
        if len(coords) >= 3:
            polygons.append(localize_ring(coords, origin_x, origin_y))
    return {
        'kind': surface_kind,
        'gml_id': surface_el.attrib.get('{http://www.opengis.net/gml}id', ''),
        'attributes': attrs,
        'polygons': polygons,
    }


def main():
    input_path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_INPUT_PATH
    output_path = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else input_path.with_suffix('.sample.lod2.json')

    root = ET.parse(input_path).getroot()
    lower = root.find('.//gml:lowerCorner', NS)
    upper = root.find('.//gml:upperCorner', NS)
    lx, ly, lz = [float(v) for v in lower.text.split()]
    ux, uy, uz = [float(v) for v in upper.text.split()]
    origin_x = lx
    origin_y = ly

    buildings = []
    function_counter = Counter()
    roof_counter = Counter()
    surface_counter = Counter()

    for member in root.findall('core:cityObjectMember', NS):
        building = member.find('bldg:Building', NS)
        if building is None:
            continue
        attrs = parse_generic_attributes(building)
        surfaces = []
        for bounded in building.findall('bldg:boundedBy', NS):
            for child in list(bounded):
                local = child.tag.rsplit('}', 1)[-1]
                if local in SURFACE_TAGS:
                    surface = parse_surface(child, origin_x, origin_y)
                    surfaces.append(surface)
                    surface_counter[surface['kind']] += len(surface['polygons'])

        function_value = building.findtext('bldg:function', default='', namespaces=NS)
        roof_type = building.findtext('bldg:roofType', default='', namespaces=NS)
        function_counter[function_value or 'unknown'] += 1
        roof_counter[roof_type or 'unknown'] += 1

        buildings.append({
            'id': building.attrib.get('{http://www.opengis.net/gml}id', ''),
            'name': building.findtext('gml:name', default='', namespaces=NS),
            'function': function_value,
            'roofType': roof_type,
            'attributes': attrs,
            'surfaces': surfaces,
        })

    output = {
        'meta': {
            'source': str(input_path.name),
            'format': 'CityGML LoD2-BY sample',
            'bounds_utm32': {
                'min_x': lx,
                'min_y': ly,
                'min_z': lz,
                'max_x': ux,
                'max_y': uy,
                'max_z': uz,
            },
            'local_origin_utm32': {'x': origin_x, 'y': origin_y},
            'building_count': len(buildings),
            'surface_polygon_counts': dict(surface_counter),
            'function_counts': dict(function_counter),
            'roof_type_counts': dict(roof_counter),
        },
        'buildings': buildings,
    }
    output_path.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')))
    print(f'Wrote {output_path}')
    print(f"Buildings: {len(buildings)}")
    print(f"Surface polygons: {dict(surface_counter)}")
    print(f"Roof types: {dict(roof_counter)}")


if __name__ == '__main__':
    main()
