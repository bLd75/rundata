#!/usr/bin/env python3
"""Build src/web/og.json: the 1200×630 PNG shown in link previews (Facebook, WhatsApp, X…), base64 in a JSON file
so that the Worker and the Node server bundle it alike. Facebook ignores SVG, hence a PNG.

And one picture per section of the site (RUBRIQUES): the island in relief, the flag, the section's name and a line,
so that a link to the hikes and a link to the events do not look the same. Those go to public/og/, served by
Cloudflare beside the Worker like the press visuals, named after their content; src/web/og-rubriques.json says
which pages show which.

The pictures are drawn as SVG here (the flag Lo Mahavéli as in src/web/flag.ts, the island from
src/places/island.json, its relief from src/web/relief.json) and rasterised by ImageMagick (`convert`, with the
DejaVu fonts).
Usage: python3 -I scripts/build-og.py
"""
import base64
import hashlib
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


# Key, name, line, and the pages (with the pages under them) that show the picture.
RUBRIQUES = [
    ("meteo", "Météo 974", "Mesurée aux stations, en direct", ["/meteo"]),
    ("randonnee", "Rando 974", "Sentiers ouverts, traces GPS", ["/randonnees", "/sentiers"]),
    ("evenements", "Sorties 974", "Que faire ce week-end ?", ["/evenements"]),
    ("actualites", "Actu 974", "L'actu de l'île, commune par commune", ["/actualites"]),
    ("volcan", "Volcan 974", "Piton de la Fournaise en direct", ["/volcan"]),
    ("mer", "Mer 974", "La mer est à combien ?", ["/mer"]),
    ("bus", "Bus 974", "Prochain bus à votre arrêt", ["/bus"]),
    ("eau", "Eau 974", "Coupures, qualité, restrictions", ["/eau", "/coupures-eau", "/secheresse"]),
    ("trafic", "Routes 974", "Routes et bouchons", ["/trafic"]),
    ("historique", "Historique 974", "Le temps qu'il a fait depuis 1900", ["/historique"]),
    ("energie", "Énergie 974", "Recharge et électricité en direct", ["/bornes", "/velos", "/electricite"]),
    ("communes", "Communes 974", "Votre commune en direct", ["/communes"]),
    ("defibrillateurs", "Défibrillateurs 974", "Le plus proche de vous, et ses horaires", ["/defibrillateurs"]),
    ("calendrier", "Calendrier 974", "Vacances scolaires et jours fériés", ["/calendrier"]),
    ("cyclones", "Cyclones 974", "Trajectoire et alerte en direct", ["/cyclones"]),
    ("sport", "Sport 974", "Matchs, résultats, Grand Raid", ["/sport"]),
    ("carburants", "Carburants 974", "Les prix maximums du mois", ["/carburants"]),
]
OUT = ROOT / "public/og"
LEFT = 600  # the text's column, left of the island
ISLAND_W, ISLAND_X, ISLAND_Y = 500, 660, 90  # the relief's width and place, on the right


def lines(text, size, width):
    """The line cut into lines that fit `width` at `size` px (DejaVu Sans Bold is about 0.6 em a letter)."""
    per = int(width / (size * 0.6))
    out = [""]
    for word in text.split():
        out[-1:] = [f"{out[-1]} {word}".strip()] if len(f"{out[-1]} {word}".strip()) <= per else [out[-1], word]
    return out


def rubrique_svg(name, line):
    island = json.loads((ROOT / "src/places/island.json").read_text())
    paths = "".join(f'<path d="{p["d"]}"/>' for p in island["paths"])
    s = ISLAND_W / island["w"]
    size = min(96, int(LEFT / (len(name) * 0.66)))
    text = "".join(f'<text x="64" y="{360 + 52 * i}" font-size="42" font-style="italic" font-weight="bold" fill="#ffd400">{t}</text>'
                   for i, t in enumerate(lines(line, 42, LEFT)))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<rect width="{W}" height="{H}" fill="#0c2a2f"/>
<rect y="{H - 14}" width="{W}" height="14" fill="#4cc2b6"/>
<g transform="translate({ISLAND_X} {ISLAND_Y}) scale({s})" fill="none" stroke="#4cc2b6" stroke-width="18" stroke-linejoin="round">{paths}</g>
<g transform="translate(64 56) scale(2.6)"><rect x="-0.6" y="-0.6" width="61.2" height="41.2" rx="2" fill="#ffffff" opacity=".25"/>{FLAG}</g>
<g font-family="DejaVu Sans" fill="#ffffff">
  <text x="64" y="290" font-size="{size}" font-weight="bold">{name}</text>
  {text}
  <text x="64" y="540" font-size="28" fill="#cfe3e0">La Réunion en direct, pour vous et votre IA</text>
  <text x="64" y="590" font-size="30" font-weight="bold" fill="#ffffff">rundata.re</text>
</g>
</svg>'''


def build_rubriques(tmp):
    relief = Path(tmp) / "relief.webp"
    relief.write_bytes(base64.b64decode(json.loads((ROOT / "src/web/relief.json").read_text())["webp"]))
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.iterdir():
        old.unlink()
    manifest = []
    for key, name, line, pages in RUBRIQUES:
        src, png = Path(tmp) / f"{key}.svg", Path(tmp) / f"{key}.png"
        src.write_text(rubrique_svg(name, line))
        subprocess.run(["convert", "-density", "96", "-background", "none", str(src),
                        "(", str(relief), "-resize", f"{ISLAND_W}x", ")", "-geometry", f"+{ISLAND_X}+{ISLAND_Y}", "-composite",
                        "-strip", "-colors", "256", "PNG8:" + str(png)], check=True)
        data = png.read_bytes()
        file = f"{key}.{hashlib.sha256(data).hexdigest()[:10]}.png"
        (OUT / file).write_bytes(data)
        manifest.append({"pages": pages, "png": f"/og/{file}", "alt": f"Drapeau de La Réunion et relief de l'île : {name}, {line[0].lower()}{line[1:]}"})
        print(OUT / file, f"{len(data) // 1024} KB PNG")
    (ROOT / "src/web/og-rubriques.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")


def main():
    with tempfile.TemporaryDirectory() as tmp:
        build_rubriques(tmp)
        src, png = Path(tmp) / "og.svg", Path(tmp) / "og.png"
        src.write_text(svg())
        subprocess.run(["convert", "-density", "96", "-background", "none", str(src),
                        "-strip", "-colors", "256", "PNG8:" + str(png)], check=True)
        data = png.read_bytes()
        out = ROOT / "src/web/og.json"
        # The page links the picture by its fingerprint: a new picture is a new address, which Facebook and the others
        # fetch again instead of showing the one they keep.
        out.write_text(json.dumps({"v": hashlib.sha256(data).hexdigest()[:8], "png": base64.b64encode(data).decode()}))
        print(out, f"{len(data) // 1024} KB PNG")


if __name__ == "__main__":
    main()
