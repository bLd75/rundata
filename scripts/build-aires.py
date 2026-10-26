#!/usr/bin/env python3
"""Build src/traces/aires.json: the ONF's reception areas in La Réunion's forests, bundled.

From the layer « Aires d'accueil » (1) of the ONF's map of the trails, the ArcGIS service sentiers_randonnee reads live
(src/providers/sentiers.ts): each place by its name and position, nothing else. The layer gives no type: nothing is
said of what a place has or allows, only its name as the ONF writes it. Edited seldom (May 2026).
Usage: python3 -I scripts/build-aires.py [--json query.json --meta layer.json]
"""
import argparse
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYER = "https://services1.arcgis.com/Y4HgaQpzkE7kenlE/arcgis/rest/services/Sentiers_La_Reunion_public/FeatureServer/1"
QUERY = LAYER + "/query?" + urllib.parse.urlencode({"where": "1=1", "outFields": "WA_Lieu", "returnGeometry": "true", "outSR": "4326", "geometryPrecision": "5", "f": "json"})
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}


def get(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--json", help="a local copy of the query")
    p.add_argument("--meta", help="a local copy of the layer's description")
    a = p.parse_args()
    rows = json.load(open(a.json)) if a.json else get(QUERY)
    meta = json.load(open(a.meta)) if a.meta else get(LAYER + "?f=json")
    if rows.get("exceededTransferLimit"):
        raise SystemExit("couche tronquée : lire par pages")
    out = []
    for f in rows["features"]:
        nom = re.sub(r"\s+", " ", (f["attributes"].get("WA_Lieu") or "")).strip()
        g = f.get("geometry") or {}
        if not nom or "x" not in g:
            continue
        out.append({"nom": nom, "lon": round(g["x"], 5), "lat": round(g["y"], 5)})
    out.sort(key=lambda r: (r["nom"], r["lon"], r["lat"]))
    edited = meta.get("editingInfo", {}).get("dataLastEditDate")
    dest = ROOT / "src/traces/aires.json"
    dest.write_text(json.dumps({
        "mise_a_jour": datetime.fromtimestamp(edited / 1000, timezone.utc).date().isoformat() if edited else None,
        "source": "ONF La Réunion, couche « Aires d'accueil » de la carte des sentiers",
        "aires": out,
    }, ensure_ascii=False, indent=0) + "\n")
    print(dest, len(out), "aires d'accueil")


if __name__ == "__main__":
    main()
