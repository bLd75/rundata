/** Writes CHANGELOG.md from the changes listed in src/nouveautes.ts (also the site's page /nouveautes). */
import { writeFileSync } from "node:fs";
import { changelog } from "../src/nouveautes.js";

writeFileSync(new URL("../CHANGELOG.md", import.meta.url), changelog());
