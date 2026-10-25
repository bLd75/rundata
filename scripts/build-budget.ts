/** Writes BUDGET.md from the budget's registry (src/registre.ts). */
import { writeFileSync } from "node:fs";
import { budget } from "../src/registre.js";

writeFileSync(new URL("../BUDGET.md", import.meta.url), budget());
