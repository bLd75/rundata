/**
 * What the site and the MCP endpoint are used for, without following anyone: one data point per MCP tool call and
 * per page view, with the kind of visitor (a browser, or the name of an assistant's or search engine's fetcher),
 * the country Cloudflare sees and the site the visitor came from. No address, no cookie, no identifier.
 *
 * In the Worker the points go to Workers Analytics Engine; in Node they go nowhere.
 */
export interface Hit {
  kind: "mcp" | "page";
  /** The tool, or the page's path. */
  name: string;
  /** The place asked for (tool), or « bouton » for a page opened from a « Domann out IA » question. */
  detail?: string;
  ok: boolean;
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
