#!/usr/bin/env python3
"""Build public/relief-<fingerprint>.webp (its name in src/web/relief.json): the island in relief, laid under the
markers of every map of the island (src/web/map.ts). The colours are the IGN's aerial photo itself, at full detail,
graded: the greens saturated and lit as those of the relief by altitude it replaces, the reds of the dry savanna turned
towards ochre, the Hauts lightened. Then shaded by the slopes as if lit from the north-west, with the relief
exaggerated so that the cirques and the volcano read at a few hundred pixels across.

Same bounds and proportions as src/places/island.json, so the image falls exactly under the map's coastline and
markers: the IGN serves the elevation for that box in plain longitude and latitude, which is the map's projection.

Sources: IGN, RGE ALTI, from the Géoplateforme WMS as raw 32-bit floats, and BD ORTHO, the aerial photo, from the
same WMS on the same box and grid (Licence Ouverte 2.0). One request a minute to the Géoplateforme.
Resized and written as WebP by ImageMagick (`convert`).

Usage: python3 -I scripts/build-relief.py [--cache DIR] [--out DIR] [--sat S] [--earth E] [--gamma G] …
  --cache keeps the IGN's answers in DIR, to try other settings without asking again;
  --out writes the picture there, leaving public/ alone; the other options try other settings than those below.
"""
import argparse
import array
import colorsys
import hashlib
import json
import math
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ISLAND = json.loads((ROOT / "src/places/island.json").read_text())
LON0, LAT0, LON1, LAT1 = ISLAND["bbox"]
W, H = ISLAND["w"] * 2, ISLAND["h"] * 2  # computed at twice the map's size, then reduced: smooth coast, crisp ridges
OUT_W = 1200  # wide enough for the map at its largest on a high-density screen
QUALITY = 82  # WebP
MAX_BYTES = 164 * 1024  # the picture is on every page with a map: no heavier than the relief by altitude was
WMS = ("https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&CRS=EPSG:4326"
       f"&BBOX={LAT0},{LON0},{LAT1},{LON1}&WIDTH={W}&HEIGHT={H}")
ELEVATION = WMS + "&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&FORMAT=image/x-bil;bits=32"
PHOTO = WMS + "&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg"

EXAGGERATION = 2.2
SUN = (315, 38)  # azimuth from north, height above the horizon, in degrees: the usual cartographer's light
# The photo's colours: SAT, how much more saturated the greens get (the browns and reds of the dry west and the lava
# EARTH of it, so that they stay earth), GAMMA, above 1 darker and below lighter, and CONTRAST, each colour moved away
# from mid-grey by that factor. Measured on the relief by altitude the user found « vives » (31/10/2026, setting
# « E3 »): its greens at a saturation of 0.44 and a value of 0.52 (HSV, means over the island), its ochres 0.36 and 0.58.
SAT, EARTH, GAMMA, CONTRAST = 2.4, 1.0, 0.62, 1.0
# WARM, how far the reds and pinks of the photo (the dry savanna of the west, the bare soil) turn towards ochre (hue
# OCHRE, in degrees), 0 not at all to 1 fully: as warm as the Hauts of the relief by altitude.
WARM, OCHRE = 0.9, 40
# The Hauts lightened (the user, 31/10/2026: « tout le centre est trop sombre »): from HIGH_FROM to HIGH_TO metres,
# the gamma goes from GAMMA to HIGH_GAMMA (the dark greens and the shadows of the cirques raised most) and the shading
# to HIGH_SHADE of its strength. Elsewhere the slopes shade at SHADE of their strength, and nowhere does a slope's
# shadow take more than SHADOW_FLOOR off. No whitening: the photo's own light is raised, never mixed with white.
SHADE, HIGH_FROM, HIGH_TO, HIGH_GAMMA, HIGH_SHADE, SHADOW_FLOOR = 0.6, 400, 1600, 0.38, 0.4, 0.2
# The shallows and the river mouths, inside the elevation's coast: the photo's blue, graded with these, never brighter.
WATER_SAT, WATER_GAMMA = 1.075, 1.15


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


def fetch(url, name, cache):
    """The Géoplateforme's answer, kept in `cache` when given; a minute between two requests."""
    kept = cache / name if cache else None
    if kept and kept.exists():
        return kept.read_bytes()
    if getattr(fetch, "last", 0):
        time.sleep(max(0.0, fetch.last + 60 - time.time()))
    with urllib.request.urlopen(url, timeout=300) as r:
        data = r.read()
    fetch.last = time.time()
    if kept:
        kept.write_bytes(data)
    return data


def ppm(data):
    """The pixels of a binary PPM (P6) or PGM (P5) as bytes, past its header."""
    fields, i = [], 0
    while len(fields) < 4:
        while data[i:i + 1].isspace():
            i += 1
        j = i
        while not data[j:j + 1].isspace():
            j += 1
        fields.append(data[i:j])
        i = j
    return data[i + 1:]


def pixels(photo):
    """The photo on the W×H grid, as RGB bytes."""
    return bytearray(ppm(subprocess.run(["convert", "jpeg:-", "-resize", f"{W}x{H}!", "ppm:-"], input=photo,
                                        capture_output=True, check=True).stdout))


def highs(z, lo, hi):
    """0 below `lo` metres, 1 above `hi`, smooth between."""
    t = min(1.0, max(0.0, (z - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)


def grade(photo, land, z, a):
    """The photo on the grid at full detail, graded: colours 0..255 for each pixel of land, None elsewhere. The sea
    the elevation counts as land (its shallows, down to about -30 m) keeps the photo's dark blue: the map's coastline
    cuts the picture there."""
    pix = pixels(photo)
    out = [None] * (W * H)
    for i in range(W * H):
        if not land[i]:
            continue
        c = pix[i * 3:i * 3 + 3]
        if z[i] < 5 and c[2] > c[0] + 4 and c[2] > c[1] + 4:
            l = light(c)
            out[i] = tuple(255 * (min(255.0, max(0.0, l + (v - l) * WATER_SAT)) / 255) ** WATER_GAMMA for v in c)
            continue
        # The greens saturated in full, the browns and reds of the dry west and the lava by EARTH.
        l, k = light(c), 1 + (a.sat - 1) * min(1.0, max(a.earth, a.earth + (c[1] - c[0]) / 20))
        c = [min(255.0, max(0.0, 128 + (l + (v - l) * k - 128) * a.contrast)) for v in c]
        if a.warm and c[0] > c[1]:
            h, s, v = colorsys.rgb_to_hsv(*(x / 255 for x in c))
            d = ((h * 360 - OCHRE + 180) % 360) - 180  # from the ochre, -180 to 180 degrees
            if abs(d) < 90:
                c = [x * 255 for x in colorsys.hsv_to_rgb(((OCHRE + d * (1 - a.warm)) % 360) / 360, s, v)]
        g = a.gamma + (a.high_gamma - a.gamma) * highs(z[i], HIGH_FROM, HIGH_TO)
        out[i] = tuple(255 * (v / 255) ** g for v in c)
    return out


def light(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def png(path, rgba, w, h):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\0" + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--cache", type=Path)
    args.add_argument("--out", type=Path)
    for name, default in (("sat", SAT), ("earth", EARTH), ("gamma", GAMMA), ("contrast", CONTRAST), ("warm", WARM),
                          ("shade", SHADE), ("high-gamma", HIGH_GAMMA), ("high-shade", HIGH_SHADE), ("floor", SHADOW_FLOOR)):
        args.add_argument(f"--{name}", type=float, default=default)
    a = args.parse_args()
    if a.cache:
        a.cache.mkdir(parents=True, exist_ok=True)
    z = array.array("f", fetch(ELEVATION, "altitudes.bil", a.cache))
    if sys.byteorder != "little":
        z.byteswap()
    assert len(z) == W * H, f"{len(z)} values, {W * H} expected"
    land = [v > -1000 for v in z]  # the sea is « no data » (-99999)
    z = [v if ok else 0.0 for v, ok in zip(z, land)]
    s = smooth(z, land)
    photo = grade(fetch(PHOTO, "photo.jpg", a.cache), land, z, a)
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
            k = max(1 - a.floor, 1 + a.shade * (1 - (1 - a.high_shade) * highs(z[i], HIGH_FROM, HIGH_TO)) * (k - 1))
            r, g, b = photo[i]
            o = i * 4
            out[o:o + 4] = bytes((min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)), 255))
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / "relief.png", Path(tmp) / "relief.webp"
        png(src, bytes(out), W, H)
        size = []  # none at first; then a size aimed at, smaller each time, while the picture is too heavy
        while True:
            subprocess.run(["convert", str(src), "-resize", f"{OUT_W}x", "-quality", str(QUALITY), "-define",
                            "webp:alpha-quality=90", *size, str(dst)], check=True)
            data = dst.read_bytes()
            if len(data) <= MAX_BYTES:
                break
            aim = int(size[1].split("=")[1]) - 5000 if size else MAX_BYTES - 15000
            size = ["-define", f"webp:target-size={aim}"]
    # The picture, a file of public/ named by its fingerprint; its name and attribution in src/web/relief.json.
    v = hashlib.sha256(data).hexdigest()[:8]
    if a.out:
        a.out.mkdir(parents=True, exist_ok=True)
        (a.out / f"relief-{v}.webp").write_bytes(data)
        print(f"{a.out}/relief-{v}.webp: {len(data) // 1024} Ko")
        return
    for old in (ROOT / "public").glob("relief-*.webp"):
        old.unlink()
    (ROOT / f"public/relief-{v}.webp").write_bytes(data)
    target = ROOT / "src/web/relief.json"
    target.write_text(json.dumps({"attribution": "Relief : IGN, RGE ALTI et BD ORTHO (Licence Ouverte 2.0)", "v": v}) + "\n")
    print(f"public/relief-{v}.webp: {len(data) // 1024} Ko")


if __name__ == "__main__":
    main()
