#!/usr/bin/env python3
"""Build src/web/relief.json: the island in relief, a WebP image base64 in a JSON file (like og.json), laid under the
markers of the home page's map (src/web/map.ts). Colours by altitude, shaded by the slopes as if lit from the
north-west, with the relief exaggerated so that the cirques and the volcano read at a few hundred pixels across.

Same bounds and proportions as src/places/island.json, so the image falls exactly under the map's coastline and
markers: the IGN serves the elevation for that box in plain longitude and latitude, which is the map's projection.

Source: IGN, RGE ALTI (Licence Ouverte 2.0), from the Géoplateforme WMS as raw 32-bit floats.
Rasterised by ImageMagick (`convert`). Usage: python3 -I scripts/build-relief.py
"""
import array
import base64
import hashlib
import json
import math
import struct
import subprocess
import sys
import tempfile
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ISLAND = json.loads((ROOT / "src/places/island.json").read_text())
LON0, LAT0, LON1, LAT1 = ISLAND["bbox"]
W, H = ISLAND["w"] * 2, ISLAND["h"] * 2  # computed at twice the map's size, then reduced: smooth coast, crisp ridges
OUT_W = 1200  # wide enough for the map at its largest on a high-density screen
WMS = ("https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap"
       "&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLES=&CRS=EPSG:4326"
       f"&BBOX={LAT0},{LON0},{LAT1},{LON1}&WIDTH={W}&HEIGHT={H}&FORMAT=image/x-bil;bits=32")

EXAGGERATION = 2.2
SUN = (315, 38)  # azimuth from north, height above the horizon, in degrees: the usual cartographer's light
# Altitude (m) → colour: green lowlands and forests, then the bare high plains and ridges, pale summits.
TINTS = [(0, (122, 178, 104)), (400, (86, 154, 92)), (900, (62, 128, 84)), (1400, (104, 140, 82)),
         (1900, (166, 154, 104)), (2400, (186, 160, 128)), (2800, (214, 200, 182)), (3100, (246, 242, 234))]


def tint(z):
    for (z0, c0), (z1, c1) in zip(TINTS, TINTS[1:]):
        if z <= z1:
            t = max(0.0, (z - z0) / (z1 - z0))
            return tuple(a + (b - a) * t for a, b in zip(c0, c1))
    return TINTS[-1][1]


def smooth(z, land):
    """The altitudes for the slopes: averaged over 3×3 pixels, which hides the seams of the IGN's tiles, and over land
    only, so that the coast does not drop to the sea like a cliff."""
    out = [0.0] * (W * H)
    for y in range(H):
        for x in range(W):
            i = y * W + x
            if not land[i]:
                continue
            total, n = 0.0, 0
            for yy in (y - 1, y, y + 1):
                if 0 <= yy < H:
                    for xx in (x - 1, x, x + 1):
                        j = yy * W + xx
                        if 0 <= xx < W and land[j]:
                            total += z[j]
                            n += 1
            out[i] = total / n
    # A sea pixel next to the land takes the height of the land, again so that the shore stays flat.
    for i in range(W * H):
        if not land[i]:
            for j in (i - 1, i + 1, i - W, i + W):
                if 0 <= j < W * H and land[j]:
                    out[i] = out[j]
                    break
    return out


def png(path, rgba, w, h):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\0" + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))


def main():
    with urllib.request.urlopen(WMS, timeout=120) as r:
        z = array.array("f", r.read())
    if sys.byteorder != "little":
        z.byteswap()
    assert len(z) == W * H, f"{len(z)} values, {W * H} expected"
    land = [v > -1000 for v in z]  # the sea is « no data » (-99999)
    z = [v if ok else 0.0 for v, ok in zip(z, land)]
    s = smooth(z, land)
    # Size of a pixel on the ground, in metres.
    dx = (LON1 - LON0) / W * 111320 * math.cos(math.radians((LAT0 + LAT1) / 2))
    dy = (LAT1 - LAT0) / H * 110574
    az, alt = (math.radians(a) for a in SUN)
    lx, ly, lz = math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)
    out = bytearray(W * H * 4)
    for y in range(H):
        up, down = max(y - 1, 0) * W, min(y + 1, H - 1) * W
        row = y * W
        for x in range(W):
            i = row + x
            if not land[i]:
                continue
            p = (s[row + min(x + 1, W - 1)] - s[row + max(x - 1, 0)]) / (2 * dx) * EXAGGERATION  # towards the east
            q = (s[up + x] - s[down + x]) / (2 * dy) * EXAGGERATION  # towards the north
            shade = (-p * lx - q * ly + lz) / math.sqrt(p * p + q * q + 1)
            k = min(1.45, max(0.28, shade / lz))  # 1 on flat ground, darker away from the sun, brighter facing it
            k *= 1 - min(0.25, math.hypot(p, q) * 0.06)  # steep walls a little darker all round
            r, g, b = tint(z[i])
            o = i * 4
            out[o:o + 4] = bytes((min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), 255))
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / "relief.png", Path(tmp) / "relief.webp"
        png(src, bytes(out), W, H)
        subprocess.run(["convert", str(src), "-resize", f"{OUT_W}x", "-quality", "82", "-define", "webp:alpha-quality=90",
                        str(dst)], check=True)
        data = dst.read_bytes()
    target = ROOT / "src/web/relief.json"
    target.write_text(json.dumps({
        "attribution": "Relief : IGN, RGE ALTI (Licence Ouverte 2.0)",
        "v": hashlib.sha256(data).hexdigest()[:8],
        "webp": base64.b64encode(data).decode(),
    }) + "\n")
    print(f"{target.relative_to(ROOT)}: {len(data) // 1024} Ko")


if __name__ == "__main__":
    main()
