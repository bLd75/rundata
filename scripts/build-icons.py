#!/usr/bin/env python3
"""Take the symbol of rundata.re, the « Point chaud », from the brand kit (src/web/logo.ts), into the site's files.

The kit renders every size itself (Chrome at the exact size), so the files are taken as they are, never redrawn:
- the icons of the site kept on a phone's home screen (src/web/site.ts serves /manifest.webmanifest): the tile at
  180 (iOS, apple-touch-icon), 192 and 512, and the full-square version at 512 (« maskable », the phone draws its own
  rounded corners or circle), in public/icons/;
- the symbol and the two lockups for the press page and the MCP server's icons, in public/logo/;
- the 48 px PNG that /favicon.ico serves (the favicon services read a PNG better than an SVG), in src/web/icons.json.
public/ is served by Cloudflare beside the Worker, each file named after its content; src/web/icons.json says which
is which.
Usage: python3 -I scripts/build-icons.py DIR
  DIR is the kit's logo folder, the one that holds png/ and svg/.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Key in icons.json, file in the kit, folder in public/.
FILES = [
    ("180", "png/point-chaud-180.png", "icons"),
    ("192", "png/point-chaud-192.png", "icons"),
    ("512", "png/point-chaud-512.png", "icons"),
    ("512-maskable", "png/point-chaud-512-maskable.png", "icons"),
    ("symbole-svg", "svg/point-chaud.svg", "logo"),
    ("symbole-1024", "png/point-chaud-1024.png", "logo"),
    ("lockup-nuit", "svg/point-chaud-lockup-nuit.svg", "logo"),
    ("lockup-sable", "svg/point-chaud-lockup-sable.svg", "logo"),
]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    kit = Path(sys.argv[1])
    for folder in {f for _, _, f in FILES}:
        out = ROOT / "public" / folder
        out.mkdir(parents=True, exist_ok=True)
        for old in out.iterdir():
            old.unlink()
    manifest = {}
    for key, src, folder in FILES:
        data = (kit / src).read_bytes()
        stem, ext = Path(src).name.rsplit(".", 1)
        name = f"{stem.replace('point-chaud', 'logo')}.{hashlib.sha256(data).hexdigest()[:10]}.{ext}"
        (ROOT / "public" / folder / name).write_bytes(data)
        manifest[key] = f"/{folder}/{name}"
        print(ROOT / "public" / folder / name, f"{len(data) // 1024} KB")
    manifest["ico"] = base64.b64encode((kit / "png/point-chaud-48.png").read_bytes()).decode()
    (ROOT / "src/web/icons.json").write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
