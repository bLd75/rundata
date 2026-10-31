#!/usr/bin/env python3
"""Build src/historique/cyclones-traces.json: the tracks of the past cyclones that have a page /cyclones/<slug>.

Their positions as the RSMC of La Réunion gave them, from its best track, reanalysed after each season: Météo-France's
« Historique des cyclones tropicaux du Sud-Ouest de l'Océan Indien » on data.gouv.fr (Licence Ouverte 2.0), one row
every 6 hours (UTC) from the season 1986-1987. A cyclone before it (Hyacinthe, 1980) is taken from NOAA's IBTrACS
(International Best Track Archive for Climate Stewardship, v04r01, South Indian basin), still the RSMC's positions
only, never those IBTrACS interpolates between them (IFLAG, 7th letter: « O » given, « P » interpolated); each track
says its source. No wind, no pressure, no stage: the map of /cyclones draws the track only (src/web/cyclones-bassin.ts).
Usage: python3 -I scripts/build-cyclones-traces.py [--mf cyclones-sud-ouest-ocean-indien.csv] [--ibtracs ibtracs.SI.list.v04r01.csv]
"""
import argparse
import csv
import datetime
import io
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The CSV resource of the dataset, at its lasting address (the file's own changes with each yearly update).
MF = "https://www.data.gouv.fr/datasets/r/1e1700b0-951e-4fc0-ab0b-28ece02695fb"
MF_PAGE = "https://www.data.gouv.fr/datasets/historique-des-cyclones-tropicaux-du-sud-ouest-de-locean-indien"
SI = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.SI.list.v04r01.csv"
IBTRACS_PAGE = "https://www.ncei.noaa.gov/products/international-best-track-archive"
# The first season of Météo-France's file: 1986-1987, named by its end as the pages are.
MF_FIRST = 1987
REUNION = 6  # the RSMC of La Réunion's letter in IFLAG
TOLERANCE = 0.05  # degrees: about 5 km, under a pixel of the map
UA = {"User-Agent": "rundata.re (open source, build)"}


def simplify(pts, tol):
    """Douglas–Peucker, the first and last positions kept."""
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
    far, best = 0, -1.0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x1 * y0 - y1 * x0) / norm
        if d > best:
            far, best = i, d
    if best <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[: far + 1], tol)[:-1] + simplify(pts[far:], tol)


def read(path, url):
    if path:
        return Path(path).read_text(encoding="utf-8-sig")
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read().decode("utf-8-sig")


def from_mf(want, text):
    """Météo-France's best track: « 09SWI2024 » is the 9th system of the season 2024-2025, so « garance-2025 »."""
    found = {}
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        slug = want.get((r["nom_cyc"], str(int(r["idswi"][-4:]) + 1)))
        if not slug:
            continue
        t = found.setdefault(slug, {"source": "meteo-france", "idswi": r["idswi"], "du": r["dat"][:10], "points": []})
        if t["idswi"] != r["idswi"]:
            raise SystemExit(f"{slug} : deux systèmes chez Météo-France ({t['idswi']}, {r['idswi']})")
        t["au"] = r["dat"][:10]
        # A row is there every 6 hours even without an observation; its position is then empty.
        if r["lat"].strip() and r["lon"].strip():
            t["points"].append([float(r["lon"]), float(r["lat"])])
    return found


def from_ibtracs(want, text):
    rows = csv.reader(io.StringIO(text))
    head = next(rows)
    next(rows)  # the units
    col = {k: head.index(k) for k in ("SID", "SEASON", "NAME", "ISO_TIME", "IFLAG", "REUNION_LAT", "REUNION_LON")}
    found = {}
    for r in rows:
        slug = want.get((r[col["NAME"]], r[col["SEASON"]]))
        if not slug:
            continue
        t = found.setdefault(slug, {"source": "ibtracs", "ibtracs": r[col["SID"]], "du": r[col["ISO_TIME"]][:10], "points": []})
        if t["ibtracs"] != r[col["SID"]]:
            raise SystemExit(f"{slug} : deux systèmes dans IBTrACS ({t['ibtracs']}, {r[col['SID']]})")
        t["au"] = r[col["ISO_TIME"]][:10]
        if r[col["IFLAG"]][REUNION] == "O" and r[col["REUNION_LAT"]].strip():
            t["points"].append([float(r[col["REUNION_LON"]]), float(r[col["REUNION_LAT"]])])
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mf", help="Météo-France's CSV, already downloaded")
    ap.add_argument("--ibtracs", help="ibtracs.SI.list.v04r01.csv, already downloaded")
    args = ap.parse_args()
    # The pages of the past cyclones: « garance-2025 » is GARANCE, season 2025 (a southern season is named by its end).
    slugs = re.findall(r'slug: "([a-z]+-\d{4})"', (ROOT / "src/historique/cyclones-passes.ts").read_text())
    key = lambda s: (s.rsplit("-", 1)[0].upper(), s.rsplit("-", 1)[1])
    recent = {key(s): s for s in slugs if int(s[-4:]) >= MF_FIRST}
    older = {key(s): s for s in slugs if int(s[-4:]) < MF_FIRST}
    found = from_mf(recent, read(args.mf, MF))
    if older:
        found |= from_ibtracs(older, read(args.ibtracs, SI))
    missing = set(slugs) - set(found)
    if missing:
        raise SystemExit(f"absents : {', '.join(sorted(missing))}")
    traces = {}
    for slug in slugs:
        t = found[slug]
        traces[slug] = {**{k: v for k, v in t.items() if k != "points"}, "points": [[round(x, 1), round(y, 1)] for x, y in simplify(t["points"], TOLERANCE)]}
    target = ROOT / "src/historique/cyclones-traces.json"
    target.write_text(json.dumps({
        "consulte": datetime.date.today().isoformat(),
        "sources": {
            "meteo-france": {"nom": "Météo-France (CMRS de La Réunion)", "licence": "Licence Ouverte 2.0", "lien": MF_PAGE, "depuis": MF_FIRST - 1},
            "ibtracs": {"nom": "NOAA IBTrACS", "lien": IBTRACS_PAGE},
        },
        "traces": traces,
    }, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{target.relative_to(ROOT)} : {len(traces)} traces, {sum(len(t['points']) for t in traces.values())} positions, {target.stat().st_size} octets")
    for slug, t in traces.items():
        print(f"  {slug} : {t['source']} {t.get('idswi') or t.get('ibtracs')}, du {t['du']} au {t['au']}, {len(found[slug]['points'])} positions, {len(t['points'])} gardées")


if __name__ == "__main__":
    main()
