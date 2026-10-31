#!/usr/bin/env python3
"""Build src/web/ocean.json: the lands of the south-west Indian Ocean, for the map of the basin on /cyclones.

The coasts of Natural Earth (1:50 million, public domain) cut to the basin watched by the RSMC of La Réunion, with a
margin, and simplified, as rings of [lon, lat]: src/web/cyclones-bassin.ts projects them. Islands too small to read at
that scale (La Réunion, Maurice, Rodrigues, the Comoros…) are drawn by the page as named dots.
Usage: python3 -I scripts/build-ocean.py [--land ne_50m_land.geojson]
"""
import argparse
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAND = "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_land.geojson"
LON0, LAT0, LON1, LAT1 = 26.0, -44.0, 94.0, 4.0
TOLERANCE = 0.08  # degrees: about 9 km, under a pixel of the map
MIN_SPAN = 0.6  # degrees: smaller islands are dots or nothing


def clip(ring):
    """The ring cut to the frame, one edge after the other (Sutherland–Hodgman)."""
    edges = [
        (lambda p: p[0] >= LON0, lambda a, b: cut_x(a, b, LON0)),
        (lambda p: p[0] <= LON1, lambda a, b: cut_x(a, b, LON1)),
        (lambda p: p[1] >= LAT0, lambda a, b: cut_y(a, b, LAT0)),
        (lambda p: p[1] <= LAT1, lambda a, b: cut_y(a, b, LAT1)),
    ]
    for inside, cut in edges:
        out = []
        for i, b in enumerate(ring):
            a = ring[i - 1]
            if inside(b):
                if not inside(a):
                    out.append(cut(a, b))
                out.append(b)
            elif inside(a):
                out.append(cut(a, b))
        ring = out
        if not ring:
            break
    return ring


def cut_x(a, b, x):
    t = (x - a[0]) / (b[0] - a[0])
    return [x, a[1] + t * (b[1] - a[1])]


def cut_y(a, b, y):
    t = (y - a[1]) / (b[1] - a[1])
    return [a[0] + t * (b[0] - a[0]), y]


def simplify(pts, tol):
    """Douglas–Peucker."""
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
    ap.add_argument("--land", help="ne_50m_land.geojson, already downloaded")
    args = ap.parse_args()
    if args.land:
        land = json.loads(Path(args.land).read_text())
    else:
        req = urllib.request.Request(LAND, headers={"User-Agent": "reunion-temps-reel (open source MCP server)"})
        land = json.load(urllib.request.urlopen(req, timeout=120))
    rings = []
    for f in land["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            ring = clip(poly[0])
            if len(ring) < 4:
                continue
            lons, lats = [p[0] for p in ring], [p[1] for p in ring]
            if max(lons) - min(lons) < MIN_SPAN and max(lats) - min(lats) < MIN_SPAN:
                continue
            # A closed ring has no chord to measure from: split it at its farthest point from the first.
            k = max(range(len(ring)), key=lambda i: (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2)
            ring = simplify(ring[: k + 1], TOLERANCE)[:-1] + simplify(ring[k:] + [ring[0]], TOLERANCE)[:-1]
            rings.append([[round(x, 2), round(y, 2)] for x, y in ring])
    target = ROOT / "src/web/ocean.json"
    target.write_text(json.dumps({
        "attribution": "Natural Earth (domaine public)",
        "bbox": [LON0, LAT0, LON1, LAT1],
        "rings": rings,
    }, separators=(",", ":")) + "\n")
    print(f"{target.relative_to(ROOT)} : {len(rings)} terres, {sum(len(r) for r in rings)} points, {target.stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
