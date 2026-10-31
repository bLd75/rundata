/**
 * The charts of /historique: the last 30 days at the six stations of the island's tour (tools/historique.ts, TOUR),
 * day by day against the 1991-2020 normal. The rain summed since the first day, the maximum and minimum of each day on
 * the band of the normal, the hours of sunshine with the grey days. Drawn on the server (graphe.ts); a missing day is a
 * hole, never a zero. A light script reads a day's values under the mouse or the finger; without it, the charts are read
 * as drawn and the table above gives the figures.
 */
import { GREY_SIGMA } from "../tools/historique.js";
import { fr } from "../tools/format.js";
import type { HistoriqueAnswer } from "./data.js";
import { chart, known } from "./graphe.js";
import { esc } from "./map.js";
import chaud from "../historique/plus-chaud.json" with { type: "json" };

type Row = HistoriqueAnswer["stations"][number];
type Day = NonNullable<Row["jours"]>[number];

const H = 210;
const num = (n: number) => fr(Math.round(n * 10) / 10);
/** « 01/10/2026 » → « 01/10 ». */
const ddmm = (d: string) => d.slice(0, 5);
/** Up from the values to a round top: 10, 20… up to 50, then by 50. */
const top = (v: number) => (v <= 10 ? 10 : v <= 50 ? Math.ceil(v / 10) * 10 : Math.ceil(v / 50) * 50);
/** The values of the series for the script, « 1.2,,3 »: a missing day stays empty. */
const serie = (xs: (number | null | undefined)[]) => xs.map((v) => (v == null ? "" : String(v))).join(",");
const data = (kind: string, days: Day[], series: (number | null | undefined)[][]) =>
  `data-k="${kind}" data-d="${days.map((j) => ddmm(j.date)).join(",")}" data-s="${series.map(serie).join(";")}"`;
/** The last day measured, for what a chart says. */
const lastOf = (days: Day[], has: (j: Day) => boolean) => [...days].reverse().find(has)?.date;

function card(r: Row, unit: string, svg: string, note = ""): string {
  return `<figure class="card"><h3>${esc(r.station)} <small>(${unit})</small></h3>${svg}<p class="ch-v" aria-hidden="true"></p>${note ? `<p class="note nn">${note}</p>` : ""}</figure>`;
}

/** The rain summed since the first day, and the normal summed the same way. */
function rain(r: Row): string {
  const days = r.jours ?? [];
  const norm = r.normale_jour?.pluie_mm;
  if (!days.some((j) => j.pluie_mm != null)) return "";
  let sum = 0;
  const cum = days.map((j) => (j.pluie_mm == null ? null : Math.round((sum += j.pluie_mm) * 10) / 10));
  let ns = 0;
  const ncum = norm ? norm.map((v) => Math.round((ns += v) * 10) / 10) : [];
  const last = cum.reduce<number>((b, v, i) => (v != null ? i : b), -1);
  const said = `Pluie cumulée mesurée par Météo-France à ${r.station} du ${ddmm(days[0].date)} au ${ddmm(days[last].date)}\u00a0: ${num(cum[last]!)} mm mesurés${norm ? `, ${num(ncum[last])} mm pour la normale 1991-2020 à cette date` : ""}.`;
  return card(r, "mm", chart({
    label: said, labels: days.map((j) => ddmm(j.date)), every: 7, h: H, min: 0, max: top(Math.max(...known(cum), ...ncum)),
    lines: [...(norm ? [{ pts: ncum, cls: "ln-no" }] : []), { pts: cum, cls: "ln-p" }],
    data: data("pluie", days, [days.map((j) => j.pluie_mm), cum, ncum]),
  }), norm ? "" : "Pas de normale de la pluie à cette station.");
}

/** The maximum and minimum of each day, on the band between the normal minimum and maximum. */
function temperatures(r: Row): string {
  const days = r.jours ?? [];
  const tx = days.map((j) => j.tmax ?? null), tn = days.map((j) => j.tmin ?? null);
  if (!known(tx).length) return "";
  const n = r.normale_jour;
  const band: [(number | null)[], (number | null)[]] | undefined = n?.tmin && n.tmax ? [n.tmin, n.tmax] : undefined;
  const range = (xs: (number | null)[]) => `de ${num(Math.min(...known(xs)))} à ${num(Math.max(...known(xs)))} °C`;
  const mean = (xs?: number[]) => xs && num(xs.reduce((a, b) => a + b, 0) / xs.length);
  const said = `Températures de chaque jour mesurées par Météo-France à ${r.station} du ${ddmm(days[0].date)} au ${ddmm(lastOf(days, (j) => j.tmax != null)!)}\u00a0: maximales ${range(tx)}, minimales ${range(tn)}` +
    `${band ? `\u00a0; normale 1991-2020\u00a0: maximales ${mean(n!.tmax)} °C, minimales ${mean(n!.tmin)} °C` : ""}.`;
  return card(r, "°C", chart({
    label: said, labels: days.map((j) => ddmm(j.date)), every: 7, h: H, band,
    lines: [{ pts: tx, cls: "ln-t" }, { pts: tn, cls: "ln-n" }],
    data: data("temp", days, [tx, tn, n?.tmax ?? [], n?.tmin ?? []]),
  }), band ? "" : "Pas de normale des températures à cette station.");
}

/** The hours of sunshine of each day, the normal as a dashed line, the grey days dotted under their bar. */
function sunshine(r: Row): string {
  const days = r.jours ?? [];
  const h = days.map((j) => j.soleil_h ?? null);
  if (!known(h).length) return "";
  const norm = r.normale_jour?.soleil_h;
  const grey = days.map((j) => j.soleil_pct != null && j.soleil_pct < GREY_SIGMA);
  const greys = grey.filter(Boolean).length;
  const said = `Heures de soleil de chaque jour mesurées par Météo-France à ${r.station} du ${ddmm(days[0].date)} au ${ddmm(lastOf(days, (j) => j.soleil_h != null)!)}\u00a0: ` +
    `${num(known(h).reduce((a, b) => a + b, 0) / known(h).length)} h par jour en moyenne${norm ? `, normale 1991-2020 ${num(norm.reduce((a, b) => a + b, 0) / norm.length)} h` : ""}\u00a0; ` +
    `${greys} jour${greys > 1 ? "s" : ""} gris.`;
  return card(r, "heures", chart({
    label: said, labels: days.map((j) => ddmm(j.date)), every: 7, h: H, min: 0, max: Math.max(12, Math.ceil(Math.max(...known(h), ...(norm ?? [])))),
    bars: h, barCls: grey.map((g) => (g ? "g" : undefined)), marks: grey,
    lines: norm ? [{ pts: norm, cls: "ln-no" }] : [],
    data: data("soleil", days, [h, days.map((j) => j.soleil_pct), norm ?? []]),
  }), norm ? "" : "Pas de normale du soleil à cette station.");
}

/** « +0,8 °C », « −0,4 °C ». */
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "\u2212" : ""}${fr(Math.abs(Math.round(v * 10) / 10))}\u00a0°C`;

/**
 * « Il fait plus chaud qu'avant ? »: each year's gap to the 1991-2020 normal at Gillot (scripts/build-plus-chaud.py),
 * a bar up for warmer, down for cooler, so that the colour does not say it alone. Drawn twice, 600 wide for a phone and
 * 1600 for the whole column of a wide screen, so that its text keeps about the size of the other charts' (CSS shows one).
 */
export function warmer(): string {
  const ys = chaud.annees as [number, number][];
  const n = ys.length;
  const mean = (xs: [number, number][]) => xs.reduce((s, [, g]) => s + g, 0) / xs.length;
  const first = ys.slice(0, 10), last = ys.slice(-10);
  const hot = ys.reduce((b, v) => (v[1] > b[1] ? v : b));
  const said = `Écart de la température moyenne de chaque année à la normale 1991-2020 (${fr(chaud.normale_c)}\u00a0°C), mesuré par Météo-France à ${chaud.station}, de ${ys[0][0]} à ${ys[n - 1][0]}\u00a0: ` +
    `${signed(mean(first))} en moyenne de ${first[0][0]} à ${first[9][0]}, ${signed(mean(last))} de ${last[0][0]} à ${last[9][0]}\u00a0; année la plus chaude ${hot[0]} (${signed(hot[1])}).`;
  const hi = Math.ceil(Math.max(...ys.map(([, g]) => g)) * 2) / 2, lo = Math.floor(Math.min(...ys.map(([, g]) => g)) * 2) / 2;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  // L and R are those GRAPHES_SCRIPT reads the bar under the finger with (52, and 62 for both).
  const chart = (W: number, H: number, size: string) => {
    const L = 52, R = 10, TOP = 14, B = 40, w = (W - L - R) / n;
    const y = (v: number) => r1(TOP + ((hi - v) * (H - TOP - B)) / (hi - lo));
    const x = (i: number) => r1(L + i * w);
    let s = `<svg class="ch ${size}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(said)}" data-k="ecart" data-d="${ys.map(([a]) => a).join(",")}" data-s="${ys.map(([, g]) => g).join(",")}">`;
    for (let v = lo; v <= hi + 1e-9; v += 0.5) s += `<line class="gr${v === 0 ? " z" : ""}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 7}" text-anchor="end">${v > 0 ? "+" : v < 0 ? "\u2212" : ""}${fr(Math.abs(v))}</text>`;
    s += ys.map(([, g], i) => `<rect class="${g >= 0 ? "up" : "dn"}" x="${r1(x(i) + w * 0.12)}" y="${Math.min(y(g), y(0))}" width="${r1(w * 0.76)}" height="${r1(Math.abs(y(g) - y(0)))}"/>`).join("");
    s += ys.map(([a], i) => (a % 10 ? "" : `<text class="ax" x="${r1(x(i) + w / 2)}" y="${H - 8}" text-anchor="middle">${a}</text>`)).join("");
    return `${s}</svg>`;
  };
  return `<section aria-labelledby="h-g-chaud"><div class="sec-h"><p class="eyebrow">Mesures Météo-France, année par année</p><h2 id="h-g-chaud">Il fait plus chaud qu'avant\u00a0?</h2>
  <p>À ${esc(chaud.station)}, la température moyenne de chaque année depuis ${ys[0][0]}, comparée à la normale 1991-2020 de la station (${fr(chaud.normale_c)}\u00a0°C). De ${first[0][0]} à ${first[9][0]}\u00a0: ${signed(mean(first))} en moyenne. De ${last[0][0]} à ${last[9][0]}\u00a0: ${signed(mean(last))}. Année la plus chaude\u00a0: ${hot[0]}, ${signed(hot[1])}.</p></div>
  <p class="note hg-k"><i class="k k-up"></i>année plus chaude que la normale, barre vers le haut <i class="k k-dn"></i>plus fraîche, vers le bas. En degrés Celsius.</p>
  <figure class="card hg-an">${chart(600, 260, "an-n")}${chart(1600, 380, "an-l")}<p class="ch-v" aria-hidden="true"></p>
  <figcaption class="note">Moyenne des maximales et des minimales de chaque jour, sous abri. Une année compte quand ses douze mois ont au moins 20 jours mesurés. Mesures brutes de la station, sans correction d'un changement d'abri ou d'emplacement. Calcul rundata.re le ${chaud.consulte.split("-").reverse().join("/")}.</figcaption></figure></section>`;
}

/** The three sections of charts, after the table of /historique; empty without the days. */
export function graphes(d: HistoriqueAnswer): string {
  const rows = d.stations.filter((r) => r.jours?.length);
  if (!rows.length) return "";
  const du = d.periode.du.slice(0, 5);
  const section = (id: string, title: string, intro: string, key: string, cards: string[]) =>
    cards.some(Boolean)
      ? `<section aria-labelledby="${id}"><div class="sec-h"><p class="eyebrow">Mesures Météo-France, jour par jour</p><h2 id="${id}">${title}</h2><p>${intro}</p></div>
  <p class="note hg-k">${key}</p>
  <div class="hg">${cards.join("")}</div></section>`
      : "";
  const sun = rows.filter((r) => r.jours!.some((j) => j.soleil_h != null)).length;
  return section("h-g-pluie", "La pluie, en avance ou en retard ?",
    `La pluie tombée depuis le ${du}, additionnée jour après jour à chaque station. Quand la courbe pleine passe sous les pointillés, la station a reçu moins que la normale 1991-2020 à cette date.`,
    `<i class="k k-p"></i>pluie mesurée, cumulée <i class="k k-no"></i>normale 1991-2020, cumulée. En millimètres\u00a0; un jour sans mesure laisse un trou.`,
    rows.map(rain)) +
    section("h-g-temp", "Les températures de chaque jour",
      `La maximale et la minimale de chaque jour depuis le ${du}, sur la bande de la normale 1991-2020 du mois\u00a0: de la minimale à la maximale normales.`,
      `<i class="k k-t"></i>maximale <i class="k k-n"></i>minimale <i class="k k-bd"></i>normale 1991-2020. En degrés Celsius, sous abri.`,
      rows.map(temperatures)) +
    section("h-g-soleil", "Le soleil de chaque jour",
      `Les heures de soleil de chaque jour depuis le ${du}, aux ${sun} stations qui le mesurent, et la normale 1991-2020 en pointillé.`,
      `<i class="k k-s"></i>heures de soleil <i class="k k-no"></i>normale 1991-2020 <i class="k k-g"></i>jour gris\u00a0: moins de ${GREY_SIGMA} % du soleil possible ce jour-là.`,
      rows.map(sunshine)) + warmer();
}

/**
 * Under the mouse or the finger, a chart says the day's values below it and marks the day; nothing is opened or
 * moved. The series are in the chart's `data-s` (graphe.ts, `data`), its days in `data-d`.
 */
export const GRAPHES_SCRIPT = `(()=>{const f=(v)=>v===""||v==null?"—":String(Math.round(+v*10)/10).replace(".",","),` +
  `T={pluie:(s,d0)=>s[0]===""?"pas de mesure":f(s[0])+" mm ce jour, "+f(s[1])+" mm depuis le "+d0+(s[2]?" (normale "+f(s[2])+" mm)":""),` +
  `temp:(s)=>s[0]===""&&s[1]===""?"pas de mesure":"maximale "+f(s[0])+" °C, minimale "+f(s[1])+" °C"+(s[2]?" (normales "+f(s[2])+" et "+f(s[3])+" °C)":""),` +
  `ecart:(s)=>(+s[0]>0?"+":+s[0]<0?"\u2212":"")+f(Math.abs(+s[0]))+" °C par rapport à la normale 1991-2020",soleil:(s)=>s[0]===""?"pas de mesure":f(s[0])+" h de soleil"+(s[1]!==""&&+s[1]<${GREY_SIGMA}?", jour gris":"")+(s[2]?" (normale "+f(s[2])+" h)":"")};` +
  `document.querySelectorAll("svg.ch[data-k]").forEach((g)=>{const d=g.dataset.d.split(","),S=g.dataset.s.split(";").map((x)=>x.split(",")),k=g.dataset.k,o=g.parentNode.querySelector(".ch-v"),` +
  `v=g.viewBox.baseVal,c=document.createElementNS("http://www.w3.org/2000/svg","line");c.setAttribute("class","cur");c.setAttribute("y1","12");c.setAttribute("y2",String(v.height-40));g.appendChild(c);` +
  `const show=(e)=>{const r=g.getBoundingClientRect(),X=(e.clientX-r.left)*v.width/r.width,w=(v.width-62)/d.length,i=Math.floor((X-52)/w);if(i<0||i>=d.length)return;` +
  `const x=String(52+(i+.5)*w);c.setAttribute("x1",x);c.setAttribute("x2",x);c.style.display="inline";o.textContent=d[i]+"\\u00a0: "+T[k](S.map((z)=>z[i]??""),d[0])};` +
  `g.addEventListener("pointermove",show);g.addEventListener("pointerdown",show);g.addEventListener("pointerleave",(e)=>{if(e.pointerType==="mouse"){c.style.display="none";o.textContent=""}})})})();`;
