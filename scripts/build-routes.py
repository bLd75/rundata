#!/usr/bin/env python3
"""Build src/web/routes.json: the main roads and the names of places, drawn over the relief of the pages' maps
(src/web/map.ts) so that one can tell where a point is.

- `ile`: the main roads for the island's map, one path: the IGN's importance 1 and 2 (the N1 with the route des
  Tamarins and the route du Littoral, the N2, N3, N4, N6, N7), and the N5 to Cilaos, which the IGN puts at 3.
- `axes` and `departementales`: for the maps close up (a commune, a trail), every road of importance 1 to 3, finer,
  one path per stretch: the main roads as above, then the main departmental roads. A map takes those in its frame.
- `noms`: the 24 communes at their chef-lieu (rank 0), then the inhabited places and quarters of importance 1 to 3
  (rank 1 to 3), at the centre of their area. The article that starts a name takes a capital (« la Saline » →
  « La Saline »), as French writes a place's name; the rest is the IGN's. No « Lotissement … »: it does not help to
  tell where one is (marketing).

Coordinates are those of the map (src/places/island.json): same bounds, same projection.
Source: IGN, BD TOPO (Licence Ouverte Etalab 2.0), from the Géoplateforme's WFS: tronçons de route and zones
d'habitation. One page a minute, about six minutes.
Usage: python3 -I scripts/build-routes.py [--cache DIR]   (DIR: where the pages are kept, read again if there)
"""
import argparse
import json
import math
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ISLAND = json.loads((ROOT / "src/places/island.json").read_text())
LON0, LAT0, LON1, LAT1 = ISLAND["bbox"]
W, H = ISLAND["w"], ISLAND["h"]
WFS = "https://data.geopf.fr/wfs/ows"
BOX = f"BBOX(geometrie,{LON0},{LAT0},{LON1},{LAT1},'EPSG:4326')"
PAGE = 5000  # the most the WFS gives at once
ISLAND_TOL = 0.6  # in map units (1000 across, about 70 m each): what the island's map shows of a road
CLOSE_TOL = 0.3  # for a commune or a trail, a few kilometres across


def xy(lon, lat):
    return ((lon - LON0) / (LON1 - LON0) * W, (LAT1 - lat) / (LAT1 - LAT0) * H)


def simplify(pts, tol):
    """Douglas-Peucker on projected points, without recursion: a road can have thousands."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        n = math.hypot(x2 - x1, y2 - y1)
        best, at = 0.0, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs((y2 - y1) * (x - x1) - (x2 - x1) * (y - y1)) / n if n else math.hypot(x - x1, y - y1)
            if d > best:
                best, at = d, i
        if at >= 0 and best > tol:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(pts, keep) if k]


def fetch(typename, extra, start, cache):
    """One page of the WFS, kept in `cache` and read from there the next time."""
    name = f"{typename.split(':')[1]}-{start}.json"
    if cache and (cache / name).exists():
        return json.loads((cache / name).read_text())
    params = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": typename,
              "OUTPUTFORMAT": "application/json", "COUNT": PAGE, "STARTINDEX": start, "SORTBY": "cleabs", **extra}
    req = urllib.request.Request(f"{WFS}?{urllib.parse.urlencode(params)}", headers={"User-Agent": "reunion-temps-reel/0.1"})
    if fetch.last:
        time.sleep(max(0, fetch.last + 61 - time.time()))
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    fetch.last = time.time()
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
        (cache / name).write_text(json.dumps(data))
    return data


fetch.last = 0.0


def every(typename, extra, cache):
    out, start = {}, 0
    while True:
        page = fetch(typename, extra, start, cache)
        for f in page["features"]:
            out[f["properties"]["cleabs"]] = f
        start += PAGE
        if start >= page["numberMatched"]:
            return list(out.values())


def chains(lines):
    """Tronçons put end to end where two and only two meet: one path per stretch of road, not one per tronçon."""
    ends = defaultdict(list)
    for i, s in enumerate(lines):
        ends[s[0]].append(i)
        ends[s[-1]].append(i)
    used = [False] * len(lines)
    out = []
    for i in range(len(lines)):
        if used[i]:
            continue
        used[i] = True
        line = list(lines[i])
        for _ in (0, 1):
            while len(ends[line[-1]]) == 2:
                nxt = [j for j in ends[line[-1]] if not used[j]]
                if not nxt:
                    break
                used[nxt[0]] = True
                s = lines[nxt[0]]
                line += (s if s[0] == line[-1] else s[::-1])[1:]
            line.reverse()
        out.append(line)
    return out


def path(line, tol, digits):
    """Relative moves, integers or tenths of the map's unit: a few bytes a point."""
    pts = simplify([xy(*p) for p in line], tol)
    k = 10 ** digits
    q = [(round(x * k), round(y * k)) for x, y in pts]
    # « -0.3 » written « -.3 », as SVG reads it.
    num = (lambda v: str(v)) if not digits else (lambda v: f"{v / k:g}".replace("0.", ".", 1) if abs(v) < k else f"{v / k:g}")
    out, (px, py) = [], q[0]
    for x, y in q[1:]:
        if (x, y) != (px, py):
            out.append(f"{num(x - px)} {num(y - py)}")
            px, py = x, y
    if not out:
        return ""
    return f"M{num(q[0][0])} {num(q[0][1])}l" + " ".join(out).replace(" -", "-")


def roads(cache):
    keep = "cleabs,geometrie,importance,cpx_numero,etat_de_l_objet"
    feats = every("BDTOPO_V3:troncon_de_route", {"CQL_FILTER": f"importance IN ('1','2','3') AND {BOX}", "PROPERTYNAME": keep}, cache)
    kinds = {0: [], 1: []}
    for f in feats:
        p = f["properties"]
        if p["etat_de_l_objet"] != "En service":
            continue
        g = f["geometry"]
        parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        main = p["importance"] in ("1", "2") or p["cpx_numero"] == "N5"
        kinds[0 if main else 1] += [[(round(c[0], 6), round(c[1], 6)) for c in part] for part in parts]
    ile = "".join(path(line, ISLAND_TOL, 0) for line in chains(kinds[0]))
    close = [[d for d in (path(line, CLOSE_TOL, 1) for line in chains(lines)) if d] for lines in kinds.values()]
    return ile, *close


def key(s):
    return re.sub(r"[^a-z]", "", unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode())


def centre(g):
    """The centre of an area (of its largest part)."""
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    best = None
    for poly in polys:
        ring = poly[0]
        a = cx = cy = 0.0
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            c = x1 * y2 - x2 * y1
            a += c
            cx += (x1 + x2) * c
            cy += (y1 + y2) * c
        if a and (best is None or abs(a) > best[0]):
            best = (abs(a), cx / (3 * a), cy / (3 * a))
    if best is None:
        ring = polys[0][0]
        return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)
    return best[1], best[2]


def capital(name):
    return name[0].upper() + name[1:] if name[:1].islower() else name


def names(cache):
    feats = every("BDTOPO_V3:zone_d_habitation", {"CQL_FILTER": BOX}, cache)
    places = [f for f in feats if f["properties"]["nature"] in ("Lieu-dit habité", "Quartier")
              and f["properties"]["toponyme"] and f["properties"]["etat_de_l_objet"] == "En service"]
    out, taken = [], set()
    for c in (p["nom"] for p in ISLAND["paths"]):
        # Its chef-lieu: the place of importance 1 named as the commune (« Commune de L'Étang-Salé » for one).
        hit = [f for f in places if f["properties"]["importance"] == "1"
               and key(f["properties"]["toponyme"]) in (key(c), key(f"Commune de {c}"))]
        if not hit:
            raise SystemExit(f"no chef-lieu for {c}")
        taken.add(hit[0]["properties"]["cleabs"])
        x, y = xy(*centre(hit[0]["geometry"]))
        out.append([c, 0, round(x, 1), round(y, 1)])
    rest = sorted((f for f in places if f["properties"]["importance"] in ("1", "2", "3") and f["properties"]["cleabs"] not in taken
                   and not f["properties"]["toponyme"].startswith("Lotissement")),
                  key=lambda f: (f["properties"]["importance"], f["properties"]["toponyme"]))
    for f in rest:
        x, y = xy(*centre(f["geometry"]))
        if 0 <= x <= W and 0 <= y <= H:
            out.append([capital(f["properties"]["toponyme"]), int(f["properties"]["importance"]), round(x, 1), round(y, 1)])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, help="where the WFS pages are kept and read again")
    args = ap.parse_args()
    ile, axes, departementales = roads(args.cache)
    noms = names(args.cache)
    out = ROOT / "src" / "web" / "routes.json"
    out.write_text(json.dumps({
        "attribution": "IGN, BD TOPO (Licence Ouverte Etalab 2.0)", "lu": date.today().isoformat(),
        "ile": ile, "axes": axes, "departementales": departementales, "noms": noms}, ensure_ascii=False, separators=(",", ":")))
    print(out, f"{len(axes) + len(departementales)} lines, {len(noms)} names, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
