/**
 * The answers kept at Cloudflare's edge (Cache API), for the addresses that read the database at each request and
 * say the same thing to everyone for a while: a bus's trip (a minute). The associations' feeds keep their own copy
 * (web/flux-associations.ts). Cloudflare does not keep a Worker's answer by itself, whatever its Cache-Control:
 * without this, a loop on one address is one D1 read per request.
 *
 * The key is the address reduced to what the page reads: a query string added to get past the copy changes nothing.
 * Only a GET's 200 is kept; the copy carries its own lifetime for the edge, and gives back the page's own
 * Cache-Control to the browser. Without the Cache API (Node, the tests) or when it fails, each request is built.
 */
/** How long the edge keeps the answer of `url`, in seconds, and the address it is kept under; undefined: not kept. */
export function gardeDe(url: URL): { secondes: number; cle: string } | undefined {
  const path = url.pathname;
  if (/^\/bus\/trajet\/[a-z]+\/\d+\/[^/]+\/?$/.test(path)) {
    const q = new URLSearchParams();
    // As the page reads them (web/site.ts): a day « 20261026 », a stop's number.
    const jour = url.searchParams.get("jour");
    const arret = url.searchParams.get("arret");
    if (jour && /^\d{8}$/.test(jour)) q.set("jour", jour);
    if (arret && /^\d{1,6}$/.test(arret)) q.set("arret", arret);
    return { secondes: TRAJET_SECONDES, cle: `${url.origin}${path}${q.size ? `?${q}` : ""}` };
  }
  return undefined;
}

/** A trip's page says which stops are passed: a minute. */
export const TRAJET_SECONDES = 60;

const CACHE_CONTROL = "x-rundata-cache-control";

async function store(): Promise<Cache | undefined> {
  return typeof caches === "undefined" ? undefined : caches.open("bord");
}

/** The copy kept for `request`, if any. */
export async function lire(request: Request): Promise<Response | undefined> {
  const garde = request.method === "GET" ? gardeDe(new URL(request.url)) : undefined;
  if (!garde) return undefined;
  try {
    const r = await (await store())?.match(garde.cle);
    if (!r) return undefined;
    const headers = new Headers(r.headers);
    const cc = headers.get(CACHE_CONTROL);
    headers.delete(CACHE_CONTROL);
    if (cc) headers.set("cache-control", cc);
    else headers.delete("cache-control");
    return new Response(r.body, { status: r.status, headers });
  } catch {
    return undefined; // a cache problem must never cost an answer
  }
}

/** Keeps `response` for `request` when it is to be kept; to run after the answer (the Worker's waitUntil). */
export async function garder(request: Request, response: Response): Promise<void> {
  const garde = request.method === "GET" && response.status === 200 ? gardeDe(new URL(request.url)) : undefined;
  if (!garde) return;
  try {
    const c = await store();
    if (!c) return;
    const headers = new Headers(response.headers);
    headers.set(CACHE_CONTROL, headers.get("cache-control") ?? "");
    headers.set("cache-control", `public, max-age=${garde.secondes}`);
    headers.delete("set-cookie");
    await c.put(garde.cle, new Response(response.body, { status: 200, headers }));
  } catch {
    // same
  }
}
