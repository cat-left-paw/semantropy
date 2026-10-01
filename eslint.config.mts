import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";
import globals from "globals";
import { globalIgnores, defineConfig } from "eslint/config";

export default defineConfig(
	globalIgnores([
		"node_modules",
		"dist",
		".cache", // Generated, untracked native-probe bundles and measurement output.
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"package.json",
		"package-lock.json",
		"tsconfig.json",
		"vitest.config.ts",
		"vitest.benchmark.config.ts",
		"vitest.distribution.config.ts",
		// The web Playground is not Obsidian plugin code and has its own lint
		// configuration (web/eslint.config.mjs, `npm run lint:web`).
		"web",
		"dist-web",
		"vitest.web.config.ts",
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mts", "manifest.json"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ["scripts/manualMorphNativeProbe.mjs", "scripts/hoverDictionaryNativeProbe.mjs"],
		rules: {
			// Development-only probe intercepts/restores console methods to count
			// unexpected output. It never logs note text or enters the product bundle.
			"obsidianmd/rule-custom-message": "off",
		},
	},
	{
		files: [
			"scripts/fakeDictionary/standardTemplates.mjs",
			"scripts/collision/standardPatterns.mjs",
			"scripts/fakeProverb/standardRecipes.mjs",
		],
		rules: {
			// The build-time generators evaluate one esbuild bundle of this
			// repository's own compiler modules, so the product's validator is
			// the only validator. The import specifier is that bundle, never
			// user input, a note or a network resource, and these scripts never
			// enter the plugin bundle.
			"no-unsanitized/method": "off",
		},
	},
	{
		files: ["src/render/rubyBodyRenderer.ts", "src/render/safeTargetPrototype.ts", "src/render/safeTargetDom.ts", "src/render/targetBodyController.ts", "src/render/chunkTargetBodyController.ts", "src/view/VocabularyControls.ts", "src/view/SemantropyToolbar.ts", "src/view/CollisionModal.ts", "src/view/FakeProverbModal.ts", "src/view/RecomposeModal.ts", "src/view/VocabularyModal.ts", "src/view/AutomaticPosToolbar.ts"],
		rules: {
			// This detached DOM adapter intentionally uses standard ownerDocument
			// APIs, also in documents without Obsidian's window.createEl helpers.
			"obsidianmd/prefer-create-el": "off",
		},
	},
	{
		// Node build/inspection scripts. They are not part of the TypeScript
		// program, so type-aware rules cannot run on them; everything else does.
		files: ["scripts/**/*.mjs", "esbuild.config.mjs"],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: {
			globals: {
				...globals.node,
			},
			parserOptions: {
				projectService: false,
				project: false,
			},
		},
		rules: {
			"obsidianmd/prefer-create-el": "off",
			"obsidianmd/no-global-this": "off",
			"obsidianmd/prefer-window-timers": "off",
			// These scripts inspect the build machine's own directory layout;
			// they never run inside Obsidian and have no Vault to ask.
			"obsidianmd/hardcoded-config-path": "off",
			// Nor do they have an Obsidian app to offer `requestUrl`. The only
			// `fetch` here is the pinned dictionary download in
			// scripts/lindera/linderaSource.mjs, reached solely from the dictionary
			// bootstrap (`npm run prepare:dictionary`, or the first `npm run build` /
			// `npm run build:distribution` with no verified cache); no plugin code
			// calls it.
			"no-restricted-globals": "off",
		},
	},
	{
		files: ["tests/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.node,
				...globals.browser,
			},
		},
		rules: {
			"obsidianmd/prefer-create-el": "off",
			"obsidianmd/prefer-instanceof": "off",
			// Tests run in Node, where there is no `window`.
			"obsidianmd/no-global-this": "off",
			"obsidianmd/prefer-window-timers": "off",
		},
	},
	{
		files: ["tests/distribution/artifact.test.ts"],
		rules: {
			// Synthetic build paths exercise vault-name leak detection. They do
			// not locate a running Vault's configuration directory.
			"obsidianmd/hardcoded-config-path": "off",
		},
	},
);
