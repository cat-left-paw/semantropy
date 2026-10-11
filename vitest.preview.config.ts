import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { vitestAliases } from "./scripts/vitestAliases.mjs";

/**
 * `npm run preview:fake-proverb`: not a test suite. It runs the one file that writes examples of every Fake Proverb
 * type from the recipe document as it stands. Like the distribution suite it needs the prepared dictionary.
 */
export default defineConfig({
	resolve: {
		alias: vitestAliases(path.dirname(fileURLToPath(import.meta.url))),
	},
	test: {
		environment: "node",
		include: ["tests/preview.*.ts"],
		testTimeout: 600000,
		hookTimeout: 600000,
	},
});
