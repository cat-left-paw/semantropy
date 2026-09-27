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
		include: ["tests/benchmark.*.ts"],
		testTimeout: 600000,
		hookTimeout: 600000,
	},
});
