#!/usr/bin/env python3
"""Build src/traces/traces.json: the GPS traces of the hikes of La Réunion, bundled with the server.

- The hiking routes of OpenStreetMap (relations route=hiking in FR-974, read once through Overpass): their ways put
  end to end, simplified to about 5 m, with the altitude of each point from the IGN (Géoplateforme altimetry service,
  RGE ALTI, no key), their length, climb and descent, and the ONF trails they follow, whose state the server reads live.
  OpenStreetMap data, ODbL: « © les contributeurs d'OpenStreetMap ».
- The trails of the ONF (the layer of src/providers/sentiers.ts), at full resolution once: their length, climb, descent
  and lowest and highest points. Their lines are not kept: the server reads each from the ONF when asked, with its state.
Usage: python3 -I scripts/build-traces.py
"""
import json
import math
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "traces" / "traces.json"
UA = {"User-Agent": "rundata.re (contact@rundata.re)"}
ONF = "https://services1.arcgis.com/Y4HgaQpzkE7kenlE/arcgis/rest/services/Sentiers_La_Reunion_public/FeatureServer/5/query"
OVERPASS = "https://overpass-api.de/api/interpreter"
ALTI = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
ALTI_MAX = 5000
# A climb or descent counts once it exceeds this: the ground model's noise is not a climb.
STEP_M = 10
SIMPLIFY_M = 5
# An ONF trail is on a route when most of its points are this close to the route.
ON_ROUTE_M = 30
ON_ROUTE_SHARE = 0.6


def fetch(url, data=None, headers=None, timeout=300):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def slug(name):
    s = unicodedata.normalize("NFD", name.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def dist_m(a, b):
    lat = math.radians((a[1] + b[1]) / 2)
    dx = math.radians(b[0] - a[0]) * math.cos(lat) * 6371000
    dy = math.radians(b[1] - a[1]) * 6371000
    return math.hypot(dx, dy)


def length_km(segments):
    return sum(dist_m(p, q) for seg in segments for p, q in zip(seg, seg[1:])) / 1000


def climb(segments_z):
    """Climb and descent in m, counted from one turning point to the next once past STEP_M."""
    up = down = 0.0
    for z in segments_z:
        z = [v for v in z if v is not None and v > -1000]
        if not z:
            continue
        ref = z[0]
        for v in z:
            if v - ref >= STEP_M:
                up += v - ref
                ref = v
            elif ref - v >= STEP_M:
                down += ref - v
                ref = v
    return round(up), round(down)


def elevations(points):
    """The altitude of each (lon, lat), from the IGN, 5 000 points per request."""
    out = []
    for i in range(0, len(points), ALTI_MAX):
        chunk = points[i:i + ALTI_MAX]
        body = json.dumps({
            "lon": "|".join(f"{p[0]:.6f}" for p in chunk),
            "lat": "|".join(f"{p[1]:.6f}" for p in chunk),
            "resource": "ign_rge_alti_wld",
            "zonly": "true",
        }).encode()
        out += fetch(ALTI, body, {"Content-Type": "application/json"})["elevations"]
        time.sleep(0.5)
    return [round(z) if z is not None and z > -1000 else None for z in out]


def simplify(points, tol_m):
    """Douglas-Peucker in metres, on a local flat projection."""
    if len(points) < 3:
        return points
    lat0 = math.radians(points[0][1])
    xy = [(math.radians(p[0]) * math.cos(lat0) * 6371000, math.radians(p[1]) * 6371000) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = xy[a], xy[b]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1e-9
        best, at = 0, None
        for i in range(a + 1, b):
            x, y = xy[i]
            d = abs(dy * (x - x1) - dx * (y - y1)) / norm if math.hypot(dx, dy) > 1e-9 else math.hypot(x - x1, y - y1)
            if d > best:
                best, at = d, i
        if at is not None and best > tol_m:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(points, keep) if k]


def encode(points):
    """Google's polyline encoding, 5 decimals, latitude first."""
    out, plat, plon = [], 0, 0
    for lon, lat in points:
        ilat, ilon = round(lat * 1e5), round(lon * 1e5)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return "".join(out)


def chain(ways):
    """The ways of a relation end to end, in as few pieces as they allow (members are not always in order)."""
    left = [list(w) for w in ways if len(w) > 1]
    pieces = []
    same = lambda p, q: abs(p[0] - q[0]) < 1e-6 and abs(p[1] - q[1]) < 1e-6
    while left:
        cur = left.pop(0)
        grown = True
        while grown:
            grown = False
            for i, w in enumerate(left):
                if same(cur[-1], w[0]):
                    cur += w[1:]
                elif same(cur[-1], w[-1]):
                    cur += w[::-1][1:]
                elif same(cur[0], w[-1]):
                    cur = w[:-1] + cur
                elif same(cur[0], w[0]):
                    cur = w[::-1][:-1] + cur
                else:
                    continue
                left.pop(i)
                grown = True
                break
        pieces.append(cur)
    return sorted(pieces, key=lambda p: -len(p))


def clean_name(n):
    return re.sub(r"\s*\(hors gestion ONF\)\s*$", "", re.sub(r"\s+", " ", n).strip(), flags=re.I)


def onf_trails():
    q = urllib.parse.urlencode({
        "where": "1=1", "outFields": "WS_NomIti", "returnGeometry": "true", "outSR": "4326", "geometryPrecision": "6", "f": "json",
    })
    feats = fetch(f"{ONF}?{q}")["features"]
    by = {}
    for f in feats:
        raw = (f["attributes"].get("WS_NomIti") or "").strip()
        if not raw:
            continue
        t = by.setdefault(clean_name(raw), {"onf": set(), "paths": []})
        t["onf"].add(raw)
        t["paths"] += [[(x, y) for x, y in p] for p in (f.get("geometry") or {}).get("paths", []) if len(p) > 1]
    return by


def bbox(points, pad):
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad


def overlaps(a, b):
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def grid(points, cell=0.0005):
    g = {}
    for p in points:
        g.setdefault((int(p[0] / cell), int(p[1] / cell)), []).append(p)
    return g, cell


def near(g, p, m):
    cells, cell = g
    cx, cy = int(p[0] / cell), int(p[1] / cell)
    return any(dist_m(p, q) <= m for dx in (-1, 0, 1) for dy in (-1, 0, 1) for q in cells.get((cx + dx, cy + dy), ()))


def main():
    print("ONF…")
    trails = onf_trails()
    names = sorted(trails)
    flat = [p for n in names for seg in trails[n]["paths"] for p in seg]
    print(f"{len(names)} sentiers, {len(flat)} points : altitudes IGN…")
    zs = elevations(flat)
    sentiers, used, i = {}, set(), 0
    for n in names:
        segs_z = []
        for seg in trails[n]["paths"]:
            segs_z.append(zs[i:i + len(seg)])
            i += len(seg)
        s = slug(n) or "sentier"
        while s in used:
            s += "-2"
        used.add(s)
        up, down = climb(segs_z)
        alts = [z for seg in segs_z for z in seg if z is not None]
        sentiers[n] = {
            "slug": s,
            "onf": sorted(trails[n]["onf"]),
            "km": round(length_km(trails[n]["paths"]), 1),
            "dplus": up,
            "dmoins": down,
            **({"alt_min": min(alts), "alt_max": max(alts)} if alts else {}),
        }

    print("OpenStreetMap…")
    query = '[out:json][timeout:180];area["ISO3166-2"="FR-974"]->.a;rel(area.a)["route"="hiking"];out geom;'
    rels = fetch(OVERPASS, urllib.parse.urlencode({"data": query}).encode())["elements"]
    onf_grids = {n: [p for seg in trails[n]["paths"] for p in seg] for n in names}
    randonnees, used = [], set()
    for r in sorted(rels, key=lambda r: r["tags"].get("name", "")):
        t = r["tags"]
        name = (t.get("name") or "").strip()
        if not name:
            continue
        ways = [[(g["lon"], g["lat"]) for g in m["geometry"]] for m in r["members"] if m["type"] == "way" and m.get("geometry")]
        pieces = chain(ways)
        if not pieces:
            continue
        full = [p for piece in pieces for p in piece]
        g = grid(full)
        box = bbox(full, 0.001)
        on = []
        for n, pts in onf_grids.items():
            if not pts or not overlaps(bbox(pts, 0), box):
                continue
            sample = pts[::3] or pts
            if sample and sum(near(g, p, ON_ROUTE_M) for p in sample) / len(sample) >= ON_ROUTE_SHARE:
                on.append(n)
        simple = [simplify(p, SIMPLIFY_M) for p in pieces]
        z = elevations([p for piece in simple for p in piece])
        segs_z, i = [], 0
        for piece in simple:
            segs_z.append(z[i:i + len(piece)])
            i += len(piece)
        up, down = climb(segs_z)
        alts = [v for v in z if v is not None]
        s = slug(name)
        while s in used:
            s += "-2"
        used.add(s)
        nom = name[0].upper() + name[1:]
        randonnees.append({
            "slug": s,
            "nom": nom,
            "osm": r["id"],
            **({"ref": t["ref"]} if t.get("ref") else {}),
            **({"operateur": t["operator"]} if t.get("operator") else {}),
            "km": round(length_km(pieces), 1),
            "dplus": up,
            "dmoins": down,
            **({"alt_min": min(alts), "alt_max": max(alts)} if alts else {}),
            "boucle": len(pieces) == 1 and dist_m(pieces[0][0], pieces[0][-1]) < 150,
            "sentiers_onf": sorted(on),
            "lignes": [encode(p) for p in simple],
            "altitudes": segs_z,
        })
        print(f"  {nom}: {len(pieces)} morceau(x), {sum(map(len, simple))} points, {randonnees[-1]['km']} km, D+ {up} m, {len(on)} sentiers ONF")
        time.sleep(0.5)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        "construit": date.today().isoformat(),
        "attribution": "Itinéraires © les contributeurs d'OpenStreetMap (ODbL) ; sentiers ONF La Réunion ; altitudes IGN, RGE ALTI (Licence Ouverte 2.0)",
        "sentiers": sentiers,
        "randonnees": randonnees,
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"{OUT.relative_to(ROOT)} : {len(sentiers)} sentiers ONF, {len(randonnees)} randonnées, {OUT.stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
