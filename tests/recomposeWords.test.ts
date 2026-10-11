// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { analyzeSelectedSource } from "../src/application/analyzeSelectedSource";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphVocabulary } from "../src/transform/manualMorphology";
import { enclosedTermSyntax } from "../src/vocabulary/enclosedTerms";
import { validateHeadword } from "../src/dictionary/headword";
import { createSeededRandom } from "../src/random/seededRandom";
import { RECOMPOSE_CORPUS_VERSION, buildRecomposeCorpus, type RecomposeCorpus, type RecomposeSourceInput } from "../src/recompose/recomposeCorpus";
import { createRecomposeModel, generateRecompose, type RecomposeMethodId } from "../src/recompose/recompose";
import { RecomposePane } from "../src/view/RecomposePane";
import { RecomposeSession, type RecomposeHost } from "../src/view/RecomposeSession";
import { recomposeWordsOf, withRecomposeWords } from "../src/view/recomposeWords";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { ui } from "../src/i18n/catalog";
import type { JapaneseToken, JapaneseTokenizer } from "../src/tokenizer/JapaneseTokenizer";
import type { RecomposeFragmentInputV5 } from "../src/collect/v4/CollectedFragmentV4";

/**
 * FAKE-DICT-RECOMPOSE1, the word elements: which morphemes of a Recompose piece the Fake Dictionary can look up
 * (the Shuffle body's own rule), where they stand in the piece's text when the core has changed that text, that a
 * morpheme's reading reaches the corpus without changing one character of what Recompose writes, and that the pane
 * shows the words without changing its text, its branch point or its keys.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => setCurrentUiLanguage("en"));

const NOUNS: readonly [string, string, string?][] = [
	["猫", "ネコ"], ["犬", "イヌ"], ["森", "モリ"], ["駅", "エキ"], ["雨", "アメ"], ["窓", "マド"], ["少年", "ショウネン"], ["少女", "ショウジョ"],
];
const LEXICON: readonly JapaneseToken[] = [
	...NOUNS.map(([surface, reading]) => token({ surface, reading })),
	token({ surface: "太郎", detail1: "固有名詞", detail2: "人名" }), token({ surface: "三", detail1: "数" }),
	token({ surface: "彼", detail1: "代名詞", detail2: "一般" }), token({ surface: "こと", detail1: "非自立", detail2: "一般" }),
	token({ surface: "静か", detail1: "形容動詞語幹" }),
	token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
	token({ surface: "で", pos: "助詞", detail1: "格助詞" }), token({ surface: "は", pos: "助詞", detail1: "係助詞" }),
	token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
	token({ surface: "走っ", pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "連用タ接続", baseForm: "走る" }),
	token({ surface: "た", pos: "助動詞", conjugationType: "特殊・タ", conjugationForm: "基本形", baseForm: "た" }),
	token({ surface: "。", pos: "記号", detail1: "句点" }), token({ surface: "、", pos: "記号", detail1: "読点" }),
	token({ surface: "「", pos: "記号", detail1: "括弧開" }), token({ surface: "」", pos: "記号", detail1: "括弧閉" }),
];

function tokenizerOf(lexicon: readonly JapaneseToken[], transform: (token: JapaneseToken) => JapaneseToken = value => value): JapaneseTokenizer {
	const sorted = [...lexicon].sort((a, b) => b.surface.length - a.surface.length);
	return {
		tokenize: async text => {
			const out: JapaneseToken[] = [];
			for (let i = 0; i < text.length;) {
				const found = sorted.find(t => text.startsWith(t.surface, i));
				const next = found ? { ...found } : token({ surface: text[i]!, pos: "記号", detail1: /\s/u.test(text[i]!) ? "空白" : "一般", isUnknown: true });
				out.push(transform(next));
				i += next.surface.length;
			}
			return out;
		},
	};
}

async function source(tokenizer: JapaneseTokenizer, path: string, text: string): Promise<RecomposeSourceInput> {
	const analyzed = await analyzeSelectedSource({ text, sourcePath: path, contentHash: `h:${path}`, tokenizer, mode: "target-prototype" });
	if (analyzed.status !== "ready") throw new Error("analysis failed");
	return { path, contentHash: `h:${path}`, projection: analyzed.projection, located: analyzed.located };
}

const TEXT = "少年は駅で猫を見た。少女は森で犬を見た。\n猫は窓で雨を見た。犬は駅で走った。\n\n「少年は猫を見た」少女は雨を見た。「太郎は静か」彼は三で走った。こと。";

describe("the reading a morpheme carries", () => {
	it("is in the corpus when the token has one, and the corpus version stays 1", async () => {
		const corpus = buildRecomposeCorpus([await source(tokenizerOf(LEXICON), "a.md", TEXT)]);
		expect(RECOMPOSE_CORPUS_VERSION).toBe(1);
		expect(corpus.version).toBe(1);
		expect(corpus.morphs.find(morph => morph.surface === "猫")?.reading).toBe("ネコ");
		expect(corpus.morphs.find(morph => morph.surface === "が" || morph.surface === "を")?.reading).toBeUndefined();
	});

	for (const method of ["joint", "ngram"] as const satisfies readonly RecomposeMethodId[]) {
		it(`${method}: changes no character, piece or jump Recompose writes`, async () => {
			const withReadings = buildRecomposeCorpus([await source(tokenizerOf(LEXICON), "a.md", TEXT)]);
			const stripped = buildRecomposeCorpus([await source(tokenizerOf(LEXICON, ({ reading: _reading, ...rest }) => rest), "a.md", TEXT)]);
			expect(withReadings.morphs.some(morph => morph.reading !== undefined)).toBe(true);
			expect(stripped.morphs.some(morph => morph.reading !== undefined)).toBe(false);
			expect(withReadings.morphs.map(({ reading: _reading, ...rest }) => rest)).toEqual(stripped.morphs.map(({ reading: _reading, ...rest }) => rest));
			expect(withReadings.sentences).toEqual(stripped.sentences);
			const a = createRecomposeModel(withReadings, method), b = createRecomposeModel(stripped, method);
			let compared = 0;
			for (const leap of [0, 50, 100]) for (const sentences of [1, 3, 5]) for (let seed = 1; seed <= 12; seed += 1) {
				const x = generateRecompose(a, { sentences, leap }, createSeededRandom(seed));
				const y = generateRecompose(b, { sentences, leap }, createSeededRandom(seed));
				expect(x).toEqual(y);
				compared += x.length;
			}
			expect(compared).toBeGreaterThan(500);
		});
	}
});

describe("which morphemes of a piece are words", () => {
	it("are the ones the Shuffle body's headword rule accepts, with the same headword", async () => {
		const corpus = buildRecomposeCorpus([await source(tokenizerOf(LEXICON), "a.md", TEXT)]);
		const seen = new Set<string>();
		corpus.morphs.forEach((morph, index) => {
			const words = recomposeWordsOf(corpus, { text: morph.surface, start: index, end: index + 1 });
			const original = LEXICON.find(entry => entry.surface === morph.surface) ?? token({ surface: morph.surface, pos: "記号", isUnknown: true });
			const expected = validateHeadword(morph.surface, [original]);
			if (expected.outcome === "accepted") {
				expect(words, morph.surface).toHaveLength(1);
				expect(words[0]!.headword).toEqual(expected.headword);
				expect([words[0]!.start, words[0]!.end]).toEqual([0, morph.surface.length]);
			} else {
				expect(words, morph.surface).toHaveLength(0);
			}
			seen.add(`${morph.pos}/${morph.detail1}/${expected.outcome}`);
		});
		// The fixture really covers accepted classes and several kinds of refusal.
		expect([...seen]).toEqual(expect.arrayContaining(["名詞/一般/accepted", "名詞/固有名詞/accepted", "名詞/数/accepted", "名詞/形容動詞語幹/accepted",
			"名詞/代名詞/rejected", "名詞/非自立/rejected", "助詞/格助詞/rejected", "動詞/自立/rejected", "記号/句点/rejected"]));
	});

	it("carry the reading, so the same word has the same identity in Shuffle and in Recompose", async () => {
		const corpus = buildRecomposeCorpus([await source(tokenizerOf(LEXICON), "a.md", TEXT)]);
		const index = corpus.morphs.findIndex(morph => morph.surface === "猫");
		const [word] = recomposeWordsOf(corpus, { text: "猫", start: index, end: index + 1 });
		expect(word!.headword.identity.reading).toBe("ネコ");
		expect(word!.headword.identity).toEqual((validateHeadword("猫", [LEXICON.find(entry => entry.surface === "猫")!]) as { headword: { identity: unknown } }).headword.identity);
	});

	describe("on the core's changed text", () => {
		const range = (corpus: RecomposeCorpus, surfaces: string) => {
			const joined = corpus.morphs.map(morph => morph.surface).join("");
			const at = joined.indexOf(surfaces);
			let start = 0, offset = 0;
			while (offset < at) { offset += corpus.morphs[start]!.surface.length; start += 1; }
			let end = start, length = 0;
			while (length < surfaces.length) { length += corpus.morphs[end]!.surface.length; end += 1; }
			return { start, end };
		};
		const words = async (morphs: string, text: string) => {
			const corpus = buildRecomposeCorpus([await source(tokenizerOf(LEXICON), "a.md", TEXT)]);
			return recomposeWordsOf(corpus, { text, ...range(corpus, morphs) }).map(word => [word.headword.surface, word.start, word.end]);
		};

		it("finds them in a text that is exactly the morphemes", async () => {
			expect(await words("猫は窓で雨を見た。", "猫は窓で雨を見た。")).toEqual([["猫", 0, 1], ["窓", 2, 3], ["雨", 4, 5]]);
		});

		it("skips a closing bracket the core dropped and keeps the offsets after it", async () => {
			expect(await words("「少年は猫を見た」少女", "「少年は猫を見た少女")).toEqual([["少年", 1, 3], ["猫", 4, 5], ["少女", 8, 10]]);
			expect(await words("「少年は猫を見た」少女", "少年は猫を見た少女")).toEqual([]);
		});

		it("accepts closing brackets and 。 the core added after the last morpheme", async () => {
			expect(await words("「太郎は静か", "「太郎は静か」")).toEqual([["太郎", 1, 3], ["静か", 4, 6]]);
			expect(await words("猫は窓で雨を見た", "猫は窓で雨を見た。")).toEqual([["猫", 0, 1], ["窓", 2, 3], ["雨", 4, 5]]);
			expect(await words("「太郎は静か", "「太郎は静か。」")).toEqual([["太郎", 1, 3], ["静か", 4, 6]]);
		});

		it("gives no word to a text it cannot read: a different morpheme, other characters left over, a missing morpheme", async () => {
			expect(await words("猫は窓で雨を見た。", "犬は窓で雨を見た。")).toEqual([]);
			expect(await words("猫は窓で雨を見た。", "猫は窓で雨を見た。X")).toEqual([]);
			expect(await words("猫は窓で雨を見た。", "猫は窓で雨を見た。猫")).toEqual([]);
			expect(await words("猫は窓で雨を見た。", "猫は窓で雨を見")).toEqual([]);
			expect(await words("猫は窓で雨を見た。", "")).toEqual([]);
		});

		it("lays each morpheme at the place the text has reached, and never looks ahead for it", async () => {
			expect(await words("猫を見た", "猫を見た")).toEqual([["猫", 0, 1]]);
			// Something in front of the first morpheme, or between two: the morpheme is not found further on.
			expect(await words("猫を見た", "XX猫を見た")).toEqual([]);
			expect(await words("猫を見た", "猫Xを見た")).toEqual([]);
		});

		it("lets only closing brackets and 。 follow the last morpheme: an opening bracket does not belong there", async () => {
			expect(await words("猫は窓で雨を見た。", "猫は窓で雨を見た。「")).toEqual([]);
			expect(await words("猫は窓で雨を見た。", "猫は窓で雨を見た。（")).toEqual([]);
			expect(await words("猫は窓で雨を見た。", "猫は窓で雨を見た。」。」")).toEqual([["猫", 0, 1], ["窓", 2, 3], ["雨", 4, 5]]);
		});

		it("does not skip a morpheme that is not a closing bracket, even when the text does not have it", async () => {
			expect(await words("猫は窓で雨を見た。", "猫は窓雨を見た。")).toEqual([]);
			expect(await words("猫は窓で雨を見た。", "猫は窓で雨見た。")).toEqual([]);
		});

		it("refuses an impossible span", async () => {
			const corpus = buildRecomposeCorpus([await source(tokenizerOf(LEXICON), "a.md", TEXT)]);
			expect(recomposeWordsOf(corpus, { text: "猫", start: -1, end: 1 })).toEqual([]);
			expect(recomposeWordsOf(corpus, { text: "猫", start: 3, end: 2 })).toEqual([]);
			expect(recomposeWordsOf(corpus, { text: "猫", start: 0, end: corpus.morphs.length + 1 })).toEqual([]);
			// A span that is read all the way to the corpus's end and then goes on: the morphemes that do exist all match.
			const last = corpus.morphs.slice(-3).map(morph => morph.surface).join("");
			expect(recomposeWordsOf(corpus, { text: last, start: corpus.morphs.length - 3, end: corpus.morphs.length + 2 })).toEqual([]);
		});

		it("skips only a morpheme made wholly of closing brackets, not one that merely starts with one", async () => {
			const odd = token({ surface: "」あ", pos: "記号", detail1: "一般" });
			const corpus = buildRecomposeCorpus([await source(tokenizerOf([...LEXICON, odd]), "odd.md", "猫」あを見た。")]);
			expect(corpus.morphs.map(morph => morph.surface)).toContain("」あ");
			const sentence = corpus.sentences[0]!;
			// The text is what the morphemes make...
			expect(recomposeWordsOf(corpus, { text: "猫」あを見た。", start: sentence.start, end: sentence.end }).map(word => word.headword.surface)).toEqual(["猫"]);
			// ...and without that morpheme it is a text the core could not have made from this span.
			expect(recomposeWordsOf(corpus, { text: "猫を見た。", start: sentence.start, end: sentence.end })).toEqual([]);
		});

		it("never makes a word of an unknown token, nor of the 〓 that stands for protected text", async () => {
			const unknown = token({ surface: "謎", isUnknown: true });
			const corpus = buildRecomposeCorpus([await source(tokenizerOf([...LEXICON, unknown]), "u.md", "謎は猫を見た。猫は`code`を見た。")]);
			const surfaces = corpus.morphs.map(morph => morph.surface);
			expect(surfaces).toContain("謎");
			expect(surfaces).toContain("〓");
			const wordsOf = (index: number) => {
				const sentence = corpus.sentences[index]!;
				const text = corpus.morphs.slice(sentence.start, sentence.end).map(morph => morph.surface).join("");
				return recomposeWordsOf(corpus, { text, start: sentence.start, end: sentence.end }).map(word => word.headword.surface);
			};
			expect(wordsOf(0)).toEqual(["猫"]);
			expect(wordsOf(1)).toEqual(["猫"]);
		});
	});

	for (const method of ["joint", "ngram"] as const satisfies readonly RecomposeMethodId[]) {
		it(`${method}: in generated pieces, every word is a morpheme of its piece, at the place the text has it, in order`, async () => {
			const corpus = buildRecomposeCorpus([await source(tokenizerOf(LEXICON), "a.md", TEXT)]);
			const model = createRecomposeModel(corpus, method);
			let pieces = 0, worded = 0, changed = 0, changedWithWords = 0;
			for (const leap of [0, 60, 100]) for (let seed = 1; seed <= 40; seed += 1) {
				for (const unit of generateRecompose(model, { sentences: 4, leap }, createSeededRandom(seed))) {
					const shown = withRecomposeWords(corpus, unit);
					const surfaces = corpus.morphs.slice(unit.start, unit.end).map(morph => morph.surface);
					pieces += 1;
					if (shown.words.length > 0) worded += 1;
					if (unit.text !== surfaces.join("")) { changed += 1; if (shown.words.length > 0) changedWithWords += 1; }
					let after = 0;
					for (const word of shown.words) {
						expect(unit.text.slice(word.start, word.end)).toBe(word.headword.surface);
						expect(word.start).toBeGreaterThanOrEqual(after);
						expect(surfaces).toContain(word.headword.surface);
						after = word.end;
					}
					// The words are exactly the accepted nouns of the span, none missed and none added.
					const expected = corpus.morphs.slice(unit.start, unit.end).filter(morph => validateHeadword(morph.surface, [LEXICON.find(entry => entry.surface === morph.surface) ?? token({ surface: morph.surface, isUnknown: true })]).outcome === "accepted").map(morph => morph.surface);
					if (shown.words.length > 0) expect(shown.words.map(word => word.headword.surface)).toEqual(expected);
					else if (unit.text === surfaces.join("")) expect(expected).toEqual([]);
				}
			}
			expect(pieces).toBeGreaterThan(300);
			expect(worded).toBeGreaterThan(50);
			// The core changed some texts (brackets, an added 。) and those pieces still have their words.
			expect(changed).toBeGreaterThan(0);
			expect(changedWithWords).toBeGreaterThan(0);
		});
	}

	it("gives a piece frozen words that hold no corpus", async () => {
		const corpus = buildRecomposeCorpus([await source(tokenizerOf(LEXICON), "a.md", TEXT)]);
		const unit = generateRecompose(createRecomposeModel(corpus, "joint"), { sentences: 1, leap: 50 }, createSeededRandom(2))[0]!;
		const shown = withRecomposeWords(corpus, unit);
		expect(Object.isFrozen(shown)).toBe(true);
		expect(Object.isFrozen(shown.words)).toBe(true);
		// A piece is the core's unit and its words, nothing more: no corpus, no model, no morphemes.
		expect(Object.keys(shown).sort()).toEqual([...Object.keys(unit), "words"].sort());
		expect(JSON.stringify(shown)).not.toContain("morphs");
		for (const word of shown.words) {
			expect(Object.isFrozen(word)).toBe(true);
			expect(Object.keys(word).sort()).toEqual(["end", "headword", "start"]);
		}
	});
});

// ---- the pane and the session -------------------------------------------------------------------------------------

const PANE_LEXICON = [
	...["猫", "犬", "森", "川", "空"].map(surface => token({ surface })),
	token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
	token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
	token({ surface: "た", pos: "助動詞", detail1: "*" }),
];
const PANE_TEXT = "猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。";

async function mint(path: string): Promise<ManualMorphVocabulary> {
	const answer = await analyzeManualMorphSource({ text: PANE_TEXT, sourcePath: path, tokenizer: lexiconTokenizer(PANE_LEXICON), mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
	if (answer.status !== "ready") throw Error("fixture");
	return buildManualMorphVocabulary({ sources: [answer.analysis], drawMode: "uniform" });
}

function paneHarness() {
	let active: ManualMorphVocabulary | null = null, nonce = 1;
	const collects: RecomposeFragmentInputV5[] = [];
	const host: RecomposeHost = {
		active: () => active, nonce: () => nonce++, paint: async () => undefined,
		copy: async () => undefined, collect: async input => { collects.push(input); return { status: "created" }; },
	};
	const session = new RecomposeSession(host);
	const root = document.createElement("div");
	document.body.append(root);
	const pane = new RecomposePane(root, session);
	return { session, pane, root, collects, setActive: (owner: ManualMorphVocabulary | null) => { active = owner; } };
}

describe("the pane", () => {
	it("shows the words as elements inside their pieces without changing a piece's text", async () => {
		const { session, pane, setActive } = paneHarness();
		setActive(await mint("a.md"));
		await pane.run("new");
		const output = pane.outputElement();
		const units = Array.from(output.querySelectorAll<HTMLElement>(".semantropy-recompose-unit"));
		const pieces = session.read().paragraphs!.flat();
		expect(units).toHaveLength(pieces.length);
		units.forEach((element, index) => {
			expect(element.textContent).toBe(pieces[index]!.text);
			const spans = Array.from(element.querySelectorAll<HTMLElement>(".semantropy-recompose-word"));
			expect(spans.map(span => span.textContent)).toEqual(pieces[index]!.words.map(word => word.headword.surface));
			spans.forEach((span, wordIndex) => {
				expect(span.dataset.word).toBe(String(wordIndex));
				expect(span.parentElement).toBe(element);
				expect(span.children).toHaveLength(0);
			});
		});
		expect(units.some(element => element.querySelector(".semantropy-recompose-word"))).toBe(true);
		expect(session.text()).toBe(pieces.map(piece => piece.text).join(""));
	});

	it("keeps clicking a word as choosing its piece for the branch point, and the keys moving it", async () => {
		const { session, pane, setActive } = paneHarness();
		setActive(await mint("a.md"));
		await pane.run("new");
		const output = pane.outputElement();
		const unit = Array.from(output.querySelectorAll<HTMLElement>(".semantropy-recompose-unit")).find(element => element.querySelector(".semantropy-recompose-word"))!;
		unit.querySelector<HTMLElement>(".semantropy-recompose-word")!.click();
		expect(unit.classList.contains("is-branch")).toBe(true);
		expect(session.read().branchAt).toBe(Number(unit.dataset.index));
		output.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
		const count = output.querySelectorAll(".semantropy-recompose-unit").length;
		expect(session.read().branchAt).toBe(count - 1);
		unit.querySelector<HTMLElement>(".semantropy-recompose-word")!.click();
		expect(session.read().branchAt).toBe(Number(unit.dataset.index));
	});

	it("names the word under an element from the session's current text, and nothing else", async () => {
		const { session, pane, setActive } = paneHarness();
		setActive(await mint("a.md"));
		await pane.run("new");
		const output = pane.outputElement();
		const span = output.querySelector<HTMLElement>(".semantropy-recompose-word")!;
		const unit = span.closest<HTMLElement>(".semantropy-recompose-unit")!;
		const found = pane.wordAt(span)!;
		expect(found.anchor).toBe(span);
		expect(found.word).toBe(session.wordAt(Number(unit.dataset.index), Number(span.dataset.word)));
		expect(pane.wordAt(unit)).toBeNull();
		expect(pane.wordAt(output)).toBeNull();
		expect(pane.wordAt(document.body)).toBeNull();
		// The text changes under a held element: the old element is no longer in the output.
		await pane.run("new");
		expect(pane.wordAt(span)).toBeNull();
		pane.clear();
		expect(pane.wordAt(output.querySelector(".semantropy-recompose-empty")!)).toBeNull();
		expect(session.wordAt(0, 0)).toBeNull();
	});

	it("draws a malformed word list without repeating or losing a character of the text", async () => {
		const { session, pane, setActive } = paneHarness();
		setActive(await mint("a.md"));
		await pane.run("new");
		const headword = session.read().paragraphs!.flat().find(piece => piece.words.length > 0)!.words[0]!.headword;
		const output = Reflect.get(session, "output") as { paragraphs: unknown[][] };
		const piece = { text: "猫を犬", source: 0, start: 0, end: 3, jump: false, sentenceEnd: true, method: "joint", words: [
			{ start: 0, end: 2, headword },
			// overlaps the first, runs past the text, is empty, and goes backwards
			{ start: 1, end: 3, headword }, { start: 2, end: 9, headword }, { start: 2, end: 2, headword }, { start: 3, end: 1, headword },
		] };
		output.paragraphs = [[piece]];
		pane.render(null);
		const unit = pane.outputElement().querySelector<HTMLElement>(".semantropy-recompose-unit")!;
		expect(unit.textContent).toBe("猫を犬");
		expect(Array.from(unit.querySelectorAll(".semantropy-recompose-word"), el => el.textContent)).toEqual(["猫を"]);
	});

	it("re-words a text on screen without rebuilding its pieces and words", async () => {
		const { pane, setActive } = paneHarness();
		setActive(await mint("a.md"));
		await pane.run("new");
		const output = pane.outputElement();
		const before = Array.from(output.querySelectorAll(".semantropy-recompose-unit, .semantropy-recompose-word"));
		const hint = output.querySelector<HTMLElement>(".semantropy-recompose-hint")!;
		expect(hint.textContent).toBe(ui().recompose.pickHint);
		setCurrentUiLanguage("ja");
		pane.relabel();
		const after = Array.from(output.querySelectorAll(".semantropy-recompose-unit, .semantropy-recompose-word"));
		expect(after).toHaveLength(before.length);
		after.forEach((element, index) => expect(element).toBe(before[index]));
		expect(output.querySelector(".semantropy-recompose-hint")).toBe(hint);
		expect(hint.textContent).toBe(ui().recompose.pickHint);
		expect(hint.textContent).not.toBe("");
		setCurrentUiLanguage("en");
		pane.relabel();
		expect(hint.textContent).toBe(ui().recompose.pickHint);
	});

	it("re-words the empty note, which has no pieces to keep", async () => {
		const { pane } = paneHarness();
		const output = pane.outputElement();
		expect(output.querySelector(".semantropy-recompose-empty")!.textContent).toBe(ui().recompose.empty);
		setCurrentUiLanguage("ja");
		pane.relabel();
		expect(output.querySelector(".semantropy-recompose-empty")!.textContent).toBe(ui().recompose.empty);
		expect(output.querySelector(".semantropy-recompose-empty")!.textContent).toMatch(/[぀-ヿ]/u);
	});

	it("writes the same Collect entry as before: no word, no reading and no corpus in it", async () => {
		const { session, pane, collects, setActive } = paneHarness();
		setActive(await mint("a.md"));
		await pane.run("new");
		await pane.collect();
		const [entry] = collects;
		expect(entry!.metadataVersion).toBe(5);
		expect(Object.keys(entry!).sort()).toEqual(["algorithmVersion", "leapMax", "leapMin", "metadataVersion", "method", "text", "type", "vocabulary"]);
		expect(entry!.text).toBe(session.text());
		expect(JSON.stringify(entry)).not.toContain("headword");
		expect(JSON.stringify(entry)).not.toContain("words");
	});

	it("keeps the words of the pieces a continuation or a branch keeps, and gives the new pieces theirs", async () => {
		const { session, pane, setActive } = paneHarness();
		setActive(await mint("a.md"));
		await pane.run("new");
		const first = session.read().paragraphs!.flat();
		await pane.run("more");
		const more = session.read().paragraphs!.flat();
		expect(more.slice(0, first.length)).toEqual(first);
		first.forEach((piece, index) => expect(more[index]).toBe(piece));
		expect(more.length).toBeGreaterThan(first.length);
		for (const piece of more) expect(Array.isArray(piece.words)).toBe(true);
		session.mark(1);
		await pane.run("branch");
		const branched = session.read().paragraphs!.flat();
		expect(branched[0]).toBe(first[0]);
		expect(branched[1]).toBe(first[1]);
		for (const piece of branched) { expect(Array.isArray(piece.words)).toBe(true); expect(Object.isFrozen(piece.words)).toBe(true); }
	});
});
