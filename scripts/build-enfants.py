#!/usr/bin/env python3
"""Build src/vie/enfants.json: the places to go with children in La Réunion, bundled with the server.

Three open sources, each for what it knows best:
- OpenStreetMap (ODbL): playgrounds, named parks and gardens, zoos and the aquarium, theme and water parks, game and
  trampoline halls, museums, libraries, the toy library; their hours and the ages they are meant for when mapped
  (min_age / max_age, read as numbers, the bans of adult places left out);
- Data ES, the census of sports equipment (ministry of sports, Licence Ouverte): the swimming pools open to the public
  (one per installation, its pools listed), the skateparks, pumptracks and city-stades in free access for individuals
  and families, the climbing walls open to them; the sites it marks closed or out of service left out;
- Basilic (ministry of culture, Licence Ouverte 2.0): the libraries and media libraries of the 24 communes, the
  mobile ones left out.
The same library mapped in OpenStreetMap and listed in Basilic, or the same pool in OpenStreetMap and Data ES, is
kept once: the closest within 300 m.
Usage: python3 -I scripts/build-enfants.py [--osm overpass.json] [--dataes data-es.json] [--basilic basilic.csv]
"""
import argparse
import csv
import io
import unicodedata
import json
import math
import re
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "reunion-temps-reel (open source MCP server, real-time data for Reunion Island)"}
OVERPASS = "https://overpass-api.de/api/interpreter"
QUERY = """[out:json][timeout:120];area["ISO3166-2"="FR-974"]->.a;(
nwr["leisure"~"^(playground|park|amusement_arcade|trampoline_park|water_park)$"](area.a);
nwr["tourism"~"^(zoo|theme_park|aquarium|museum)$"](area.a);
nwr["amenity"~"^(library|toy_library)$"](area.a););out center tags;"""
DATAES = "https://equipements.sports.gouv.fr/api/explore/v2.1/catalog/datasets/data-es/exports/json?where=dep_code%3D%22974%22"
BASILIC = "https://www.data.gouv.fr/fr/datasets/r/dced78ee-0823-4b61-86e6-57717308d4e4"

# OpenStreetMap's tags → the page's types (src/vie/enfants.ts).
OSM_KIND = {
    ("leisure", "playground"): "aire_de_jeux", ("leisure", "park"): "parc", ("tourism", "zoo"): "animaux",
    ("tourism", "aquarium"): "animaux", ("tourism", "theme_park"): "loisirs", ("leisure", "water_park"): "loisirs",
    ("leisure", "amusement_arcade"): "salle_jeux", ("leisure", "trampoline_park"): "salle_jeux", ("tourism", "museum"): "musee",
    ("amenity", "library"): "mediatheque", ("amenity", "toy_library"): "ludotheque",
}
# Data ES's types → the page's.
ES_SPORT = {"Skatepark", "Pumptrack", "Anneau de Roller", "Multisports/City-stades"}
ES_CLIMB = {"Structure Artificielle d'Escalade", "Salle de blocs artificiels d'escalade"}
CLOSED = re.compile(r"site ferm[ée]|ferm[ée]e? d[ée]finitivement|ferm[ée]e? depuis|hors service|d[ée]moli|d[ée]truit|d[ée]saffect", re.I)
FAMILIES = "Individuel(s),famille(s)"
NOT_PUBLIC_LIBRARY = re.compile(r"universitaire|documentation|librairie|archives|tabac|presse|\bCDI\b|^B\.?C\.?D\b|direction|centre multi", re.I)
# The words every library's name has: two names share another one when they are the same library.
GENERIC = {"bibliotheque", "mediatheque", "municipale", "intercommunale", "departementale", "de", "du", "des", "la", "le", "les", "l", "d", "et", "bedetheque",
           "annexe", "relais", "publique", "ludotheque", "numeritheque", "reseau", "saint", "sainte"}

PLACES = json.loads((ROOT / "src/places/gazetteer.json").read_text())["places"]
LOCALITIES = [p for p in PLACES if p["type"] in ("quartier", "localite", "lieu_dit")]
COMMUNES = {nom for nom, _ in re.findall(r'"([^"]+)": "(974\d\d)"', (ROOT / "src/places/insee.ts").read_text())}
COS = math.cos(math.radians(21.1))


def km(lon0, lat0, lon1, lat1):
    return math.hypot((lon1 - lon0) * COS, lat1 - lat0) * 111.2


def commune_at(lon, lat):
    """The commune of the nearest place of the gazetteer, as src/places/resolve.ts does, and how far it is (km)."""
    best = min(PLACES, key=lambda p: ((p["lon"] - lon) * COS) ** 2 + (p["lat"] - lat) ** 2)
    return best["commune"], km(lon, lat, best["lon"], best["lat"])


def locality(lon, lat, commune):
    """The district or locality the place is in, when one of the gazetteer is within 1.5 km, else None."""
    near = [p for p in LOCALITIES if p["commune"] == commune]
    best = min(near, key=lambda p: km(lon, lat, p["lon"], p["lat"]), default=None)
    return best["nom"] if best and km(lon, lat, best["lon"], best["lat"]) < 1.5 else None


def opened(url, data=None, timeout=300):
    return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=UA), timeout=timeout)


def tidy(s):
    return re.sub(r"\s+", " ", s or "").strip()


def titled(s):
    """« COMPLEXE SPORTIF DES AVIRONS » → « Complexe sportif des Avirons »; a name already in mixed case is kept."""
    s = tidy(s)
    if s != s.upper():
        return s[:1].upper() + s[1:]
    words = s.lower().split(" ")
    small = {"de", "du", "des", "la", "le", "les", "et", "d", "l", "à", "au", "aux", "en", "sur"}
    out = [w if i and w in small else w.capitalize() for i, w in enumerate(words)]
    # The proper nouns after the kind of place keep their capital: « Piscine Municipale De L'Entre-Deux ».
    text = " ".join(out)
    text = re.sub(r"\b(Complexe|Piscine|Stade|Plateau|Centre|Terrain|Gymnase|Salle) (Sportif|Sportive|Municipal|Municipale|Nautique|Polyvalent|Multisports|Noir)\b",
                  lambda m: f"{m.group(1)} {m.group(2).lower()}", text)
    return re.sub(r"(?<=['-])(\w)", lambda m: m.group(1).upper(), text)


def accents(s):
    """Basilic writes « Bibliotheque », « Mediatheque »."""
    return re.sub(r"\bBiblioth[eè]que", "Bibliothèque", re.sub(r"\bM[eé]diath[eè]que", "Médiathèque", s))


def age_number(v):
    """An age as OpenStreetMap gives it (« 3 », « 0.5 », « 3 ans »), or None when it is not one."""
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*(?:ans?)?\s*", v or "")
    return float(m.group(1).replace(",", ".")) if m else None


def ages(t):
    """The ages mapped for a children's place, as {min, max} in years; None when not mapped or not a child's range."""
    lo, hi = age_number(t.get("min_age")), age_number(t.get("max_age"))
    if lo is not None and lo >= 18:  # a ban (bars), not a range
        return None
    if hi is not None and (hi > 17 or (lo is not None and hi < lo)):
        hi = None
    if lo is not None and lo <= 0:
        lo = None
    if lo is None and hi is None:
        return None
    return {k: (int(v) if v == int(v) else v) for k, v in (("min", lo), ("max", hi)) if v is not None}


def osm_places(elements):
    out = []
    for e in elements:
        t = e.get("tags", {})
        kind = next((k for (key, value), k in OSM_KIND.items() if t.get(key) == value), None)
        if not kind or t.get("access") in ("private", "no", "customers") or t.get("disused") == "yes":
            continue
        name = tidy(t.get("name"))
        # An unnamed park is a green patch; an unnamed playground is still a playground. The university libraries and
        # the documentation centres are for students.
        if (not name and kind != "aire_de_jeux") or (kind == "mediatheque" and (NOT_PUBLIC_LIBRARY.search(name) or t.get("fixme"))):
            continue
        if kind == "loisirs" and re.match(r"piscine", name, re.I):  # a municipal pool mapped as a water park
            kind = "piscine"
        lat, lon = (e["lat"], e["lon"]) if e["type"] == "node" else (e["center"]["lat"], e["center"]["lon"])
        commune, far = commune_at(lon, lat)
        if far > 6:
            continue
        p = {"nom": name, "type": kind, "commune": commune, "lon": round(lon, 5), "lat": round(lat, 5), "source": "osm",
             "lien": f"https://www.openstreetmap.org/{e['type']}/{e['id']}"}
        a = ages(t)
        if a:
            p["age"] = a
        if t.get("opening_hours"):
            p["horaires_osm"] = t["opening_hours"]
        if t.get("website") or t.get("contact:website"):
            p["site"] = t.get("website") or t.get("contact:website")
        street = tidy(" ".join(x for x in [t.get("addr:housenumber"), t.get("addr:street")] if x))
        if street:
            p["adresse"] = street
        out.append(p)
    return out


def es_places(records):
    """The pools open to the public, one per installation; the free-access sports and the climbing walls for families."""
    pools, out = {}, []
    for r in records:
        family, name = r["equip_type_famille"], r["equip_type_name"]
        kind = "piscine" if family == "Bassin de natation" else "sport" if name in ES_SPORT else "escalade" if name in ES_CLIMB else None
        if not kind or r.get("inst_hs_bool") == "Oui" or CLOSED.search(f"{r.get('inst_obs') or ''} {r.get('equip_obs') or ''}"):
            continue
        public, free = r["equip_ouv_public_bool"] == "true", r["equip_acc_libre"] == "true"
        families = FAMILIES in (r.get("equip_utilisateur") or "")
        if kind == "piscine" and not (public and families):  # a school's or a club's own pool
            continue
        if kind == "sport" and not (free and families):
            continue
        if kind == "escalade" and not ((public or free) and families):
            continue
        xy = r.get("equip_coordonnees") or {}
        if not xy.get("lon"):
            continue
        commune = r.get("new_name") if r.get("new_name") in COMMUNES else commune_at(xy["lon"], xy["lat"])[0]
        place = {"nom": titled(r["inst_nom"] if kind == "piscine" else r["equip_nom"] or r["inst_nom"]), "type": kind, "commune": commune,
                 "lon": round(xy["lon"], 5), "lat": round(xy["lat"], 5), "source": "data_es",
                 "lien": f"https://equipements.sports.gouv.fr/pages/fiche/?refine.equip_numero={r['equip_numero']}"}
        if tidy(r.get("inst_adresse")):
            place["adresse"] = tidy(r["inst_adresse"])
        if kind == "sport":
            place["detail"] = {"Multisports/City-stades": "City-stade"}.get(name, name)
        if kind == "piscine":
            pool = pools.get(r["inst_numero"])
            if pool:
                pool["detail"].append(name)
                continue
            place["detail"] = [name]
            pools[r["inst_numero"]] = place
        out.append(place)
    for p in pools.values():
        kinds = sorted(set(p["detail"]), key=lambda k: ("ludique" not in k, k))
        p["detail"] = ", ".join(k.replace("Bassin ", "bassin ").replace(" de natation", "") for k in kinds)
        p["detail"] = p["detail"][:1].upper() + p["detail"][1:]
    return out


def basilic_places(text):
    out = []
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        if not r["code_insee"].startswith("974") or r["Type équipement ou lieu"] != "Bibliothèque" or re.search(r"bibliobus|m[ée]diabus", r["Nom"], re.I) or NOT_PUBLIC_LIBRARY.search(r["Nom"]):
            continue
        try:
            lon, lat = float(r["Longitude"]), float(r["Latitude"])
        except ValueError:
            continue
        commune = r["libelle_geographique"] if r["libelle_geographique"] in COMMUNES else commune_at(lon, lat)[0]
        p = {"nom": accents(tidy(r["Nom"])), "type": "mediatheque", "commune": commune, "lon": round(lon, 5), "lat": round(lat, 5), "source": "basilic"}
        if tidy(r["Adresse"]):
            p["adresse"] = tidy(r["Adresse"]).replace("r. ", "rue ").replace("rte ", "route ").replace("av. ", "avenue ").replace("bd ", "boulevard ")
        if tidy(r["Nom_du_Reseau_de_Bibliotheques"]):
            p["reseau"] = accents(tidy(r["Nom_du_Reseau_de_Bibliotheques"]))
        out.append(p)
    return out


def words(name):
    plain = re.sub(r"[^a-z0-9 ]", " ", "".join(c for c in unicodedata.normalize("NFD", name.lower()) if not unicodedata.combining(c)))
    return set(plain.split()) - GENERIC


def same(b, x):
    """Two entries for one place: within 300 m; or in the same commune, a word of their names in common within 4 km
    (Basilic places some libraries a few streets or a district away), or one of them named only by its kind
    (« Bibliothèque municipale ») within 600 m, both within 2 km."""
    d = km(b["lon"], b["lat"], x["lon"], x["lat"])
    if d < 0.3:
        return True
    wb, wx = words(b["nom"]), words(x["nom"])
    return b["commune"] == x["commune"] and ((d < 4 and bool(wb & wx)) or (d < 0.6 and (not wb or not wx)) or (d < 2 and not wb and not wx))


def merge(base, extra, pairs):
    """Folds into `base` each place of `extra` that `base` already has (`same`), for the (base type, extra type)
    `pairs`; adds the rest. The base keeps its name and type; it takes what it lacks."""
    for x in extra:
        # One entry of each source per place: a library named « Médiathèque » does not take in its whole network.
        near = [b for b in base if (b["type"], x["type"]) in pairs and b["source"] != x["source"] and same(b, x) and x["source"] not in [a["source"] for a in b.get("aussi", [])]]
        if not near:
            base.append(x)
            continue
        b = min(near, key=lambda b: km(b["lon"], b["lat"], x["lon"], x["lat"]))
        b.setdefault("aussi", []).append({k: x[k] for k in ("source", "lien") if x.get(k)})
        for k in ("adresse", "reseau", "detail", "horaires_osm", "site", "age"):
            if x.get(k) and not b.get(k):
                b[k] = x[k]
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", help="Overpass's answer to QUERY, saved; else asked")
    ap.add_argument("--dataes", help="Data ES's export for the 974, saved; else downloaded")
    ap.add_argument("--basilic", help="Basilic's national CSV, saved; else downloaded")
    args = ap.parse_args()
    elements = json.loads(Path(args.osm).read_text())["elements"] if args.osm else json.load(opened(OVERPASS, urllib.parse.urlencode({"data": QUERY}).encode()))["elements"]
    records = json.loads(Path(args.dataes).read_text()) if args.dataes else json.load(opened(DATAES))
    text = Path(args.basilic).read_text(encoding="utf-8-sig") if args.basilic else opened(BASILIC, timeout=900).read().decode("utf-8-sig")
    # The pools are Data ES's; the same pool mapped in OpenStreetMap, often as a water park, is folded in.
    places = merge([p for p in es_places(records) if p["type"] == "piscine"], osm_places(elements), {("piscine", "loisirs"), ("piscine", "piscine")})
    places += [p for p in es_places(records) if p["type"] != "piscine"]
    # The libraries are OpenStreetMap's, with their hours; Basilic adds those not mapped and the networks.
    places = merge(places, basilic_places(text), {("mediatheque", "mediatheque")})
    for p in places:
        if not p["nom"]:
            p["quartier"] = locality(p["lon"], p["lat"], p["commune"])
    places.sort(key=lambda p: (p["commune"], p["type"], p["nom"] or "~", p["lat"]))
    dest = ROOT / "src/vie/enfants.json"
    dest.write_text(json.dumps({
        "construit": date.today().isoformat(),
        "sources": "© les contributeurs d'OpenStreetMap (ODbL)\u00a0; Data ES (ministère des Sports) et Basilic (ministère de la Culture), Licence Ouverte",
        "lieux": places,
    }, ensure_ascii=False, separators=(",", ":")) + "\n")
    counts = {}
    for p in places:
        counts[p["type"]] = counts.get(p["type"], 0) + 1
    print(f"{dest.relative_to(ROOT)} : {len(places)} lieux, {dest.stat().st_size // 1024} Ko", counts)


if __name__ == "__main__":
    main()
