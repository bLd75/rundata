#!/usr/bin/env python3
"""Build src/historique/cyclones-traces.json: the tracks of the past cyclones that have a page /cyclones/<slug>.

Their positions as the RSMC of La Réunion gave them (its best track), from NOAA's IBTrACS (International Best Track
Archive for Climate Stewardship, v04r01, South Indian basin): only the positions the RSMC gave, never those IBTrACS
interpolates between them (IFLAG, 7th letter: « O » given, « P » interpolated). No wind, no pressure, no stage: the
map of /cyclones draws the track only (src/web/cyclones-bassin.ts). A season IBTrACS still marks as provisional says
so (`provisoire`). Usage: python3 -I scripts/build-cyclones-traces.py [--csv ibtracs.SI.list.v04r01.csv]
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
SI = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.SI.list.v04r01.csv"
REUNION = 6  # the RSMC of La Réunion's letter in IFLAG
TOLERANCE = 0.05  # degrees: about 5 km, under a pixel of the map


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="ibtracs.SI.list.v04r01.csv, already downloaded")
    args = ap.parse_args()
    # The pages of the past cyclones: « garance-2025 » is GARANCE, season 2025 (a southern season is named by its end).
    slugs = re.findall(r'slug: "([a-z]+-\d{4})"', (ROOT / "src/historique/cyclones-passes.ts").read_text())
    want = {(s.rsplit("-", 1)[0].upper(), s.rsplit("-", 1)[1]): s for s in slugs}
    if args.csv:
        text = Path(args.csv).read_text(encoding="utf-8")
    else:
        req = urllib.request.Request(SI, headers={"User-Agent": "rundata.re (open source, build)"})
        text = urllib.request.urlopen(req, timeout=300).read().decode("utf-8")
    rows = csv.reader(io.StringIO(text))
    head = next(rows)
    next(rows)  # the units
    col = {k: head.index(k) for k in ("SID", "SEASON", "NAME", "ISO_TIME", "IFLAG", "REUNION_LAT", "REUNION_LON", "TRACK_TYPE")}
    found = {}
    for r in rows:
        slug = want.get((r[col["NAME"]], r[col["SEASON"]]))
        if not slug:
            continue
        t = found.setdefault(slug, {"sid": r[col["SID"]], "points": [], "provisoire": False, "du": r[col["ISO_TIME"]][:10]})
        if t["sid"] != r[col["SID"]]:
            raise SystemExit(f"{slug} : deux systèmes dans IBTrACS ({t['sid']}, {r[col['SID']]})")
        t["au"] = r[col["ISO_TIME"]][:10]
        t["provisoire"] |= "PROVISIONAL" in r[col["TRACK_TYPE"]]
        if r[col["IFLAG"]][REUNION] == "O" and r[col["REUNION_LAT"]].strip():
            t["points"].append([float(r[col["REUNION_LON"]]), float(r[col["REUNION_LAT"]])])
    missing = set(slugs) - set(found)
    if missing:
        raise SystemExit(f"absents d'IBTrACS : {', '.join(sorted(missing))}")
    traces = {}
    for slug in slugs:
        t = found[slug]
        pts = simplify(t["points"], TOLERANCE)
        traces[slug] = {
            "ibtracs": t["sid"],
            "du": t["du"],
            "au": t["au"],
            **({"provisoire": True} if t["provisoire"] else {}),
            "points": [[round(x, 1), round(y, 1)] for x, y in pts],
        }
    target = ROOT / "src/historique/cyclones-traces.json"
    target.write_text(json.dumps({
        "source": "NOAA IBTrACS v04r01, positions du CMRS de La Réunion",
        "consulte": datetime.date.today().isoformat(),
        "traces": traces,
    }, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{target.relative_to(ROOT)} : {len(traces)} traces, {sum(len(t['points']) for t in traces.values())} positions, {target.stat().st_size} octets")


if __name__ == "__main__":
    main()
