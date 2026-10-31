#!/usr/bin/env python3
"""Build src/historique/plus-chaud.json: « Il fait plus chaud qu'avant ? », year by year at Saint-Denis Gillot.

From Météo-France's « Données climatologiques de base quotidiennes » (Licence Ouverte 2.0), département 974: the long
file (1950-2024) and the recent one (2025-2026). The station of Gillot (aéroport, 97418110) measures since 1953 on the
north coast. A year's temperature is the mean of its twelve monthly means of (TN + TX) / 2, a month counting with at
least 20 days measured, a year only when its twelve months count; its gap is to the mean of the years 1991-2020 that
count, as the normals (scripts/build-normales.py). Raw measures: no correction for a change of shelter or place. The
year not over yet is left out. Values Météo-France marks doubtful (quality code 2) are left out.
Usage: python3 -I scripts/build-plus-chaud.py [--dir folder-with-the-csv.gz]
"""
import argparse
import csv
import datetime
import gzip
import io
import json
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/"
FILES = ["Q_974_previous-1950-2024_RR-T-Vent.csv.gz", "Q_974_latest-2025-2026_RR-T-Vent.csv.gz"]
UA = {"User-Agent": "rundata.re (open source MCP server, real-time data for Reunion Island)"}
POSTE = "97418110"
Y0, Y1 = 1991, 2020
MIN_DAYS = 20
MIN_NORMAL_YEARS = 25


def rows(name, folder):
    if folder and (Path(folder) / name).exists():
        raw = open(Path(folder) / name, "rb")
    else:
        raw = urllib.request.urlopen(urllib.request.Request(BASE + name, headers=UA), timeout=600)
    return csv.DictReader(io.TextIOWrapper(gzip.GzipFile(fileobj=raw), encoding="utf-8", newline=""), delimiter=";")


def value(r, field):
    v = (r.get(field) or "").strip()
    if not v or (r.get("Q" + field) or "").strip() == "2":
        return None
    return float(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", help="where the two files already are")
    args = ap.parse_args()
    this_year = datetime.date.today().year
    # (year, month) → the day's mean, (TN + TX) / 2, of each day both were measured
    days = defaultdict(dict)
    for name in FILES:
        for r in rows(name, args.dir):
            if r["NUM_POSTE"] != POSTE:
                continue
            d = r["AAAAMMJJ"]
            tn, tx = value(r, "TN"), value(r, "TX")
            if tn is not None and tx is not None:
                days[(int(d[:4]), int(d[4:6]))][d] = (tn + tx) / 2
    years, left_out = {}, []
    for y in range(min(y for y, _ in days), this_year):
        ms = [days.get((y, m), {}) for m in range(1, 13)]
        if all(len(m) >= MIN_DAYS for m in ms):
            years[y] = sum(sum(m.values()) / len(m) for m in ms) / 12
        else:
            left_out.append(f"{y} ({sum(len(m) < MIN_DAYS for m in ms)} mois de moins de {MIN_DAYS} jours)")
    ref = [t for y, t in years.items() if Y0 <= y <= Y1]
    if len(ref) < MIN_NORMAL_YEARS:
        raise SystemExit(f"{len(ref)} années comptées sur {Y0}-{Y1} seulement")
    normal = sum(ref) / len(ref)
    target = ROOT / "src/historique/plus-chaud.json"
    target.write_text(json.dumps({
        "poste": POSTE,
        "station": "Saint-Denis Gillot (aéroport)",
        "normale_c": round(normal, 2),
        "periode_normale": f"{Y0}-{Y1}",
        "consulte": datetime.date.today().isoformat(),
        # [year, gap to the normal in °C]; a year missing did not count
        "annees": [[y, round(t - normal, 2)] for y, t in years.items()],
    }, ensure_ascii=False, separators=(",", ":")) + "\n")
    gaps = [[y, t - normal] for y, t in years.items()]
    mean = lambda xs: sum(g for _, g in xs) / len(xs)
    hot = max(gaps, key=lambda g: g[1])
    print(f"{target.relative_to(ROOT)} : {len(years)} années de {min(years)} à {max(years)}, normale {normal:.2f} °C sur {len(ref)} ans")
    print(f"années écartées : {', '.join(left_out) or 'aucune'} ; {this_year}, pas finie, laissée de côté")
    print(f"{gaps[0][0]}-{gaps[9][0]} : {mean(gaps[:10]):+.2f} °C ; {gaps[-10][0]}-{gaps[-1][0]} : {mean(gaps[-10:]):+.2f} °C ; la plus chaude : {hot[0]}, {hot[1]:+.2f} °C")


if __name__ == "__main__":
    main()
