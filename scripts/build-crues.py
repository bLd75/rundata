#!/usr/bin/env python3
"""Build src/crues/stations.json: the river gauges of Vigicrues Réunion (DEAL Réunion), bundled with the server.

For each gauge: its name, its river and catchment, the sector of the island, where it is (from the Hub'Eau reference
of hydrometric stations, by its code) and the past floods the DEAL gives as landmarks (height and flow). The live
heights and flows, and the flood vigilance, are read by the server itself (src/providers/vigicrues.ts).

Vigicrues Réunion has no documented API: these are the requests its own pages make. Its content is public
information, free to reuse under the Etalab licence, citing « © VIGICRUES » and the date (its legal notice).
Usage: python3 -I scripts/build-crues.py
"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://www.vigicrues-reunion.re/assets/php/vigicrues/"
COMMUNES = "https://geo.api.gouv.fr/departements/974/communes?fields=nom,code"
HUBEAU = "https://hubeau.eaufrance.fr/api/v2/hydrometrie/referentiel/stations?format=json&code_station="
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}


def post(name, fields):
    req = urllib.request.Request(SITE + name, data=urllib.parse.urlencode(fields).encode(), headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def main():
    listing = post("liste_stations_par_bv.php", {"validation": "true"})
    # Hub'Eau writes the communes in capitals without accents: their official names, by INSEE code.
    commune = {c["code"]: c["nom"] for c in get(COMMUNES)}
    sector_of = {bv: sector for sector in ("NORD", "EST", "SUD", "OUEST") for bv, _ in listing.get(sector, [])}
    river_of = {bv: river for sector in ("NORD", "EST", "SUD", "OUEST") for bv, river in listing.get(sector, [])}
    stations = []
    for bv, gauges in sorted((k, v) for k, v in listing.items() if k.startswith("bv")):
        for sid, name in gauges:
            info = post("donnees.php", {"id": sid})
            code = str(info["infos"]["code_hydro"])
            ref = get(HUBEAU + code)["data"]
            if not ref:
                print(f"{sid} {name}: code {code} absent de Hub'Eau, station laissée de côté")
                continue
            ref = ref[0]
            stations.append({
                "id": sid,
                "nom": name,
                "riviere": river_of.get(bv, info["noms"].get(bv, "")),
                "bassin": bv,
                "secteur": sector_of.get(bv, info.get("secteur", "")),
                "code_hydro": code,
                "commune": commune[ref["code_commune_station"]],
                "lon": round(ref["longitude_station"], 5),
                "lat": round(ref["latitude_station"], 5),
                "crues": [{"nom": c["nom"], "hauteur_m": c["h"], "debit_m3s": c["q"]} for c in info.get("crues") or []],
            })
            print(f"{sid} {name} ({stations[-1]['commune']}) : {len(stations[-1]['crues'])} crues de référence")
    out = ROOT / "src" / "crues" / "stations.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"stations": stations}, ensure_ascii=False, indent=1) + "\n")
    print(out, len(stations), "stations")


if __name__ == "__main__":
    main()
