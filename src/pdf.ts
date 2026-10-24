/**
 * Reads the text of a PDF, line by line, with the fill colour of each piece of text, as far as the OVPF's releases
 * need: the PDF a Mac prints (« macOS Quartz PDFContext »), with a classic cross-reference table, no object streams, no
 * encryption, Flate streams, and TrueType subsets whose codes are read through their ToUnicode map only. Anything else
 * is refused rather than guessed. Only the pages' contents and the ToUnicode maps are inflated, through the platform's
 * DecompressionStream like zip.ts; the images and the fonts themselves are never read.
 */

export interface Run {
  text: string;
  /** Fill colour, 0 to 1 per channel. */
  rgb: [number, number, number];
  x: number;
}

export interface Line {
  /** 1 for the first page. */
  page: number;
  /** Height on the page, in points from the bottom. */
  y: number;
  runs: Run[];
  /** The runs joined, spaces collapsed. */
  text: string;
}

// Bounds of what a release can be: a few pages of text and figures.
const MAX_BYTES = 4_000_000;
const MAX_CONTENT = 1_000_000;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

const fail = (why: string): never => {
  throw new Error(`pdf : ${why}`);
};

// One character per byte. By pieces of 8 KB: the spread of larger arrays costs ten times more.
function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192) as unknown as number[]);
  return s;
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return latin1(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/** The value of `/key` in a dictionary's text: a reference « 12 0 R », a nested << … >> or [ … ], or a single token. */
function value(dict: string, key: string): string | undefined {
  const m = new RegExp(`/${key}(?=[\\s/<\\[(])\\s*`).exec(dict);
  if (!m) return undefined;
  const at = m.index + m[0].length;
  const ref = /^(\d+)\s+\d+\s+R\b/.exec(dict.slice(at, at + 24));
  if (ref) return ref[0];
  const open = dict.startsWith("<<", at) ? "<<" : dict[at] === "[" ? "[" : undefined;
  if (!open) return /^\/?[^\s/<>[\]()]*/.exec(dict.slice(at))![0];
  const close = open === "<<" ? ">>" : "]";
  let depth = 0;
  for (let i = at; i < dict.length; i++) {
    if (dict.startsWith(open, i)) {
      depth++;
      i += open.length - 1;
    } else if (dict.startsWith(close, i)) {
      depth--;
      i += close.length - 1;
      if (!depth) return dict.slice(at, i + 1);
    } else if (dict[i] === "(") {
      // A string may hold brackets: skip it whole.
      for (let n = 0; i < dict.length; i++) {
        if (dict[i] === "\\") i++;
        else if (dict[i] === "(") n++;
        else if (dict[i] === ")" && !--n) break;
      }
    }
  }
  return fail(`dictionnaire illisible (/${key})`);
}

const refOf = (v: string | undefined) => (v && /^(\d+)\s+\d+\s+R$/.exec(v) ? Number(v.split(/\s+/)[0]) : undefined);

// The file is never turned into text whole: only its tail, its cross-reference tables and the dictionaries asked for.
class Pdf {
  private readonly offsets = new Map<number, number>();
  readonly trailer: string;

  constructor(private readonly bytes: Uint8Array<ArrayBuffer>) {
    const tail = this.text(Math.max(0, bytes.length - 1024), 1024);
    let at = Number(/startxref\s+(\d+)\s*%%EOF\s*$/.exec(tail)?.[1] ?? fail("pas de startxref"));
    let trailer: string | undefined;
    for (let n = 0; n < 16 && at > 0; n++) {
      if (this.text(at, 4) !== "xref") fail("table xref absente (flux de références non lu)");
      const end = this.find("trailer", at, 4_000_000);
      const table = this.text(at + 4, end - at - 4).trim().split(/\r\n|\r|\n/);
      for (let i = 0; i < table.length; ) {
        const [first, count] = table[i++].trim().split(/\s+/).map(Number);
        if (!Number.isInteger(first) || !Number.isInteger(count) || i + count > table.length) fail("table xref illisible");
        for (let k = 0; k < count; k++, i++) {
          const [off, , kind] = table[i].trim().split(/\s+/);
          // An earlier table (/Prev) never overrides a later one.
          if (kind === "n" && !this.offsets.has(first + k)) this.offsets.set(first + k, Number(off));
        }
      }
      const t = this.text(end, Math.min(2048, bytes.length - end));
      trailer ??= t;
      at = Number(value(t, "Prev") ?? 0);
    }
    this.trailer = trailer ?? fail("pas de trailer");
    if (value(this.trailer, "Encrypt")) fail("chiffré");
  }

  /** `length` bytes from `at`, one character each. */
  private text(at: number, length: number): string {
    return latin1(this.bytes.subarray(at, at + length));
  }

  /** Where `word` starts, from `from` and within `limit` bytes; fails when it is not there. */
  private find(word: string, from: number, limit: number): number {
    const b = this.bytes;
    const first = word.charCodeAt(0);
    const stop = Math.min(b.length - word.length, from + limit);
    for (let i = from; i <= stop; i++) {
      if (b[i] !== first) continue;
      let k = 1;
      while (k < word.length && b[i + k] === word.charCodeAt(k)) k++;
      if (k === word.length) return i;
    }
    return fail(`« ${word} » introuvable`);
  }

  /** Where the first « stream » or « endobj » is, from `from` and within `limit` bytes. */
  private end(from: number, limit: number): number | undefined {
    const b = this.bytes;
    const stop = Math.min(b.length - 6, from + limit);
    for (let i = from; i <= stop; i++) {
      const c = b[i];
      if (c === 0x73 && b[i + 1] === 0x74 && b[i + 2] === 0x72 && b[i + 3] === 0x65 && b[i + 4] === 0x61 && b[i + 5] === 0x6d) return i; // stream
      if (c === 0x65 && b[i + 1] === 0x6e && b[i + 2] === 0x64 && b[i + 3] === 0x6f && b[i + 4] === 0x62 && b[i + 5] === 0x6a) return i; // endobj
    }
    return undefined;
  }

  /** An object's dictionary (or plain value) text, without its stream, and where its stream would start. */
  private object(n: number): { dict: string; end: number } {
    const at = this.offsets.get(n) ?? fail(`objet ${n} absent`);
    const head = /^\s*(\d+)\s+\d+\s+obj\b/.exec(this.text(at, 32));
    if (!head || Number(head[1]) !== n) fail(`objet ${n} mal placé`);
    const from = at + head![0].length;
    // The dictionary ends where its stream or the object does; neither word is found inside a dictionary's text.
    const end = this.end(from, 65_536) ?? fail(`objet ${n} sans fin`);
    return { dict: this.text(from, end - from).trim(), end };
  }

  dict(n: number): string {
    return this.object(n).dict;
  }

  /** An object's stream, inflated when it is Flate, as latin-1 text. */
  async stream(n: number): Promise<string> {
    const { dict, end } = this.object(n);
    if (this.text(end, 6) !== "stream") fail(`objet ${n} sans flux`);
    const start = end + (this.text(end, 8) === "stream\r\n" ? 8 : 7);
    const lv = value(dict, "Length");
    const length = refOf(lv) !== undefined ? Number(this.dict(refOf(lv)!)) : Number(lv);
    if (!Number.isInteger(length) || length < 0 || start + length > this.bytes.length) fail(`longueur du flux ${n} illisible`);
    const raw = this.bytes.slice(start, start + length);
    const filter = value(dict, "Filter");
    if (!filter) return latin1(raw);
    if (!/^(\/FlateDecode|\[\s*\/FlateDecode\s*\])$/.test(filter) || value(dict, "DecodeParms")) fail(`filtre ${filter} non lu`);
    return inflate(raw);
  }

  /** A value that may be given inline or as a reference: its text. */
  resolve(v: string | undefined): string | undefined {
    const r = refOf(v);
    return r === undefined ? v : this.dict(r);
  }

  /** The pages in order, each with its resources (inherited from the tree when not its own). */
  pages(): { dict: string; resources: string }[] {
    const root = this.dict(refOf(value(this.trailer, "Root")) ?? fail("pas de /Root"));
    const out: { dict: string; resources: string }[] = [];
    const walk = (n: number, inherited: string | undefined, depth: number) => {
      if (depth > 16) fail("arbre des pages trop profond");
      const d = this.dict(n);
      const resources = this.resolve(value(d, "Resources")) ?? inherited;
      if (/\/Type\s*\/Pages\b/.test(d)) {
        for (const kid of (value(d, "Kids") ?? "").matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(kid[1]), resources, depth + 1);
      } else if (/\/Type\s*\/Page\b/.test(d)) out.push({ dict: d, resources: resources ?? fail("page sans ressources") });
    };
    walk(refOf(value(root, "Pages")) ?? fail("pas de /Pages"), undefined, 0);
    return out;
  }
}

interface Font {
  bytes: number;
  map: Map<number, string>;
}

const utf16 = (hex: string) => {
  let s = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return s;
};

/** A ToUnicode CMap: codes of one or two bytes, bfchar and bfrange (both forms). */
export function toUnicode(cmap: string): Font {
  const space = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(cmap);
  const bytes = space ? space[1].length / 2 : 1;
  if (bytes !== 1 && bytes !== 2) fail(`codes de ${bytes} octets`);
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(code, 16), utf16(dst));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, dst, list] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const a = parseInt(lo, 16);
      const z = parseInt(hi, 16);
      if (z - a > 0xffff) fail("bfrange trop large");
      if (list !== undefined) {
        [...list.matchAll(/<([0-9a-fA-F]*)>/g)].forEach((m, i) => map.set(a + i, utf16(m[1])));
      } else {
        const base = parseInt(dst!.slice(-4), 16);
        const prefix = utf16(dst!.slice(0, -4));
        for (let c = a; c <= z; c++) map.set(c, prefix + String.fromCharCode(base + c - a));
      }
    }
  }
  return { bytes, map };
}

type Token = number | string | { s: string } | Token[];

/** The tokens of a content stream, operators as plain strings, names with their « / », strings as { s }. */
function* tokens(src: string): Generator<Token | "<<" | ">>" | "[" | "]"> {
  const n = src.length;
  for (let i = 0; i < n; ) {
    const c = src[i];
    if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0") {
      i++;
    } else if (c === "%") {
      while (i < n && src[i] !== "\n" && src[i] !== "\r") i++;
    } else if (c === "(") {
      let s = "";
      let depth = 1;
      for (i++; i < n; i++) {
        const d = src[i];
        if (d === "\\") {
          const e = src[++i];
          if (e >= "0" && e <= "7") {
            let k = 0;
            let v = 0;
            while (k < 3 && src[i] >= "0" && src[i] <= "7") v = v * 8 + Number(src[i++]), k++;
            i--;
            s += String.fromCharCode(v & 0xff);
          } else if (e === "\r") {
            if (src[i + 1] === "\n") i++;
          } else if (e !== "\n") {
            s += ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[e] ?? e;
          }
        } else if (d === "(") {
          depth++;
          s += d;
        } else if (d === ")") {
          if (!--depth) break;
          s += d;
        } else s += d;
      }
      i++;
      yield { s };
    } else if (c === "<" && src[i + 1] === "<") {
      i += 2;
      yield "<<";
    } else if (c === ">" && src[i + 1] === ">") {
      i += 2;
      yield ">>";
    } else if (c === "<") {
      const end = src.indexOf(">", i);
      if (end < 0) fail("chaîne hexadécimale ouverte");
      const hex = src.slice(i + 1, end).replace(/\s+/g, "");
      let s = "";
      for (let k = 0; k < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16));
      i = end + 1;
      yield { s };
    } else if (c === "[" || c === "]") {
      i++;
      yield c;
    } else {
      let j = i + 1;
      while (j < n && !" \n\r\t\f\0()<>[]{}/%".includes(src[j])) j++;
      if (c === "/") {
        yield src.slice(i, j);
      } else {
        const word = src.slice(i, j);
        const num = Number(word);
        yield /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) && Number.isFinite(num) ? num : word;
      }
      // An inline image: its data up to « EI », skipped.
      if (src.slice(i, j) === "ID") {
        const ei = src.slice(j).search(/\sEI(?=[\s]|$)/);
        if (ei < 0) fail("image en ligne sans EI");
        j += ei + 3;
      }
      i = j;
    }
  }
}

const OPERATORS = new Set(["q", "Q", "cm", "rg", "g", "k", "sc", "scn", "BT", "ET", "Tf", "Tm", "Td", "TD", "T*", "TL", "Tj", "TJ", "'", '"']);

async function pageRuns(pdf: Pdf, page: { dict: string; resources: string }): Promise<{ text: string; rgb: Run["rgb"]; x: number; y: number }[]> {
  const fonts = new Map<string, Font>();
  for (const [, name, ref] of (pdf.resolve(value(page.resources, "Font")) ?? "").matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const f = pdf.dict(Number(ref));
    const tu = refOf(value(f, "ToUnicode"));
    // A font without its map: its codes cannot be read, the page is refused.
    if (tu === undefined) fail(`police ${name} sans ToUnicode`);
    fonts.set(name, toUnicode(await pdf.stream(tu!)));
  }
  const contents = value(page.dict, "Contents") ?? "";
  let src = "";
  for (const [, ref] of contents.matchAll(/(\d+)\s+\d+\s+R/g)) {
    src += `${await pdf.stream(Number(ref))}\n`;
    if (src.length > MAX_CONTENT) fail("contenu de page trop long");
  }

  const out: { text: string; rgb: Run["rgb"]; x: number; y: number }[] = [];
  const stack: { ctm: Matrix; rgb: Run["rgb"] }[] = [];
  let ctm = IDENTITY;
  let rgb: Run["rgb"] = [0, 0, 0];
  let tm = IDENTITY;
  let tlm = IDENTITY;
  let leading = 0;
  let font: Font | undefined;
  const decode = (s: string) => {
    if (!font) return fail("texte sans police");
    let t = "";
    for (let i = 0; i + font.bytes <= s.length; i += font.bytes) {
      const code = font.bytes === 1 ? s.charCodeAt(i) : (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1);
      t += font.map.get(code) ?? "�";
    }
    return t;
  };
  const show = (text: string) => {
    const m = mul(tm, ctm);
    if (text) out.push({ text, rgb, x: m[4], y: m[5] });
  };
  const move = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };
  let ops: Token[] = [];
  const arrays: Token[][] = [];
  for (const t of tokens(src)) {
    if (t === "[") arrays.push([]);
    else if (t === "]") {
      const a = arrays.pop() ?? fail("tableau fermé sans ouverture");
      (arrays.length ? arrays[arrays.length - 1] : ops).push(a!);
    } else if (arrays.length) arrays[arrays.length - 1].push(t as Token);
    else if (t === "<<" || t === ">>" || typeof t !== "string" || t.startsWith("/")) ops.push(t as Token);
    else {
      const nums = ops.filter((o): o is number => typeof o === "number");
      if (OPERATORS.has(t)) {
        switch (t) {
          case "q":
            stack.push({ ctm, rgb });
            break;
          case "Q":
            ({ ctm, rgb } = stack.pop() ?? { ctm, rgb });
            break;
          case "cm":
            if (nums.length === 6) ctm = mul(nums as Matrix, ctm);
            break;
          case "rg":
          case "sc":
          case "scn":
            if (nums.length === 3) rgb = [nums[0], nums[1], nums[2]];
            else if (nums.length === 1) rgb = [nums[0], nums[0], nums[0]];
            else if (nums.length === 4) rgb = [(1 - nums[0]) * (1 - nums[3]), (1 - nums[1]) * (1 - nums[3]), (1 - nums[2]) * (1 - nums[3])];
            break;
          case "g":
            rgb = [nums[0], nums[0], nums[0]];
            break;
          case "k":
            rgb = [(1 - nums[0]) * (1 - nums[3]), (1 - nums[1]) * (1 - nums[3]), (1 - nums[2]) * (1 - nums[3])];
            break;
          case "BT":
            tm = tlm = IDENTITY;
            break;
          case "Tf":
            font = fonts.get(String(ops[0]).slice(1));
            if (!font) fail(`police ${String(ops[0])} absente des ressources`);
            break;
          case "Tm":
            if (nums.length === 6) tm = tlm = nums as Matrix;
            break;
          case "Td":
            move(nums[0], nums[1]);
            break;
          case "TD":
            leading = -nums[1];
            move(nums[0], nums[1]);
            break;
          case "TL":
            leading = nums[0];
            break;
          case "T*":
            move(0, -leading);
            break;
          case "Tj":
            show(decode((ops[0] as { s: string }).s));
            break;
          case "'":
          case '"':
            move(0, -leading);
            show(decode((ops[ops.length - 1] as { s: string }).s));
            break;
          case "TJ": {
            let text = "";
            for (const part of ops[0] as Token[]) {
              if (typeof part === "number") {
                // A wide gap in the text is a space that the PDF did not write.
                if (part <= -250 && text && !text.endsWith(" ")) text += " ";
              } else text += decode((part as { s: string }).s);
            }
            show(text);
            break;
          }
        }
      }
      ops = [];
    }
  }
  return out;
}

/** The PDF's lines, page by page from the top, each with its runs from the left. Throws on what it cannot read. */
export async function pdfLines(data: ArrayBuffer): Promise<Line[]> {
  if (data.byteLength > MAX_BYTES) fail("trop gros");
  const bytes = new Uint8Array(data);
  if (latin1(bytes.subarray(0, 5)) !== "%PDF-") fail("pas un PDF");
  const pdf = new Pdf(bytes);
  const lines: Line[] = [];
  let p = 0;
  for (const page of pdf.pages()) {
    p++;
    const rows: { y: number; runs: (Run & { y: number })[] }[] = [];
    for (const r of await pageRuns(pdf, page)) {
      // The same baseline within a point and a half: one line.
      const row = rows.find((w) => Math.abs(w.y - r.y) < 1.5);
      if (row) row.runs.push(r);
      else rows.push({ y: r.y, runs: [r] });
    }
    for (const row of rows.sort((a, b) => b.y - a.y)) {
      const runs = row.runs.sort((a, b) => a.x - b.x).map(({ text, rgb, x }) => ({ text, rgb, x }));
      const t = runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
      if (t) lines.push({ page: p, y: Math.round(row.y * 10) / 10, runs, text: t });
    }
  }
  return lines;
}
