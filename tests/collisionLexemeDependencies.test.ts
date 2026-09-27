import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { COLLISION_PRODUCTION_MODULES } from "./support/collisionProductionGraph";

/**
 * `PRE-RELEASE-COLLISION-LEXEME1` boundaries, read from the module graph
 * rather than inferred from behaviour.
 *
 * Three claims are checked here.
 *
 *   - The pool builder is a leaf: it cannot tokenize, read a file or a
 *     resource, reach the network, write the Clipboard or the Vault, or touch
 *     persistence, because none of that is reachable from it.
 *   - VIEW1 connects exactly the reviewed Collision modules to production.
 *   - `src/transform/regularConjugationTypes.ts` — the shared conjugation
 *     allowlist this slice extracted — *is* reachable from production, through
 *     Manual Morph. That extraction is the whole reason `main.js` changed by
 *     +4 bytes, so it is asserted rather than assumed. This slice is not
 *     `main.js`-neutral, and these checks do not claim it is: they establish
 *     which module is responsible for the delta. The byte-level evidence is in
 *     `Docs/pre_release_collision_lexeme1_record.md` §12.
 */

const LEXEME_ENTRY = "src/collision/collisionLexemePool.ts";

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

describe("the Collision lexeme pure-core dependency boundary", () => {
	it("reaches no tokenizer, Obsidian, DOM, Vault, renderer, resource or filesystem module", async () => {
		const { inputs, code } = await graph(LEXEME_ENTRY);
		for (const name of inputs) {
			expect(name).not.toMatch(
				/obsidian|node_modules|\/tokenizer\/|\/render\/|\/view\/|\/collect\/|\/settings\/|SemantropyView|SemantropySession|SourceSnapshot|projectMarkdownSource|analyzeSelectedSource/u,
			);
		}
		expect(code).not.toMatch(
			/MarkdownRenderer|postProcess|\bVault\b|TFile|fetch\(|XMLHttpRequest|WebSocket|DOMParser|document\.|window\.|navigator\.|require\(|node:fs|readFile|writeFile|resourcePath|clipboard|localStorage|saveData|loadData/u,
		);
		// A lexeme pool is a value, not a draw: no randomness, no clock, no nonce.
		expect(code).not.toMatch(/Math\.random|Date\.now|new Date|performance\./u);
	});

	it("never imports the generated standard pattern entries", async () => {
		const { inputs } = await graph(LEXEME_ENTRY);
		expect(
			inputs.filter((name) => name.includes("generated/standardCollisionPattern")),
		).toEqual([]);
	});

	it("joins production through VIEW1 without widening the pure builder's capabilities", async () => {
		const { inputs } = await graph("src/SemantropyPlugin.ts", ["obsidian"]);
		expect(inputs.filter((name) => name.includes("collisionLexemePool"))).toEqual(
			[LEXEME_ENTRY],
		);
		expect(inputs.filter((name) => name.includes("regularInflection"))).toEqual(
			["src/collision/regularInflection.ts"],
		);
		expect(
			inputs.filter((name) => name.includes("src/collision/")).sort(),
		).toEqual(COLLISION_PRODUCTION_MODULES);
	});

	it("accounts for the one module this slice did add to production", async () => {
		const { inputs } = await graph("src/SemantropyPlugin.ts", ["obsidian"]);
		// Manual Morph pulls the shared allowlist in. It is the only module this
		// slice added to the production graph, and the only cause of the +4-byte
		// `main.js` change.
		expect(
			inputs.filter((name) =>
				name.endsWith("src/transform/regularConjugationTypes.ts"),
			),
		).toEqual(["src/transform/regularConjugationTypes.ts"]);

		// It is a leaf: it imports nothing, so extracting it moved constants
		// without widening what production reaches.
		const shared = await graph("src/transform/regularConjugationTypes.ts");
		expect(shared.inputs).toEqual([
			"src/transform/regularConjugationTypes.ts",
		]);
	});
});
