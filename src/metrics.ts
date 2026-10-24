/**
 * What the site and the MCP endpoint are used for, without following anyone: one data point per MCP message and
 * per page view, with the kind of visitor (a browser, or the name of an assistant's or search engine's fetcher),
 * the country Cloudflare sees and the site the visitor came from. No address, no cookie, no identifier.
 *
 * In the Worker the points go to Workers Analytics Engine (`point` below says which column holds what); in Node they
 * go nowhere.
 */
import { left, perInvocation } from "./budget.js";

export interface Hit {
  /** « mcp »: a tools/call; « rpc »: any other MCP message (initialize, tools/list…) or a refused request; « page ». */
  kind: "mcp" | "rpc" | "page";
  /** The tool; the JSON-RPC method (or the HTTP method of a request without one); the page's path. */
  name: string;
  /**
   * Tool: the place asked for, as the gazetteer understood it (« Saint-Pierre », « coordonnées »), or the text asked,
   * cut to 60 characters, when it did not. Page: « bouton » when opened from a « Domann out IA » question.
   */
  detail?: string;
  ok: boolean;
  /** MCP: the JSON-RPC method. */
  method?: string;
  /** MCP: the client's own name and version, from its initialize (« claude-ai », « 0.1.0 »). */
  client?: string;
  clientVersion?: string;
  /** MCP: the protocol version asked (initialize) or sent in the mcp-protocol-version header. */
  protocol?: string;
  /** MCP: « ok », « erreur » (the tool answered isError), « lieu inconnu » (isError, place not understood), « rpc <code> », « http <status> ». */
  outcome?: string;
  /** MCP: the protocol error's message (JSON-RPC error or refused request). Never a tool's own answer. */
  message?: string;
  /** MCP: the names of the arguments given, sorted (« lieu,quand »); never their values. */
  args?: string;
  /** Tool: « résolu », « inconnu » or « coordonnées » when a place was asked. */
  place?: string;
  /** Tool: the commune of the place understood. */
  commune?: string;
  /** Page: the HTTP status. */
  status?: number;
  /** Milliseconds from the request to this answer (wall time: waiting on sources included). */
  ms?: number;
  /** Subrequests made while it ran (for several messages in one request, they overlap). */
  subrequests?: number;
  /** Cache entries served fresh, and loaded or refreshed from the source, while it ran. */
  cacheHits?: number;
  cacheLoads?: number;
  /** Tool: characters of text in the answer. */
  size?: number;
}

export type Recorder = (hit: Hit) => void;

const AGENTS: [RegExp, string][] = [
  [/openai-mcp/i, "ChatGPT (connecteur)"],
  [/ChatGPT-User/i, "ChatGPT"],
  [/OAI-SearchBot/i, "OpenAI recherche"],
  [/GPTBot/i, "OpenAI robot"],
  [/Claude-User/i, "Claude"],
  [/Claude-SearchBot/i, "Anthropic recherche"],
  [/ClaudeBot/i, "Anthropic robot"],
  [/Perplexity/i, "Perplexity"],
  [/MistralAI/i, "Mistral"],
  [/meta-external|facebookexternalhit/i, "Meta"],
  [/Googlebot|Google-Extended|Google-InspectionTool/i, "Google"],
  [/bingbot/i, "Bing"],
  [/Applebot/i, "Apple"],
  [/DuckAssistBot|DuckDuckBot/i, "DuckDuckGo"],
];

/** The kind of visitor, from its User-Agent: a named fetcher, « navigateur », or the first word of an unknown one. */
export function visitor(userAgent: string): string {
  for (const [re, name] of AGENTS) if (re.test(userAgent)) return name;
  if (/bot|crawler|spider/i.test(userAgent)) return "autre robot";
  if (userAgent.startsWith("Mozilla/")) return "navigateur";
  return userAgent.split(/[\s/;(]/)[0].slice(0, 40) || "inconnu";
}

// Fetches made for a person by an assistant, as opposed to its crawler.
const ASSISTANTS = new Set(["ChatGPT", "ChatGPT (connecteur)", "Claude", "Perplexity", "Mistral"]);

/**
 * Who a page view is for: « humain », « assistant » (an AI fetching the page for someone), « robot » (a declared crawler
 * or a script), or « robot probable »: a browser's User-Agent without what every current browser sends with a page
 * (a preferred language and the sec-fetch-mode header), the mark of a script dressed as Chrome.
 */
export function audience(headers: Headers): string {
  const ua = headers.get("user-agent") ?? "";
  const who = visitor(ua);
  if (ASSISTANTS.has(who)) return "assistant";
  if (who !== "navigateur") return "robot";
  if (/Headless|Lighthouse|PageSpeed|PTST|Chrome-Lighthouse/i.test(ua)) return "robot";
  return headers.has("accept-language") && headers.has("sec-fetch-mode") ? "humain" : "robot probable";
}

/** The visitor's first language (« fr », « en »), from Accept-Language; empty without one. */
export function language(acceptLanguage: string | null): string {
  return /^\s*([a-z]{2,3})\b/i.exec(acceptLanguage ?? "")?.[1].toLowerCase() ?? "";
}

/** The kind of page: « accueil », the first part of the path (« vigilance », « meteo »), with « /* » below it (« meteo/* »). */
export function category(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return "accueil";
  return parts[0].slice(0, 30) + (parts.length > 1 ? "/*" : "");
}

/** The cache's counts for the current invocation (cache.ts adds to them; outside an invocation they go nowhere). */
export function cacheTally(): { hits: number; loads: number } {
  return perInvocation("metrics:cache", () => ({ hits: 0, loads: 0 }));
}

/** What the request says about its visitor, filled in by the Worker. */
export interface Visit {
  /** visitor() of its User-Agent. */
  who: string;
  country: string;
  /** The referring site, or « ref:<canal> ». */
  from: string;
  /** For pages: audience() and language(). */
  audience: string;
  language: string;
}

/**
 * The Analytics Engine data point of a hit (dataset rundata_usage). Columns 1 to 6 and double1 keep their first meaning,
 * so older queries still work.
 *
 * | column  | mcp, rpc                                   | page                                   |
 * |---------|--------------------------------------------|----------------------------------------|
 * | index1  | kind                                       | kind                                   |
 * | blob1   | kind: mcp (tools/call) or rpc (the rest)   | page                                   |
 * | blob2   | tool, or JSON-RPC method, or HTTP method   | path                                   |
 * | blob3   | place understood, or text not understood   | « bouton » (opened from a question)    |
 * | blob4   | visitor, from the User-Agent               | visitor                                |
 * | blob5   | country                                    | country                                |
 * | blob6   | referring site or « ref:<canal> »          | same                                   |
 * | blob7   | JSON-RPC method                            | category: accueil, meteo/*…            |
 * | blob8   | client name (initialize)                   | language: fr, en…                      |
 * | blob9   | client version (initialize)                | audience: humain, assistant, robot…    |
 * | blob10  | protocol version                           | HTTP status                            |
 * | blob11  | outcome: ok, erreur, lieu inconnu, rpc …, http … | —                                |
 * | blob12  | protocol error message                     | —                                      |
 * | blob13  | argument names                             | —                                      |
 * | blob14  | place: résolu, inconnu, coordonnées        | —                                      |
 * | blob15  | commune of the place                       | —                                      |
 * | double1 | 1 if answered without error                | 1 if served without error              |
 * | double2 | milliseconds                               | milliseconds                           |
 * | double3 | subrequests                                | subrequests                            |
 * | double4 | cache entries served fresh                 | same                                   |
 * | double5 | cache entries loaded from the source       | same                                   |
 * | double6 | characters of the tool's answer            | —                                      |
 *
 * Analytics Engine keeps points three months.
 */
export function point(hit: Hit, v: Visit): { indexes: string[]; blobs: string[]; doubles: number[] } {
  const page = hit.kind === "page";
  const blobs = [
    hit.kind, hit.name, hit.detail ?? "", v.who, v.country, v.from,
    page ? category(hit.name) : hit.method ?? "",
    page ? v.language : hit.client ?? "",
    page ? v.audience : hit.clientVersion ?? "",
    page ? String(hit.status ?? "") : hit.protocol ?? "",
    hit.outcome ?? "", hit.message ?? "", hit.args ?? "", hit.place ?? "", hit.commune ?? "",
  ];
  const doubles = [hit.ok ? 1 : 0, hit.ms ?? 0, hit.subrequests ?? 0, hit.cacheHits ?? 0, hit.cacheLoads ?? 0, hit.size ?? 0];
  return { indexes: [hit.kind], blobs, doubles };
}

/**
 * Starts measuring: the returned function gives the milliseconds, subrequests and cache counts since. Outside a counted
 * invocation (Node, tests) subrequests and cache counts stay at 0.
 */
export function stopwatch(): () => Pick<Required<Hit>, "ms" | "subrequests" | "cacheHits" | "cacheLoads"> {
  const start = Date.now();
  const before = left();
  const tally = cacheTally();
  const [hits, loads] = [tally.hits, tally.loads];
  return () => ({
    ms: Date.now() - start,
    subrequests: Number.isFinite(before) ? before - left() : 0,
    cacheHits: tally.hits - hits,
    cacheLoads: tally.loads - loads,
  });
}
