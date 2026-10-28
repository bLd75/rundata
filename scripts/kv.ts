/**
 * Writes one key of the Worker's KV store (binding STORE) through Cloudflare's API, for the collectors run on a machine
 * of the project (scripts/ovpf-ocr.ts, scripts/carburants.ts --kv). Needs CLOUDFLARE_API_TOKEN (a token that may write
 * to Workers KV, nothing else) and CLOUDFLARE_ACCOUNT_ID in the environment.
 */
import { readFileSync } from "node:fs";

// The namespace of the binding STORE, as wrangler.jsonc gives it.
function namespace(): string {
  const m = /"binding":\s*"STORE",\s*"id":\s*"([0-9a-f]{32})"/.exec(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  if (!m) throw new Error("namespace KV STORE introuvable dans wrangler.jsonc");
  return m[1];
}

/** Stores `value` as JSON under `key`, kept `ttlSeconds`. Throws when the API refuses it. */
export async function putKv(key: string, value: unknown, ttlSeconds: number) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN sont nécessaires");
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace()}/values/${encodeURIComponent(key)}?expiration_ttl=${ttlSeconds}`;
  const res = await fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(value), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`écriture KV de ${key} refusée : HTTP ${res.status}`);
}
