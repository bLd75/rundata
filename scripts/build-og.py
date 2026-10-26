#!/usr/bin/env python3
"""Build public/og.png: the 1200×630 PNG shown in link previews (Facebook, WhatsApp, X…), served by Cloudflare before
the Worker, its fingerprint in src/web/og.json. Facebook ignores SVG, hence a PNG.

And one picture per section of the site (RUBRIQUES), so that a link to the hikes and a link to the events do not look
the same. Those go to public/og/, served by Cloudflare beside the Worker like the press visuals, named after their
content; src/web/og-rubriques.json says which pages show which.

And for each section a 4:5 picture (1080×1350, `<key>-4x5.<hash>.png`, `png_4x5` in the manifest) for the posts on
Instagram: the same template, the title above the map; and one of the share picture (`png_4x5` in src/web/og.json).
No page links them in its meta tags.

Drawn on the brand kit's template A (marketing: identite/kit.html, formats « partage » and « rubrique »): the night
gradient of the site's band, Bricolage Grotesque (public/font/titres-1.woff2) and Inter (scripts/og/inter.woff2,
SIL Open Font License 1.1), the lockup of the symbol (public/logo/, scripts/build-icons.py) at the top left, and the
map: the island in relief (public/relief-*.webp on src/places/island.json), in a card for a section, the Piton de la Fournaise
for the volcano (scripts/og/fournaise.webp: relief IGN RGE ALTI, Licence Ouverte 2.0; ramparts, RN 2, Pas de
Bellecombe © OpenStreetMap contributors, ODbL). Each page is an HTML page shot by headless Chrome, then cut to the
exact size and saved on a palette of 256 colours, dithered, by libvips: a third of the size, the gradient unchanged to
the eye. A title or a line too long for its column is set smaller, never cut, and a line breaks only where written (« | »).
Needs libvips (`vips`, Ubuntu package libvips-tools).
Usage: python3 -I scripts/build-og.py
  Chrome is $CHROME, else Playwright's Chromium.
"""
import hashlib
import json
import os
import subprocess
import tempfile
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
W, H = 1200, 630
# The 4:5 picture of a post on Instagram.
W45, H45 = 1080, 1350
CHROME = os.environ.get("CHROME") or str(Path.home() / ".cache/ms-playwright/chromium-1140/chrome-linux/chrome")
# The kit's texts (marketing: identite/kit.md).
ACCROCHE = 'La Réunion <span class="n">974</span><br>en direct'
THEMES = "Sorties · randos · météo · routes"

# Key, name, line, and the pages (with the pages under them) that show the picture; the lockup names the first.
RUBRIQUES = [
    ("meteo", "Météo 974", "Mesurée aux stations,|en direct", ["/meteo"]),
    ("randonnee", "Rando 974", "Sentiers ouverts ou fermés,|traces GPS", ["/randonnees", "/sentiers"]),
    ("evenements", "Sorties 974", "Que faire ce week-end ?", ["/evenements"]),
    ("actualites", "Actu 974", "L'actu de l'île,|commune par commune", ["/actualites"]),
    ("volcan", "Volcan 974", "Piton de la Fournaise|en direct", ["/volcan"]),
    ("mer", "Mer 974", "La mer est à combien ?", ["/mer"]),
    ("bus", "Bus 974", "Prochain bus à votre arrêt", ["/bus"]),
    ("eau", "Eau 974", "Coupures, qualité,|restrictions", ["/eau", "/coupures-eau", "/secheresse"]),
    ("trafic", "Routes 974", "Routes fermées|et déviations", ["/trafic"]),
    ("historique", "Historique 974", "Le temps qu'il a fait|depuis 1900", ["/historique"]),
    ("energie", "Énergie 974", "Recharge et électricité|en direct", ["/bornes", "/velos", "/electricite"]),
    ("communes", "Communes 974", "Votre commune en direct", ["/communes"]),
    ("defibrillateurs", "Défibrillateurs 974", "Le plus proche de vous|et ses horaires", ["/defibrillateurs"]),
    ("calendrier", "Calendrier 974", "Vacances scolaires|et jours fériés", ["/calendrier"]),
    ("cyclones", "Cyclones 974", "Trajectoire et alerte|en direct", ["/cyclones"]),
    ("crues", "Crues 974", "Rivières et vigilance crues", ["/crues"]),
    ("sport", "Sport 974", "Matchs, résultats,|Grand Raid", ["/sport"]),
    ("carburants", "Carburants 974", "Les prix maximum du mois", ["/carburants"]),
    ("feux", "Feux 974", "Les feux de végétation|vus par satellite, 24 h", ["/feux"]),
    ("enfants", "Enfants 974", "Où aller avec les enfants,|de 0 à 17 ans", ["/enfants"]),
    ("associations", "Espace clubs|et associations", "Proposer un événement,|en 2\u00a0minutes.|Gratuit, sans compte.", ["/associations"]),
]
# The volcano's third line, the kit's; the others have two levels.
INFO = {"volcan": "Niveau d'alerte, accès à l'Enclos, séismes"}
# A text in sentences, said as it is written (marketing).
ALT = {"associations": "Symbole rundata.re et relief de l'île\u00a0: Espace clubs et associations. Proposer un événement, en 2 minutes. Gratuit, sans compte."}
OUT = ROOT / "public/og"


def assets(tmp):
    """The fonts, the symbol and the maps, as files beside the pages."""
    files = {
        "bricolage.woff2": (ROOT / "public/font/titres-1.woff2").read_bytes(),
        "inter.woff2": (ROOT / "scripts/og/inter.woff2").read_bytes(),
        "relief.webp": (ROOT / f"public/relief-{json.loads((ROOT / 'src/web/relief.json').read_text())['v']}.webp").read_bytes(),
        "fournaise.webp": (ROOT / "scripts/og/fournaise.webp").read_bytes(),
        "symbole.svg": (ROOT / ("public" + json.loads((ROOT / "src/web/icons.json").read_text())["symbole-svg"])).read_bytes(),
    }
    for name, data in files.items():
        (Path(tmp) / name).write_bytes(data)


def island(h, trait=10):
    """The island in relief on its coast, `h` px high (kit.html, ile())."""
    data = json.loads((ROOT / "src/places/island.json").read_text())
    w = h * data["w"] / data["h"]
    paths = "".join(f'<path d="{p["d"]}"/>' for p in data["paths"])
    return (f'<svg width="{w:.1f}" height="{h}" viewBox="0 0 {data["w"]} {data["h"]}" overflow="visible">'
            f'<g fill="none" stroke="#4fd1c5" stroke-width="{trait}" stroke-linejoin="round">{paths}</g>'
            f'<image href="relief.webp" width="{data["w"]}" height="{data["h"]}"/></svg>')


def lockup(size, page=""):
    """The symbol, then « rundata.re », the page as a suffix (kit.html, marque())."""
    suffix = f'<span class="page">{escape(page)}</span>' if page else ""
    return (f'<div class="marque fit" data-max="540" style="font-size:{size}px;gap:{round(size * .36)}px">'
            f'<img src="symbole.svg" width="{round(size * 1.3)}" height="{round(size * 1.3)}" alt="">'
            f'<span>rundata<span class="tld">.re</span>{suffix}</span></div>')


def page(body, w=W, h=H):
    return f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
@font-face {{ font-family: "Bricolage"; src: url("bricolage.woff2") format("woff2"); font-weight: 600 800; }}
@font-face {{ font-family: "Inter"; src: url("inter.woff2") format("woff2"); font-weight: 400 800; }}
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ width: {w}px; height: {h}px; overflow: hidden; }}
body {{ background: linear-gradient(160deg, #0b1f36 0%, #15406b 100%); color: #f1f5f9; font: 500 26px/1.3 "Inter", sans-serif;
  -webkit-font-smoothing: antialiased; position: relative; }}
.abs {{ position: absolute; }}
.titre {{ font-family: "Bricolage", sans-serif; font-weight: 800; line-height: .94; letter-spacing: -.035em; }}
.n {{ color: #ffcf1f; }}
.slogan {{ font-family: "Bricolage", sans-serif; font-weight: 700; font-style: italic; color: #ffcf1f; letter-spacing: -.01em; }}
.info {{ color: #b4c6d8; font-weight: 500; }}
.marque {{ display: flex; align-items: center; font-family: "Bricolage", sans-serif; font-weight: 800; letter-spacing: -.02em; white-space: nowrap; }}
.marque .tld {{ color: #ffcf1f; }}
.marque .page {{ color: #b4c6d8; font-weight: 700; }}
.fit {{ white-space: nowrap; width: max-content; }}
svg, img {{ display: block; }}
.carte {{ border-radius: 28px; overflow: hidden; background: #0d2236; }}
.ile {{ position: relative; }}
.ile svg {{ position: absolute; inset: 6%; width: 88%; height: 88%; }}
</style></head><body>{body}
<script>
// A title or a line wider than its column (data-max) set smaller until it fits: never cut, never wrapped.
document.fonts.ready.then(() => {{
  for (const e of document.querySelectorAll(".fit")) {{
    let size = parseFloat(getComputedStyle(e).fontSize);
    while (e.scrollWidth > Number(e.dataset.max) && size > 10) e.style.fontSize = `${{--size}}px`;
    for (const img of e.querySelectorAll("img")) img.width = img.height = Math.round(size * 1.3);
    e.dataset.taille = size;
  }}
}});
</script></body></html>'''


def lines(text):
    return "<br>".join(escape(t) for t in text.split("|"))


def partage():
    return page(f'<div class="abs" style="left:668px;top:110px">{island(470)}</div>'
                f'<div class="abs" style="left:72px;top:64px">{lockup(40)}</div>'
                f'<div class="abs" style="left:72px;top:190px"><div class="titre" style="font-size:96px">{ACCROCHE}</div>'
                f'<div class="slogan" style="font-size:40px;margin-top:22px">{escape(json.loads((ROOT / "src/web/brand.json").read_text())["slogan"])}</div>'
                f'<div class="info" style="font-size:24px;margin-top:18px;width:560px">{THEMES}</div></div>')


def rubrique(key, name, line, path):
    carte = ('<div class="carte" style="width:500px;height:502px;background:#0d2236 url(fournaise.webp) 72% 58%/675px auto no-repeat"></div>'
             if key == "volcan" else
             f'<div class="carte" style="width:500px;height:502px;display:grid;place-items:center">{island(392, 8)}</div>')
    # « Météo 974 »: the number in the accent colour; a name without one (« Espace clubs|et associations ») breaks where written.
    head, num = name.rsplit(" ", 1) if name[-1].isdigit() else (name, "")
    info = f'<div class="info fit" data-max="528" style="font-size:24px;margin-top:20px">{escape(INFO[key])}</div>' if key in INFO else ""
    return page(f'<div class="abs" style="left:628px;top:64px">{carte}</div>'
                f'<div class="abs" style="left:72px;top:64px">{lockup(40, path)}</div>'
                f'<div class="abs" style="left:72px;top:206px">'
                f'<div class="titre fit" data-max="528" style="font-size:112px">{lines(head)}{f' <span class="n">{num}</span>' if num else ""}</div>'
                f'<div class="slogan fit" data-max="528" style="font-size:40px;margin-top:24px;font-style:normal">{lines(line)}</div>{info}</div>')


def rubrique_4x5(key, name, line, path):
    """The same, the title and its line above the map, which takes the height left, for a post on Instagram (1080×1350)."""
    carte = ('<div class="carte" style="flex:1;background:#0d2236 url(fournaise.webp) 50% 100%/936px auto no-repeat"></div>'
             if key == "volcan" else
             f'<div class="carte ile" style="flex:1;display:grid;place-items:center">{island(620, 8)}</div>')
    head, num = name.rsplit(" ", 1) if name[-1].isdigit() else (name, "")
    info = f'<div class="info fit" data-max="936" style="font-size:28px;margin-top:20px">{escape(INFO[key])}</div>' if key in INFO else ""
    return colonne(lockup(40, path),
                   f'<div class="titre fit" data-max="936" style="font-size:112px">{lines(head)}{f' <span class="n">{num}</span>' if num else ""}</div>'
                   f'<div class="slogan fit" data-max="936" style="font-size:44px;margin-top:24px;font-style:normal">{lines(line)}</div>{info}', carte)


def partage_4x5():
    """The share picture's title and slogan above the island, for the posts on Instagram that link the home page."""
    return colonne(lockup(40),
                   f'<div class="titre" style="font-size:112px">{ACCROCHE}</div>'
                   f'<div class="slogan fit" data-max="936" style="font-size:44px;margin-top:24px">{escape(json.loads((ROOT / "src/web/brand.json").read_text())["slogan"])}</div>',
                   f'<div class="carte ile" style="flex:1;display:grid;place-items:center">{island(620, 8)}</div>')


def colonne(marque, textes, carte):
    """The 4:5 layout: the lockup, the texts, then the map in the height left, 72 px from the edges."""
    return page(f'<div style="display:flex;flex-direction:column;height:100%;padding:72px">{marque}'
                f'<div style="margin:56px 0 48px">{textes}</div>{carte}</div>', W45, H45)


def shoot(tmp, name, html, w=W, h=H):
    src, raw, png = Path(tmp) / f"{name}.html", Path(tmp) / f"{name}-brut.png", Path(tmp) / f"{name}.png"
    src.write_text(html)
    # The window is taller than the picture: headless Chrome takes its own bar out of the window's height.
    subprocess.run([CHROME, "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
                    f"--user-data-dir={Path(tmp) / 'profil'}", f"--window-size={w},{h + 200}", "--virtual-time-budget=5000",
                    f"--screenshot={raw}", src.as_uri()], check=True, capture_output=True)
    subprocess.run(["vips", "crop", str(raw), f"{png}[palette,Q=100,dither=1,effort=10,strip]", "0", "0", str(w), str(h)], check=True)
    return png.read_bytes()


def main():
    with tempfile.TemporaryDirectory() as tmp:
        assets(tmp)
        OUT.mkdir(parents=True, exist_ok=True)
        for old in OUT.iterdir():
            old.unlink()
        manifest = []
        for key, name, line, pages in RUBRIQUES:
            data = shoot(tmp, key, rubrique(key, name, line, pages[0]))
            file = f"{key}.{hashlib.sha256(data).hexdigest()[:10]}.png"
            (OUT / file).write_bytes(data)
            what = "relief du Piton de la Fournaise" if key == "volcan" else "relief de l'île"
            said = line.replace("|", " ")
            alt = ALT.get(key) or f"Symbole rundata.re et {what}\u00a0: {name}, {said[0].lower()}{said[1:]}"
            tall = shoot(tmp, f"{key}-4x5", rubrique_4x5(key, name, line, pages[0]), W45, H45)
            file_4x5 = f"{key}-4x5.{hashlib.sha256(tall).hexdigest()[:10]}.png"
            (OUT / file_4x5).write_bytes(tall)
            manifest.append({"pages": pages, "png": f"/og/{file}", "png_4x5": f"/og/{file_4x5}", "alt": alt})
            print(OUT / file, f"{len(data) // 1024} KB PNG,", OUT / file_4x5, f"{len(tall) // 1024} KB PNG")
        (ROOT / "src/web/og-rubriques.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
        data = shoot(tmp, "og", partage())
        tall = shoot(tmp, "accueil-4x5", partage_4x5(), W45, H45)
        file_4x5 = f"accueil-4x5.{hashlib.sha256(tall).hexdigest()[:10]}.png"
        (OUT / file_4x5).write_bytes(tall)
        out = ROOT / "src/web/og.json"
        # The page links the picture by its fingerprint: a new picture is a new address, which Facebook and the others
        # fetch again instead of showing the one they keep.
        (ROOT / "public/og.png").write_bytes(data)
        out.write_text(json.dumps({"v": hashlib.sha256(data).hexdigest()[:8], "png_4x5": f"/og/{file_4x5}"}))
        print(ROOT / "public/og.png", f"{len(data) // 1024} KB PNG,", OUT / file_4x5, f"{len(tall) // 1024} KB PNG")


if __name__ == "__main__":
    main()
