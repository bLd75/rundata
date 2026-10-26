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
  /**
   * « mcp »: a tools/call; « rpc »: any other MCP message (initialize, tools/list…) or a refused request; « page »;
   * « flux »: a commune's RSS feed fetched by a reader (web/rss.ts), kept apart from the page views; « signal »: what a
   * page's browser tells (web/signaux.ts), never a page view.
   */
  kind: "mcp" | "rpc" | "page" | "flux" | "signal";
  /** The tool; the JSON-RPC method (or the HTTP method of a request without one); the page's path. */
  name: string;
  /**
   * Tool: the place asked for, as the gazetteer understood it (« Saint-Pierre », « coordonnées »), or the text asked,
   * cut to 60 characters, when it did not. Page: « bouton » when opened from a « Domann out IA » question. Signal:
   * its event (« affichage », « adresse copiée », « aide », « retour »).
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
  /**
   * MCP: « ok », « vide » (the tool answered but found nothing: vide.ts), « erreur » (the tool answered isError),
   * « lieu inconnu » (isError, place not understood), « rpc <code> », « http <status> ».
   */
  outcome?: string;
  /** Tool, as the server tells it: the JSON-RPC id of the call, for the transport's record of it (usage.ts). */
  id?: string | number;
  /** MCP: the protocol error's message (JSON-RPC error or refused request). Never a tool's own answer. */
  message?: string;
  /** MCP: the names of the arguments given, sorted (« lieu,quand »); never their values. */
  args?: string;
  /** Tool: « résolu », « inconnu » or « coordonnées » when a place was asked. */
  place?: string;
  /** Tool: the commune of the place understood. */
  commune?: string;
  /** Page, feed: the HTTP status. */
  status?: number;
  /** Feed: the reader, from its User-Agent (feedReader). */
  reader?: string;
  /** Feed: how many subscribers the reader says it fetches for; 1 when it does not say. */
  subscribers?: number;
  /** Milliseconds from the request to this answer (wall time: waiting on sources included). */
  ms?: number;
  /** Subrequests made while it ran (for several messages in one request, they overlap). */
  subrequests?: number;
  /** Cache entries served fresh, and loaded or refreshed from the source, while it ran. */
  cacheHits?: number;
  cacheLoads?: number;
  /** Tool: characters of text in the answer. */
  size?: number;
  /** Signal: its value (« oui », « non », the class of a visit), and for « affichage » the LCP in ms (TTFB in `ms`). */
  value?: string;
  lcp?: number;
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

/** The visitor and the audience of the team's own visits, which the figures leave out (teamVisit). */
export const TEAM = "interne";

/**
 * The kind of visitor, from its User-Agent: « interne » for the team's scripts (« rundata-interne » in their
 * User-Agent), a named fetcher, « navigateur », or the first word of an unknown one.
 */
export function visitor(userAgent: string): string {
  if (/rundata-interne/i.test(userAgent)) return TEAM;
  for (const [re, name] of AGENTS) if (re.test(userAgent)) return name;
  if (/bot|crawler|spider/i.test(userAgent)) return "autre robot";
  if (userAgent.startsWith("Mozilla/")) return "navigateur";
  return userAgent.split(/[\s/;(]/)[0].slice(0, 40) || "inconnu";
}

// The feed readers, online services first: those tell how many of their users follow the feed.
const FEED_READERS: [RegExp, string][] = [
  [/feedly/i, "Feedly"],
  [/inoreader/i, "Inoreader"],
  [/newsblur/i, "NewsBlur"],
  [/theoldreader/i, "The Old Reader"],
  [/feedbin/i, "Feedbin"],
  [/bazqux/i, "BazQux"],
  [/feedspot/i, "Feedspot"],
  [/netnewswire/i, "NetNewsWire"],
  [/reeder/i, "Reeder"],
  [/miniflux/i, "Miniflux"],
  [/freshrss/i, "FreshRSS"],
  [/tiny ?tiny ?rss|tt-rss/i, "Tiny Tiny RSS"],
  [/newsboat/i, "Newsboat"],
  [/thunderbird/i, "Thunderbird"],
  [/akregator/i, "Akregator"],
  [/\bfeeder\b/i, "Feeder"],
];

/**
 * The reader fetching a feed, and how many subscribers it says it fetches for (« 12 subscribers » from Feedly,
 * Inoreader, NewsBlur…): 1 when it says nothing, as an app on someone's phone. Another User-Agent: visitor().
 */
export function feedReader(userAgent: string): { name: string; subscribers: number } {
  const name = FEED_READERS.find(([re]) => re.test(userAgent))?.[1] ?? visitor(userAgent);
  const n = /(\d+)\s*(?:subscribers?|readers?|abonnés?)\b/i.exec(userAgent);
  return { name, subscribers: n ? Math.max(1, Number(n[1])) : 1 };
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
  if (who === TEAM) return TEAM;
  if (ASSISTANTS.has(who)) return "assistant";
  if (who !== "navigateur") return "robot";
  if (/Headless|Lighthouse|PageSpeed|PTST|Chrome-Lighthouse/i.test(ua)) return "robot";
  return headers.has("accept-language") && headers.has("sec-fetch-mode") ? "humain" : "robot probable";
}

/**
 * A visit of the team, left out of the figures (written « interne » in blob4 and, for a page, in blob9): a script
 * with « rundata-interne » in its User-Agent, a page asked by the service worker of a phone marked as the team's
 * (header `rundata-equipe: 1`, web/pwa.ts), or the address that marks it (`?interne=1`). Nothing is kept to know it
 * again: the mark stays on the phone.
 */
export function teamVisit(headers: Headers, url: URL): boolean {
  return /rundata-interne/i.test(headers.get("user-agent") ?? "") || headers.get("rundata-equipe") === "1" || url.searchParams.get("interne") === "1";
}

/**
 * The device of a person's page view: « mobile », « tablette » or « ordinateur », from the Sec-CH-UA-Mobile hint that
 * Chromium browsers send (?1 on a phone), then the User-Agent (iPad, Android without « Mobile »: a tablet). Empty for
 * robots and assistants. An iPad or an Android tablet asking for the desktop site says it is a computer, and is counted so.
 */
export function device(headers: Headers): string {
  const ua = headers.get("user-agent") ?? "";
  if (visitor(ua) !== "navigateur") return "";
  if (headers.get("sec-ch-ua-mobile") === "?1") return "mobile";
  if (/iPad|Tablet|Kindle|Silk\/|PlayBook|Android(?!.*Mobile)/i.test(ua)) return "tablette";
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return "mobile";
  return "ordinateur";
}

/** The visitor's first language (« fr », « en »), from Accept-Language; empty without one. */
export function language(acceptLanguage: string | null): string {
  return /^\s*([a-z]{2,3})\b/i.exec(acceptLanguage ?? "")?.[1].toLowerCase() ?? "";
}

/** blob6 of a page opened from another page of the site: the visit's next page, not its way in. */
export const FROM_SITE = "interne";

/**
 * Where the request came from: « ref:<canal> » for a link shared by the campaign (« ?ref=fb », « ?ref=presse-zinfos »),
 * which wins over the referer; FROM_SITE from a page of the site; else the referring site, or empty without one.
 * A visit is then a page view of a person whose blob6 is not FROM_SITE, as Simple Analytics counts them: nothing kept,
 * nothing read from the browser but its referer.
 */
export function origin(referer: string | null, url: URL): string {
  const tag = url.searchParams.get("ref")?.replace(/[^\w.-]/g, "").slice(0, 40);
  if (tag) return `ref:${tag}`;
  try {
    const host = new URL(referer ?? "").host;
    return host === url.host ? FROM_SITE : host;
  } catch {
    return "";
  }
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
  /** origin(): « ref:<canal> », « interne », the referring site, or empty. */
  from: string;
  /** For pages: audience() and language(). */
  audience: string;
  language: string;
  /** For pages: « app » when asked by the installed app's service worker (web/pwa.ts), else empty. */
  mode?: string;
  /** For pages: device(). */
  device?: string;
}

/**
 * The Analytics Engine data point of a hit (dataset rundata_usage). Columns 1 to 6 and double1 keep their first meaning,
 * so older queries still work.
 *
 * A feed (« flux ») is written as a page, but for blob1, blob4 (the reader) and double6 (its subscribers). Readers per
 * feed per day: for each feed and reader, the day's largest double6; then their sum.
 *
 * A signal (web/signaux.ts) is written as a page too, but for blob1 (« signal »), blob3 (its event), blob6 (empty:
 * its referer is always the page), blob10 (its value: oui, non, première, même jour, lendemain, dans la semaine, plus
 * tard), double2 (« affichage »: the TTFB seen by the browser, ms) and double6 (« affichage »: the LCP, ms, 0 where the
 * browser does not give it). A visit's class (« retour ») leaves with the page the visit came in by.
 *
 * | column  | mcp, rpc                                   | page                                   |
 * |---------|--------------------------------------------|----------------------------------------|
 * | index1  | kind                                       | kind                                   |
 * | blob1   | kind: mcp (tools/call) or rpc (the rest)   | page, flux, or signal                  |
 * | blob2   | tool, or JSON-RPC method, or HTTP method   | path                                   |
 * | blob3   | place understood, or text not understood   | « bouton » (opened from a question)    |
 * | blob4   | visitor, from the User-Agent; « interne » for the team (teamVisit) | visitor; for a feed, its reader |
 * | blob5   | country                                    | country                                |
 * | blob6   | referring site, « ref:<canal> », or « interne » from a page of the site (origin) | same |
 * | blob7   | JSON-RPC method                            | category: accueil, meteo/*…            |
 * | blob8   | client name (initialize)                   | language: fr, en…                      |
 * | blob9   | client version (initialize)                | audience: humain, assistant, robot…, interne |
 * | blob10  | protocol version                           | HTTP status                            |
 * | blob11  | outcome: ok, vide, erreur, lieu inconnu, rpc …, http … | « app » in the installed app, else empty |
 * | blob12  | protocol error message                     | device: mobile, tablette, ordinateur; empty for a robot |
 * | blob13  | argument names                             | —                                      |
 * | blob14  | place: résolu, inconnu, coordonnées        | —                                      |
 * | blob15  | commune of the place                       | —                                      |
 * | double1 | 1 if answered without error (« vide » too) | 1 if served without error              |
 * | double2 | milliseconds                               | milliseconds                           |
 * | double3 | subrequests                                | subrequests                            |
 * | double4 | cache entries served fresh                 | same                                   |
 * | double5 | cache entries loaded from the source       | same                                   |
 * | double6 | characters of the tool's answer            | feed: its reader's subscribers, else 1 |
 *
 * Analytics Engine keeps points three months.
 */
export function point(hit: Hit, v: Visit): { indexes: string[]; blobs: string[]; doubles: number[] } {
  const signal = hit.kind === "signal";
  const page = hit.kind === "page" || hit.kind === "flux" || signal;
  const seen = hit.kind === "page" || signal;
  const blobs = [
    hit.kind, hit.name, hit.detail ?? "", hit.reader ?? v.who, v.country, signal ? "" : v.from,
    page ? category(hit.name) : hit.method ?? "",
    page ? v.language : hit.client ?? "",
    page ? v.audience : hit.clientVersion ?? "",
    signal ? hit.value ?? "" : page ? String(hit.status ?? "") : hit.protocol ?? "",
    seen ? v.mode ?? "" : hit.outcome ?? "", seen ? v.device ?? "" : hit.message ?? "", hit.args ?? "", hit.place ?? "", hit.commune ?? "",
  ];
  const doubles = [hit.ok ? 1 : 0, hit.ms ?? 0, hit.subrequests ?? 0, hit.cacheHits ?? 0, hit.cacheLoads ?? 0, hit.kind === "flux" ? hit.subscribers ?? 1 : signal ? hit.lcp ?? 0 : hit.size ?? 0];
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
