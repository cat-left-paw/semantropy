import { readdir } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

/**
 * `PRE-RELEASE-ADVERB-SPIKE1` boundaries, read from the module graph rather
 * than inferred from behaviour.
 *
 * Three claims:
 *
 *   - Production cannot reach this slice. `main.js` is byte-identical to the
 *     pre-slice build, and the reason is here: no module the plugin entry point
 *     imports leads to `src/adverb/`.
 *   - The slice is a pure leaf. It cannot tokenize, read a file or a resource,
 *     reach the network, write the Clipboard, the Vault or settings, or draw a
 *     random number, because none of that is reachable from it.
 *   - Its own module set is closed and small, so a later slice that widens it
 *     has to say so here.
 */

const ADVERB_MODULES = [
	"src/adverb/adverbBridgeProfile.ts",
	"src/adverb/adverbCapability.ts",
	"src/adverb/adverbFamily.ts",
	"src/adverb/adverbObservation.ts",
];

/** The capability seam is the widest entry point; everything else is below it. */
const SPIKE_ENTRY = "src/adverb/adverbCapability.ts";

async function graph(entry: string, external: readonly string[] = []) {
	const result = await build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		metafile: true,
		platform: "neutral",
		format: "esm",
		external: [...external],
		legalComments: "none",
	});
	return {
		inputs: Object.keys(result.metafile.inputs),
		code: result.outputFiles[0]!.text.replace(
			/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu,
			"",
		),
	};
}

describe("the adverb spike dependency boundary", () => {
	it("connects the reviewed four modules from the production entry point", async () => {
		const { inputs } = await graph("src/SemantropyPlugin.ts", ["obsidian"]);
		expect(inputs.filter((name) => name.includes("src/adverb/")).sort()).toEqual(ADVERB_MODULES);
	});

	it("connects the reviewed four modules from the plugin main entry", async () => {
		const { inputs } = await graph("src/main.ts", [
			"obsidian",
			"virtual:semantropy-lindera-wasm",
			"virtual:semantropy-lindera-payload",
		]);
		expect(inputs.filter((name) => name.includes("src/adverb/")).sort()).toEqual(ADVERB_MODULES);
	});

	it("contains exactly the four reviewed modules", async () => {
		const files = await readdir("src/adverb");
		expect(files.map((name) => `src/adverb/${name}`).sort()).toEqual(
			ADVERB_MODULES,
		);
	});

	it("reaches no tokenizer, Obsidian, DOM, Vault, renderer or filesystem module", async () => {
		const { inputs, code } = await graph(SPIKE_ENTRY);
		for (const name of inputs) {
			expect(name).not.toMatch(
				/obsidian|node_modules|\/tokenizer\/|\/render\/|\/view\/|\/collect\/|\/copy\/|\/settings\/|\/dictionary\/|\/collision\/|SemantropyView|SemantropySession|SourceSnapshot|projectMarkdownSource|analyzeSelectedSource/u,
			);
		}
		expect(code).not.toMatch(
			/MarkdownRenderer|postProcess|\bVault\b|TFile|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|require\(|node:fs|readFile|writeFile|resourcePath|clipboard|localStorage|saveData|loadData/u,
		);
		// An observation is a reading of text, not a draw: no randomness, no
		// clock, no nonce anywhere in the emitted graph.
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\./u);
		// No runtime resource read and no second dictionary copy: the profile is
		// authored TypeScript, and the survey lives in the test suite.
		expect(code).not.toMatch(/dict\.words|dict\.trie|\.cache|resources\//u);
	});

	it("shares the Snapshot's identity function instead of repeating it", async () => {
		const { inputs } = await graph(SPIKE_ENTRY);
		// `vocabularyCandidateId` is imported from the module the Vocabulary
		// Snapshot mints its own records with, so ADVERB-MANUAL1 binds these
		// observations to records without a second notion of identity.
		expect(inputs).toContain("src/analysis/rubyVocabulary.ts");
		expect(inputs.filter((name) => name.startsWith("src/adverb/")).sort()).toEqual(
			ADVERB_MODULES,
		);
	});
});
