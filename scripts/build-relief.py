#!/usr/bin/env python3
"""Build public/relief-<fingerprint>.webp (its name in src/web/relief.json): the island in relief, laid under the
markers of every map of the island (src/web/map.ts). The colours are the IGN's aerial photo itself, at full detail,
graded: the greens saturated and lit as those of the relief by altitude it replaces, the reds of the dry savanna turned
towards ochre, the Hauts lightened. Then shaded by the slopes as if lit from the north-west, with the relief
exaggerated so that the cirques and the volcano read at a few hundred pixels across.

Same bounds and proportions as src/places/island.json, so the image falls exactly under the map's coastline and
markers: the IGN serves the elevation for that box in plain longitude and latitude, which is the map's projection.

With --fin, the same relief 4 times finer, for the maps zoomed in: the island cut in FIN × FIN tiles, each computed on
the same grid as the island (so 4 times finer), with a margin all round that is cut off afterwards, so that the slopes
and the blur at a tile's edge are those of its neighbour's and no seam shows. Written as public/relief-fin-<fingerprint>-
<column>-<row>.webp, the fingerprint of the whole set in src/web/relief.json (« fin »).

Sources: IGN, RGE ALTI, from the Géoplateforme WMS as raw 32-bit floats, and an aerial photo from the same WMS on the
same box and grid (Licence Ouverte 2.0): for the island, its layer ORTHOIMAGERY.ORTHOPHOTOS (« Photographies
aériennes »); for the finer tiles, the BD ORTHO by name, brought to the island's colours (PRE_*). One request a minute
to the Géoplateforme.
Resized and written as WebP by ImageMagick (`convert`).

Usage: python3 -I scripts/build-relief.py [--fin] [--cache DIR] [--out DIR] [--sat S] [--earth E] [--gamma G] …
  --fin writes the tiles of the finer relief, and leaves the island's picture alone;
  --cache keeps the IGN's answers in DIR, to try other settings without asking again;
  --out writes the pictures there, leaving public/ alone; the other options try other settings than those below.
"""
import argparse
import array
import colorsys
import hashlib
import json
import math
import re
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
WMS = "https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&CRS=EPSG:4326"
ELEVATION = "&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&FORMAT=image/x-bil;bits=32"
PHOTO = "&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS&FORMAT=image/jpeg"
# The finer tiles: the BD ORTHO by name. The layer ORTHOIMAGERY.ORTHOPHOTOS mixes takes, and at a tile's scale may
# serve another than at the island's, without saying which.
PHOTO_FIN = "&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS.BDORTHO&FORMAT=image/jpeg"
# The finer relief: FIN × FIN tiles, a margin of FIN_MARGIN of a tile's size on each side computed then cut off.
FIN, FIN_MARGIN = 4, 0.04
FIN_MAX_BYTES = 230 * 1024  # a tile, fetched only when the map is zoomed in on it
ATTRIBUTION = "Relief : IGN, RGE ALTI, couche Photographies aériennes de la Géoplateforme et BD ORTHO (Licence Ouverte 2.0)"

EXAGGERATION = 2.2
SUN = (315, 38)  # azimuth from north, height above the horizon, in degrees: the usual cartographer's light
# The photo's colours: SAT, how much more saturated the greens get (the browns and reds of the dry west and the lava
# EARTH of it, so that they stay earth), GAMMA, above 1 darker and below lighter, and CONTRAST, each colour moved away
# from mid-grey by that factor. Measured on the relief by altitude the user found « vives » (31/10/2026, setting
# « E3 »): its greens at a saturation of 0.44 and a value of 0.52 (HSV, means over the island), its ochres 0.36 and 0.58;
# here 0.42 and 0.42, with no acid green (hue 60 to 95°, saturation above 0.45: 0.4 % of the island, as E2) and 0.5 %
# in bright yellow (hue 40 to 75°, saturation above 0.35) against its 6.5 %.
SAT, EARTH, GAMMA, CONTRAST = 4.0, 1.0, 0.55, 1.0
# WARM, how far the reds and pinks of the photo (the dry savanna of the west, the bare soil) turn towards ochre (hue
# OCHRE, in degrees), 0 not at all to 1 fully: as warm as the Hauts of the relief by altitude.
WARM, OCHRE = 0.9, 40
# The Hauts lightened (the user, 31/10/2026: « tout le centre est trop sombre »): from HIGH_FROM to HIGH_TO metres,
# the gamma goes from GAMMA to HIGH_GAMMA (the dark greens and the shadows of the cirques raised most) and the shading
# to HIGH_SHADE of its strength. Elsewhere the slopes shade at SHADE of their strength, and nowhere does a slope's
# shadow take more than SHADOW_FLOOR off. No whitening: the photo's own light is raised, never mixed with white.
SHADE, HIGH_FROM, HIGH_TO, HIGH_GAMMA, HIGH_SHADE, SHADOW_FLOOR = 0.6, 400, 1600, 0.38, 0.4, 0.2
# Marketing's three limits (31/10/2026): the saturation is pushed on the greens only (hues GREENS, in degrees), the
# yellows of the Plaines and of the west keep the photo's own, as E2's (BASE_SAT, its browns BASE_EARTH); nothing
# greyer than GREY_S is pushed (the lava of the Grand Brûlé turned violet); and nothing that grey is lighter than GREY_V,
# so that the white rings of the dots and the communes' outlines still read on the towns.
GREENS, BASE_SAT, BASE_EARTH, GREY_S, GREY_V = (100, 145), 1.25, 0.3, 0.15, 0.8
# E2's light, for what is not green: its gamma on the coast and in the Hauts. Between the two settings, a pixel goes
# smoothly by its hue (over RAMP degrees at each end of GREENS) and its saturation (from GREY_S to twice), so that no
# edge shows where a field turns from green to yellow.
BASE_GAMMA, BASE_HIGH_GAMMA, RAMP = 1.15, 0.5, 15
# Against an acid green (marketing, 31/10/2026): the yellow-greens of the photo (hues TURN, in degrees) turned by up to
# TURN_BY towards the forests' green; the weight of the push blurred over MASK_BLUR pixels, so that a field is pushed as
# a whole and not one pixel in two; and no colour lit above LIT more saturated than MAX_S.
TURN, TURN_BY, MASK_BLUR, LIT, MAX_S = (60, 150), 15, 2, 0.5, 0.55
# The greys (the towns, saturation under GREY_S) kept at GREY_KEEP of their tint: a neutral grey, not a green one.
GREY_KEEP = 0.4
# The shallows and the river mouths, inside the elevation's coast: the photo's blue, graded with these, never brighter.
WATER_SAT, WATER_GAMMA = 1.075, 1.15
# The BD ORTHO is paler and lighter than the take the settings above were made on (saturation 0.24 against 0.40 over
# the land, 31/10/2026). Before they apply, its saturation times PRE_SAT, its value to the power PRE_GAMMA, and its
# yellow-greens (hues PRE_TURN, in degrees) turned by up to PRE_TURN_BY towards green, most in the middle: then the
# settings above give the island the user chose, and the same at 4 times the detail.
PRE_SAT, PRE_GAMMA, PRE_TURN, PRE_TURN_BY = 1.2, 1.2, (40, 115), 16
# Past the BD ORTHO's edge at sea the WMS answers white: a pixel of the shallows (under 5 m) above WHITE in each of its
# channels is sea.
WHITE = 215


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


def pixels(photo, bd):
    """The photo on the W×H grid, as RGB bytes; the BD ORTHO's (`bd`) brought to the colours the grading was made on
    (PRE_*)."""
    pix = bytearray(ppm(subprocess.run(["convert", "jpeg:-", "-resize", f"{W}x{H}!", "ppm:-"], input=photo,
                                       capture_output=True, check=True).stdout))
    if not bd:
        return pix
    span = PRE_TURN[1] - PRE_TURN[0]
    for i in range(0, len(pix), 3):
        h, s, v = colorsys.rgb_to_hsv(*(x / 255 for x in pix[i:i + 3]))
        d = h * 360 - PRE_TURN[0]
        if 0 < d < span:
            h += PRE_TURN_BY * math.sin(math.pi * d / span) / 360
        pix[i:i + 3] = bytes(min(255, round(x * 255)) for x in colorsys.hsv_to_rgb(h, min(1.0, s * PRE_SAT), v ** PRE_GAMMA))
    return pix


def highs(z, lo, hi):
    """0 below `lo` metres, 1 above `hi`, smooth between."""
    t = min(1.0, max(0.0, (z - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)


def grade(photo, land, z, a, bd):
    """The photo on the grid at full detail, graded: colours 0..255 for each pixel of land, None elsewhere. The sea
    the elevation counts as land (its shallows, down to about -30 m) keeps the photo's dark blue: the map's coastline
    cuts the picture there. What the BD ORTHO (`bd`) does not cover (WHITE) leaves `land`."""
    pix = pixels(photo, bd)
    for i in range(W * H) if bd else ():
        if land[i] and z[i] < 5 and min(pix[i * 3:i * 3 + 3]) > WHITE:
            land[i] = False
    weights = bytearray(W * H)
    for i in range(W * H):
        if land[i]:
            h, s0, _ = colorsys.rgb_to_hsv(*(x / 255 for x in pix[i * 3:i * 3 + 3]))
            # How green: 1 well inside GREENS and saturated enough, 0 for the yellows, the reds, the greys.
            w = highs(h * 360, GREENS[0] - RAMP, GREENS[0] + RAMP) * (1 - highs(h * 360, GREENS[1] - RAMP, GREENS[1] + RAMP))
            weights[i] = round(255 * w * highs(s0, GREY_S, 2 * GREY_S))
    weights = ppm(subprocess.run(["convert", "-size", f"{W}x{H}", "-depth", "8", "gray:-", "-blur", f"0x{MASK_BLUR}", "pgm:-"],
                                 input=bytes(weights), capture_output=True, check=True).stdout)
    out = [None] * (W * H)
    for i in range(W * H):
        if not land[i]:
            continue
        c = pix[i * 3:i * 3 + 3]
        if z[i] < 5 and c[2] > c[0] + 4 and c[2] > c[1] + 4:
            l = light(c)
            out[i] = tuple(255 * (min(255.0, max(0.0, l + (v - l) * WATER_SAT)) / 255) ** WATER_GAMMA for v in c)
            continue
        h, s0, _ = colorsys.rgb_to_hsv(*(x / 255 for x in c))
        w = weights[i] / 255
        # The greens saturated in full, the browns and reds of the dry west and the lava by EARTH; the yellows and the
        # rest as by default; the greys not at all.
        sat, earth = BASE_SAT + (a.sat - BASE_SAT) * w, BASE_EARTH + (a.earth - BASE_EARTH) * w
        l, k = light(c), 1 + (sat - 1) * min(1.0, max(earth, earth + (c[1] - c[0]) / 20)) if s0 >= GREY_S else 1
        c = [min(255.0, max(0.0, 128 + (l + (v - l) * k - 128) * a.contrast)) for v in c]
        if a.warm and s0 >= GREY_S and c[0] > c[1]:
            h, s, v = colorsys.rgb_to_hsv(*(x / 255 for x in c))
            d = ((h * 360 - OCHRE + 180) % 360) - 180  # from the ochre, -180 to 180 degrees
            if abs(d) < 90:
                c = [x * 255 for x in colorsys.hsv_to_rgb(((OCHRE + d * (1 - a.warm)) % 360) / 360, s, v)]
        t = highs(z[i], HIGH_FROM, HIGH_TO)
        g = (1 - w) * (BASE_GAMMA + (BASE_HIGH_GAMMA - BASE_GAMMA) * t) + w * (a.gamma + (a.high_gamma - a.gamma) * t)
        h, s, v = colorsys.rgb_to_hsv(*((x / 255) ** g for x in c))
        if s0 >= GREY_S:
            d = h * 360 - TURN[0]
            if 0 < d < TURN[1] - TURN[0]:
                # Most turned in the middle of TURN, not at all at its ends: no edge.
                h += TURN_BY * math.sin(math.pi * d / (TURN[1] - TURN[0])) / 360
        if s0 < GREY_S:
            s *= GREY_KEEP
        if v > LIT:
            s = min(s, MAX_S)
        out[i] = tuple(255 * x for x in colorsys.hsv_to_rgb(h, s, v))
    return out


def light(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def png(path, rgba, w, h):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\0" + rgba[y * w * 4:(y + 1) * w * 4] for y in range(h))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))


def shaded(box, cache, a, bd=False):
    """The relief of `box` (longitudes and latitudes, as the island's bbox) on the W×H grid: RGBA bytes, the sea
    transparent. With `bd`, on the BD ORTHO."""
    lon0, lat0, lon1, lat1 = box
    wms = WMS + f"&BBOX={lat0},{lon0},{lat1},{lon1}&WIDTH={W}&HEIGHT={H}"
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
    z = array.array("f", fetch(wms + ELEVATION, "altitudes.bil", cache))
    if sys.byteorder != "little":
        z.byteswap()
    assert len(z) == W * H, f"{len(z)} values, {W * H} expected"
    land = [v > -1000 for v in z]  # the sea is « no data » (-99999)
    z = [v if ok else 0.0 for v, ok in zip(z, land)]
    s = smooth(z, land)
    photo = grade(fetch(wms + (PHOTO_FIN if bd else PHOTO), "photo.jpg", cache), land, z, a, bd)
    # Size of a pixel on the ground, in metres.
    dx = (lon1 - lon0) / W * 111320 * math.cos(math.radians((lat0 + lat1) / 2))
    dy = (lat1 - lat0) / H * 110574
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
            r, g, b = (v * k for v in photo[i])
            hi, lo = max(r, g, b), min(r, g, b)
            if hi > 255 * GREY_V and hi - lo < GREY_S * hi:
                r, g, b = (v * 255 * GREY_V / hi for v in (r, g, b))
            o = i * 4
            out[o:o + 4] = bytes((min(255, int(r)), min(255, int(g)), min(255, int(b)), 255))
    return bytes(out)


def webp(rgba, crop, max_bytes):
    """The picture as WebP, OUT_W wide, cut to `crop` (ImageMagick's geometry) first, no heavier than `max_bytes`."""
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / "relief.png", Path(tmp) / "relief.webp"
        png(src, rgba, W, H)
        size = []  # none at first; then a size aimed at, smaller each time, while the picture is too heavy
        while True:
            subprocess.run(["convert", str(src), *(["-crop", crop, "+repage"] if crop else []), "-resize", f"{OUT_W}x",
                            "-quality", str(QUALITY), "-define", "webp:alpha-quality=90", *size, str(dst)], check=True)
            data = dst.read_bytes()
            if len(data) <= max_bytes:
                return data
            aim = int(size[1].split("=")[1]) - 5000 if size else max_bytes - 15000
            size = ["-define", f"webp:target-size={aim}"]


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--fin", action="store_true")
    args.add_argument("--cache", type=Path)
    args.add_argument("--out", type=Path)
    for name, default in (("sat", SAT), ("earth", EARTH), ("gamma", GAMMA), ("contrast", CONTRAST), ("warm", WARM),
                          ("shade", SHADE), ("high-gamma", HIGH_GAMMA), ("high-shade", HIGH_SHADE), ("floor", SHADOW_FLOOR)):
        args.add_argument(f"--{name}", type=float, default=default)
    a = args.parse_args()
    out = a.out or ROOT / "public"
    out.mkdir(parents=True, exist_ok=True)
    target = ROOT / "src/web/relief.json"
    kept = json.loads(target.read_text())
    if a.fin:
        # Each tile on the island's grid, its box widened by FIN_MARGIN on each side, the margin cut off after.
        dl, db = (LON1 - LON0) / FIN, (LAT1 - LAT0) / FIN
        m = FIN_MARGIN
        mx, my = round(W * m / (1 + 2 * m)), round(H * m / (1 + 2 * m))
        crop = f"{W - 2 * mx}x{H - 2 * my}+{mx}+{my}"
        tiles = {}
        for row in range(FIN):
            for col in range(FIN):
                box = (LON0 + (col - m) * dl, LAT1 - (row + 1 + m) * db, LON0 + (col + 1 + m) * dl, LAT1 - (row - m) * db)
                rgba = shaded(box, a.cache and a.cache / f"fin-{col}-{row}", a, bd=True)
                tiles[col, row] = webp(rgba, crop, FIN_MAX_BYTES)
                print(f"tile {col}-{row}: {len(tiles[col, row]) // 1024} Ko", flush=True)
        f = hashlib.sha256(b"".join(tiles[k] for k in sorted(tiles))).hexdigest()[:8]
        if not a.out:
            for old in out.glob("relief-fin-*.webp"):
                old.unlink()
        for (col, row), data in tiles.items():
            (out / f"relief-fin-{f}-{col}-{row}.webp").write_bytes(data)
        print(f"{out}/relief-fin-{f}-*.webp: {sum(map(len, tiles.values())) // 1024} Ko")
        if not a.out:
            target.write_text(json.dumps({**kept, "attribution": ATTRIBUTION, "fin": f}) + "\n")
        return
    data = webp(shaded((LON0, LAT0, LON1, LAT1), a.cache, a), None, MAX_BYTES)
    # The picture, a file of public/ named by its fingerprint; its name and attribution in src/web/relief.json.
    v = hashlib.sha256(data).hexdigest()[:8]
    if a.out:
        (out / f"relief-{v}.webp").write_bytes(data)
        print(f"{out}/relief-{v}.webp: {len(data) // 1024} Ko")
        return
    # The island's picture only: « relief-[0-9a-f]* » would also take the tiles, « f » of « fin » being hexadecimal.
    for old in out.glob("relief-*.webp"):
        if re.fullmatch(r"relief-[0-9a-f]{8}\.webp", old.name):
            old.unlink()
    (out / f"relief-{v}.webp").write_bytes(data)
    target.write_text(json.dumps({**kept, "attribution": ATTRIBUTION, "v": v}) + "\n")
    print(f"public/relief-{v}.webp: {len(data) // 1024} Ko")


if __name__ == "__main__":
    main()
