#!/usr/bin/env python3
"""Build src/irve/stations.json: the public charging stations for electric cars on La Réunion, bundled with the server.

From the national base of charging points (IRVE, static data) as consolidated each day by transport.data.gouv.fr:
the points on the island, grouped by station, with where it is, who set it up, its hours and each point's power and
plugs. Whether each point is free, taken or out of order now comes from the live file of the same national access
point (src/providers/irve.ts), joined on the point's id (`id_pdc_itinerance`).

The file is large (about 130 Mo, all of France); only the rows of La Réunion are kept. A station's commune is its
official name from geo.api.gouv.fr, by its position: the addresses often lack the INSEE code.
Licence Ouverte 2.0. Usage: python3 -I scripts/build-irve.py [--csv consolidation.csv]
"""
import argparse
import csv
import io
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = "https://transport.data.gouv.fr/resources/84013/download"
COMMUNE_AT = "https://geo.api.gouv.fr/communes?fields=nom&format=json&"
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}
LON0, LAT0, LON1, LAT1 = 55.1, -21.5, 55.9, -20.8

PLUGS = [("prise_type_2", "Type 2"), ("prise_type_combo_ccs", "Combo CCS"), ("prise_type_chademo", "CHAdeMO"),
         ("prise_type_ef", "prise domestique"), ("prise_type_autre", "autre prise")]
DAYS = {"Mo": 0, "Tu": 1, "We": 2, "Th": 3, "Fr": 4, "Sa": 5, "Su": 6}
DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
# The brand a driver knows, from the operator's (the app or card that starts the charge).
NETWORKS = [("Freshmile", "Freshmile"), ("Road", "EZDrive"), ("EZDRIVE", "EZDrive"), ("Ezdrive", "EZDrive"),
            ("E.Leclerc", "E.Leclerc"), ("WattzHub", "WattzHub")]


def opened(r):
    return urllib.request.urlopen(urllib.request.Request(r, headers=UA), timeout=300)


def hhmm(t):
    h, m = t.split(":")
    return f"{int(h)} h" + (f" {m}" if m != "00" else "")


def hours(text):
    """« 24/7 », « Mo,Tu… 08:00-18:00 » (the schema's OpenStreetMap-like syntax) in words."""
    text = text.strip()
    if text in ("", "24/7"):
        return "24 h/24, 7 j/7" if text else ""
    groups = re.findall(r"((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(\d\d:\d\d)-(\d\d:\d\d)", text)
    if not groups:
        return text
    by_time = {}
    for days, a, b in groups:
        for d in days.split(","):
            by_time.setdefault(f"{hhmm(a)} – {hhmm(b)}", set()).add(DAYS[d])
    parts = []
    for span, days in sorted(by_time.items(), key=lambda kv: min(kv[1])):
        days = sorted(days)
        if len(days) == 7:
            label = "tous les jours"
        elif days == list(range(days[0], days[-1] + 1)) and len(days) > 2:
            label = f"du {DAY_NAMES[days[0]]} au {DAY_NAMES[days[-1]]}"
        else:
            label = ", ".join(DAY_NAMES[d] for d in days)
        parts.append(f"{label} {span}")
    return " ; ".join(parts)


def address(text):
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r",?\s*France$", "", text)
    return re.sub(r"\s*974\d\d\b", "", text).strip(" ,")


def network(r):
    for key, name in NETWORKS:
        if key in r["nom_operateur"] or key in r["nom_enseigne"]:
            return name
    return r["nom_enseigne"].strip() or r["nom_operateur"].strip()


def place_name(r):
    """Who set the station up, when it names the place (« Decathlon Saint-Denis », « E.Leclerc, Le Tampon »)."""
    name = re.sub(r"\s+", " ", r["nom_amenageur"]).strip()
    return "" if name.upper() in ("", "MISSING") else name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="the consolidated file, already downloaded")
    args = ap.parse_args()
    src = open(args.csv, encoding="utf-8") if args.csv else io.TextIOWrapper(opened(STATIC), encoding="utf-8")
    rows = []
    for r in csv.DictReader(src):
        try:
            lon, lat = float(r["consolidated_longitude"]), float(r["consolidated_latitude"])
        except ValueError:
            continue
        if r["code_insee_commune"].startswith("974") or (LON0 < lon < LON1 and LAT0 < lat < LAT1):
            rows.append((r, lon, lat))
    stations = {}
    for r, lon, lat in rows:
        sid = r["id_station_itinerance"]
        s = stations.setdefault(sid, {
            "id": sid,
            "nom": place_name(r),
            "reseau": network(r),
            "adresse": address(r["adresse_station"]),
            "lon": round(lon, 5),
            "lat": round(lat, 5),
            "implantation": r["implantation_station"],
            "horaires": hours(r["horaires"]),
            **({"tarif": r["tarification"].strip()} if r["tarification"].strip() else {}),
            **({"gratuit": True} if r["gratuit"] == "true" else {}),
            **({"acces_reserve": True} if r["condition_acces"] == "Accès réservé" else {}),
            "points": [],
        })
        if any(p["id"] == r["id_pdc_itinerance"] for p in s["points"]):
            continue
        kw = float(r["puissance_nominale"] or 0)
        s["points"].append({
            "id": r["id_pdc_itinerance"],
            "kw": round(kw, 1) if kw % 1 else int(kw),
            "prises": [name for col, name in PLUGS if r[col] == "true"],
        })
    out = sorted(stations.values(), key=lambda s: s["id"])
    for s in out:
        s["points"].sort(key=lambda p: p["id"])
        found = json.load(opened(COMMUNE_AT + urllib.parse.urlencode({"lon": s["lon"], "lat": s["lat"]})))
        s["commune"] = found[0]["nom"] if found else ""
    target = ROOT / "src/irve/stations.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps({
        "attribution": "Base nationale des IRVE, consolidée par transport.data.gouv.fr (Licence Ouverte 2.0)",
        "stations": out,
    }, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{target.relative_to(ROOT)} : {len(out)} stations, {sum(len(s['points']) for s in out)} points de charge")


if __name__ == "__main__":
    main()
