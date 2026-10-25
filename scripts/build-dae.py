#!/usr/bin/env python3
"""Build src/dae/dae.json: the public defibrillators of La Réunion, bundled with the server.

From Géo'DAE, the national base of automated external defibrillators (ministry of health, published every day on
data.gouv.fr): the devices of the island declared working, without the duplicates and the mobile ones (in a vehicle),
with where each one is, whether it is outside or freely reachable, its floor and its hours when declared.
Most devices carry « Mo-Su off » as hours, the form's default: read as « not said », not as « never ».
Licence Ouverte 2.0. Usage: python3 -I scripts/build-dae.py [--csv geodae.csv]
"""
import argparse
import csv
import io
import math
import json
from datetime import date
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = "https://www.data.gouv.fr/api/1/datasets/61556e1e9d6adb2df86eb0fc/"
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}
LON0, LAT0, LON1, LAT1 = 55.1, -21.5, 55.9, -20.8
DAYS = {"Mo": "lundi", "Tu": "mardi", "We": "mercredi", "Th": "jeudi", "Fr": "vendredi", "Sa": "samedi", "Su": "dimanche"}


def opened(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600)


def csv_url():
    meta = json.load(opened(DATASET))
    return next(r["url"] for r in meta["resources"] if r["format"] == "csv")


def hours(text):
    """The OpenStreetMap-like hours in words, or "" when not said."""
    text = text.strip()
    if text in ("", "Mo-Su off"):
        return ""
    if text == "24/7":
        return "24 h/24, 7 j/7"
    out = []
    for part in text.split(";"):
        part = part.strip()
        m = re.match(r"^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(.+)$", part)
        if not m:
            continue
        days = re.sub(r"(Mo|Tu|We|Th|Fr|Sa|Su)", lambda d: DAYS[d.group(1)], m.group(1)).replace("-", " au ").replace(",", ", ")
        spans = m.group(2)
        out.append(f"{days} : {'fermé' if spans == 'off' else spans.replace('-', ' – ').replace(',', ', ')}")
    return "\u00a0; ".join(out)


def tidy(s):
    return re.sub(r"\s+", " ", s or "").strip()


PLACES = json.loads((ROOT / "src/places/gazetteer.json").read_text())["places"]
COS = math.cos(math.radians(21.1))


def commune_at(lon, lat):
    """The commune of the nearest place of the gazetteer, as src/places/resolve.ts does, and how far it is (km)."""
    best = min(PLACES, key=lambda p: ((p["lon"] - lon) * COS) ** 2 + (p["lat"] - lat) ** 2)
    return best["commune"], math.hypot((best["lon"] - lon) * COS, best["lat"] - lat) * 111.2


def name(r):
    """Without the serial number some operators append (« ADECCO - St Pierre - X25L969856 »)."""
    n = re.sub(r"\s+-\s+[A-Z]{1,3}\d?-\d{5,}\s*$", "", tidy(r["c_nom"]))
    n = re.sub(r"\s+-\s+[A-Za-z0-9]*\d{5,}[A-Za-z0-9-]*\s*$", "", n)
    return n or tidy(r["c_expt_rais"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="the national file, already downloaded")
    args = ap.parse_args()
    src = open(args.csv, encoding="utf-8", newline="") if args.csv else io.TextIOWrapper(opened(csv_url()), encoding="utf-8", newline="")
    head = src.readline()
    delim = ";" if head.count(";") > head.count(",") else ","
    reader = csv.DictReader(src, fieldnames=next(csv.reader([head], delimiter=delim)), delimiter=delim)
    out = []
    for r in reader:
        try:
            lon, lat = float(r["c_long_coor1"]), float(r["c_lat_coor1"])
        except (ValueError, TypeError):
            continue
        if not (r["c_com_insee"].startswith("974") or (LON0 < lon < LON1 and LAT0 < lat < LAT1)):
            continue
        if r["c_doublon"] == "t" or r["c_dae_mobile"] == "t" or r["c_etat_fonct"] != "En fonctionnement":
            continue
        commune, km = commune_at(lon, lat)
        if km > 5:  # at sea, or a position typed wrong
            continue
        address = tidy(f"{r['c_adr_num']} {r['c_adr_voie']}")
        floor = tidy(r["c_acc_etg"])
        d = {
            "nom": name(r),
            "adresse": address,
            "commune": commune,
            "lon": round(lon, 5),
            "lat": round(lat, 5),
            "exterieur": r["c_acc"] == "Extérieur",
            "acces_libre": r["c_acc_lib"] == "t",
        }
        if tidy(r["c_acc_complt"]):
            d["emplacement"] = tidy(r["c_acc_complt"])[:160]
        if floor and floor not in ("0", "RDC"):
            d["etage"] = floor
        if hours(r["c_dispo_horaires"]):
            d["horaires"] = hours(r["c_dispo_horaires"])
        if tidy(r["c_expt_rais"]) and tidy(r["c_expt_rais"]).lower() != d["nom"].lower():
            d["exploitant"] = tidy(r["c_expt_rais"])
        out.append(d)
    out.sort(key=lambda d: (d["commune"], d["nom"]))
    target = ROOT / "src/dae/dae.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps({
        "construit": date.today().isoformat(),
        "attribution": "Géo'DAE, base nationale des défibrillateurs (ministère chargé de la santé), Licence Ouverte 2.0",
        "defibrillateurs": out,
    }, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{target.relative_to(ROOT)} : {len(out)} défibrillateurs, {target.stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
