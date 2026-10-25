#!/usr/bin/env python3
"""Build src/maree/constantes.json: the harmonic constants of the tide at the two SHOM tide gauges of La Réunion.

The SHOM's tide predictions are not open data; its gauges' measurements are (REFMAR, Licence Ouverte, citing
« REFMAR. http://dx.doi.org/10.17183/REFMAR#RONIM »). This script fits the classic harmonic model of the tide to the
validated hourly heights of several years, by least squares, with the nodal corrections of Schureman (the 18.6-year
cycle of the Moon's node). The server computes the next high and low waters from these constants (src/maree/calcul.ts,
the same formulas), without a request: a computation of rundata from the measurements, not the SHOM's prediction.

Then it checks the computation against months the fit did not use: the high and low waters the gauge measured (every
10 minutes) against the computed ones, in minutes and centimetres, the heights also as the server corrects them by
the gauge's latest measurements. The check is printed and kept in the file.

Pure Python, no library: python3 -I scripts/build-maree.py [--cache DIR] [--fit-from 2022-07] [--fit-to 2026-06] [--test-from 2026-07] [--test-to 2026-09] [--test 2026-09]
"""
import argparse
from bisect import bisect_left
import json
import math
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "maree" / "constantes.json"
API = "https://services.data.shom.fr/maregraphie/observation/json/"
UA = {"User-Agent": "rundata.re (contact@rundata.re)"}
GAUGES = {"110": "Pointe des Galets (Le Port)", "832": "Sainte-Marie"}
HOURLY = 4  # validated hourly heights
TEN_MIN = 2  # raw heights every 10 minutes, a few days late
CITATION = "REFMAR. http://dx.doi.org/10.17183/REFMAR#RONIM"

# --- Astronomy: the arguments of the constituents ------------------------------------------------------------------
# Mean longitudes of the Moon (s), the Sun (h), the lunar perigee (p), the Moon's node (N) and the solar perigee (p1),
# in degrees, from Julian centuries since J2000; T is the hour angle of the mean Sun, 180° at midnight UTC.
# src/maree/calcul.ts has the same formulas, line for line.

D = math.pi / 180


def astro(t):
    """t: seconds since 1970-01-01 UTC."""
    c = (t / 86400 + 2440587.5 - 2451545.0) / 36525
    hours = t / 3600
    return {
        "T": 180 + 15 * hours,
        "s": 218.3164477 + 481267.88123421 * c,
        "h": 280.46646 + 36000.76983 * c,
        "p": 83.3532465 + 4069.0137287 * c,
        "N": 125.04452 - 1934.136261 * c,
        "p1": 282.94 + 1.7192 * c,
    }


def nodal(N):
    """Schureman's nodal factors f and angles u (degrees) of the base constituents, from the longitude of the node."""
    n = N * D
    i = 5.145 * D  # inclination of the Moon's orbit on the ecliptic
    w = 23.452 * D  # obliquity of the ecliptic
    cos_I = math.cos(w) * math.cos(i) - math.sin(w) * math.sin(i) * math.cos(n)
    I = math.acos(cos_I)
    e1 = math.atan(math.cos(0.5 * (w - i)) / math.cos(0.5 * (w + i)) * math.tan(0.5 * n)) - 0.5 * n
    e2 = math.atan(math.sin(0.5 * (w - i)) / math.sin(0.5 * (w + i)) * math.tan(0.5 * n)) - 0.5 * n
    xi = -(e1 + e2)
    nu = e1 - e2
    nup = math.atan2(math.sin(2 * I) * math.sin(nu), math.sin(2 * I) * math.cos(nu) + 0.3347)
    nupp2 = math.atan2(math.sin(I) ** 2 * math.sin(2 * nu), math.sin(I) ** 2 * math.cos(2 * nu) + 0.0727)
    sI, s2I = math.sin(I), math.sin(2 * I)
    return {
        "Mm": ((2 / 3 - sI ** 2) / 0.5021, 0.0),
        "Mf": (sI ** 2 / 0.1578, -2 * xi / D),
        "O1": (sI * math.cos(I / 2) ** 2 / 0.3800, (2 * xi - nu) / D),
        "J1": (s2I / 0.7214, -nu / D),
        "OO1": (sI * math.sin(I / 2) ** 2 / 0.01640, (-2 * xi - nu) / D),
        "M2": (math.cos(I / 2) ** 4 / 0.9154, (2 * xi - 2 * nu) / D),
        "K1": (math.sqrt(0.8965 * s2I ** 2 + 0.6001 * s2I * math.cos(nu) + 0.1006), -nup / D),
        "K2": (math.sqrt(19.0444 * sI ** 4 + 2.7702 * sI ** 2 * math.cos(2 * nu) + 0.0981), -nupp2 / D),
    }


# name: multipliers of (T, s, h, p, p1), phase in degrees, nodal factors as (base, power).
CONSTITUENTS = [
    ("Sa", (0, 0, 1, 0, 0), 0, ()),
    ("Ssa", (0, 0, 2, 0, 0), 0, ()),
    ("Mm", (0, 1, 0, -1, 0), 0, (("Mm", 1),)),
    ("Mf", (0, 2, 0, 0, 0), 0, (("Mf", 1),)),
    ("2Q1", (1, -4, 1, 2, 0), 90, (("O1", 1),)),
    ("Q1", (1, -3, 1, 1, 0), 90, (("O1", 1),)),
    ("RHO1", (1, -3, 3, -1, 0), 90, (("O1", 1),)),
    ("O1", (1, -2, 1, 0, 0), 90, (("O1", 1),)),
    ("P1", (1, 0, -1, 0, 0), 90, ()),
    ("S1", (1, 0, 0, 0, 0), 180, ()),
    ("K1", (1, 0, 1, 0, 0), -90, (("K1", 1),)),
    ("J1", (1, 1, 1, -1, 0), -90, (("J1", 1),)),
    ("OO1", (1, 2, 1, 0, 0), -90, (("OO1", 1),)),
    ("2N2", (2, -4, 2, 2, 0), 0, (("M2", 1),)),
    ("MU2", (2, -4, 4, 0, 0), 0, (("M2", 1),)),
    ("N2", (2, -3, 2, 1, 0), 0, (("M2", 1),)),
    ("NU2", (2, -3, 4, -1, 0), 0, (("M2", 1),)),
    ("M2", (2, -2, 2, 0, 0), 0, (("M2", 1),)),
    ("L2", (2, -1, 2, -1, 0), 180, (("M2", 1),)),
    ("T2", (2, 0, -1, 0, 1), 0, ()),
    ("S2", (2, 0, 0, 0, 0), 0, ()),
    ("K2", (2, 0, 2, 0, 0), 0, (("K2", 1),)),
    ("MO3", (3, -4, 3, 0, 0), 90, (("M2", 1), ("O1", 1))),
    ("M3", (3, -3, 3, 0, 0), 0, (("M2", 1.5),)),
    ("MK3", (3, -2, 3, 0, 0), -90, (("M2", 1), ("K1", 1))),
    ("MN4", (4, -5, 4, 1, 0), 0, (("M2", 2),)),
    ("M4", (4, -4, 4, 0, 0), 0, (("M2", 2),)),
    ("MS4", (4, -2, 2, 0, 0), 0, (("M2", 1),)),
    ("S4", (4, 0, 0, 0, 0), 0, ()),
    ("M6", (6, -6, 6, 0, 0), 0, (("M2", 3),)),
    ("2MS6", (6, -4, 4, 0, 0), 0, (("M2", 2),)),
]


def arguments(t):
    """(f, V + u in radians) of every constituent at t."""
    a = astro(t)
    nod = nodal(a["N"])
    out = []
    for _, (kT, ks, kh, kp, kp1), phase, factors in CONSTITUENTS:
        v = kT * a["T"] + ks * a["s"] + kh * a["h"] + kp * a["p"] + kp1 * a["p1"] + phase
        f = 1.0
        for base, power in factors:
            fb, ub = nod[base]
            f *= fb ** power
            v += power * ub
        out.append((f, (v % 360) * D))
    return out


# --- Least squares --------------------------------------------------------------------------------------------------

def solve(a, b):
    """Gaussian elimination with partial pivoting."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for k in range(n):
        piv = max(range(k, n), key=lambda r: abs(m[r][k]))
        m[k], m[piv] = m[piv], m[k]
        for r in range(k + 1, n):
            q = m[r][k] / m[k][k]
            if q:
                row, top = m[r], m[k]
                for c in range(k, n + 1):
                    row[c] -= q * top[c]
    x = [0.0] * n
    for k in range(n - 1, -1, -1):
        x[k] = (m[k][n] - sum(m[k][c] * x[c] for c in range(k + 1, n))) / m[k][k]
    return x


def fit(points):
    """points: [(t, h)]. The mean level z0 and, per constituent, amplitude (m) and phase lag (degrees)."""
    n = 1 + 2 * len(CONSTITUENTS)
    ata = [[0.0] * n for _ in range(n)]
    atb = [0.0] * n
    for t, h in points:
        row = [1.0]
        for f, vu in arguments(t):
            row += [f * math.cos(vu), f * math.sin(vu)]
        for i in range(n):
            ri = row[i]
            atb[i] += ri * h
            line = ata[i]
            for j in range(i, n):
                line[j] += ri * row[j]
    for i in range(n):
        for j in range(i):
            ata[i][j] = ata[j][i]
    x = solve(ata, atb)
    consts = []
    for k, (name, *_rest) in enumerate(CONSTITUENTS):
        c, s = x[1 + 2 * k], x[2 + 2 * k]
        consts.append([name, round(math.hypot(c, s), 4), round(math.degrees(math.atan2(s, c)) % 360, 2)])
    return round(x[0], 4), consts


def predict(z0, consts, t):
    """Height at t: z0 + Σ f·H·cos(V + u − g), the same sum as the server's."""
    h = z0
    for (f, vu), (_, amp, g) in zip(arguments(t), consts):
        h += f * amp * math.cos(vu - g * D)
    return h


# --- The data -------------------------------------------------------------------------------------------------------

def months(first, last):
    y, m = first
    while (y, m) <= last:
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def fetch(gauge, source, y, m, cache):
    """One month: the service gives at most about 745 values a request."""
    start = f"{y}-{m:02d}-01T00:00:00Z"
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    end = f"{ny}-{nm:02d}-01T00:00:00Z"
    file = cache / f"{gauge}-{source}-{y}-{m:02d}.json" if cache else None
    if file and file.exists():
        return json.loads(file.read_text())
    url = f"{API}{gauge}?sources={source}&dtStart={start}&dtEnd={end}"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                data = json.load(r)
            break
        except OSError:
            if attempt == 2:
                raise
            time.sleep(5)
    if file:
        file.write_text(json.dumps(data))
    time.sleep(0.5)
    return data


def series(gauge, source, first, last, cache):
    out = {}
    for y, m in months(first, last):
        for d in fetch(gauge, source, y, m, cache).get("data", []):
            t = datetime.strptime(d["timestamp"], "%Y/%m/%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
            if d.get("value") is not None:
                out[t] = d["value"]
    return sorted(out.items())


# --- High and low waters --------------------------------------------------------------------------------------------

def smooth(points, half):
    """Moving mean over ± half seconds."""
    out, lo, hi, total = [], 0, 0, 0.0
    for t, _ in points:
        while hi < len(points) and points[hi][0] <= t + half:
            total += points[hi][1]
            hi += 1
        while points[lo][0] < t - half:
            total -= points[lo][1]
            lo += 1
        out.append((t, total / (hi - lo)))
    return out


def turns(points, span=2.5 * 3600):
    """High and low waters: the highest (lowest) point within ± span, refined by a parabola through its neighbours."""
    out = []
    j0 = 0
    for i, (t, h) in enumerate(points):
        while points[j0][0] < t - span:
            j0 += 1
        if t - points[0][0] < span or points[-1][0] - t < span:
            continue
        j = j0
        hi = lo = True
        while j < len(points) and points[j][0] <= t + span:
            if points[j][1] > h:
                hi = False
            if points[j][1] < h:
                lo = False
            j += 1
        if hi or lo:
            if 0 < i < len(points) - 1:
                (t0, a), (_, b), (_, c) = points[i - 1], points[i], points[i + 1]
                den = a - 2 * b + c
                step = points[i + 1][0] - t
                dt = 0.5 * (a - c) / den * step if den else 0.0
                t = t + dt
            out.append(("pleine_mer" if hi else "basse_mer", t, h))
    # Equal neighbours on a flat top make two: keep the first of each run.
    return [e for k, e in enumerate(out) if k == 0 or out[k - 1][0] != e[0]]


# The server corrects the computed heights by the gap between the gauge's measurement and the computation over the
# last hours (wind, pressure and swell raise or lower the sea for days): the check does the same, with the gap
# measured over 6 hours ending LEAD hours before each high or low water, as an answer gives the next day's.
OFFSET_HOURS = 6
LEAD_HOURS = 12


def check(z0, consts, gauge, first, last, cache):
    """The measured high and low waters of these months against the computed ones."""
    obs = series(gauge, TEN_MIN, first, last, cache)
    if len(obs) < 2000:
        return None
    # The same smoothing (± 30 min) on both, so that the computation is judged by the same rule as the measurement.
    observed = turns(smooth(obs, 1800))
    step = 600
    computed = turns(smooth([(t, predict(z0, consts, t)) for t in range(int(obs[0][0]), int(obs[-1][0]) + 1, step)], 1800))
    times = [t for t, _ in obs]
    resid = [h - predict(z0, consts, t) for t, h in obs]
    dts, dhs, dhc, ranges = [], [], [], []
    for kind, t, h in observed:
        near = [c for c in computed if c[0] == kind and abs(c[1] - t) < 3 * 3600]
        if not near:
            continue
        c = min(near, key=lambda c: abs(c[1] - t))
        end = t - LEAD_HOURS * 3600
        a, b = bisect_left(times, end - OFFSET_HOURS * 3600), bisect_left(times, end)
        if b - a < 20:
            continue
        offset = sum(resid[a:b]) / (b - a)
        dts.append(abs(c[1] - t) / 60)
        dhs.append(abs(c[2] - h) * 100)
        dhc.append(abs(c[2] + offset - h) * 100)
    if not dts:
        return None
    q = lambda xs, p: sorted(xs)[min(len(xs) - 1, int(p * len(xs)))]
    stats = lambda xs: {"mediane": round(q(xs, 0.5), 1), "p90": round(q(xs, 0.9), 1), "max": round(max(xs), 1)}
    return {
        "mois": f"{first[0]}-{first[1]:02d} à {last[0]}-{last[1]:02d}",
        "extremes_mesures": len(observed),
        "apparies": len(dts),
        "ecart_heure_min": stats(dts),
        "ecart_hauteur_cm": stats(dhs),
        "ecart_hauteur_recalee_cm": stats(dhc),
        "part_sous_10_min": round(sum(d <= 10 for d in dts) / len(dts), 2),
        "part_sous_20_min": round(sum(d <= 20 for d in dts) / len(dts), 2),
        "part_sous_5_cm": round(sum(d <= 5 for d in dhs) / len(dhs), 2),
        "part_sous_5_cm_recalee": round(sum(d <= 5 for d in dhc) / len(dhc), 2),
        "residu_rms_cm": round(100 * math.sqrt(sum(r * r for r in resid) / len(resid)), 1),
    }


def ym(s):
    y, m = s.split("-")
    return int(y), int(m)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", type=Path, help="keep the downloaded months in this directory")
    ap.add_argument("--fit-from", default="2022-07", help="first month of the fit")
    ap.add_argument("--fit-to", default="2026-06", help="last month of the fit")
    ap.add_argument("--test-from", default="2026-07", help="first month checked, outside the fit")
    ap.add_argument("--test-to", default="2026-09", help="last month checked")
    args = ap.parse_args()
    if args.cache:
        args.cache.mkdir(parents=True, exist_ok=True)
    first, last = ym(args.fit_from), ym(args.fit_to)
    test_from, test_to = ym(args.test_from), ym(args.test_to)
    assert test_from > last or test_to < first, "the months checked must be outside the fit"
    out = {
        "source": "Marégraphes du SHOM à La Réunion (réseau RONIM), hauteurs horaires validées",
        "citation": CITATION,
        "licence": "Licence Ouverte 2.0 (Etalab)",
        "methode": "analyse harmonique par moindres carrés, corrections nodales de Schureman\u00a0; scripts/build-maree.py",
        "reference": "zéro hydrographique (zéro des cartes marines), en mètres",
        "calcule_le": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "maregraphes": {},
    }
    for gauge, name in GAUGES.items():
        points = series(gauge, HOURLY, first, last, cache=args.cache)
        days = len(points) / 24
        print(f"{name} : {len(points)} heures mesurées ({days:.0f} jours) de {args.fit_from} à {args.fit_to}")
        if days < 365:
            print("  moins d'un an de mesures : laissé de côté")
            continue
        z0, consts = fit(points)
        rms = math.sqrt(sum((h - predict(z0, consts, t)) ** 2 for t, h in points) / len(points))
        print(f"  niveau moyen {z0:.3f} m, résidu {100 * rms:.1f} cm ; " +
              ", ".join(f"{c[0]} {100 * c[1]:.1f} cm" for c in sorted(consts, key=lambda c: -c[1])[:6]))
        verdict = check(z0, consts, gauge, test_from, test_to, args.cache)
        if verdict:
            v = verdict
            print(f"  contrôle sur {v['mois']} (hors ajustement) : {v['apparies']}/{v['extremes_mesures']} pleines et basses mers mesurées")
            print(f"    heure : écart médian {v['ecart_heure_min']['mediane']} min, 90 % sous {v['ecart_heure_min']['p90']} min ; "
                  f"{100 * v['part_sous_10_min']:.0f} % sous 10 min, {100 * v['part_sous_20_min']:.0f} % sous 20 min")
            print(f"    hauteur : écart médian {v['ecart_hauteur_cm']['mediane']} cm ({100 * v['part_sous_5_cm']:.0f} % sous 5 cm) ; "
                  f"recalée sur la mesure des {OFFSET_HOURS} h d'avant, {LEAD_HOURS} h plus tôt : {v['ecart_hauteur_recalee_cm']['mediane']} cm "
                  f"({100 * v['part_sous_5_cm_recalee']:.0f} % sous 5 cm)")
            print(f"    critère 10 min et 5 cm (médianes) : heure {'tenu' if v['ecart_heure_min']['mediane'] <= 10 else 'NON TENU'}, "
                  f"hauteur recalée {'tenue' if v['ecart_hauteur_recalee_cm']['mediane'] <= 5 else 'NON TENUE'}")
        else:
            print(f"  pas assez de mesures de {args.test_from} à {args.test_to} pour le contrôle")
        out["maregraphes"][gauge] = {
            "nom": name,
            "ajuste_sur": {"du": args.fit_from, "au": args.fit_to, "heures": len(points), "residu_rms_cm": round(100 * rms, 1)},
            "z0": z0,
            "constantes": [c for c in consts if c[1] >= 0.0005],
            "controle": verdict,
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"→ {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
