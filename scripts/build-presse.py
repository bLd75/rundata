#!/usr/bin/env python3
"""Build the visuals of the press page (/presse): public/presse/ and src/web/presse.json.

Each screenshot becomes a JPEG to download (the "HD" file) and a small WebP for the page, both named after their
content, so the Worker's static assets may keep them for good (public/_headers). They are served by Cloudflare beside
the Worker, not bundled with it: the bundle stays as it was. The phone screenshots (780 px wide, @2x) are cut to their
top 1300 px, the first screen and a half; the desktop one of a trail to its first screen.
Needs libvips (`vips`, Ubuntu package libvips-tools).
Usage: python3 -I scripts/build-presse.py DIR
  DIR holds the screenshots named below (the communication kit's captures/).
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "presse")
MANIFEST = os.path.join(ROOT, "src", "web", "presse.json")

# id, source file, crop (width, height from the top) or None, width of the HD file, width of the thumbnail.
VISUALS = [
    ("randonnees-ordi", "presse-randonnees-ordi.jpg", None, 1600, 800),
    ("accueil-ordi", "presse-accueil-ordi.jpg", None, 1600, 800),
    ("piton-des-neiges-ordi", "piton-des-neiges-ordi.png", (2560, 1250), 1600, 800),
    ("accueil", "accueil.png", (780, 1300), 780, 400),
    ("cilaos", "cilaos.png", (780, 1300), 780, 400),
    ("randonnees", "randonnees.png", (780, 1300), 780, 400),
    ("evenements", "evenements.png", (780, 1300), 780, 400),
    ("historique", "historique.png", (780, 1300), 780, 400),
]


def vips(*args):
    subprocess.run(["vips", *args], check=True)


def size(path):
    out = subprocess.run(["vipsheader", "-f", "width", path], check=True, capture_output=True, text=True).stdout
    h = subprocess.run(["vipsheader", "-f", "height", path], check=True, capture_output=True, text=True).stdout
    return int(out), int(h)


def named(tmp, id_, ext):
    with open(tmp, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()[:10]
    name = f"rundata-{id_}.{digest}.{ext}"
    os.replace(tmp, os.path.join(OUT, name))
    return name


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        os.remove(os.path.join(OUT, old))
    manifest = {}
    with tempfile.TemporaryDirectory() as work:
        for id_, file, crop, hd_w, thumb_w in VISUALS:
            source = os.path.join(src, file)
            if crop:
                cut = os.path.join(work, f"{id_}.v")
                vips("crop", source, cut, "0", "0", str(crop[0]), str(crop[1]))
                source = cut
            hd = os.path.join(work, f"{id_}.jpg")
            vips("thumbnail", source, f"{hd}[Q=84,optimize_coding,interlace,strip]", str(hd_w), "--height", "100000")
            thumb = os.path.join(work, f"{id_}.webp")
            vips("thumbnail", source, f"{thumb}[Q=78,strip]", str(thumb_w), "--height", "100000")
            (w, h), (tw, th) = size(hd), size(thumb)
            octets, thumb_octets = os.path.getsize(hd), os.path.getsize(thumb)
            manifest[id_] = {
                "hd": f"/presse/{named(hd, id_, 'jpg')}", "largeur": w, "hauteur": h, "octets": octets,
                "vignette": f"/presse/{named(thumb, id_, 'webp')}", "vignette_largeur": tw, "vignette_hauteur": th,
            }
            print(f"{id_}: {w}×{h} {octets // 1024} Ko, vignette {tw}×{th} {thumb_octets // 1024} Ko")
    with open(MANIFEST, "w") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
