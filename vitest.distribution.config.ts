import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { vitestAliases } from "./scripts/vitestAliases.mjs";

const pluginRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * The distribution suite. Separate from the default suite because it needs the
 * prepared dictionary (`npm run prepare:dictionary`, or a first `npm run build`,
 * which leaves the archive and the extracted dictionary in `.cache/`) and builds
 * the real artifact, neither of which the fast unit suite should depend on.
 */
export default defineConfig({
	resolve: {
		alias: vitestAliases(pluginRoot),
	},
	test: {
		environment: "node",
		include: ["tests/distribution/**/*.test.ts"],
		// The artifact suite builds twice and loads a 12 MB bundle; the
		// sequential order keeps two esbuild runs off the same output path.
		fileParallelism: false,
		testTimeout: 600000,
		hookTimeout: 600000,
	},
});
