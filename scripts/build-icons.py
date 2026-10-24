#!/usr/bin/env python3
"""Build the icons of the site kept on a phone's home screen (src/web/site.ts serves /manifest.webmanifest): the flag
Lo Mahavéli on a full square, as the favicon (src/web/flag.ts), in PNG at the sizes Android and iOS ask for. The phone
draws its own rounded corners or circle; the summit of the volcano, where the rays meet, stays in the middle.
Those go to public/icons/, served by Cloudflare beside the Worker, named after their content; src/web/icons.json says
which is which. Rasterised by ImageMagick (`convert`).
Usage: python3 -I scripts/build-icons.py
"""
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/icons"
RAYS = "M0 18.5v3L60 18.5v3zM30 20 0 2.5V0H2.5zM30 20 57.5 0H60V2.5zM30 20 28.5 0h3z"
# 180 for iOS (apple-touch-icon), 192 and 512 for Android and the others.
SIZES = [180, 192, 512]


def svg(size):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 60 60">'
            '<rect width="60" height="60" fill="#2563d8"/><g transform="translate(-15 0) scale(1.5)">'
            f'<path d="M30 20L60 40H0Z" fill="#e3262d"/><path d="{RAYS}" fill="#ffd400"/></g></svg>')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.iterdir():
        old.unlink()
    manifest = {}
    with tempfile.TemporaryDirectory() as tmp:
        for size in SIZES:
            src, png = Path(tmp) / f"{size}.svg", Path(tmp) / f"{size}.png"
            src.write_text(svg(size))
            subprocess.run(["convert", "-background", "none", str(src), "-strip", "PNG32:" + str(png)], check=True)
            data = png.read_bytes()
            name = f"flag-{size}.{hashlib.sha256(data).hexdigest()[:10]}.png"
            (OUT / name).write_bytes(data)
            manifest[str(size)] = f"/icons/{name}"
            print(OUT / name, f"{len(data) // 1024} KB PNG")
    (ROOT / "src/web/icons.json").write_text(json.dumps(manifest, indent=1) + "\n")


if __name__ == "__main__":
    main()
