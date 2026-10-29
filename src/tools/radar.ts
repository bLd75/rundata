import type { Cache } from "../cache.js";
import { ageMinutes, localTime } from "../geo.js";
import type { Place } from "../places/resolve.js";
import * as radar from "../providers/radar.js";
import { why } from "../types.js";
import { fr } from "./format.js";

const RADIUS_KM = 3;
// Older than this, the image says nothing about now.
const TOO_OLD_MIN = 45;
// Below this mean quality index the relief hides the place from both radars.
const POOR_QUALITY = 0.5;

/** Usual words for a rain rate (Météo-France's and OPERA's classes, rounded). */
export function intensity(mmh: number): string {
  if (mmh <= 0) return "pas de pluie";
  if (mmh < 1) return "pluie faible";
  if (mmh < 4) return "pluie modérée";
  if (mmh < 8) return "pluie forte";
  return "pluie très forte";
}

/** What the radar says at a place, as a sentence and a block; null when the radar cannot answer. */
export function describe(img: radar.RadarImage, p: Place, now: Date) {
  const at = radar.rainAt(img, p.lon, p.lat, RADIUS_KM);
  const age = ageMinutes(new Date(img.fin), now);
  if (!at || age > TOO_OLD_MIN) return null;
  const doubt = at.qualite != null && at.qualite < POOR_QUALITY;
  const warnings = [
    ...(doubt ? ["Qualité radar faible ici (relief, cirques) : la pluie peut être sous-estimée ou manquée."] : []),
    ...(img.pannes.length ? [`Radar en défaut : ${img.pannes.join(", ")}. Couverture réduite, à prendre avec prudence.`] : []),
  ];
  const here = at.mm_h == null ? "le radar ne voit pas ce point" : at.mm_h > 0 ? `${intensity(at.mm_h)} (${fr(at.mm_h)} mm/h)` : "pas de pluie détectée";
  const around =
    at.max_mm_h && at.max_mm_h > 0 && (at.mm_h ?? 0) === 0
      ? `, mais de la pluie à moins de ${RADIUS_KM} km (jusqu'à ${fr(at.max_mm_h)} mm/h)`
      : "";
  const phrase =
    `Radar Météo-France, image de ${localTime(new Date(img.fin)).split(" ")[1]} : ${here}${around}.` +
    (doubt ? " Le relief cache en partie ce lieu aux radars : une absence de pluie n'y est pas certaine." : "");
  return {
    resume: phrase,
    bloc: {
      nature: "mesure radar (estimation de la pluie, pas un pluviomètre)",
      image: `${localTime(new Date(img.debut))}–${localTime(new Date(img.fin)).split(" ")[1]} heure de La Réunion`,
      age_min: age,
      au_lieu_mm_h: at.mm_h,
      [`max_${RADIUS_KM}km_mm_h`]: at.max_mm_h,
      [`moyenne_${RADIUS_KM}km_mm_h`]: at.moyenne_mm_h,
      [`part_pluie_${RADIUS_KM}km`]: at.part_pluie,
      qualite_radar: at.qualite,
      avertissements: warnings.length ? warnings : undefined,
    },
  };
}

/** Never throws: the radar is a bonus next to the stations. */
export async function radarAt(cache: Cache, p: Place, now = new Date()) {
  if (!radar.enabled()) return null;
  try {
    const img = (await radar.image(cache)).value;
    const said = describe(img, p, now);
    return said;
  } catch (err) {
    console.error(`source ${radar.SOURCE.id} indisponible:`, why(err));
    return null;
  }
}
