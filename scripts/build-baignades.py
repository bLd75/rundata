#!/usr/bin/env python3
"""Build src/eau/baignades.json: the bathing sites of La Réunion whose water the ARS checks, with where they are.

The list and the positions come from the map of the ministry of health's bathing water site (baignades.sante.gouv.fr,
its ArcGIS service), one row per site and season: the latest season of each site is kept. The results of the samples
are read live, site by site (src/providers/baignades.ts).
Usage: python3 -I scripts/build-baignades.py
"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYER = "https://sigmas.social.gouv.fr/server/rest/services/baignades/reu_vue_baignade/MapServer/5/query?"
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}
SMALL = {"de", "des", "du", "la", "le", "les", "l", "d", "à", "a", "aux", "et"}


def nice(name):
    """« PLAGE DE L'HERMITAGE CENTRE » → « Plage de l'Hermitage centre »: the place's name keeps its capitals."""
    words = name.strip().lower().split()
    out = []
    for i, w in enumerate(words):
        parts = w.split("'")
        parts = [p if (p in SMALL and (i or j)) else p[:1].upper() + p[1:] for j, p in enumerate(parts)]
        out.append("'".join(parts))
    text = " ".join(out)
    for low in ("Centre", "Nord", "Sud", "Village", "Les Bains", "Embouchure"):
        text = text.replace(f" {low}", f" {low.lower()}") if not text.startswith(low) else text
    text = text.replace("Saint-paul", "Saint-Paul").replace("Saint-pierre", "Saint-Pierre").replace("Saint-leu", "Saint-Leu")
    return FIXES.get(text, text)


# The ministry's names lack their accents, or worse.
FIXES = {
    "Plage centre Ville de Saint-Pierre": "Plage du centre-ville de Saint-Pierre",
    "Plage centre Ville de Saint-Leu": "Plage du centre-ville de Saint-Leu",
    "Plage d'Etang Sale les Bains": "Plage de L'Étang-Salé-les-Bains",
    "Bassin d'Ilet Bethl\x90em": "Bassin de l'Îlet Bethléem",
    "Bassin Aval Riviere des Marsouins": "Bassin aval de la rivière des Marsouins",
    "Plage de la Saline les Bains": "Plage de La Saline-les-Bains",
    "Plage de Grands Bois": "Plage de Grand Bois",
}


def commune(lcom):
    """« ETANG-SALE (L') » → « L'Étang-Salé »."""
    names = {"ETANG-SALE (L')": "L'Étang-Salé", "PETITE-ILE": "Petite-Île", "SAINT-BENOIT": "Saint-Benoît",
             "SAINT-JOSEPH": "Saint-Joseph", "SAINT-LEU": "Saint-Leu", "SAINT-PAUL": "Saint-Paul",
             "SAINT-PHILIPPE": "Saint-Philippe", "SAINT-PIERRE": "Saint-Pierre"}
    return names.get(lcom, lcom.title())


def main():
    query = urllib.parse.urlencode({"where": "1=1", "outFields": "isite,lsite,lcom,annee", "outSR": 4326,
                                    "returnGeometry": "true", "f": "json"})
    with urllib.request.urlopen(urllib.request.Request(LAYER + query, headers=UA), timeout=60) as r:
        features = json.load(r)["features"]
    latest = {}
    for f in features:
        a, g = f["attributes"], f["geometry"]
        if a["isite"] not in latest or a["annee"] > latest[a["isite"]][0]["annee"]:
            latest[a["isite"]] = (a, g)
    sites = [{
        "id": "974" + a["isite"],
        "nom": nice(a["lsite"]),
        "commune": commune(a["lcom"]),
        "lon": round(g["x"], 5),
        "lat": round(g["y"], 5),
    } for a, g in sorted(latest.values(), key=lambda ag: ag[0]["isite"])]
    target = ROOT / "src/eau/baignades.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps({
        "attribution": "Ministère chargé de la santé, ARS La Réunion : contrôle sanitaire des eaux de baignade",
        "sites": sites,
    }, ensure_ascii=False, indent=1) + "\n")
    print(f"{target.relative_to(ROOT)} : {len(sites)} sites")


if __name__ == "__main__":
    main()
