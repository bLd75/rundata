#!/usr/bin/env python3
"""Build src/routes/radars.json: the fixed speed cameras of La Réunion, bundled.

From the ministry of the Interior's « Liste des radars fixes en France » on data.gouv.fr (Licence Ouverte 2.0, updated
once a year): each fixed camera of the island, with its number, its type, the speed limit it checks and when it was put
in service. The list is the ministry's, not a survey: a camera may be missing from it. Never the mobile checks.
Usage: python3 -I scripts/build-radars.py [--csv liste.csv]
"""
import argparse
import csv
import io
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = "https://www.data.gouv.fr/api/1/datasets/6712583387af110196942793/"
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}
LON0, LAT0, LON1, LAT1 = 55.1, -21.5, 55.9, -20.8
# The types as the dataset's page defines them.
TYPES = {
    "ETF": "radar vitesse fixe",
    "ETD": "radar vitesse discriminant",
    "ETT": "radar vitesse fixe de nouvelle génération",
    "ETU": "radar vitesse urbain",
    "ETVM": "radar vitesse moyenne",
    "ETFR": "radar de feu rouge",
    "ETPN": "radar de passage à niveau",
}


def opened(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120)


def latest():
    """The newest CSV of the dataset, and the day it was put online."""
    meta = json.load(opened(DATASET))
    r = max((r for r in meta["resources"] if r["format"] == "csv"), key=lambda r: r["last_modified"])
    return r["url"], r["last_modified"][:10]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--csv", help="a local copy of the CSV")
    p.add_argument("--du", help="the day of that copy, 2025-12-30")
    a = p.parse_args()
    if a.csv:
        raw, url, day = Path(a.csv).read_bytes(), None, a.du
    else:
        url, day = latest()
        raw = opened(url).read()
    rows = list(csv.reader(io.StringIO(raw.decode("latin-1")), delimiter=";"))[1:]
    out = []
    for numero, kind, since, vma, lat, lon in (r[:6] for r in rows if len(r) >= 6):
        try:
            x, y = float(lon), float(lat)
        except ValueError:
            continue
        if not (LON0 < x < LON1 and LAT0 < y < LAT1):
            continue
        d = since.strip()[:10]
        out.append({
            "numero": numero.strip(),
            "type": TYPES.get(kind.strip(), kind.strip()),
            "vma_kmh": int(vma) if vma.strip().isdigit() else None,
            "mis_en_service": f"{d[6:10]}-{d[3:5]}-{d[0:2]}" if len(d) == 10 else None,
            "lon": round(x, 5),
            "lat": round(y, 5),
        })
    out.sort(key=lambda r: r["numero"])
    dest = ROOT / "src/routes/radars.json"
    dest.write_text(json.dumps({
        "fichier_du": day,
        "source": "Ministère de l'Intérieur, « Liste des radars fixes en France », Licence Ouverte 2.0",
        "page": "https://www.data.gouv.fr/datasets/liste-des-radars-fixes-en-france",
        "radars": out,
    }, ensure_ascii=False, indent=0) + "\n")
    print(dest, len(out), "radars fixes")


if __name__ == "__main__":
    main()
