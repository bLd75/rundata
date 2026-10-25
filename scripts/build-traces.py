#!/usr/bin/env python3
"""Build src/traces/traces.json: the GPS traces of the hikes of La Réunion, bundled with the server.

- The hiking routes of OpenStreetMap (relations route=hiking in FR-974, read once through Overpass): their ways put
  end to end, simplified to about 5 m, with the altitude of each point from the IGN (Géoplateforme altimetry service,
  RGE ALTI, no key), their length, climb and descent, and the ONF trails they follow, whose state the server reads live.
  OpenStreetMap data, ODbL: « © les contributeurs d'OpenStreetMap ».
- The trails of the ONF (the layer of src/providers/sentiers.ts), at full resolution once: their length, climb, descent
  and lowest and highest points. Their lines are not kept: the server reads each from the ONF when asked, with its state.
- The sector of each (Mafate, Cilaos, Volcan, Sud sauvage…): where the most of its length lies, from the cirque of Mafate
  in OpenStreetMap, the communes of geo.api.gouv.fr (Cilaos, Salazie, then the others by part of the island) and the
  altitudes (the volcano's heights, the coast). A route across several sectors has none of its own, but lists them.
Usage: python3 -I scripts/build-traces.py [--cache DIR]
  --cache DIR keeps every response in DIR and reads it back on the next run: to rebuild without asking the sources again.
"""
import hashlib
import json
import math
import sys
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
COMMUNES = "https://geo.api.gouv.fr/departements/974/communes?format=geojson&geometry=contour&fields=nom"
ALTI = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
ALTI_MAX = 5000
# A climb or descent counts once it exceeds this: the ground model's noise is not a climb.
STEP_M = 10
SIMPLIFY_M = 5
# An ONF trail is on a route when most of it, or a good stretch of it, lies this close to the route: a short trail the
# route takes whole, a long one it follows for a while. A trail that only crosses the route, or runs beside it farther
# off, is not on it.
ON_ROUTE_M = 30
ON_ROUTE_SHARE = 0.6
ON_ROUTE_MIN_M = 200
# The stretches of a route along one of its ONF trails, shorter than this, are crossings: not kept.
PORTION_MIN_M = 50


# The sectors of the hikes, by part of the island: the communes not named here are in the cirques (whole communes) or
# split by the rules of sector_at.
SECTOR_OF_COMMUNE = {
    "Saint-Denis": "Nord", "Sainte-Marie": "Nord", "Sainte-Suzanne": "Nord", "La Possession": "Nord",
    "Saint-André": "Est", "Bras-Panon": "Est", "Saint-Benoît": "Est", "La Plaine-des-Palmistes": "Est",
    "Saint-Pierre": "Sud", "Petite-Île": "Sud", "Le Tampon": "Sud", "Entre-Deux": "Sud", "Saint-Louis": "Sud", "Saint-Joseph": "Sud",
    "Saint-Paul": "Hauts de l'Ouest", "Le Port": "Hauts de l'Ouest", "Les Trois-Bassins": "Hauts de l'Ouest", "Saint-Leu": "Hauts de l'Ouest",
    "Les Avirons": "Hauts de l'Ouest", "L'Étang-Salé": "Hauts de l'Ouest",
    "Sainte-Rose": "Sud sauvage", "Saint-Philippe": "Sud sauvage",
}
# The volcano: its massif above this, east of the Plaine des Cafres and south of the Plaine des Palmistes (Plaine des
# Cafres, Nez de Bœuf, Plaine des Sables, Pas de Bellecombe, the Enclos).
VOLCAN_M, VOLCAN_LON, VOLCAN_LAT = 1400, 55.55, -21.16
# Saint-Joseph east of its town (Langevin, Vincendo, Grand Coude) is the Sud sauvage.
SUD_SAUVAGE_LON = 55.625
# Below this, along the coast: the coastal paths (out of the Sud sauvage, which has its own).
LITTORAL_M = 100
# A route has a sector when this share of its length lies in it; it is listed in each sector with at least the other.
SECTOR_SHARE, CROSSED_SHARE = 0.5, 0.15


CACHE = None


def fetch(url, data=None, headers=None, timeout=300):
    if CACHE:
        key = CACHE / (hashlib.sha256(url.encode() + (data or b"")).hexdigest() + ".json")
        if key.exists():
            return json.loads(key.read_text())
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = json.load(r)
            if CACHE:
                key.write_text(json.dumps(body))
            return body
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


def seg_dist_m(p, a, b):
    """Distance in m from p to the segment a-b, on a flat projection around p."""
    k = math.cos(math.radians(p[1]))
    ax, ay = (a[0] - p[0]) * k, a[1] - p[1]
    bx, by = (b[0] - p[0]) * k, b[1] - p[1]
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
    return math.hypot(ax + t * dx, ay + t * dy) * math.pi / 180 * 6371000


class Lines:
    """The segments of some lines, by cell of a grid: how close a point is to them, whatever the spacing of their points."""

    def __init__(self, lines, cell=0.0005):
        self.cell, self.cells = cell, {}
        for line in lines:
            for a, b in zip(line, line[1:]):
                for cx in range(math.floor(min(a[0], b[0]) / cell), math.floor(max(a[0], b[0]) / cell) + 1):
                    for cy in range(math.floor(min(a[1], b[1]) / cell), math.floor(max(a[1], b[1]) / cell) + 1):
                        self.cells.setdefault((cx, cy), []).append((a, b))

    def near(self, p, m):
        # A cell is about 50 m wide: its neighbours hold every segment within ON_ROUTE_M.
        cx, cy = math.floor(p[0] / self.cell), math.floor(p[1] / self.cell)
        return any(seg_dist_m(p, a, b) <= m for dx in (-1, 0, 1) for dy in (-1, 0, 1) for a, b in self.cells.get((cx + dx, cy + dy), ()))


def along(paths, lines):
    """How many metres of the paths lie within ON_ROUTE_M of the lines, and their whole length."""
    on = total = 0.0
    for seg in paths:
        close = [lines.near(p, ON_ROUTE_M) for p in seg]
        for i in range(1, len(seg)):
            d = dist_m(seg[i - 1], seg[i])
            total += d
            if close[i - 1] and close[i]:
                on += d
    return on, total


def portions(pieces, lines):
    """The stretches of the route's pieces along the lines, as [piece, first point, last point]; crossings left out."""
    out = []
    for k, piece in enumerate(pieces):
        close = [lines.near(p, ON_ROUTE_M) for p in piece] + [False]
        start = None
        for i, c in enumerate(close):
            if c and start is None:
                start = i
            elif not c and start is not None:
                if i - 1 > start and sum(dist_m(piece[j], piece[j + 1]) for j in range(start, i - 1)) >= PORTION_MIN_M:
                    out.append([k, start, i - 1])
                start = None
    return out


def rings_of(geometry):
    """The polygons of a GeoJSON geometry, each as its rings of (lon, lat)."""
    polys = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    return [[[tuple(p) for p in ring] for ring in poly] for poly in polys]


def inside(p, polys):
    """Whether p is in one of the polygons (even-odd over each one's rings, its holes too)."""
    x, y = p
    for poly in polys:
        n = 0
        for ring in poly:
            for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
                if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                    n += 1
        if n % 2:
            return True
    return False


class Shapes:
    """The cirque of Mafate (OpenStreetMap) and the 24 communes (geo.api.gouv.fr): where a point is, by cell of about 50 m."""

    CELL = 0.0005

    def __init__(self):
        query = '[out:json][timeout:60];area["ISO3166-2"="FR-974"]->.a;rel(area.a)["name"="Cirque de Mafate"];out geom;'
        rel = fetch(OVERPASS, urllib.parse.urlencode({"data": query}).encode())["elements"][0]
        outer = chain([[(g["lon"], g["lat"]) for g in m["geometry"]] for m in rel["members"] if m["type"] == "way" and m.get("role") == "outer"])
        self.mafate = [("Mafate", [[ring]]) for ring in outer]
        self.communes = [(f["properties"]["nom"], rings_of(f["geometry"])) for f in fetch(COMMUNES)["features"]]
        self.boxes = {id(polys): bbox([p for poly in polys for p in poly[0]], 0) for _, polys in self.mafate + self.communes}
        self.cells = {}

    def find(self, p, shapes):
        return next((n for n, polys in shapes if overlaps(self.boxes[id(polys)], (p[0], p[1], p[0], p[1])) and inside(p, polys)), None)

    def at(self, p):
        """(in Mafate, commune) at p."""
        k = (math.floor(p[0] / self.CELL), math.floor(p[1] / self.CELL))
        if k not in self.cells:
            c = ((k[0] + 0.5) * self.CELL, (k[1] + 0.5) * self.CELL)
            self.cells[k] = (self.find(c, self.mafate) is not None, self.find(c, self.communes))
        return self.cells[k]


def sector_at(p, z, shapes):
    """The sector of a point, its altitude in m when known."""
    mafate, commune = shapes.at(p)
    if mafate:
        return "Mafate"
    if commune in ("Cilaos", "Salazie"):
        return commune
    if z is not None and z >= VOLCAN_M and p[0] >= VOLCAN_LON and p[1] <= VOLCAN_LAT:
        return "Volcan"
    if commune in ("Sainte-Rose", "Saint-Philippe") or (commune == "Saint-Joseph" and p[0] >= SUD_SAUVAGE_LON):
        return "Sud sauvage"
    if z is not None and z < LITTORAL_M:
        return "Littoral"
    return SECTOR_OF_COMMUNE.get(commune)


def sectors(segments, segments_z, shapes):
    """The sectors a line runs through, with their share of its length, the largest first."""
    by, total = {}, 0.0
    for seg, z in zip(segments, segments_z):
        for i in range(1, len(seg)):
            d = dist_m(seg[i - 1], seg[i])
            total += d
            mid = ((seg[i - 1][0] + seg[i][0]) / 2, (seg[i - 1][1] + seg[i][1]) / 2)
            zs = [v for v in (z[i - 1], z[i]) if v is not None]
            k = sector_at(mid, sum(zs) / len(zs) if zs else None, shapes)
            if k:
                by[k] = by.get(k, 0) + d
    return sorted(((k, v / total) for k, v in by.items()), key=lambda kv: -kv[1]) if total else []


def main():
    global CACHE
    if "--cache" in sys.argv:
        CACHE = Path(sys.argv[sys.argv.index("--cache") + 1])
        CACHE.mkdir(parents=True, exist_ok=True)
    print("ONF…")
    trails = onf_trails()
    names = sorted(trails)
    flat = [p for n in names for seg in trails[n]["paths"] for p in seg]
    print(f"{len(names)} sentiers, {len(flat)} points : altitudes IGN…")
    zs = elevations(flat)
    print("Secteurs : Mafate (OpenStreetMap), communes (geo.api.gouv.fr)…")
    shapes = Shapes()
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
        where = sectors(trails[n]["paths"], segs_z, shapes)
        sentiers[n] = {
            "slug": s,
            "onf": sorted(trails[n]["onf"]),
            **({"secteur": where[0][0]} if where else {}),
            "km": round(length_km(trails[n]["paths"]), 1),
            "dplus": up,
            "dmoins": down,
            **({"alt_min": min(alts), "alt_max": max(alts)} if alts else {}),
        }

    print("OpenStreetMap…")
    query = '[out:json][timeout:180];area["ISO3166-2"="FR-974"]->.a;rel(area.a)["route"="hiking"];out geom;'
    rels = fetch(OVERPASS, urllib.parse.urlencode({"data": query}).encode())["elements"]
    onf_points = {n: [p for seg in trails[n]["paths"] for p in seg] for n in names}
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
        route = Lines(pieces)
        box = bbox(full, 0.001)
        on = []
        for n, pts in onf_points.items():
            if not pts or not overlaps(bbox(pts, 0), box):
                continue
            m, total = along(trails[n]["paths"], route)
            if total and (m / total >= ON_ROUTE_SHARE or m >= ON_ROUTE_MIN_M):
                on.append(n)
        simple = [simplify(p, SIMPLIFY_M) for p in pieces]
        z = elevations([p for piece in simple for p in piece])
        segs_z, i = [], 0
        for piece in simple:
            segs_z.append(z[i:i + len(piece)])
            i += len(piece)
        up, down = climb(segs_z)
        alts = [v for v in z if v is not None]
        where = sectors(simple, segs_z, shapes)
        stretches = {n: portions(simple, Lines(trails[n]["paths"])) for n in on}
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
            **({"secteur": where[0][0]} if where and where[0][1] >= SECTOR_SHARE else {}),
            "secteurs": [k for k, v in where if v >= CROSSED_SHARE] or [k for k, _ in where[:1]],
            "sentiers_onf": sorted(on),
            # Where on the route each ONF trail is: a closure drawn on the route's own line, its start marked in the GPX.
            "portions": {n: v for n, v in sorted(stretches.items()) if v},
            "lignes": [encode(p) for p in simple],
            "altitudes": segs_z,
        })
        print(f"  {nom}: {len(pieces)} morceau(x), {sum(map(len, simple))} points, {randonnees[-1]['km']} km, D+ {up} m, {len(on)} sentiers ONF, "
              + ", ".join(f"{k} {v:.0%}" for k, v in where))
        time.sleep(0.5)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        "construit": date.today().isoformat(),
        "attribution": "Itinéraires © les contributeurs d'OpenStreetMap (ODbL)\u00a0; sentiers ONF La Réunion\u00a0; altitudes IGN, RGE ALTI (Licence Ouverte 2.0)",
        "sentiers": sentiers,
        "randonnees": randonnees,
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"{OUT.relative_to(ROOT)} : {len(sentiers)} sentiers ONF, {len(randonnees)} randonnées, {OUT.stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
