/**
 * Reads and writes one key of the Worker's KV store (binding STORE) through Cloudflare's API, for the collectors run on
 * a machine of the project (scripts/ovpf-ocr.ts, scripts/carburants.ts, scripts/prefecture.ts, with --kv). Needs
 * CLOUDFLARE_API_TOKEN (a token that may write to Workers KV, nothing else) and CLOUDFLARE_ACCOUNT_ID in the
 * environment.
 */
import { readFileSync } from "node:fs";

// The namespace of the binding STORE, as wrangler.jsonc gives it.
function namespace(): string {
  const m = /"binding":\s*"STORE",\s*"id":\s*"([0-9a-f]{32})"/.exec(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  if (!m) throw new Error("namespace KV STORE introuvable dans wrangler.jsonc");
  return m[1];
}

/** The address of `key` in the store, and the token to ask it with. */
function where(key: string) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN sont nécessaires");
  return { url: `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace()}/values/${encodeURIComponent(key)}`, token };
}

/** Stores `value` as JSON under `key`, kept `ttlSeconds`. Throws when the API refuses it. */
export async function putKv(key: string, value: unknown, ttlSeconds: number) {
  const { url, token } = where(key);
  const res = await fetch(`${url}?expiration_ttl=${ttlSeconds}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(value), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`écriture KV de ${key} refusée : HTTP ${res.status}`);
}

/** The JSON stored under `key`, undefined when there is none. Throws when the API refuses it. */
export async function getKv<T>(key: string): Promise<T | undefined> {
  const { url, token } = where(key);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`lecture KV de ${key} refusée : HTTP ${res.status}`);
  return (await res.json()) as T;
}
