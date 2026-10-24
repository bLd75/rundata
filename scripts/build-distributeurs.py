#!/usr/bin/env python3
"""Build src/eau/distributeurs.json: the water distributor of each commune of La Réunion, as the ARS names it in its
sanitary control of tap water (Hub'Eau, « qualité de l'eau potable », field nom_distributeur): the one of most of the
commune's samples over the last six months. Open data, Licence Ouverte 2.0.
Usage: python3 -I scripts/build-distributeurs.py
"""
import json
import time
import urllib.request
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "eau" / "distributeurs.json"
UA = {"User-Agent": "rundata.re (contact@rundata.re)"}
API = "https://hubeau.eaufrance.fr/api/v1/qualite_eau_potable/resultats_dis"
INSEE = {
    "Les Avirons": "97401", "Bras-Panon": "97402", "Entre-Deux": "97403", "L'Étang-Salé": "97404", "Petite-Île": "97405",
    "La Plaine-des-Palmistes": "97406", "Le Port": "97407", "La Possession": "97408", "Saint-André": "97409",
    "Saint-Benoît": "97410", "Saint-Denis": "97411", "Saint-Joseph": "97412", "Saint-Leu": "97413", "Saint-Louis": "97414",
    "Saint-Paul": "97415", "Saint-Pierre": "97416", "Saint-Philippe": "97417", "Sainte-Marie": "97418", "Sainte-Rose": "97419",
    "Sainte-Suzanne": "97420", "Salazie": "97421", "Le Tampon": "97422", "Les Trois-Bassins": "97423", "Cilaos": "97424",
}


def main():
    since = (date.today() - timedelta(days=182)).isoformat()
    communes = {}
    for nom, code in INSEE.items():
        url = f"{API}?code_commune={code}&date_min_prelevement={since}&size=500&fields=nom_distributeur"
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                    rows = json.load(r)["data"]
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(5 * (attempt + 1))
        count = Counter(x["nom_distributeur"] for x in rows if x.get("nom_distributeur"))
        communes[nom] = count.most_common(1)[0][0] if count else None
        print(f"  {nom}: {communes[nom]} ({sum(count.values())} résultats)")
        time.sleep(0.5)
    OUT.write_text(json.dumps({
        "construit": date.today().isoformat(),
        "source": "ARS La Réunion, contrôle sanitaire des eaux distribuées (Hub'Eau), Licence Ouverte 2.0",
        "communes": communes,
    }, ensure_ascii=False, indent=1) + "\n")
    print(f"{OUT.relative_to(ROOT)} : {sum(1 for v in communes.values() if v)} communes")


if __name__ == "__main__":
    main()
