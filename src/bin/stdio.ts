#!/usr/bin/env node
/** Local use: `npx reunion-temps-reel` in an MCP client config (Claude Desktop, Cursor…). */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "./net.js";
import { Cache } from "../cache.js";
import * as meteofrance from "../providers/meteofrance.js";
import { createServer } from "../server.js";

// Optional: with a key from portail-api.meteofrance.fr, the ~56 Météo-France stations are added.
meteofrance.configure({
  applicationId: process.env.METEOFRANCE_APPLICATION_ID,
  apiKey: process.env.METEOFRANCE_API_KEY,
  token: process.env.METEOFRANCE_TOKEN,
});
await createServer(new Cache()).connect(new StdioServerTransport());
