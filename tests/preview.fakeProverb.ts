import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN } from "../scripts/fakeProverb/standardRecipes.mjs";
import { buildTokenize, compactDictionaryDir, initLindera } from "./distribution/linderaFixture";
import { buildFakeProverbPreview } from "./support/fakeProverbPreview";

/*
 * `npm run preview:fake-proverb` (FAKE-PROVERB-RECIPES3). Not a test: it reads the recipe document as it stands and
 * writes examples of every proverb and gloss, made from the three web presets, to a file Git ignores. It never
 * touches the generated module or the lock, so the owner can run it as often as they like before raising data-version.
 * It needs the prepared dictionary (`npm run build` once).
 */

export const FAKE_PROVERB_PREVIEW_OUTPUT = ".cache/fake-proverb-preview.md";
const BATCHES = 400;

it("writes examples of every Fake Proverb type", async () => {
	const presets = JSON.parse(readFileSync("web/presets/presets.json", "utf8")) as { title: string; file: string }[];
	await initLindera();
	const preview = await buildFakeProverbPreview({
		markdown: readFileSync(STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN, "utf8"),
		sources: presets.map((preset) => ({ title: preset.title, text: readFileSync(path.join("web/presets", preset.file), "utf8") })),
		tokenize: buildTokenize(compactDictionaryDir()),
		batches: BATCHES,
		made: new Date().toLocaleString("ja-JP", { hour12: false }),
	});
	if (!preview.ok) {
		process.stdout.write(`\n${preview.explanation}\n\n`);
		expect.fail("レシピのファイルに書き間違いがあります。上の説明を見てください。出力の例は、書き出していません。");
	}
	mkdirSync(path.dirname(FAKE_PROVERB_PREVIEW_OUTPUT), { recursive: true });
	writeFileSync(FAKE_PROVERB_PREVIEW_OUTPUT, preview.markdown, "utf8");
	process.stdout.write(`\n出力の例を書き出しました: ${FAKE_PROVERB_PREVIEW_OUTPUT}\n（data-version ${preview.dataVersion}。ことわざ ${preview.proverbs} 個、解説 ${preview.glosses} 個）\n\n`);
});
