#!/usr/bin/env python3
"""Build src/vie/collecte.json: the days the bins are collected, street by street, in the Territoire de l'Ouest (TCO).

From the TCO's open data (data.tco.re, « Calendriers de collectes du Territoire de l'Ouest », Licence Ouverte): each
street of Le Port, La Possession, Saint-Paul, Trois-Bassins and Saint-Leu with the code of its calendar, and each
calendar's PDF. The days are only in the PDF: a grid of the year, a row per day, whose text layer holds a code per
collection (OM ordures ménagères, CS collecte sélective, DV déchets végétaux, EN encombrants, F jour férié, NT none).
Read with `pdftotext -bbox` (poppler-utils). Each page shows six months, its six leftmost columns of days; the
template hides four more under the right-hand panel, which are left out. Every month read is checked against the
calendar (each row's weekday letter), and the script fails rather than write a calendar it could not read.

Run by .github/workflows/collecte.yml when the dataset's modification date changes.
Usage: python3 -I scripts/build-collecte.py [--pdf-dir DIR]   (DIR: PDFs already downloaded, named as on tco.re)
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = "calendriers-de-collectes-du-territoire-de-louest-gru"
API = f"https://data.tco.re/api/explore/v2.1/catalog/datasets/{DATASET}"
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}
OUT = ROOT / "src/vie/collecte.json"
CODES = {"OM", "CS", "DV", "EN", "F"}
# A code whose text the PDF cuts short, its square drawn in full: « E » for EN, in the column of the encombrants
# (2026_PORT_04 and 2026_SP2b_12, 10 June, seen on the drawing).
SHORT = {"E": "EN"}
WEEKDAYS = "LMMJVSD"
# The communes as the server spells them (src/places/insee.ts).
COMMUNES = {"LE PORT": "Le Port", "LA POSSESSION": "La Possession", "SAINT-PAUL": "Saint-Paul", "TROIS BASSINS": "Les Trois-Bassins", "TROIS-BASSINS": "Les Trois-Bassins", "SAINT-LEU": "Saint-Leu"}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()


def words(pdf):
    """Each page's words with their box: [(page, x, y, text)]."""
    xml = subprocess.run(["pdftotext", "-bbox", str(pdf), "-"], check=True, capture_output=True, text=True).stdout
    out = []
    for page, body in enumerate(re.split(r"<page ", xml)[1:]):
        for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">([^<]*)</word>', body):
            out.append((page, float(m.group(1)), float(m.group(2)), m.group(3)))
    return out


def calendar(pdf, year):
    """{code: [day of the year, …]} of one calendar, every month checked against the weekdays."""
    ws = words(pdf)
    days = {}
    for page in (0, 1):
        on = [w for w in ws if w[0] == page]
        # The columns of months: where a « 01 » starts a column, the six leftmost.
        firsts = sorted({round(x) for _, x, _, t in on if t == "01"})
        if len(firsts) < 6:
            raise ValueError(f"{pdf.name} : {len(firsts)} colonnes de mois en page {page + 1}")
        ends = firsts[1:] + [firsts[-1] + firsts[1] - firsts[0]]
        for i, x0 in enumerate(firsts[:6]):
            month = page * 6 + i + 1
            inside = [w for w in on if x0 - 3 <= w[1] < ends[i] - 3]
            rows = {int(t): y for _, x, y, t in inside if re.fullmatch(r"\d\d", t) and abs(x - x0) < 3}
            n = (date(year + (month == 12), month % 12 + 1, 1) - date(year, month, 1)).days
            if sorted(rows) != list(range(1, n + 1)):
                raise ValueError(f"{pdf.name} : mois {month}, jours lus {sorted(rows)}")
            for d, y in rows.items():
                line = sorted((x, t) for _, x, wy, t in inside if abs(wy - y) < 3 and x > x0 + 3)
                letter = line[0][1] if line else ""
                when = date(year, month, d)
                if letter != WEEKDAYS[when.weekday()]:
                    raise ValueError(f"{pdf.name} : {when} lu « {letter} »")
                for _, t in line[1:]:
                    t = SHORT.get(t, t)
                    if t in CODES:
                        days.setdefault(t, set()).add(when.timetuple().tm_yday)
                    elif t != "NT":
                        raise ValueError(f"{pdf.name} : {when}, code inconnu « {t} »")
    return {k: sorted(v) for k, v in sorted(days.items())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", type=Path)
    args = ap.parse_args()
    meta = json.loads(get(API))
    modified = (meta.get("metas", {}).get("default", meta)).get("modified", "")[:10]
    rows = json.loads(get(f"{API}/exports/json?select=nomvoielong,libcommune,codcalend,fichier_pdf"))
    # « NC_PORT », « NC_SP3 »…: streets the TCO gives no calendar for (their PDF does not exist), kept without days.
    none = lambda code: code.startswith("NC")
    years = {int(r["codcalend"][:4]) for r in rows if not none(r["codcalend"])}
    if len(years) != 1:
        raise ValueError(f"plusieurs années de calendriers : {years}")
    year = years.pop()
    pdfs = {r["codcalend"]: r["fichier_pdf"] for r in rows if not none(r["codcalend"])}
    calendars = {}
    with tempfile.TemporaryDirectory() as tmp:
        for code, url in sorted(pdfs.items()):
            local = args.pdf_dir / Path(url).name if args.pdf_dir else None
            if not (local and local.exists()):
                local = Path(tmp) / Path(url).name
                local.write_bytes(get(url))
                time.sleep(1)
            calendars[code] = calendar(local, year)
    codes = sorted(calendars)
    streets = sorted({(re.sub(r"\s+", " ", r["nomvoielong"]).strip(), COMMUNES[r["libcommune"].strip().upper()], -1 if none(r["codcalend"]) else codes.index(r["codcalend"])) for r in rows})
    out = {
        "source": f"https://data.tco.re/explore/dataset/{DATASET}/",
        "licence": "Licence Ouverte (Etalab)",
        "mis_a_jour": modified,
        "annee": year,
        "calendriers": [{"code": c, "pdf": pdfs[c], **calendars[c]} for c in codes],
        "voies": [list(s) for s in streets],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{OUT.relative_to(ROOT)} : {len(codes)} calendriers, {len(streets)} voies, jeu du {modified}", file=sys.stderr)


if __name__ == "__main__":
    main()
