import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crop, datasets } from "../src/hdf5.js";
import { resolvePlace } from "../src/places/resolve.js";
import { WINDOW, parse, pixel, rainAt, type RadarImage } from "../src/providers/radar.js";
import { describe as say, intensity } from "../src/tools/radar.js";

// The real lame d'eau of 22/10/2026 05:35–05:40 UTC: almost dry over the island.
const file = readFileSync(new URL("./fixtures/radar_lame_eau.h5", import.meta.url));
const data = () => file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
const NOW = new Date("2026-10-22T05:50:00Z");
const place = (name: string) => resolvePlace(name)!.lieu;

/** The image with `mm5` hundredths of a millimetre in 5 min (×0.12 = mm/h) in a square around a place. */
function withRain(img: RadarImage, name: string, mm5: number, halfSide = 2): RadarImage {
  const p = place(name);
  const { row, col } = pixel(p.lon, p.lat);
  const bin = atob(img.pluie);
  const v = new Uint16Array(new Uint8Array([...bin].map((c) => c.charCodeAt(0))).buffer);
  const width = WINDOW.col1 - WINDOW.col0;
  for (let r = row - halfSide; r <= row + halfSide; r++)
    for (let c = col - halfSide; c <= col + halfSide; c++) v[(r - WINDOW.row0) * width + (c - WINDOW.col0)] = mm5;
  const bytes = new Uint8Array(v.buffer);
  return { ...img, pluie: btoa(String.fromCharCode(...bytes)) };
}

describe("HDF5 reader", () => {
  it("finds the rain and quality grids and their chunks", () => {
    const sets = datasets(data());
    expect(sets.map((d) => [d.chunkRows, d.cols, d.size, d.chunks.length])).toEqual([[222, 2300, 2, 10], [400, 2300, 1, 5]]);
  });

  it("reads a crop identical to h5py's", async () => {
    const rain = await crop(data(), datasets(data())[0], WINDOW.row0, WINDOW.row1, WINDOW.col0, WINDOW.col1);
    expect(rain.length).toBe((WINDOW.row1 - WINDOW.row0) * (WINDOW.col1 - WINDOW.col0));
    expect(Math.max(...rain.filter((v) => v < 65534))).toBe(66);
  });

  it("refuses a file that is not HDF5", () => {
    expect(() => datasets(new TextEncoder().encode("not hdf5 at all, not at all").buffer as ArrayBuffer)).toThrow(/hdf5/);
  });
});

describe("radar lame d'eau", () => {
  it("dates the image and keeps the island", async () => {
    const img = await parse(data());
    expect([img.debut, img.fin, img.pannes]).toEqual(["2026-10-22T05:35:00Z", "2026-10-22T05:40:00Z", []]);
    const at = rainAt(img, place("Saint-Denis").lon, place("Saint-Denis").lat)!;
    expect(at.mm_h).toBe(0);
    expect(at.qualite).toBeGreaterThan(0.8);
  });

  it("says dry, rain here, or rain nearby", async () => {
    const img = await parse(data());
    expect(say(img, place("Saint-Denis"), NOW)!.resume).toBe("Radar Météo-France, image de 09:40 : pas de pluie détectée.");
    // The image's span as kit.md writes one: no space around the dash.
    expect(say(img, place("Saint-Denis"), NOW)!.bloc.image).toBe("22/10 09:35–09:40 heure de La Réunion");
    const wet = say(withRain(img, "Saint-Benoît", 25), place("Saint-Benoît"), NOW)!;
    expect(wet.resume).toContain("pluie modérée (3 mm/h)");
    const near = say(withRain(img, "Saint-Benoît", 100, 1), { ...place("Saint-Benoît"), lon: place("Saint-Benoît").lon + 0.02 }, NOW)!;
    expect(near.resume).toContain("mais de la pluie à moins de 3 km (jusqu'à 12 mm/h)");
  });

  it("warns where the relief hides the place, and keeps quiet on an old image", async () => {
    const img = await parse(data());
    const poor = { ...img, qualite: btoa(String.fromCharCode(...new Uint8Array(new Uint16Array(atob(img.qualite).length / 2).fill(30).buffer))) };
    expect(say(poor, place("Mafate"), NOW)!.resume).toContain("une absence de pluie n'y est pas certaine");
    expect(say(img, place("Saint-Denis"), new Date("2026-10-22T07:00:00Z"))).toBeNull();
  });

  it("names intensities", () => {
    expect([0, 0.5, 2, 6, 20].map(intensity)).toEqual(["pas de pluie", "pluie faible", "pluie modérée", "pluie forte", "pluie très forte"]);
  });
});
