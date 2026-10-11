// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";

/*
 * TRAILING-SPACE1 in the body the writer sees. A note pasted from the web has half-width spaces and tabs at the ends of its
 * lines; the body reads those lines like any other, and shows them without the blank (so Copy and Collect, which take
 * what is shown, have none either).
 */

let restore: () => void;
const harnesses: ReturnType<typeof manualMorphHarness>[] = [];
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(async () => { for (const h of harnesses.splice(0)) await h.view.onClose(); document.body.replaceChildren(); });

const noun = (surface: string): JapaneseToken => ({ surface, pos: "名詞", detail1: "一般", detail2: "*", detail3: "*", conjugationType: "*",
	conjugationForm: "*", baseForm: surface, isUnknown: false });
const lexicon = ["猫", "犬", "鳥", "魚", "花", "木"].map(noun);

async function opened(text: string, size = 5000) {
	const h = manualMorphHarness(lexiconTokenizer(lexicon), size); harnesses.push(h);
	await h.open(text);
	return h;
}
const words = (h: Awaited<ReturnType<typeof opened>>): string[] => h.plan().slots.map((slot) => slot.originalToken.surface).filter((surface) => lexicon.some((entry) => entry.surface === surface));

describe("the body of a note with blanks at the ends of its lines", () => {
	it("lets the words of those lines be replaced, and shows each line without its blank", async () => {
		const h = await opened("猫と犬。 \n鳥と魚。\t\n\n花と木。  ");
		expect(words(h)).toEqual(["猫", "犬", "鳥", "魚", "花", "木"]);
		const shown = h.root().textContent ?? "";
		expect(shown).toContain("猫と犬。");
		expect(shown).toContain("花と木。");
		expect(shown).not.toMatch(/[ \t]/u);
	});

	it("shows the same text and the same words as the note without the blanks", async () => {
		const pasted = "猫と犬。 \n鳥と魚。\t\n\n花と木。  ";
		const plain = await opened("猫と犬。\n鳥と魚。\n\n花と木。");
		const blank = await opened(pasted);
		expect(blank.root().textContent).toBe(plain.root().textContent);
		expect(words(blank)).toEqual(words(plain));
	});

	it("reads the same lines whole or in Chunks, so every Chunk has the words of its lines", async () => {
		const lines = Array.from({ length: 60 }, (_unused, index) => `${["猫", "犬", "鳥", "魚", "花", "木"][index % 6]}と空。${index % 3 === 0 ? " " : index % 3 === 1 ? "\t" : "  "}`);
		const pasted = lines.join("\n");
		const whole = await opened(pasted, 100_000);
		const chunked = await opened(pasted, 40);
		expect(whole.controller().hasNext()).toBe(false);
		expect(chunked.controller().hasNext()).toBe(true);
		while (chunked.controller().hasNext()) {
			expect(await chunked.view.loadNextSection()).toBe("applied");
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		expect(words(whole).length).toBe(60);
		expect(words(chunked)).toEqual(words(whole));
		expect(chunked.root().textContent).toBe(whole.root().textContent);
		expect(whole.root().textContent).not.toMatch(/[ \t]/u);
		expect(chunked.root().textContent).not.toMatch(/[ \t]/u);
	});
});
