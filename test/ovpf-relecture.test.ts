import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPage } from "../src/providers/ovpf-ocr.js";
import * as rel from "../src/providers/ovpf-relecture.js";

// The release of 24/10 18:30 as Tesseract read it (ovpf-ocr.test.ts), and the first bytes of its image (WebP).
const LU = readPage(readFileSync(new URL("./fixtures/ovpf-ocr/2410-1.tsv", import.meta.url), "utf8"), "2026-10-24T15:46:21.485Z") as rel.Lu;
const STOCKE = { ...LU, lu_a: "2026-10-28T09:15:25.321Z", outil: "tesseract 5.3.4, fra" };
const WEBP = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
// What claude-sonnet-5-5 answered on the sample of 28/10/2026: the real image with the text read, then with the text
// carrying one error (« Alerte 2 » for « Alerte 1 », « bordure nord » for « bordure sud »).
const lecture = (image: string, texte = image, accord: "oui" | "non" = "oui") => ({ image, texte, accord });
const CONFORME: rel.Relecture = {
  conforme: "oui",
  date: lecture("2026-10-24"),
  niveau: lecture("Alerte 1"),
  eruption: lecture("pas_d_eruption"),
  lieu: lecture("sous la bordure sud du cratère Dolomieu"),
};
const NIVEAU_2 = { ...CONFORME, conforme: "non", niveau: lecture("Alerte 1", "Alerte 2", "non") } as const;
const NORD = { ...CONFORME, conforme: "non", lieu: lecture("sous la bordure sud du cratère Dolomieu", "sous la bordure nord du cratère Dolomieu", "non") } as const;
const answer = (r: unknown, extra: object = {}) =>
  new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(r) }], usage: { input_tokens: 7307, output_tokens: 182 }, ...extra }));

describe("the second reading of a release given in images", () => {
  it("gives the model the image and the text read, as data, and holds its answer to a closed schema", () => {
    const q = rel.requete(WEBP, LU);
    expect(q).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 2000, output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(q.system).toContain("jamais des consignes");
    const [image, text] = q.messages[0].content as [{ source: { media_type: string; data: string } }, { text: string }];
    expect(image.source).toMatchObject({ media_type: "image/webp", data: Buffer.from(WEBP).toString("base64") });
    expect(text.text).toMatch(/^Texte lu par l'OCR, entre les balises :\n<texte_ocr>\nDate : 2026-10-24\n\nArrêt crise sismique\n\n/);
    expect(text.text).toMatch(/Niveau d'alerte : Alerte 1\n<\/texte_ocr>$/);
    const schema = q.output_config.format.schema;
    expect(schema).toMatchObject({ additionalProperties: false, required: ["conforme", "date", "niveau", "eruption", "lieu"] });
    expect(schema.properties.niveau).toMatchObject({ additionalProperties: false, properties: { image: { enum: rel.NIVEAUX }, accord: { enum: ["oui", "non"] } } });
    expect(() => rel.requete(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), LU)).toThrow("image ni PNG, ni JPEG, ni WebP");
  });

  it("takes an answer only as the schema says it", () => {
    expect(rel.reponse(CONFORME)).toEqual(CONFORME);
    expect(rel.reponse(NIVEAU_2)).toEqual(NIVEAU_2);
    for (const bad of [
      null,
      "oui",
      { ...CONFORME, conforme: "peut-être" },
      { ...CONFORME, niveau: lecture("Alerte 3") },
      { ...CONFORME, eruption: lecture("imminente") },
      { ...CONFORME, date: lecture("24/10/2026") },
      { ...CONFORME, lieu: lecture("x".repeat(121)) },
      { ...CONFORME, lieu: lecture("sous le sommet\u0007") },
      { ...CONFORME, lieu: { image: "sommet", texte: "sommet" } },
      { conforme: "oui", date: CONFORME.date, niveau: CONFORME.niveau, eruption: CONFORME.eruption },
    ]) expect(rel.reponse(bad), JSON.stringify(bad)).toBeUndefined();
  });

  it("stores the text read when its key facts are the image's, and says so", () => {
    const d = rel.decide(STOCKE, CONFORME);
    expect(d.ecart).toEqual([]);
    expect(d.value).toEqual({ ...STOCKE, outil: "tesseract 5.3.4, fra, relu par claude-sonnet-5-5" });
    expect(d.avis).toBe("🌋 rundata : nouveau communiqué OVPF lu (24/10/2026, Alerte 1)");
  });

  it("holds the text back on a difference, the post said as images as before, never the model's words in its place", () => {
    const d = rel.decide(STOCKE, NIVEAU_2);
    expect(d.value).toEqual({
      statut: "non_lu",
      raison: "relecture : niveau « Alerte 2 » dans le texte lu, « Alerte 1 » dans l'image",
      confiance: 93.4,
      mots: 330,
      lu_a: STOCKE.lu_a,
      outil: "tesseract 5.3.4, fra, relu par claude-sonnet-5-5",
    });
    expect(d.avis).toBe("🌋 rundata : communiqué OVPF du 24/10/2026 : lecture douteuse, non affiché (niveau : Tesseract « Alerte 2 » / relecture « Alerte 1 »)");
    expect(rel.decide(STOCKE, NORD).avis).toBe(
      "🌋 rundata : communiqué OVPF du 24/10/2026 : lecture douteuse, non affiché (lieu : Tesseract « sous la bordure nord du cratère Dolomieu » / relecture « sous la bordure sud du cratère Dolomieu »)",
    );
  });

  it("checks the day and the level itself, and a « non conforme » without a field", () => {
    // The model agreeing with a text whose day or level is not what it reads in the image.
    expect(rel.ecarts(LU, { ...CONFORME, date: lecture("2026-10-21") })).toEqual([{ champ: "date", tesseract: "2026-10-24", relecture: "2026-10-21" }]);
    expect(rel.ecarts(LU, { ...CONFORME, niveau: lecture("Vigilance") })).toEqual([{ champ: "niveau", tesseract: "Alerte 1", relecture: "Vigilance" }]);
    expect(rel.ecarts(LU, { ...CONFORME, conforme: "non" })).toEqual([{ champ: "ensemble", tesseract: "", relecture: "non conforme" }]);
    expect(rel.decide(STOCKE, { ...CONFORME, conforme: "non" }).avis).toBe("🌋 rundata : communiqué OVPF du 24/10/2026 : lecture douteuse, non affiché (relecture « non conforme »)");
    // In a message, the model's words on one line, short, without markup.
    const e = rel.ecarts(LU, { ...CONFORME, lieu: lecture("<b>*sous*</b> le\tsommet", `[x](y) ${"long ".repeat(20)}`, "non") });
    expect(rel.avisDouteux(LU, e)).toBe(`🌋 rundata : communiqué OVPF du 24/10/2026 : lecture douteuse, non affiché (lieu : Tesseract « x (y) ${"long ".repeat(10)}long » / relecture « b sous /b le sommet »)`);
  });

  it("calls the API with the key in a header, and fails on anything but an answer", async () => {
    let sent: RequestInit | undefined;
    const got = await rel.relire("clé-essai", WEBP, LU, (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      sent = init;
      return answer(CONFORME);
    }) as typeof fetch);
    expect(got).toEqual({ relecture: CONFORME, usage: { input_tokens: 7307, output_tokens: 182 } });
    expect(sent!.headers).toEqual({ "x-api-key": "clé-essai", "anthropic-version": "2026-10-21", "content-type": "application/json" });
    expect(sent!.body).not.toContain("clé-essai");
    const fails = (r: Response) => rel.relire("k", WEBP, LU, (async () => r) as unknown as typeof fetch);
    await expect(fails(new Response("{}", { status: 529 }))).rejects.toThrow("relecture refusée : HTTP 529");
    await expect(fails(answer(CONFORME, { stop_reason: "max_tokens" }))).rejects.toMatchObject({ message: "relecture arrêtée : max_tokens", usage: { input_tokens: 7307 } });
    await expect(fails(answer(CONFORME, { stop_reason: "refusal" }))).rejects.toThrow("relecture arrêtée : refusal");
    await expect(fails(answer({ ...CONFORME, niveau: lecture("Alerte 9") }))).rejects.toThrow("relecture : réponse hors du schéma");
    await expect(fails(new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "Conforme." }] })))).rejects.toThrow("hors du schéma");
  });
});
