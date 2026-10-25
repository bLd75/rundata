#!/usr/bin/env python3
"""Build src/vie/marches.json: the markets of La Réunion as OpenStreetMap maps them (amenity=marketplace), bundled.

OpenStreetMap's contributors map the forains and the covered markets, often with their days and hours, not all of
them: the tool says the list is not complete and sends to the town hall. Those with neither a name nor hours are left
out, as are the second-hand markets. ODbL: « © les contributeurs d'OpenStreetMap ».
Usage: python3 -I scripts/build-marches.py [--json overpass.json]
"""
import argparse
import json
import re
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}
QUERY = """[out:json][timeout:90];area["ISO3166-2"="FR-974"]->.a;(nwr["amenity"="marketplace"](area.a););out center tags;"""
DAYS = {"Mo": "lundi", "Tu": "mardi", "We": "mercredi", "Th": "jeudi", "Fr": "vendredi", "Sa": "samedi", "Su": "dimanche"}
ORDER = list(DAYS)


def hour(h):
    """« 06:00 » → « 6 h », « 12:30 » → « 12 h 30 »."""
    hh, mm = h.split(":")
    return f"{int(hh)} h" + (f" {mm}" if mm != "00" else "")


def days(spec):
    out = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            out.append(f"du {DAYS[a]} au {DAYS[b]}" if ORDER.index(b) - ORDER.index(a) > 1 else f"{DAYS[a]} et {DAYS[b]}")
        else:
            out.append(DAYS[part])
    return ", ".join(out)


def hours(text):
    """OpenStreetMap's opening_hours in words (« le samedi de 6 h à 12 h »), or "" when it says nothing usable."""
    text = (text or "").strip()
    if not text or text == "24/7":
        return ""
    out = []
    for part in [p.strip() for p in text.split(";") if p.strip()]:
        m = re.fullmatch(r"((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:[-,](?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+(\d{1,2}:\d\d)-(\d{1,2}:\d\d)(?:\s*,\s*(\d{1,2}:\d\d)-(\d{1,2}:\d\d))?", part)
        if not m:
            return ""  # a form not read here: better nothing than a wrong day
        span = f"de {hour(m.group(2))} à {hour(m.group(3))}" + (f" et de {hour(m.group(4))} à {hour(m.group(5))}" if m.group(4) else "")
        d = days(m.group(1))
        out.append(f"{'le ' if ',' not in m.group(1) and '-' not in m.group(1) else ''}{d} {span}")
    return "\u00a0; ".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="Overpass's answer to QUERY, saved; else asked")
    args = ap.parse_args()
    if args.json:
        elements = json.loads(Path(args.json).read_text())["elements"]
    else:
        req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": QUERY}).encode(), headers=UA)
        elements = json.load(urllib.request.urlopen(req, timeout=180))["elements"]
    out = []
    for e in elements:
        t = e.get("tags", {})
        if t.get("second_hand") == "yes" or re.search(r"brocante", t.get("name", ""), re.I):
            continue
        h = hours(t.get("opening_hours"))
        if not t.get("name") and not h and not t.get("note"):
            continue
        lat, lon = (e["lat"], e["lon"]) if e["type"] == "node" else (e["center"]["lat"], e["center"]["lon"])
        street = " ".join(x for x in [t.get("addr:housenumber"), t.get("addr:street")] if x)
        out.append({
            "nom": t.get("name") or "Marché",
            "horaires": h or None,
            "horaires_osm": t.get("opening_hours") if h else None,
            "note": t.get("note"),
            "adresse": street or None,
            "lon": round(lon, 5),
            "lat": round(lat, 5),
            "osm": f"https://www.openstreetmap.org/{e['type']}/{e['id']}",
        })
    out.sort(key=lambda m: (m["lat"], m["lon"]))
    dest = ROOT / "src/vie/marches.json"
    dest.write_text(json.dumps({"construit": date.today().isoformat(), "source": "© les contributeurs d'OpenStreetMap, ODbL", "marches": out}, ensure_ascii=False, indent=0) + "\n")
    print(dest, len(out), "marchés,", sum(1 for m in out if m["horaires"]), "avec leurs horaires")


if __name__ == "__main__":
    main()
