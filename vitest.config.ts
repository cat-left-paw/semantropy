import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { vitestAliases } from "./scripts/vitestAliases.mjs";

export default defineConfig({
	resolve: {
		alias: vitestAliases(path.dirname(fileURLToPath(import.meta.url))),
	},
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			// Needs the prepared dictionary and builds the artifact:
			// npm run verify:distribution.
			"tests/distribution/**",
		],
		testTimeout: 20000,
	},
});
