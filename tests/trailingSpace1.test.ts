import { describe, expect, it } from "vitest";
import {
	projectMarkdownSource, SOURCE_PROJECTION_POLICY_VERSION, TARGET_PRESENTATION_POLICY_VERSION, type MarkdownSourceProjection,
} from "../src/analysis/projectMarkdownSource";
import { analyzeManualMorphSource, buildManualMorphVocabulary } from "../src/transform/manualMorphology";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { lexiconTokenizer } from "./support/manualMorphHarness";
import { projectionDigest, unchangedNotes } from "./support/trailingSpace1Corpus";

/*
 * TRAILING-SPACE1. A line that ends in half-width spaces or tabs (pasted web articles carry them) used to be protected whole:
 * its words were neither replaced nor part of the Vocabulary. Now such a line is read as if it ended before them, and the
 * blank is syntax: shown, copied and collected as nothing. Every other note is read exactly as before. The Target
 * projection's policy is therefore target-presentation-3; Source mode is untouched.
 */

/** A full-width space and a no-break space: blanks, but not half-width ones. Named so that no file holds them invisibly. */
const WIDE = String.fromCharCode(0x3000), NBSP = String.fromCharCode(0xa0);

const target = (text: string): MarkdownSourceProjection => projectMarkdownSource(text, "target-prototype");
const runTexts = (p: MarkdownSourceProjection): string[] => p.document.runs.map((run) => run.analysisText);
/** The text a reader gets from a block (and so Copy and Collect): what is analyzed and what is shown as it is. */
function logicalText(p: MarkdownSourceProjection): string[] {
	const segments = new Map(p.document.segments.map((segment) => [segment.run.runId, segment]));
	return p.presentation.blocks.map((block) => block.items.map((item) => {
		if (item.kind === "break") return "";
		if (item.kind === "static") return item.placeholder ? "" : item.text;
		return segments.get(item.runId)!.run.sourceParts.filter((part) => part.kind === "text" || part.kind === "ruby-base").map((part) => part.text).join("");
	}).join(""));
}
/** The half-width blank at the end of each line, as raw ranges. */
function blanksOf(text: string): { start: number; end: number }[] {
	const found: { start: number; end: number }[] = [];
	for (const match of text.matchAll(/[ \t]+(?=\r\n|\n|\r|$)/gu)) found.push({ start: match.index, end: match.index + match[0].length });
	return found;
}
const withoutBlanks = (text: string): string => text.replaceAll(/[ \t]+(?=\r\n|\n|\r|$)/gu, "");

/** [label, source digest, target digest] of notes with no blank at the end of a line, taken from the code before this change. */
const UNCHANGED: readonly (readonly [string, string, string])[] = [
	["preset kumono-ito", "7fb82fecf024facecc7e5b8d3aa5dc36ee90a6ef970fcfc418d54e7d864e9b95", "8659b66cd07b395f92b24610c25697671b214f7e6314df6fc6f2a739ad0c4d66"],
	["preset yume-juya", "b1383e458c09e1caec8939e272b668a6d18d6b291a7cf0e2323c5f7c30062f3d", "540623d9adceb38201869ca89ba2129ad390c613511e1c1437712c91f543f59a"],
	["preset chumonno-oi-ryoriten", "3427c3e89d17db7c7c9a487e4cfbaa487579b6e1f7bb393a4c788c49a086b036", "c43bffa1ef6c5efcee58854060c38bb7bbd1757a9f7fac3ee2dc64e60f84db27"],
	["fixture markdown-protection.md", "a1637a4d00b7ec2b53887408a1902bd25405db3b83cfb7511a4c1e0ad12e3a2f", "a586c799ef709f24a6ec2d33f9fa306f419ea9d23e3864db82a9ef4ac55e0fc5"],
	["fixture ruby-analysis.md", "debb8d8ae84c6c766bbd0aacf5574c7046d1a98b3347992558c3749882f6a7a8", "796d0203944f747024f8795896663df0327af18991d843db6deaad5020e53e16"],
	["safe fixture blocks / heading", "aa806ff4d8a0249b644e1aa9438f86d4c057d8ca3d8e61b1b8747cbd3e5a1049", "aa806ff4d8a0249b644e1aa9438f86d4c057d8ca3d8e61b1b8747cbd3e5a1049"],
	["safe fixture inline decorations", "e97d9f3c66ebcaff37b2c49ed055c493439460b2e5dea4e9d09f40dbb7589ad0", "e97d9f3c66ebcaff37b2c49ed055c493439460b2e5dea4e9d09f40dbb7589ad0"],
	["safe fixture short and explicit ruby", "8a4689889f7f4004eedd08a5f3cb6f276c8d27d7745a681bc3f0f32c38173e7a", "8a4689889f7f4004eedd08a5f3cb6f276c8d27d7745a681bc3f0f32c38173e7a"],
	["safe fixture HTML / okurigana", "2a8a28b06c5f774dbbe0833952938521dcd433ae678e5a136962cb7cae433146", "2a8a28b06c5f774dbbe0833952938521dcd433ae678e5a136962cb7cae433146"],
	["safe fixture code / link / math / tag", "0f35ae2f377990c5ae7f477d49de194341cb014d5d940b11c4354f4658277e88", "0f35ae2f377990c5ae7f477d49de194341cb014d5d940b11c4354f4658277e88"],
	["safe fixture visible escape", "2cf867242a13cbf9d5a798ff12abf258449c344cd74ef3431a7d43e71a7dc69b", "2cf867242a13cbf9d5a798ff12abf258449c344cd74ef3431a7d43e71a7dc69b"],
	["safe fixture soft lines", "b2d590be312318b5b43d4908a621a83b91a0c6eb5e741f4e9235573e4f488d2b", "d8b50bf8cc04b61d469460ba7ac2c8ccd3097fd93fe9da797a251b9a6d336db9"],
	["mixed note, LF", "6dfd49efffe12cd0ff7d9a6b20a36313fe60ebedb0e55015d35ec9086a09ba8a", "ae8235f0887c11ad4c9b240eaed98823aa6ed65cb98850d45b06fcb588aec3fe"],
	["mixed note, CRLF", "c0ced798cfb7d0c65b2948446994dfcf20f22f234e23fab947273c659e05fcc6", "f33073aa67f5e1c329b0e04cc486d9842b03c4baed234aa057a553e1ce7a90cf"],
	["mixed note, CR", "9e6de2b08f9dbadebfd44959decb175f05bd5753c19e94c276a249fd50a92234", "305da74eba9042bcee08cdb14ecc258d619e3daddf74fb20c16fc392182d197d"],
	["mixed note, LF and a final newline", "0e77814aa2d11bd1a7d2a824f046a538ea10a818def94e69fd2cbab3850c338e", "ec798cc4a3f4c9a3f2a2856413328d87369521fe7442f97e22db44eb9a267609"],
	["mixed note, no frontmatter, starting with a heading", "a896b13686c65105a7ab1f4656db245c9aed299bbb26c9c86b0f53dd2478d70a", "a86815fe6ac640ab3a9fb43a9459af4a84df61881dd7e2d357a61023cb6aaab8"],
];

describe("a note with no blank at the end of a line", () => {
	it("is read exactly as it was read before this change, in both modes (the digests leave out the policy's name)", () => {
		const notes = unchangedNotes();
		expect(notes.map(([label]) => label)).toEqual(UNCHANGED.map(([label]) => label));
		for (const [index, [label, text]] of notes.entries()) {
			// A fixture is only evidence if it has no such line: this is what the claim is about.
			expect(blanksOf(text), label).toEqual([]);
			expect([label, projectionDigest(text, "source"), projectionDigest(text, "target-prototype")], label).toEqual(UNCHANGED[index]);
		}
	});

	it("is read under the new policy's name, and Source mode keeps its own", () => {
		expect(TARGET_PRESENTATION_POLICY_VERSION).toBe("target-presentation-3");
		expect(SOURCE_PROJECTION_POLICY_VERSION).toBe("source-projection-1");
		expect(target("本文。").policyVersion).toBe("target-presentation-3");
		expect(projectMarkdownSource("本文。").policyVersion).toBe("source-projection-1");
	});
});

describe("a line that ends in half-width spaces or tabs", () => {
	/** [label, note]: each is read as the same note without its blanks, in Target mode. */
	const lines: readonly (readonly [string, string])[] = [
		["one space", "猫と犬が歩く。 "],
		["two spaces, a hard break in Markdown", "猫と犬が歩く。  "],
		["many spaces", "猫と犬が歩く。       "],
		["a tab", "猫と犬が歩く。\t"],
		["spaces and tabs mixed", "猫と犬が歩く。 \t \t"],
		["a heading", "# 題名です \n\n本文です。 "],
		["a heading with a level", "### 小見出し\t\n"],
		["LF", "一行目。 \n二行目。\t\n三行目。  \n"],
		["CRLF", "一行目。 \r\n二行目。\t\r\n三行目。  \r\n"],
		["CR", "一行目。 \r二行目。\t\r三行目。  \r"],
		["the last line without a newline", "一行目。\n最後の行。 "],
		["blank lines between paragraphs", "段落一。 \n\n段落二。\t\n\n\n段落三。  "],
		["a soft-wrapped paragraph that mixes both", "一行目。 \n二行目。\n三行目。  \n四行目。\n"],
		["ruby right before the blank", "漢字《かんじ》 \n｜親文字《おやもじ》\t\n<ruby>漢<rt>かん</rt></ruby> "],
		["an Aozora annotation right before the blank", "ひらがなの※［＃「口＋禺」、第3水準1-15-9］《ぐう》という字。 "],
		["emphasis and a code span right before the blank", "**強調** と `code` \n~~消す~~ "],
		["a link and an embed right before the blank", "参照は[語](note.md)と![[image.png]]です。 "],
		["an enclosed term right before the blank", "{{語のまとまり}} \n{{別の語}}\t"],
		["a full-width space before the blank", `全角の空白${WIDE} `],
	];

	it.each(lines)("is read as the line without them: %s", (_label, text) => {
		const plain = withoutBlanks(text);
		expect(blanksOf(text).length).toBeGreaterThan(0);
		const read = target(text), reference = target(plain);
		expect(runTexts(read)).toEqual(runTexts(reference));
		expect(runTexts(read).length).toBeGreaterThan(0);
		expect(read.presentation.blocks.map((block) => [block.tag, block.items.map((item) => item.kind)]))
			.toEqual(reference.presentation.blocks.map((block) => [block.tag, block.items.map((item) => item.kind)]));
		expect(read.presentation.decorations.map((decoration) => decoration.tag)).toEqual(reference.presentation.decorations.map((decoration) => decoration.tag));
		// What Copy and Collect take is the same: the blank is not in it.
		expect(logicalText(read)).toEqual(logicalText(reference));
		for (const block of logicalText(read)) expect(block).not.toMatch(/[ \t]$/u);
	});

	it.each(lines)("puts every raw offset where the note has it, and the blank is syntax, not text: %s", (_label, text) => {
		const read = target(text);
		const excluded = (at: number): boolean => read.exclusions.some((entry) => entry.reason === "syntax" && entry.range.start <= at && at < entry.range.end);
		// Every binding is exactly the note's own characters at its raw range.
		const bindings = new Map(read.bindings.map((binding) => [binding.sourceId, binding]));
		for (const binding of read.bindings) expect(text.slice(binding.rawRange.start, binding.rawRange.end)).toBe(binding.text);
		// Every analyzed character sits at the raw offset the mapping says, and none of them is a blank at the end of a line.
		const blank = new Set(blanksOf(text).flatMap(({ start, end }) => Array.from({ length: end - start }, (_unused, offset) => start + offset)));
		let checked = 0;
		for (const run of read.document.runs) {
			for (const mapping of run.mapping) {
				const binding = bindings.get(mapping.sourcePart.sourceId)!;
				const raw = binding.rawRange.start + mapping.sourcePart.range.start;
				const analyzed = run.analysisText.slice(mapping.analysisRange.start, mapping.analysisRange.end);
				for (let offset = 0; offset < analyzed.length; offset += 1) {
					expect(text[raw + offset]).toBe(analyzed[offset]);
					expect(blank.has(raw + offset)).toBe(false);
					checked += 1;
				}
			}
		}
		expect(checked).toBeGreaterThan(0);
		// The blank of an analyzed line is excluded as syntax, whole.
		for (const { start, end } of blanksOf(text)) for (let at = start; at < end; at += 1) expect(excluded(at), `offset ${at}`).toBe(true);
	});

	it("still protects a line for any other reason, whatever blank follows it", () => {
		const protectedOtherwise: readonly (readonly [string, string])[] = [
			["a leading space", "  字下げの行。 "],
			["a leading tab", "\t字下げの行。\t"],
			["a bracket at its start", "[閉じない括弧 "],
			["a URL", "猫と https://example.invalid/犬 の行 "],
			["an unclosed code span", "`閉じない "],
			["a tab inside the line", "猫\tと犬。 "],
			["an HTML tag", "<span>猫</span> "],
			["a table row", "| 猫 | 犬 | "],
			["an empty heading", "# "],
			["an empty heading with more blank", "#   \t"],
		];
		for (const [label, text] of protectedOtherwise) {
			expect(runTexts(target(text)), label).toEqual([]);
			expect(runTexts(target(withoutBlanks(text))), label).toEqual([]);
		}
	});

	it("keeps a blank that is not half-width where it was: in the text, analyzed", () => {
		expect(runTexts(target(`猫と犬。${WIDE}`))).toEqual([`猫と犬。${WIDE}`]);
		expect(runTexts(target(`猫と犬。${NBSP}`))).toEqual([`猫と犬。${NBSP}`]);
		// A half-width space inside the line is part of it, as it always was.
		expect(runTexts(target("猫 と犬。 "))).toEqual(["猫 と犬。"]);
		// Only the end of the line is read as a blank: a full-width space, then a half-width one.
		expect(runTexts(target(`猫と犬。${WIDE} `))).toEqual([`猫と犬。${WIDE}`]);
	});

	it("reads each line of a paragraph for itself, so one with a blank does not change the lines beside it", () => {
		const read = target("猫の行。 \n  字下げの行。 \n犬の行。\t\n[括弧の行 \n鳥の行。 ");
		const analyzed = runTexts(read).map((text) => text.replaceAll(/[\r\n]/gu, ""));
		for (const line of ["猫の行。", "犬の行。", "鳥の行。"]) expect(analyzed).toContain(line);
		for (const text of analyzed) {
			expect(text).not.toContain("字下げ");
			expect(text).not.toContain("括弧");
		}
	});
});

describe("a Vocabulary, through the production path", () => {
	const noun = (surface: string): JapaneseToken => ({ surface, pos: "名詞", detail1: "一般", detail2: "*", detail3: "*", conjugationType: "*",
		conjugationForm: "*", baseForm: surface, isUnknown: false });
	const lexicon = ["猫", "犬", "鳥", "魚", "花", "木", "月", "星"].map(noun);
	async function surfaces(text: string, mode: "source" | "target-prototype" = "target-prototype"): Promise<string[]> {
		const analyzed = await analyzeManualMorphSource({ text, sourcePath: "pasted.md", tokenizer: lexiconTokenizer(lexicon), mode });
		if (analyzed.status !== "ready") throw new Error(analyzed.status);
		const vocabulary = buildManualMorphVocabulary({ sources: [analyzed.analysis], drawMode: "uniform" });
		// Every token is a candidate; the words of the lexicon are the ones the notes were written with.
		const words = new Set(lexicon.map((entry) => entry.surface));
		return [...new Set(vocabulary.snapshot.projections.manual.candidates.map((candidate) => candidate.surface).filter((surface) => words.has(surface)))].sort();
	}

	it("takes the words of a line with a blank at its end, and the same words the note without the blanks has", async () => {
		const pasted = "猫と犬。 \n鳥と魚。\t\n\n花と木。  \n月と星。 ";
		const taken = await surfaces(pasted);
		expect(taken).toEqual(["星", "月", "木", "花", "魚", "鳥", "犬", "猫"].sort());
		expect(await surfaces(withoutBlanks(pasted))).toEqual(taken);
	});

	it("leaves Source mode as it was: a line with a blank is still protected there (the product does not use that mode)", async () => {
		expect(await surfaces("猫と犬。", "source")).toEqual(["犬", "猫"]);
		expect(await surfaces("猫と犬。 ", "source")).toEqual([]);
	});
});
