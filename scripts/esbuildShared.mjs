import { builtinModules } from "node:module";

export const OBSIDIAN_EXTERNALS = [
	"obsidian",
	"electron",
	"@codemirror/autocomplete",
	"@codemirror/collab",
	"@codemirror/commands",
	"@codemirror/language",
	"@codemirror/lint",
	"@codemirror/search",
	"@codemirror/state",
	"@codemirror/view",
	"@lezer/common",
	"@lezer/highlight",
	"@lezer/lr",
	...builtinModules,
];

export function baseBuildOptions() {
	return {
		bundle: true,
		external: OBSIDIAN_EXTERNALS,
		format: "cjs",
		target: "es2021",
		platform: "browser",
		treeShaking: true,
	};
}
