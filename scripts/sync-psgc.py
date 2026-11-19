import json
import sys
import urllib.request
import zipfile
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union


PSGC_BASE = "https://psgc.gitlab.io/api"
FAELDON_RELEASE = "https://github.com/faeldon/philippines-json-maps/releases/download/2023-4q/geojson-hires.zip"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data"
CACHE = ROOT / ".cache"
CACHE_FILE = CACHE / "philippines-2023-4q-geojson-hires.zip"

FORCE = "--if-ready" not in sys.argv
if not FORCE:
    runtime_files = [
        OUT / "regions.geojson",
        OUT / "provinces.geojson",
        OUT / "municipalities.geojson",
        OUT / "barangays.json",
        OUT / "barangays" / "by-region",
    ]
    if CACHE_FILE.exists() and all(path.exists() for path in runtime_files):
        print("Boundary data is already generated; use npm run sync:psgc to force refresh.")
        sys.exit(0)


def get_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Philippine-GeoBase/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.status != 200:
            raise RuntimeError(f"{response.status} {url}")
        return json.loads(response.read().decode("utf-8"))


def write_json(name, payload):
    path = OUT / name
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {path.relative_to(ROOT)}: {len(payload if isinstance(payload, list) else payload.get('features', []))} records")


def psgc_code(value):
    return str(int(value)).zfill(10)


OUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

print("Reading complete PSGC JSON...")
barangays = get_json(f"{PSGC_BASE}/barangays.json")
municipalities = get_json(f"{PSGC_BASE}/cities-municipalities.json")
regions = get_json(f"{PSGC_BASE}/regions.json")
provinces = get_json(f"{PSGC_BASE}/provinces.json")

write_json("barangays.json", barangays)
write_json("municipalities.json", municipalities)
write_json("regions.json", regions)
write_json("provinces.json", provinces)

if not CACHE_FILE.exists():
    print("Downloading the 2023-4Q high-resolution (10%) Philippine boundary archive...")
    with urllib.request.urlopen(FAELDON_RELEASE, timeout=300) as response:
        if response.status != 200:
            raise RuntimeError(f"{response.status} {FAELDON_RELEASE}")
        CACHE_FILE.write_bytes(response.read())
else:
    print("Using cached 2023-4Q high-resolution boundary archive.")

barangays_by_code = {str(item["psgc10DigitCode"]): item for item in barangays}

with zipfile.ZipFile(CACHE_FILE) as archive:
    def collection(prefix, feature_level):
        features = []
        for name in archive.namelist():
            if not name.startswith(prefix) or not name.endswith(".json"):
                continue
            payload = json.loads(archive.read(name).decode("utf-8"))
            for feature in payload.get("features", []):
                properties = feature.setdefault("properties", {})
                properties["geometry_source"] = "Faeldon 2023-4Q / OCHA COD-AB / NAMRIA-PSA"
                properties["source_feature_level"] = feature_level
                features.append(feature)
        return {"type": "FeatureCollection", "features": features}

    provinces_collection = collection("geojson/regions/hires/", "province")
    municipality_collection = collection("geojson/provdists/hires/", "municipality")

    for feature in provinces_collection["features"]:
        province_code = feature["properties"].get("adm2_psgc")
        if province_code is not None:
            feature["properties"]["psgc_code"] = psgc_code(province_code)
            feature["properties"]["psgc_name"] = feature["properties"].get("adm2_en") or feature["properties"].get("name")
            feature["properties"]["source_feature_level"] = "province"

    municipality_features = []
    for feature in municipality_collection["features"]:
        municipality_code = feature["properties"].get("adm3_psgc")
        if municipality_code is None:
            continue
        feature["properties"]["psgc_code"] = psgc_code(municipality_code)
        feature["properties"]["psgc_name"] = feature["properties"].get("adm3_en") or feature["properties"].get("name")
        feature["properties"]["source_feature_level"] = "municipality"
        municipality_features.append(feature)
    municipality_collection = {"type": "FeatureCollection", "features": municipality_features}

    province_geometries = {}
    region_names = {str(item["psgc10DigitCode"]): item for item in regions}
    for feature in provinces_collection["features"]:
        adm1 = feature["properties"].get("adm1_psgc")
        if adm1 is None:
            continue
        source_key = str(int(adm1)).zfill(10)
        region = region_names.get(source_key)
        if region is None:
            continue
        province_geometries.setdefault(str(region["psgc10DigitCode"]), []).append(shape(feature["geometry"]))

    region_features = []
    for region_code, geometries in province_geometries.items():
        region = next((item for item in regions if str(item["psgc10DigitCode"]) == region_code), None)
        if region is None:
            continue
        geometry = unary_union(geometries)
        region_features.append({
            "type": "Feature",
            "properties": {
                "psgc_code": region_code,
                "psgc_name": region["name"],
                "adm1_psgc": int(region_code) // 10,
                "geometry_source": "Faeldon 2023-4Q / OCHA COD-AB / NAMRIA-PSA",
                "source_feature_level": "region",
            },
            "geometry": mapping(geometry),
        })
    regions_collection = {"type": "FeatureCollection", "features": region_features}

    barangay_features = []
    missing = []
    for name in archive.namelist():
        if not name.startswith("geojson/municities/hires/") or not name.endswith(".json"):
            continue
        payload = json.loads(archive.read(name).decode("utf-8"))
        for feature in payload.get("features", []):
            properties = feature.setdefault("properties", {})
            if properties.get("geo_level") != "Bgy":
                continue
            integer_code = properties.get("adm4_psgc")
            if integer_code is None:
                continue
            code = psgc_code(integer_code)
            properties["psgc_code"] = code
            psgc = barangays_by_code.get(code)
            properties["psgc_name"] = psgc["name"] if psgc else properties.get("adm4_en")
            properties["adm4_en"] = properties["psgc_name"]
            properties["geometry_source"] = "Faeldon 2023-4Q / OCHA COD-AB / NAMRIA-PSA"
            properties["source_feature_level"] = "barangay"
            if not psgc:
                missing.append(code)
            barangay_features.append(feature)

barangays_collection = {"type": "FeatureCollection", "features": barangay_features}

write_json("regions.geojson", regions_collection)
write_json("provinces.geojson", provinces_collection)
write_json("municipalities.geojson", municipality_collection)
write_json("barangays.geojson", barangays_collection)
import shutil

region_directory = OUT / "barangays" / "by-region"
if region_directory.exists():
    shutil.rmtree(region_directory)
place_directory = OUT / "barangays" / "by-place"
if place_directory.exists():
    shutil.rmtree(place_directory)
region_directory.mkdir(parents=True, exist_ok=True)

for obsolete_name in (
    "barangays.curated.geojson",
    "component_cities.geojson",
    "independent_component_cities.geojson",
    "highly_urbanized_cities.geojson",
):
    obsolete = OUT / obsolete_name
    if obsolete.exists():
        obsolete.unlink()

barangays_by_region = {}
for feature in barangay_features:
    region_code = feature["properties"].get("adm1_psgc")
    if region_code is None:
        continue
    region_prefix = psgc_code(region_code)[:2]
    barangays_by_region.setdefault(region_prefix, []).append(feature)

for region_prefix, region_features in barangays_by_region.items():
    (region_directory / f"{region_prefix}.json").write_text(
        json.dumps({"type": "FeatureCollection", "features": region_features}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


unique_codes = {feature["properties"]["psgc_code"] for feature in barangay_features}
print(f"Barangay geometry: {len(barangay_features)} features, {len(unique_codes)} unique PSGC codes")
print(f"Barangay PSGC codes absent from local API snapshot: {len(set(missing))}")
