#!/usr/bin/env python3
"""Build src/web/og.json: the 1200×630 PNG shown in link previews (Facebook, WhatsApp, X…), base64 in a JSON file
so that the Worker and the Node server bundle it alike. Facebook ignores SVG, hence a PNG.

The picture is drawn as SVG here (the flag Lo Mahavéli as in src/web/flag.ts, the island from
src/places/island.json) and rasterised by ImageMagick (`convert`, with the DejaVu fonts).
Usage: python3 -I scripts/build-og.py
"""
import base64
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
W, H = 1200, 630

RAYS = "M0 18.5v3L60 18.5v3zM30 20 0 2.5V0H2.5zM30 20 57.5 0H60V2.5zM30 20 28.5 0h3z"
FLAG = ('<rect width="60" height="40" fill="#2563d8"/>' '<path d="M30 20L60 40H0Z" fill="#e3262d"/>'
        f'<path d="{RAYS}" fill="#ffd400"/>')


def svg():
    island = json.loads((ROOT / "src/places/island.json").read_text())
    slogan = json.loads((ROOT / "src/web/brand.json").read_text())["slogan"]
    paths = "".join(f'<path d="{p["d"]}"/>' for p in island["paths"])
    s = 440 / island["w"]  # the island, 440 px wide, on the right
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<rect width="{W}" height="{H}" fill="#0c2a2f"/>
<rect y="{H - 14}" width="{W}" height="14" fill="#4cc2b6"/>
<g transform="translate(722 96) scale({s})">
  <g fill="none" stroke="#4cc2b6" stroke-width="16" stroke-linejoin="round">{paths}</g>
  <g fill="#ece2c8">{paths}</g>
  <g fill="none" stroke="#cdbf9c" stroke-width="2">{paths}</g>
  <path d="M{(55.4783 - 55.19) / 0.67 * 1000 - 22} {(-20.85 + 21.0989) / 0.56 * 896 + 16}l22-38l22 38z" fill="#b4441a"/>
  <path d="M{(55.7083 - 55.19) / 0.67 * 1000 - 22} {(-20.85 + 21.2444) / 0.56 * 896 + 16}l22-38l22 38z" fill="#b4441a"/>
</g>
<g transform="translate(64 64) scale(4.2)"><rect x="-0.6" y="-0.6" width="61.2" height="41.2" rx="2" fill="#ffffff" opacity=".25"/>{FLAG}</g>
<g font-family="DejaVu Sans" fill="#ffffff">
  <text x="64" y="330" font-size="70" font-weight="bold">La Réunion</text>
  <text x="64" y="420" font-size="78" font-weight="bold" fill="#4cc2b6">974 en direct</text>
  <text x="64" y="488" font-size="40" font-style="italic" font-weight="bold" fill="#ffd400">{slogan}</text>
  <text x="64" y="540" font-size="28" fill="#cfe3e0">Dans Claude, ChatGPT, Le Chat · connecteur MCP gratuit</text>
  <text x="64" y="590" font-size="30" font-weight="bold" fill="#ffffff">rundata.re</text>
</g>
</svg>'''


def main():
    with tempfile.TemporaryDirectory() as tmp:
        src, png = Path(tmp) / "og.svg", Path(tmp) / "og.png"
        src.write_text(svg())
        subprocess.run(["convert", "-density", "96", "-background", "none", str(src),
                        "-strip", "-colors", "256", "PNG8:" + str(png)], check=True)
        data = png.read_bytes()
        out = ROOT / "src/web/og.json"
        out.write_text(json.dumps({"png": base64.b64encode(data).decode()}))
        print(out, f"{len(data) // 1024} KB PNG")


if __name__ == "__main__":
    main()
