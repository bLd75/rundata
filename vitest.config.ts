import { defineConfig } from "vitest/config";

// Every test file starts with fetch refused (test/sans-reseau.ts): no test reaches a real host.
export default defineConfig({ test: { setupFiles: ["test/sans-reseau.ts"] } });
