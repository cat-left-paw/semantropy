// Lint configuration for the web Playground (`npm run lint:web`).
// The Obsidian plugin rules do not apply here: this code runs in an ordinary
// web page and a Web Worker, and uses the standard DOM and `fetch` on purpose.
import tseslint from "typescript-eslint";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(
	globalIgnores(["../dist-web", "presets"]),
	{
		files: ["src/**/*.ts", "tests/**/*.ts"],
		extends: [tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				project: [path.join(webDir, "tsconfig.json"), path.join(webDir, "tests", "tsconfig.json")],
				tsconfigRootDir: webDir,
			},
		},
		rules: {
			"no-alert": "off",
			"@typescript-eslint/no-floating-promises": "error",
		},
	},
	{
		files: ["tools/**/*.mjs", "deploy/**/*.mjs", "eslint.config.mjs"],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: { globals: { ...globals.node } },
	},
);
