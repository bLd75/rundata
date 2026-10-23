/**
 * Reads 2-D chunked datasets out of an HDF5 file, as far as Météo-France's ODIM radar composites need: superblock v0,
 * data layout message v3 (chunked), chunk index in a version 1 B-tree, chunks deflated with no other filter. Anything
 * else is refused rather than guessed. Inflating goes through the platform's DecompressionStream, like zip.ts.
 *
 * The layout messages are found by their bytes (version 3, class 2 = chunked, rank + 1 = 3) followed by an address
 * that holds a B-tree ("TREE"), instead of walking the object headers: much shorter, and the B-tree check keeps it
 * from matching stray bytes.
 */

export interface Chunked {
  /** Rows and columns of one chunk. */
  chunkRows: number;
  cols: number;
  /** Bytes per value: 1 (uint8) or 2 (uint16). */
  size: 1 | 2;
  /** First row of each chunk, its address and compressed size, sorted by row. */
  chunks: { row: number; addr: number; bytes: number }[];
}

const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));

function isTree(b: Uint8Array, at: number): boolean {
  return at + 4 <= b.length && b[at] === 0x54 && b[at + 1] === 0x52 && b[at + 2] === 0x45 && b[at + 3] === 0x45;
}

function leaves(v: DataView, b: Uint8Array, addr: number, out: Chunked["chunks"], depth = 0): void {
  if (!isTree(b, addr) || b[addr + 4] !== 1 || depth > 8) throw new Error("hdf5 : index de chunks illisible");
  const level = b[addr + 5];
  const entries = v.getUint16(addr + 6, true);
  // Header: signature, node type, level, entries used, left and right siblings. Then per entry a key (chunk size,
  // filter mask, one offset per dimension plus one for the element) and the child's address.
  let p = addr + 24;
  for (let k = 0; k < entries; k++) {
    const bytes = v.getUint32(p, true);
    const mask = v.getUint32(p + 4, true);
    const row = u64(v, p + 8);
    const child = u64(v, p + 32);
    if (level > 0) leaves(v, b, child, out, depth + 1);
    else if (mask !== 0) throw new Error("hdf5 : chunk sans son filtre deflate");
    else out.push({ row, addr: child, bytes });
    p += 40;
  }
}

/** Every 2-D chunked dataset of the file, in file order. Throws when the file is not one this code can read. */
export function datasets(data: ArrayBuffer): Chunked[] {
  const b = new Uint8Array(data);
  const v = new DataView(data);
  // Superblock v0 at offset 0 with 8-byte addresses and lengths.
  if (v.getUint32(0) !== 0x89484446 || b[8] !== 0 || b[13] !== 8 || b[14] !== 8) throw new Error("hdf5 : en-tête non pris en charge");
  const out: Chunked[] = [];
  for (let i = 0; i < b.length - 23; i++) {
    if (b[i] !== 3 || b[i + 1] !== 2 || b[i + 2] !== 3) continue;
    const tree = u64(v, i + 3);
    const size = v.getUint32(i + 19, true);
    if ((size !== 1 && size !== 2) || !isTree(b, tree)) continue;
    const chunks: Chunked["chunks"] = [];
    leaves(v, b, tree, chunks);
    out.push({ chunkRows: v.getUint32(i + 11, true), cols: v.getUint32(i + 15, true), size, chunks: chunks.sort((x, y) => x.row - y.row) });
  }
  return out;
}

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
}

/**
 * Rows `from` to `to` (excluded), columns `c0` to `c1` (excluded), as one flat array of (to - from) × (c1 - c0)
 * values. Only the chunks holding those rows are inflated.
 */
export async function crop(data: ArrayBuffer, d: Chunked, from: number, to: number, c0: number, c1: number): Promise<Uint16Array> {
  const width = c1 - c0;
  const out = new Uint16Array((to - from) * width);
  for (const c of d.chunks) {
    if (c.row + d.chunkRows <= from || c.row >= to) continue;
    const raw = await inflate(new Uint8Array(data, c.addr, c.bytes));
    const values = d.size === 2 ? new Uint16Array(raw) : new Uint8Array(raw);
    if (values.length !== d.chunkRows * d.cols) throw new Error("hdf5 : chunk de taille inattendue");
    for (let r = Math.max(from, c.row); r < Math.min(to, c.row + d.chunkRows); r++) {
      const src = (r - c.row) * d.cols;
      out.set(values.subarray(src + c0, src + c1), (r - from) * width);
    }
  }
  return out;
}
