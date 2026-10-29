#!/usr/bin/env python3
"""Build public/altitudes-<fingerprint>.png (its name in src/web/altitudes.json): the island's altitudes on a small
grid, read by the script of /meteo to estimate the temperatures between the stations (src/web/meteo-carte.ts).

Same bounds and proportions as src/places/island.json, as the relief (scripts/build-relief.py). One grey level per
cell: 0 for the sea, else 1 + the altitude in steps of STEP metres (255 holds 3 175 m, over the Piton des Neiges).
A PNG with the « up » filter on every row: about 5 kB, which the phone loads after the page, kept a year.

Source: IGN, RGE ALTI (Licence Ouverte 2.0), from the Géoplateforme WMS as raw 32-bit floats.
Usage: python3 -I scripts/build-altitudes.py
"""
import array
import hashlib
import json
import struct
import sys
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ISLAND = json.loads((ROOT / "src/places/island.json").read_text())
LON0, LAT0, LON1, LAT1 = ISLAND["bbox"]
W = 125  # about 540 m a cell: enough for a veil of colour drawn smooth over the map
H = round(W * ISLAND["h"] / ISLAND["w"])
STEP = 12.5
WMS = ("https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap"
       "&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLES=&CRS=EPSG:4326"
       f"&BBOX={LAT0},{LON0},{LAT1},{LON1}&WIDTH={W}&HEIGHT={H}&FORMAT=image/x-bil;bits=32")


def png(levels, w, h):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\2" + bytes((levels[y * w + x] - (levels[(y - 1) * w + x] if y else 0)) & 255 for x in range(w))
                    for y in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def main():
    with urllib.request.urlopen(WMS, timeout=120) as r:
        z = array.array("f", r.read())
    if sys.byteorder != "little":
        z.byteswap()
    assert len(z) == W * H, f"{len(z)} values, {W * H} expected"
    # The sea is « no data » (-99999).
    levels = bytes(0 if v < -1000 else min(255, 1 + max(0, round(v / STEP))) for v in z)
    data = png(levels, W, H)
    v = hashlib.sha256(data).hexdigest()[:8]
    for old in (ROOT / "public").glob("altitudes-*.png"):
        old.unlink()
    (ROOT / f"public/altitudes-{v}.png").write_bytes(data)
    (ROOT / "src/web/altitudes.json").write_text(json.dumps({"attribution": "Altitudes : IGN, RGE ALTI (Licence Ouverte 2.0)", "v": v, "pas_m": STEP}) + "\n")
    print(f"public/altitudes-{v}.png: {W}×{H}, {len(data)} octets")


if __name__ == "__main__":
    main()
