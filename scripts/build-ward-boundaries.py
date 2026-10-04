"""Build reviewed CivicPulse ward outlines from the Dhaka census polygon layer.

The thana/ward crosswalk is checked against the two CityPopulation directories.
Run from the repository root with Python 3. The source service contains clipped
ward fragments, so fragments with the same corporation and ward number are
combined into one MultiPolygon. No geometry is invented for missing wards.
"""

import html
import json
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAYER = "https://www.arcgisbd.com/server/rest/services/ADB005/CRIIPS/MapServer/346/query?where=1%3D1&outFields=OBJECTID,division_n,upazila_th,union_ward,Area_ha&returnGeometry=true&outSR=4326&f=geojson"
DIRECTORY = {
    "DNCC": "https://www.citypopulation.de/en/bangladesh/dhakanorthcity/admin/",
    "DSCC": "https://www.citypopulation.de/en/bangladesh/dhakasouthcity/admin/",
}


def get(url, cache_name):
    cache = ROOT / "tmp" / cache_name
    if cache.exists():
        return cache.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": "CivicPulse/ward-boundary-build"})
    with urllib.request.urlopen(request, timeout=90) as response:
        contents = response.read()
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(contents)
    return contents


def normalize(name):
    name = re.sub(r"[^a-z]", "", name.lower())
    aliases = {
        "adabar": "adabor", "dakkhinkhan": "dakshinkhan", "uttrapashchim": "uttarapaschim",
        "chakbazar": "chawkbazar", "hazaribag": "hazaribagh", "kamrangichar": "kamrangirchar",
        "lalbag": "lalbagh", "sabujbag": "sabujbagh", "shahbag": "shahbagh", "newmarket": "newmarket",
    }
    return aliases.get(name, name)


def ward_number(label):
    match = re.search(r"Ward No[.]?\s*([0-9]+)", label)
    if not match:
        raise ValueError(f"Cannot read ward number: {label}")
    return int(match.group(1))


def directory_rows():
    rows = set()
    for corp, url in DIRECTORY.items():
        thana = None
        for line in get(url, f"citypop-{'north' if corp == 'DNCC' else 'south'}.html").decode("utf-8").splitlines():
            if "<tr " not in line:
                continue
            status = re.search(r'<td class="rstatus">([^<]+)', line)
            name = re.search(r'<td class="rname"[^>]*>(.*?)</td>', line)
            if not status or not name:
                continue
            label = html.unescape(re.sub(r"<[^>]+>", "", name.group(1))).strip()
            if status.group(1) == "City District":
                thana = label.split(" (")[0]
            elif status.group(1) == "Ward":
                rows.add((corp, normalize(thana), ward_number(label)))
    return rows


def main():
    rows = directory_rows()
    source = json.loads(get(LAYER, "ward-geometry-source.geojson"))
    if source.get("type") != "FeatureCollection" or len(source.get("features", [])) < 150:
        raise ValueError("The source returned too few ward polygons.")
    grouped = defaultdict(list)
    exceptions = {
        ("sherebanglanagar", 27): "DNCC", ("sherebanglanagar", 28): "DNCC",
        ("sherebanglanagar", 17): "DSCC", ("sabujbagh", 72): "DSCC",
    }
    for feature in source["features"]:
        props = feature["properties"]
        thana, number = normalize(props["upazila_th"]), ward_number(props["union_ward"])
        matches = [corp for corp in DIRECTORY if (corp, thana, number) in rows]
        corporation = matches[0] if len(matches) == 1 else exceptions.get((thana, number))
        if not corporation:
            raise ValueError(f"Unmatched polygon: {thana} ward {number} ({matches})")
        if corporation == "DNCC" and number == 98:
            continue  # Restricted census area, outside the 54 municipal wards.
        code = f"{corporation}-{number:02d}"
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        grouped[code].extend(polygons)

    destination = ROOT / "public" / "ward-boundaries"
    destination.mkdir(parents=True, exist_ok=True)
    for corporation, count in (("DNCC", 54), ("DSCC", 75)):
        expected = {f"{corporation}-{n:02d}" for n in range(1, count + 1)}
        actual = {code for code in grouped if code.startswith(corporation)}
        if actual != expected:
            raise ValueError(f"{corporation} missing {sorted(expected - actual)}, extra {sorted(actual - expected)}")
        boundaries = []
        for code in sorted(actual):
            polygons = grouped[code]
            rounded = [[[[round(x, 6), round(y, 6)] for x, y in ring] for ring in polygon] for polygon in polygons]
            boundaries.append({"code": code, "geometry": {"type": "MultiPolygon", "coordinates": rounded}})
        path = destination / f"{corporation.lower()}.json"
        path.write_text(json.dumps(boundaries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{corporation}: {len(boundaries)} wards, {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
