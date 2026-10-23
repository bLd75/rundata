/**
 * Reads some files out of a zip archive, as text. Only what Météo-France's archives use: files stored or deflated,
 * no zip64, no encryption. Inflating goes through the platform's DecompressionStream (Workers and Node alike), so the
 * Worker carries no library and spends little CPU on it.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/** The files whose name `wanted` accepts, by name. Throws on anything that is not a zip this code can read. */
export async function unzip(data: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  let end = -1;
  // The end record is 22 bytes plus a comment of at most 64 KB.
  for (let i = data.byteLength - 22; i >= Math.max(0, data.byteLength - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("zip : fin d'archive introuvable");
  const entries = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  const names = new TextDecoder();
  const out = new Map<string, string>();
  for (let n = 0; n < entries; n++) {
    if (view.getUint32(p, true) !== CENTRAL) throw new Error("zip : répertoire central illisible");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const skip = nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + skip;
    if (!wanted(name)) continue;
    if (view.getUint32(local, true) !== LOCAL) throw new Error(`zip : en-tête de ${name} illisible`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const body = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, new TextDecoder().decode(body));
    else if (method === 8) out.set(name, await inflate(body));
    else throw new Error(`zip : méthode ${method} non prise en charge (${name})`);
  }
  return out;
}
