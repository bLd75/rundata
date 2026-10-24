#!/usr/bin/env python3
"""Build src/vie/decheteries.json: the déchèteries of the Territoire de l'Ouest (TCO), bundled.

From the TCO's open data (data.tco.re, « Météo des déchèteries », Licence Ouverte): each déchèterie it reports on,
with its address, commune, position and page on tco.re. Which skips take waste today is read live from the same
dataset (src/providers/tco.ts); this list keeps the sites known when it does not answer. No opening hours are
published, only that they open seven days a week.
Usage: python3 -I scripts/build-decheteries.py
"""
import html
import json
import re
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = "https://data.tco.re/api/explore/v2.1/catalog/datasets/meteo-des-decheteries/records?limit=100&select=titre,address,commune,lat,lng,lien"
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}
# « Commune de Trois-Bassins » → the commune as the server spells it (src/places/insee.ts).
NAMES = {code: nom for nom, code in re.findall(r'"([^"]+)": "(974\d\d)"', (ROOT / "src/places/insee.ts").read_text())}


def commune(s):
    s = re.sub(r"^Commune (de |du |d')", lambda m: "Le " if m.group(1) == "du " else "", s.strip())
    flat = lambda x: re.sub(r"[^a-z]", "", x.lower().replace("é", "e").replace("è", "e"))
    return next((n for n in NAMES.values() if flat(n).endswith(flat(s))), s)


def main():
    rows = json.load(urllib.request.urlopen(urllib.request.Request(URL, headers=UA), timeout=60))["results"]
    out = [{
        "nom": html.unescape(r["titre"]).replace("’", "'"),
        # Without the « , Réunion » the map adds, nor a plus code (« V76G+2F ») standing for an address.
        "adresse": "" if re.match(r"^[0-9A-Z]{4}\+[0-9A-Z]{2}", r.get("address") or "") else re.sub(r",\s*Réunion$", "", html.unescape(r.get("address") or "")),
        "commune": commune(r["commune"]),
        "lon": round(float(r["lng"]), 5),
        "lat": round(float(r["lat"]), 5),
        "lien": r["lien"],
    } for r in rows]
    out.sort(key=lambda d: (d["commune"], d["nom"]))
    dest = ROOT / "src/vie/decheteries.json"
    dest.write_text(json.dumps({"construit": date.today().isoformat(), "source": "Territoire de l'Ouest (TCO), Licence Ouverte", "sites": out}, ensure_ascii=False, indent=0) + "\n")
    print(dest, len(out), "déchèteries:", sorted({d["commune"] for d in out}))


if __name__ == "__main__":
    main()
