import { describe, expect, it } from "vitest";
import { Cache, MemoryStore } from "../src/cache.js";
import { callDeadline, noteLecture, withLectures } from "../src/lectures.js";
import { fraicheur } from "../src/tools/fraicheur.js";
import { refresh } from "../src/tools/resume.js";
import { cite } from "../src/tools/citer.js";
import { defibrillateurs } from "../src/tools/dae.js";
import { sitesSansReponse } from "../src/tools/sans-reponse.js";

const t = (iso: string) => Date.parse(`${iso}+04:00`);

describe("the time an answer says it read its data", () => {
  it("is the time of what it serves up to date, a last copy keeping its own in the warning", () => {
    // evenements at 02:16 on 31/10/2026: the events read at 01:17, the halls' programmes kept from 23:57.
    const now = new Date(t("2026-10-31T02:16:00"));
    const events = { key: "agenda", fetchedAt: t("2026-10-31T01:17:00"), stale: false, freshSeconds: 3600 };
    const halls = { key: "agenda:salles", fetchedAt: t("2026-10-30T23:57:00"), stale: true, freshSeconds: 3600, source: "salles" };
    const f = fraicheur({}, [events, halls], now, { nom: () => "Programmes des salles" });
    expect(f.lue_a).toBe("31/10 01:17");
    expect(f.age).toBe("il y a 59 min");
    expect(f.copies_de_secours).toEqual([{ source: "Programmes des salles", lue_le: "30/10 23:57" }]);
    expect(f.avertissement).toContain("date de notre lecture du 30/10 à 23:57");
    // Every part a copy: the oldest of them, as before.
    expect(fraicheur({}, [halls], now, { nom: () => "Programmes des salles" }).lue_a).toBe("30/10 23:57");
  });

  it("dates an answer of many dated parts by the newest of them, never older than one of its parts", () => {
    // resume_du_jour at Bras-Panon, 31/10/2026 07:10: the weather read again at 07:06 for the call, the calendar's copy of
    // 06:25. It said « lue à 06:25, il y a 45 min » over a measurement of 07:00.
    const now = new Date(t("2026-10-31T07:10:00"));
    const meteo = { key: "web:lieu:bras-panon", fetchedAt: t("2026-10-31T07:06:00"), stale: false, freshSeconds: 300 };
    const calendrier = { key: "web:calendrier", fetchedAt: t("2026-10-31T06:25:00"), stale: false, freshSeconds: 300 };
    const f = fraicheur({}, [calendrier, meteo], now, { donnee: false });
    expect(f.lue_a).toBe("31/10 07:06");
    expect(f.age).toBe("il y a 4 min");
    expect(f.donnee_du).toBeUndefined();
    // An answer about one datum keeps the oldest of what it serves up to date.
    expect(fraicheur({}, [calendrier, meteo], now).lue_a).toBe("31/10 06:25");
  });

  it("never includes what a copy brought up to date after the answer reads", async () => {
    const cache = new Cache(new MemoryStore(), () => t("2026-10-31T02:04:00"));
    const pending: Promise<unknown>[] = [];
    let deadline: number | undefined = 0;
    const { lectures } = await withLectures(async () => {
      noteLecture({ key: "web:electricite", fetchedAt: t("2026-10-31T01:45:00"), stale: false, freshSeconds: 300 });
      refresh(cache, [{ key: "web:lieu:le-tampon", age: 21 * 3600_000, build: async () => {
        deadline = callDeadline();
        // A collector's copy read for the build, with its own old time (cache.getCopy, islandRead).
        noteLecture({ key: "crues:hauteur:all", fetchedAt: t("2026-10-30T04:58:00"), stale: false, freshSeconds: 3600 });
        return {};
      } }], (p) => pending.push(p), 0);
      await Promise.all(pending);
    }, 4000);
    expect(pending).toHaveLength(1);
    expect(lectures.map((l) => l.key)).toEqual(["web:electricite"]);
    // Nor is it cut by the answer's time: it ends after the answer, waiting for its sources.
    expect(deadline).toBeUndefined();
  });

  it("writes the data's date one way for every tool, the time zone said once beside it", () => {
    const now = new Date(t("2026-10-31T02:16:00"));
    const du = (p: Record<string, unknown>) => fraicheur(p, [], now).donnee_du;
    // vigilance_meteo and electricite, meteo_actuelle, coupures_eau, qualite_eau, as they wrote it on 31/10/2026.
    expect(du({ vigilance: { emise: "30/10 17:07 heure de La Réunion" } })).toBe("30/10 17:07");
    expect(du({ stations: [{ heure_mesure: "31/10 01:48" }] })).toBe("31/10 01:48");
    expect(du({ avis: [{ publie_le: "30/10/2026 à 16:39" }] })).toBe("30/10 16:39");
    expect(du({ avis: [{ publie_le: "30/10/2026" }] })).toBe("30/10/2026");
    expect(du({ analyses: { derniere_analyse: "26/08/2026" } })).toBe("26/08/2026");
    expect(du({ evenement: { publie_le: "vendredi 23/10 à 10:00" } })).toBe("23/10 10:00");
    expect(fraicheur({ vigilance: { emise: "30/10 17:07 heure de La Réunion" } }, [], now).fuseau).toBe("heure de La Réunion (UTC+4)");
  });

  it("dates a list rebuilt from its file, and a daily check, by their own date, not by the call", async () => {
    const now = new Date(t("2026-10-31T02:04:00"));
    const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
    // Géo'DAE's list, rebuilt on 24/10/2026: it said « à l'instant ».
    const dae = body(cite("defibrillateurs", defibrillateurs("Saint-Denis"), { lectures: [], now })).fraicheur;
    expect(dae).toMatchObject({ donnee_du: "24/10/2026", lue_a: "31/10 02:04", age: "il y a 7 jours" });
    // The day's check of the silent sites, run at 02:50 the day before: « il y a 5 min » was the copy's age.
    const store = new MemoryStore();
    await store.put("sans-reponse", { value: { lignes: [], passage: t("2026-10-30T02:50:00") / 1000 }, fetchedAt: t("2026-10-31T01:59:00") });
    const cache = new Cache(store, () => now.getTime());
    const { value, lectures } = await withLectures(() => sitesSansReponse(cache, undefined, now));
    const answer = body(cite("sites_sans_reponse", value, { lectures, now }));
    expect(answer.derniere_verification).toBe("30/10 à 02:50");
    expect(answer.fraicheur).toMatchObject({ donnee_du: "30/10 02:50", age: "il y a 23 h" });
  });
});
