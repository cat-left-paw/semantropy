import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { COLLISION_PRODUCTION_MODULES } from "./support/collisionProductionGraph";

describe("Collision View production and capability boundaries", () => {
	it("routes production View through Session and authenticated BATCH1 with generated typed patterns", async () => {
		const result = await build({ entryPoints: ["src/SemantropyPlugin.ts"], bundle: true, write: false, metafile: true,
			platform: "neutral", format: "esm", external: ["obsidian"] });
		const inputs = result.metafile.inputs;
		expect(Object.keys(inputs).filter(name => name.startsWith("src/collision/")).sort()).toEqual(COLLISION_PRODUCTION_MODULES);
		const imports = (name: string) => inputs[name]!.imports.map(item => item.path);
		expect(imports("src/view/SemantropyView.ts")).toEqual(expect.arrayContaining(["src/view/CollisionSession.ts", "src/view/CollisionModal.ts"]));
		expect(imports("src/view/CollisionSession.ts").filter(name => name.startsWith("src/collision/"))).toEqual([
			"src/collision/collisionBatch.ts", "src/collision/compilePatternSet.ts", "src/collision/generated/standardCollisionPatternEntries.ts",
		]);
		expect(imports("src/collision/collisionBatch.ts")).toContain("src/collision/collisionVocabulary.ts");
		expect(imports("src/collision/collisionVocabulary.ts")).toContain("src/transform/manualMorphology.ts");
	});
	it("adds no runtime file, network, Markdown, settings, writer or tokenizer capability to Session", async () => {
		const result = await build({ entryPoints: ["src/view/CollisionSession.ts"], bundle: true, write: false, metafile: true,
			platform: "neutral", format: "esm", legalComments: "none" });
		const code = result.outputFiles[0]!.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
		expect(Object.keys(result.metafile.inputs).join("\n")).not.toMatch(/node_modules|\/tokenizer\/|\/render\/|\/settings\/|FragmentRepository|CollectionStorage|\.md$/u);
		expect(code).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|MarkdownRenderer|DOMParser|readFile|writeFile|readText|tokenize\(|localStorage|saveData|loadData|console\.|Math\.random|Date\.now|STANDARD_COLLISION_PATTERN_DATA_JSON/u);
		const session = await readFile("src/view/CollisionSession.ts", "utf8");
		for (const method of ["createCollisionBatchController", "beginGenerate", "beginRegenerate", "prepare", "complete", "select", "cancel", "close", "dispose", "collisionFragmentFromBatch"]) expect(session).toContain(`${method}(`);
		expect(session).not.toMatch(/\b(?:generateCollisionResults|buildCollisionLexemePool|buildAuthenticatedCollisionLexemePool|buildManualMorphVocabulary|analyzeManualMorphSource)\s*\(/u);
	});
	it("renders text with fixed elements and keeps private material out of DOM/settings/logging", async () => {
		const modal = await readFile("src/view/CollisionModal.ts", "utf8");
		expect(modal).toContain("textContent");
		expect(modal).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|MarkdownRenderer|DOMParser|localStorage|console\.|nonce|operationMaterial|identityMaterial/u);
		const view = await readFile("src/view/SemantropyView.ts", "utf8");
		const begin = view.indexOf("openCollision(): void"), end = view.indexOf("closeCollision(): void", begin);
		const entry = view.slice(begin, end);
		expect(entry).toContain("new Uint8Array(32)"); expect(entry).toContain("crypto.getRandomValues(bytes)");
		expect(entry).not.toMatch(/issueUint32Seed|Math\.random|Date\.now|readCurrentText|tokenize|setDisplaySettings|console\./u);
	});
});
