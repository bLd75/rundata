#!/usr/bin/env python3
"""Build src/vie/loyers.json: the rents asked in the ads of each of the 24 communes, bundled with the server.

From the « Carte des loyers » of the ministry in charge of housing (DHUP), made by the ANIL from the ads of SeLoger and
leboncoin, on data.gouv.fr under the Licence Ouverte 2.0: for each commune and each kind of home (flat, flat of 1 or 2
rooms, of 3 rooms or more, house), the predicted rent per m² of an ad, charges included, its prediction interval, and
the number of ads in the commune and the model's adjusted R². They are predictions of a hedonic model for a reference
home let unfurnished, put online in the third quarter of the vintage, neither medians nor means. Below 100 ads in the
commune, the estimate is that of its mesh, neighbouring communes grouped with it (TYPPRED « maille », or « epci »).
The ANIL asks for caution below 30 ads in the commune or an R² under 0.5. These are rents asked in ads, not rents
signed; vintages cannot be compared (the meshes change). One vintage a year (published in December): run again then,
with the new dataset's id and VINTAGE.
Usage: python3 -I scripts/build-loyers.py [--dir folder with the 4 CSV]
"""
import argparse
import csv
import io
import json
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = "https://www.data.gouv.fr/api/1/datasets/693aa2feed1bf4da603faa49/"
VINTAGE = 2025
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}
# Each file of the dataset, by the end of its name.
KINDS = {"appartement": "pred-app-", "appartement_1_2_pieces": "pred-app12-", "appartement_3_pieces_et_plus": "pred-app3-", "maison": "pred-mai-"}


def number(s):
    return float(s.replace(",", "."))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", help="a folder holding the 4 CSV files (pred-app-…, pred-app12-…, pred-app3-…, pred-mai-…), else downloaded")
    args = ap.parse_args()
    meta = None if args.dir else json.load(urllib.request.urlopen(urllib.request.Request(DATASET, headers=UA), timeout=120))
    communes = {}
    for kind, prefix in KINDS.items():
        if args.dir:
            raw = next(p for p in Path(args.dir).iterdir() if p.name.startswith(prefix)).read_bytes()
        else:
            url = next(r["url"] for r in meta["resources"] if r["url"].rsplit("/", 1)[-1].startswith(prefix))
            raw = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600).read()
        # The files are in Windows-1252, with decimal commas.
        for r in csv.DictReader(io.StringIO(raw.decode("cp1252")), delimiter=";"):
            if r["DEP"] != "974":
                continue
            communes.setdefault(r["INSEE_C"], {})[kind] = {
                "loyer_m2": round(number(r["loypredm2"]), 2),
                "bas": round(number(r["lwr.IPm2"]), 2),
                "haut": round(number(r["upr.IPm2"]), 2),
                "annonces": int(r["nbobs_com"]),
                "r2": round(number(r["R2_adj"]), 2),
                # Estimated with the communes grouped with it: their ads together.
                **({"zone": r["TYPPRED"].lower(), "annonces_zone": int(r["nbobs_mail"])} if r["TYPPRED"] != "commune" else {}),
            }
    dest = ROOT / "src/vie/loyers.json"
    out = {"construit": date.today().isoformat(), "millesime": VINTAGE, "source": "Carte des loyers, ANIL pour le ministère chargé du logement, Licence Ouverte 2.0",
           "communes": dict(sorted(communes.items()))}
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=0) + "\n")
    print(dest, len(communes), "communes", {k: sum(k in c for c in communes.values()) for k in KINDS})


if __name__ == "__main__":
    main()
