#!/usr/bin/env python3
"""Build src/historique/cyclones-passes.json: what Météo-France's stations measured while a past cyclone went by.

From the same files as build-climat.py (« Données climatologiques de base quotidiennes », département 974, Licence
Ouverte 2.0, the RR-T-Vent part): for each cyclone of CYCLONES and each day of its window, every station's rain (RR,
mm, from 06 UTC that day to 06 UTC the next, i.e. 10 h to 10 h in Réunion) and strongest gust (FXI, m/s, as the file
gives it). Values Météo-France marks doubtful (quality code 2) are left out. A station's value is marked as its record
when it is the highest of the station's whole series (the same record as the historique_meteo tool's), with the year
the station's series starts.

The windows are the days the sources of src/historique/cyclones-passes.ts name, and the day before (its rain runs to 10 h
of the first day); for Hyacinthe and Firinga, the days of the episode on Météo-France's « Pluies extrêmes » page.

Usage: python3 -I scripts/build-cyclones-passes.py --dir <folder of the .csv.gz> --out src/historique/cyclones-passes.json
"""

import argparse
import csv
import gzip
import io
import json
import re
from pathlib import Path

CYCLONES = {
    "hyacinthe-1980": [f"1980-01-{d}" for d in range(16, 28)],
    "firinga-1989": ["1989-01-28", "1989-01-29", "1989-01-30"],
    "dina-2002": ["2002-01-21", "2002-01-22", "2002-01-23"],
    "batsirai-2022": ["2022-02-01", "2022-02-02", "2022-02-03", "2022-02-04"],
    "belal-2024": ["2024-01-13", "2024-01-14", "2024-01-15"],
    "garance-2025": ["2025-02-27", "2025-02-28"],
}
FIELDS = ("RR", "FXI")


def rows(path):
    return csv.DictReader(io.TextIOWrapper(gzip.open(path), encoding="utf-8", newline=""), delimiter=";")


def number(v):
    return int(v) if v == int(v) else v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="folder of the RR-T-Vent .csv.gz of département 974")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    days = {d.replace("-", ""): (cid, d) for cid, ds in CYCLONES.items() for d in ds}
    # station → field → (best value, its day), first year; station → (name, altitude); cyclone → station → field → day → value
    best, first, meta, seen = {}, {}, {}, {}
    paths = sorted(Path(args.dir).glob("Q_974_*_RR-T-Vent.csv.gz"))
    if not paths:
        raise SystemExit(f"aucun fichier Q_974_*_RR-T-Vent.csv.gz dans {args.dir}")
    for path in paths:
        for r in rows(path):
            st, d = r["NUM_POSTE"], r["AAAAMMJJ"]
            for f in FIELDS:
                v = (r.get(f) or "").strip()
                if not v or (r.get("Q" + f) or "").strip() == "2":
                    continue
                v = float(v)
                key = (st, f)
                first[key] = min(first.get(key, d), d)
                # Strictly higher: a tie leaves the record to its first day.
                if key not in best or v > best[key][0] or (v == best[key][0] and d < best[key][1]):
                    best[key] = (v, d)
                if d in days:
                    cid, day = days[d]
                    seen.setdefault(cid, {}).setdefault(st, {}).setdefault(f, {})[day] = v
                    if st not in meta or d >= meta[st][2]:
                        meta[st] = (re.sub(r"_SAPC$", "", r["NOM_USUEL"]).strip(), int(float(r["ALTI"] or 0)), d)
    out = {}
    for cid, ds in CYCLONES.items():
        stations = []
        for st, fields in seen.get(cid, {}).items():
            s = {"poste": st, "nom": meta[st][0], "alt": meta[st][1]}
            for f in FIELDS:
                if f not in fields:
                    continue
                k = f.lower()
                s[k] = [number(fields[f][d]) if d in fields[f] else None for d in ds]
                v, day = best[(st, f)]
                if day in {d.replace("-", "") for d in ds}:
                    s[f"record_{k}"] = {"jour": f"{day[:4]}-{day[4:6]}-{day[6:]}", "depuis": int(first[(st, f)][:4])}
            if "rr" in s or "fxi" in s:
                stations.append(s)
        # Most rain first; the stations with only a gust after.
        stations.sort(key=lambda s: (-sum(x or 0 for x in s.get("rr", [])), s["nom"]))
        out[cid] = {"jours": ds, "stations": stations}
    Path(args.out).write_text(json.dumps({"cyclones": out}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for cid, c in out.items():
        print(f"{cid} : {len(c['stations'])} stations, {sum(1 for s in c['stations'] if 'fxi' in s)} avec rafale, "
              f"{sum(1 for s in c['stations'] for k in ('record_rr', 'record_fxi') if k in s)} records")


if __name__ == "__main__":
    main()
