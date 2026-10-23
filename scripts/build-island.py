#!/usr/bin/env python3
"""Build src/places/island.json: the outline of La Réunion as SVG paths, for the map on the home page.

One path per commune (simplified), drawn twice by the page: stroked underneath, filled on top, so that only the
coastline shows; a commune's own page draws its path once more, highlighted. The projection is the one of
src/web/map.ts; both must change together.

Source: geo.api.gouv.fr commune contours (Licence Ouverte 2.0).
Usage: python3 -I scripts/build-island.py [--communes communes974.geojson]
"""
import argparse
import json
import math
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMUNES = "https://geo.api.gouv.fr/departements/974/communes?format=geojson&geometry=contour&fields=nom"
LON0, LAT0, LON1, LAT1 = 55.19, -21.41, 55.86, -20.85
KX = math.cos(math.radians(21.1))  # equirectangular, scaled at the island's latitude
W = 1000
H = round(W * (LAT1 - LAT0) / ((LON1 - LON0) * KX))
TOLERANCE = 1.2  # in map units (1000 across): about 80 m, invisible at any screen size


def xy(lon, lat):
    return ((lon - LON0) / (LON1 - LON0) * W, (LAT1 - lat) / (LAT1 - LAT0) * H)


def simplify(pts, tol):
    """Douglas-Peucker on projected points."""
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    norm = math.hypot(dx, dy) or 1e-9
    i, dmax = 0, 0.0
    for k in range(1, len(pts) - 1):
        d = abs(dy * (pts[k][0] - x0) - dx * (pts[k][1] - y0)) / norm
        if d > dmax:
            i, dmax = k, d
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol)


def path(ring):
    raw = [xy(*c[:2]) for c in ring]
    # A closed ring starts and ends on the same point, which Douglas-Peucker cannot measure from: cut it in two
    # at the point farthest from the start.
    far = max(range(len(raw)), key=lambda k: math.dist(raw[0], raw[k]))
    pts = simplify(raw[:far + 1], TOLERANCE)[:-1] + simplify(raw[far:], TOLERANCE)
    if len(pts) < 4:
        return ""
    # Relative moves with integer coordinates: a third of the size of absolute decimals.
    out, px, py = [], 0, 0
    for k, (x, y) in enumerate(pts[:-1]):
        x, y = round(x), round(y)
        if k and (x, y) == (px, py):
            continue
        out.append(f"{'M' if k == 0 else 'l'}{x - px if k else x},{y - py if k else y}")
        px, py = x, y
    return "".join(out).replace(",-", "-") + "z"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--communes", type=Path, help="local copy of the GeoJSON (default: download)")
    args = ap.parse_args()
    if args.communes:
        geo = json.loads(args.communes.read_text())
    else:
        req = urllib.request.Request(COMMUNES, headers={"User-Agent": "reunion-temps-reel/0.1"})
        with urllib.request.urlopen(req, timeout=60) as r:
            geo = json.load(r)
    paths = []
    for f in geo["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        d = "".join(path(p[0]) for p in polys)
        if d:
            paths.append({"nom": f["properties"]["nom"], "d": d})
    out = ROOT / "src" / "places" / "island.json"
    out.write_text(json.dumps({
        "attribution": "Contours des communes : geo.api.gouv.fr (Licence Ouverte 2.0)",
        "bbox": [LON0, LAT0, LON1, LAT1], "w": W, "h": H, "paths": paths}, separators=(",", ":")))
    print(out, len(paths), f"{out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
