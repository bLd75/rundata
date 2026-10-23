#!/usr/bin/env python3
"""Build src/web/font.json: the headings' typeface, served by the site itself at /font/titres.woff2.

Bricolage Grotesque (Mathieu Triay, SIL Open Font License 1.1), from Google Fonts, cut down to the weights 600–800,
the optical sizes 36–96 and the glyphs of French: about 55 KB. Served from rundata.re rather than from Google, so
that the pages make no request elsewhere.

Needs fonttools and brotli: python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli
Usage: /tmp/ft/bin/python -I scripts/build-font.py
"""
import base64
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The variable font, latin subset, as Google Fonts serves it to a current browser.
URL = "https://fonts.gstatic.com/s/bricolagegrotesque/v9/3y9K6as8bTXq_nANBjzKo3IeZx8z6up5BeSl9D4dj_x9PpZBMlGIInE.woff2"
UNICODES = ("U+0020-007E,U+00A0-00FF,U+0152-0153,U+2009,U+2013-2014,U+2019,U+201C-201E,U+2026,U+202F,"
            "U+2192,U+20AC")


def main():
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        src, inst, out = d / "src.woff2", d / "inst.ttf", d / "out.woff2"
        src.write_bytes(urllib.request.urlopen(URL, timeout=60).read())
        py = sys.executable
        subprocess.run([py, "-m", "fontTools.varLib.instancer", str(src), "wght=600:800", "opsz=36:96",
                        "-o", str(inst), "-q"], check=True)
        subprocess.run([py, "-m", "fontTools.subset", str(inst), f"--unicodes={UNICODES}",
                        "--layout-features=kern,liga,calt", "--flavor=woff2", f"--output-file={out}"], check=True)
        data = out.read_bytes()
    target = ROOT / "src" / "web" / "font.json"
    target.write_text(json.dumps({"woff2": base64.b64encode(data).decode()}))
    print(target, f"{len(data) // 1024} KB")


if __name__ == "__main__":
    main()
