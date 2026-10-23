/**
 * Just enough TIFF to read the grids Météo-France's WCS returns: one band, uncompressed strips, integer or
 * floating-point samples, plus the GeoTIFF tie point and pixel scale. Anything else is refused rather than misread.
 */

export interface Raster {
  width: number;
  height: number;
  /** Row by row from the top (north) left (west) pixel; null where the file says "no data". */
  values: (number | null)[];
  /** Position of the top-left pixel and spacing, in the file's coordinates (here degrees). */
  x0: number;
  y0: number;
  dx: number;
  dy: number;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

export function readTiff(buffer: ArrayBuffer | Uint8Array): Raster {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (order !== "II" && order !== "MM") throw new Error("pas un fichier TIFF");
  const le = order === "II";
  if (view.getUint16(2, le) !== 42) throw new Error("TIFF non pris en charge (BigTIFF ?)");

  const tags = new Map<number, number[] | string>();
  const ifd = view.getUint32(4, le);
  const count = view.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + 12 * i;
    const tag = view.getUint16(e, le);
    const type = view.getUint16(e + 2, le);
    const n = view.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] ?? 1) * n;
    const at = size <= 4 ? e + 8 : view.getUint32(e + 8, le);
    if (type === 2) {
      tags.set(tag, new TextDecoder().decode(bytes.subarray(at, at + n)).replace(/\0+$/, ""));
      continue;
    }
    const vals: number[] = [];
    for (let k = 0; k < n; k++) {
      const p = at + k * (TYPE_SIZE[type] ?? 1);
      vals.push(
        type === 3 ? view.getUint16(p, le)
        : type === 4 ? view.getUint32(p, le)
        : type === 11 ? view.getFloat32(p, le)
        : type === 12 ? view.getFloat64(p, le)
        : type === 8 ? view.getInt16(p, le)
        : type === 9 ? view.getInt32(p, le)
        : bytes[p],
      );
    }
    tags.set(tag, vals);
  }
  const num = (tag: number, fallback?: number) => {
    const v = tags.get(tag);
    if (Array.isArray(v)) return v[0];
    if (fallback === undefined) throw new Error(`TIFF : étiquette ${tag} absente`);
    return fallback;
  };

  const width = num(256);
  const height = num(257);
  const bits = num(258);
  const format = num(339, 1); // 1 unsigned, 2 signed, 3 float
  if (num(259, 1) !== 1) throw new Error("TIFF compressé non pris en charge");
  if (num(277, 1) !== 1) throw new Error("TIFF à plusieurs bandes non pris en charge");
  if (tags.has(322)) throw new Error("TIFF tuilé non pris en charge");
  const offsets = tags.get(273) as number[];
  const step = bits / 8;
  const read = (p: number): number =>
    format === 3
      ? bits === 64 ? view.getFloat64(p, le) : view.getFloat32(p, le)
      : format === 2
        ? bits === 32 ? view.getInt32(p, le) : bits === 16 ? view.getInt16(p, le) : view.getInt8(p)
        : bits === 32 ? view.getUint32(p, le) : bits === 16 ? view.getUint16(p, le) : view.getUint8(p);

  const rowsPerStrip = num(278, height);
  const noData = typeof tags.get(42113) === "string" ? Number(tags.get(42113)) : undefined;
  const values: (number | null)[] = [];
  for (let row = 0; row < height; row++) {
    const strip = Math.floor(row / rowsPerStrip);
    const base = offsets[strip] + (row % rowsPerStrip) * width * step;
    for (let col = 0; col < width; col++) {
      const v = read(base + col * step);
      values.push(Number.isNaN(v) || v === noData ? null : v);
    }
  }

  const scale = tags.get(33550) as number[] | undefined;
  const tie = tags.get(33922) as number[] | undefined;
  if (!scale || !tie) throw new Error("TIFF sans géoréférencement");
  // Tie point: raster (i, j) ↔ model (x, y). Pixel-is-point or not, Météo-France puts (0, 0) on the first value.
  return { width, height, values, x0: tie[3] - tie[0] * scale[0], y0: tie[4] + tie[1] * scale[1], dx: scale[0], dy: scale[1] };
}
