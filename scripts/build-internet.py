#!/usr/bin/env python3
"""Build src/vie/internet.json: how the premises of each of the 24 communes can be connected to the internet, bundled.

From « Ma connexion internet » of the ARCEP (data.arcep.fr, statistics by commune, Licence Ouverte 2.0): for each
commune, its premises (homes and business premises) counted by the best technology they are eligible to, the fibre
first, as the operators declare them to the ARCEP at the end of a quarter. Eligible is not connected: a premise
eligible to the fibre may not have it. One release a quarter: run again then.
Usage: python3 -I scripts/build-internet.py [--csv commune_meilleure_techno_thd.csv]
"""
import argparse
import csv
import io
import json
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = "https://data.arcep.fr/fixe/maconnexioninternet/statistiques/last/commune/commune_meilleure_techno_thd.csv"
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}
# The file's columns, best technology first, as the server names them.
TECHNOS = {"elig_ftth": "fibre", "elig_coax": "cable", "elig_cu_30": "cuivre_30", "elig_thdr": "thd_radio", "elig_cu_8": "cuivre_8", "elig_4gf": "4g_fixe",
           "elig_hdr": "hd_radio", "elig_sat": "satellite"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="the file commune_meilleure_techno_thd.csv, else downloaded")
    args = ap.parse_args()
    text = Path(args.csv).read_text(encoding="utf-8") if args.csv else urllib.request.urlopen(urllib.request.Request(URL, headers=UA), timeout=300).read().decode("utf-8")
    communes, day = {}, None
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        if r["code_dep"] != "974" or r["type"] != "all":
            continue
        day = r["date"]
        communes[r["code_insee"]] = {"locaux": int(r["nbr"]), **{name: int(r[col]) for col, name in TECHNOS.items() if int(r[col])}}
    dest = ROOT / "src/vie/internet.json"
    # « au »: the end of the quarter the operators declared (2026-06-30 for the second quarter of 2026).
    out = {"construit": date.today().isoformat(), "au": day, "source": "Ma connexion internet, ARCEP, Licence Ouverte 2.0", "communes": dict(sorted(communes.items()))}
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=0) + "\n")
    print(dest, len(communes), "communes au", day)


if __name__ == "__main__":
    main()
