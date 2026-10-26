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
# The types as the dataset's page defines them, word for word (read on 26/10/2026).
TYPES = {
    "ETF": "radar vitesse fixe classique, conçu pour contrôler les excès de vitesse sur une portion de route précise",
    "ETD": "radar vitesse fixe discriminant, capable de différencier les types de véhicules (poids lourds, voitures) et d’appliquer des seuils de vitesse différents selon la catégorie",
    "ETT": "radar vitesse fixe de nouvelle génération, doté de fonctionnalités plus avancées de détection des infractions pour contrôler les excès de vitesse ou franchissement",
    "ETU": "radar vitesse fixe de nouvelle génération en milieu urbain pour contrôler les excès de vitesse ou franchissement",
    "ETVM": "radar vitesse moyenne, qui calcule la vitesse moyenne d’un véhicule sur une certaine distance entre deux points",
    "ETFR": "radar de franchissement de feu rouge, qui surveille le respect des feux tricolores",
    "ETPN": "radar de passage à niveau, utilisé pour vérifier le respect des consignes de sécurité aux passages à niveau",
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
            "type": kind.strip(),
            "definition": TYPES.get(kind.strip()),
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
