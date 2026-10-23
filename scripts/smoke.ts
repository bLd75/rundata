/**
 * Call every tool on a running server, against the live sources.
 * Usage: npx tsx scripts/smoke.ts [http://localhost:8787/mcp] ["lieu" …]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [url = "http://localhost:8787/mcp", ...places] = process.argv.slice(2);
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const calls: [string, Record<string, string>][] = [["sources_donnees", {}]];
for (const lieu of places.length ? places : ["plage de l'Hermitage", "Cilaos", "Saint-Denis"]) {
  calls.push(["meteo_actuelle", { lieu }], ["temperature_mer", { lieu }]);
}
for (const [name, args] of calls) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const body = (r.content as { type: string; text: string }[])[0].text;
  console.log(`\n── ${name} ${JSON.stringify(args)} ${r.isError ? "ERREUR " : ""}(${Date.now() - t0} ms)\n${body}`);
}
await client.close();
