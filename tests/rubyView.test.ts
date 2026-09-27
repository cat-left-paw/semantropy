// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAnalysisDocument } from "../src/render/buildAnalysisDocument";
import { tokenizeAnalysisDocument } from "../src/analysis/locateTokens";
import { buildRubyVocabulary, chooseRubyVariant, chooseVocabularyCandidate } from "../src/analysis/rubyVocabulary";
import { MarkdownBodyController } from "../src/render/markdownBodyController";
import { transformDetachedBody } from "../src/render/transformDetachedBody";
import { readBodySelection } from "../src/view/readBodySelection";
import { token } from "./tokenFixtures";
import { MAX, OFF, MEDIUM } from "./readyAnalysis";
import { RefreshHarness, deferred } from "./refreshHarness";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";

function parse(html: string): HTMLElement {
	const root = document.createElement("div");
	root.append(...Array.from(new DOMParser().parseFromString(html, "text/html").body.childNodes));
	return root;
}
const ruby = (base: string, reading: string) => `<ruby>${base}<rt>${reading}</rt></ruby>`;
function lexical(words = ["漢字", "言葉", "東京", "都", "走る", "歩く", "猫", "犬"]): (text: string) => Promise<JapaneseToken[]> {
	return async (text) => {
		const result: JapaneseToken[] = [];
		let cursor = 0;
		while (cursor < text.length) {
			const word = words.find((surface) => text.startsWith(surface, cursor));
			const surface = word ?? String.fromCodePoint(text.codePointAt(cursor)!);
			result.push(token({ surface, ...(word ? { reading: "辞書由来NG" } : { pos: "記号", isUnknown: true }) }));
			cursor += surface.length;
		}
		return result;
	};
}
async function opened(html: string, tokenize = lexical()) {
	const root = parse(html);
	const controller = new MarkdownBodyController();
	const unload = vi.fn();
	await controller.renderIfCurrent(1, { text: "immutable source", sourcePath: "source.md", contentHash: "source-hash" }, () => true, {
		createOwner: () => ({ unload }), createContainer: () => root,
		renderMarkdown: async () => undefined,
	});
	const calls = vi.fn(tokenize);
	const initial = await transformDetachedBody({ requestId: 1, isCurrent: () => true, controller,
		bodyGeneration: controller.getBodyGeneration(), getTokenizer: () => ({ tokenize: calls }), bodySeed: 1, bodySemantropy: OFF });
	expect(initial.status).toBe("applied");
	const apply = (seed = 1, level = MAX) => controller.applyRubyResult(controller.getBodyGeneration(), controller.transformRuby(seed, level));
	return { root, controller, calls, initial, apply, unload };
}
function logical(root: HTMLElement): string {
	document.body.append(root);
	const range = document.createRange(); range.selectNodeContents(root);
	const result = readBodySelection({ root, selection: { rangeCount: 1, getRangeAt: () => range } });
	return result.status === "selected" ? result.text : "";
}

afterEach(() => document.body.replaceChildren());

describe("legacy DOM Ruby renderer (test oracle; no longer the production Target)", () => {
	it("transfers verified 言葉/ことば and never retains the old target reading", async () => {
		const h = await opened(`<p>${ruby("漢字", "かんじ")}と${ruby("言葉", "ことば")}</p>`);
		expect(h.calls.mock.calls.map(([text]) => text)).toEqual(["漢字と言葉"]);
		expect(h.apply()).toBe("applied");
		expect(h.root.querySelector("ruby")?.textContent).toBe("言葉ことば");
		expect(logical(h.root)).toBe("言葉と漢字");
		expect(h.root.querySelectorAll("rt")[1]?.textContent).toBe("かんじ");
	});
	it("uses plain candidates without verified pairs, never tokenizer reading", async () => {
		const h = await opened(`<p>${ruby("漢字", "かんじ")}と言葉</p>`);
		h.apply();
		expect(h.root.querySelector("p")?.textContent).toBe("言葉と漢字かんじ");
		expect(h.root.querySelectorAll("ruby")).toHaveLength(1);
		expect(h.root.textContent).not.toContain("辞書由来NG");
	});
	it("restores the source ruby including notation after repeated rerolls", async () => {
		const h = await opened("<p>漢字《かんじ》と言葉《ことば》</p>");
		const original = h.root.innerHTML;
		for (let seed = 1; seed <= 10; seed += 1) expect(h.apply(seed)).toBe("applied");
		expect(h.apply(10, OFF)).toBe("applied");
		expect(h.root.innerHTML).toBe(original);
		expect(h.root.querySelector("ruby")?.getAttribute("data-semantropy-ruby")).toBe("aozora-short");
		expect(h.calls).toHaveBeenCalledTimes(1);
	});
	it("maps okurigana as one candidate surface without inventing a reading", async () => {
		// Pure rendering fixture uses noun-shaped tokens; production eligibility
		// remains noun-only. No verb policy expansion is needed to test the map.
		const h = await opened(`<p>${ruby("走", "はし")}ると${ruby("歩", "ある")}く</p>`);
		expect(h.calls).toHaveBeenCalledWith("走ると歩く");
		h.apply();
		expect(h.root.querySelector("ruby")?.textContent).toBe("歩ある");
		expect(logical(h.root)).toBe("歩くと走る");
	});
	it("invalidates all of a multi-token annotation and refuses pair transfer into its parts", async () => {
		const h = await opened(`<p>${ruby("東京都", "とうきょうと")}と${ruby("言葉", "ことば")}</p>`);
		const result = h.controller.transformRuby(1, MAX);
		const surfaces = [["言葉", "都", "と", "言葉"]];
		expect(result.candidateSelections![0]![0]!.surface).toBe("言葉");
		const candidateSelections = [[result.candidateSelections![0]![0]!, null, null, null]];
		expect(h.controller.applyRubyResult(h.controller.getBodyGeneration(), { ...result, texts: surfaces.map((s) => s.join("")), tokenSurfaces: surfaces, candidateSelections })).toBe("applied");
		expect(h.root.querySelectorAll("rt")).toHaveLength(1);
		expect(h.root.querySelector("rt")?.textContent).toBe("ことば");
		expect(logical(h.root)).toBe("言葉都と言葉");
		h.apply(1, OFF);
		expect(h.root.querySelector("rt")?.textContent).toBe("とうきょうと");
	});
	it("preserves escaped literals and protects malformed and unsupported runs", async () => {
		const h = await opened(`<p>漢字\\《かんじ》と言葉</p><p>|漢字《かんじ》</p><p>漢字《かん《じ》》</p><p>漢字《》</p>`);
		expect(h.calls).toHaveBeenCalledTimes(1);
		expect(h.calls).toHaveBeenCalledWith("漢字\\《かんじ》と言葉");
		const before = Array.from(h.root.querySelectorAll("p")).slice(1).map((p) => p.outerHTML);
		h.apply();
		expect(h.root.querySelector("p")?.textContent).toContain("\\《かんじ》");
		expect(Array.from(h.root.querySelectorAll("p")).slice(1).map((p) => p.outerHTML)).toEqual(before);
	});
	it("retains protected nodes, event listeners, and boundaries through reshuffles", async () => {
		const h = await opened(`<p>漢字<a href="#">link《reading》</a>言葉<code>漢字《かんじ》</code></p>`);
		const link = h.root.querySelector("a")!;
		const click = vi.fn(); link.addEventListener("click", click);
		h.apply(); h.apply(2, OFF);
		expect(h.root.querySelector("a")).toBe(link);
		link.click(); expect(click).toHaveBeenCalledOnce();
		expect(h.calls.mock.calls.map(([s]) => s)).toEqual(["漢字", "言葉"]);
	});
	it("shares token identity across inline formatting and handles supplementary emoji", async () => {
		const h = await opened("<p>😀漢<strong>字</strong>と言葉🐈</p>");
		expect(h.calls).toHaveBeenCalledWith("😀漢字と言葉🐈");
		h.apply();
		expect(logical(h.root)).toBe("😀言葉と漢字🐈");
		expect(h.root.querySelector("strong")?.textContent).toBe("葉");
		const parts = h.root.querySelectorAll('[data-semantropy-token="run:0:token:1"]');
		expect(parts).toHaveLength(2);
		expect(Array.from(parts, (p) => p.textContent).join("")).toBe("言葉");
	});
	it("renders dense Ruby without omissions or reading contamination", async () => {
		const h = await opened(`<p>${(ruby("漢字", "かんじ") + ruby("言葉", "ことば")).repeat(200)}</p>`);
		h.apply();
		expect(h.root.querySelectorAll("ruby")).toHaveLength(400);
		expect(logical(h.root)).toBe("言葉漢字".repeat(200));
	});
	it("refuses every patch when the generation is revoked immediately before commit", async () => {
		const h = await opened(`<p>${ruby("漢字", "かんじ")}</p><p>${ruby("言葉", "ことば")}</p>`);
		document.body.append(h.root);
		const before = h.root.innerHTML;
		const commit = h.controller.prepareRubyResult(h.controller.getBodyGeneration(), h.controller.transformRuby(1, MAX));
		expect(commit).not.toBeNull();
		h.controller.release();
		expect(commit?.commit()).toBe("stale");
		expect(h.root.innerHTML).toBe(before);
	});
	it("refuses all patches when one binding is detached", async () => {
		const h = await opened(`<p>${ruby("漢字", "かんじ")}</p><p>${ruby("言葉", "ことば")}</p>`);
		const commit = h.controller.prepareRubyResult(h.controller.getBodyGeneration(), h.controller.transformRuby(1, MAX));
		const last = h.root.querySelectorAll(".semantropy-analysis-run")[1]!;
		last.remove(); const before = h.root.innerHTML;
		expect(commit?.commit()).toBe("stale"); expect(h.root.innerHTML).toBe(before);
	});
	it("rejects replay, descendant mutation, and inconsistent surface results before any write", async () => {
		const h = await opened(`<p>${ruby("漢字", "かんじ")}</p><p>${ruby("言葉", "ことば")}</p>`);
		const result = h.controller.transformRuby(1, MAX);
		const prepare = () => h.controller.prepareRubyResult(h.controller.getBodyGeneration(), result);
		const commit = prepare();
		expect(commit?.commit()).toBe("applied");
		const after = h.root.innerHTML;
		expect(commit?.commit()).toBe("stale"); expect(h.root.innerHTML).toBe(after);
		const changed = prepare();
		h.root.querySelectorAll("rt")[1]!.textContent = "External mutation";
		const before = h.root.innerHTML;
		expect(changed?.commit()).toBe("stale"); expect(h.root.innerHTML).toBe(before);
		expect(h.controller.prepareRubyResult(h.controller.getBodyGeneration(), { ...result, texts: ["wrong", "text"] })).toBeNull();
	});
	it("keeps empty media and custom elements as identity-preserving boundaries", async () => {
		const h = await opened("<p>漢字<img alt='fixture'>言葉<x-fixture>漢字《かんじ》</x-fixture>漢字</p>");
		const image = h.root.querySelector("img"); const custom = h.root.querySelector("x-fixture");
		expect(h.calls.mock.calls.map(([s]) => s)).toEqual(["漢字", "言葉", "漢字"]);
		h.apply(); h.apply(2, OFF);
		expect(h.root.querySelector("img")).toBe(image);
		expect(h.root.querySelector("x-fixture")).toBe(custom);
	});
	it("gives plain and decorated versions of the same inline flow identical surface draws", async () => {
		const plain = await opened("<p>漢字と言葉</p>");
		const decorated = await opened("<p>漢<strong>字</strong>と言葉</p>");
		for (let seed = 0; seed < 20; seed += 1) {
			expect(decorated.controller.transformRuby(seed, MAX)).toEqual(plain.controller.transformRuby(seed, MAX));
		}
	});
	it("never learns candidates from displayed replacements", async () => {
		const h = await opened(`<p>${ruby("漢字", "かんじ")}と言葉</p>`);
		const initial = h.controller.transformRuby(9, MAX);
		for (let seed = 1; seed < 20; seed += 1) h.apply(seed);
		expect(h.controller.transformRuby(9, MAX)).toEqual(initial);
		expect(h.calls).toHaveBeenCalledOnce();
	});
	it("fails explicitly if a source DOM binding changes while tokenization is pending", async () => {
		const root = parse("<p>漢字と言葉</p>");
		const controller = new MarkdownBodyController();
		await controller.renderIfCurrent(1, { text: "漢字と言葉", sourcePath: "source.md" }, () => true, {
			createOwner: () => ({ unload: vi.fn() }), createContainer: () => root, renderMarkdown: async () => undefined,
		});
		const result = await transformDetachedBody({ requestId: 1, isCurrent: () => true, controller,
			bodyGeneration: controller.getBodyGeneration(), bodySeed: 1, bodySemantropy: MAX,
			getTokenizer: () => ({ tokenize: async (text) => {
				const tokens = await lexical()(text);
				root.querySelector("p")!.firstChild!.nodeValue = "別の本文";
				return tokens;
			} }),
		});
		expect(result.status).toBe("error");
		expect(root.isConnected).toBe(false);
		expect(root.querySelector(".semantropy-analysis-run")).toBeNull();
	});
});

describe("verified candidate provenance and secondary draws", () => {
	async function vocabulary(html: string) {
		const dom = buildAnalysisDocument(parse(html));
		const located = await tokenizeAnalysisDocument(dom.document, { tokenize: lexical() });
		return buildRubyVocabulary(located, { path: "source.md", contentHash: "hash" });
	}
	it("counts accepted pair occurrences, retaining canonical notation and source provenance", async () => {
		const v = await vocabulary(`<p>${ruby("言葉", "ことば")}${ruby("言葉", "ことば")}言葉《ことば》${ruby("言葉", "げんよう")}</p>`);
		const c = v.candidates.find((item) => item.surface === "言葉")!;
		expect(c.frequency).toBe(4);
		expect(c.verifiedRubyVariants.map((item) => item.frequency).sort()).toEqual([1, 3]);
		expect(c.verifiedRubyVariants.find((item) => item.frequency === 3)).toMatchObject({
			sourceNotations: ["aozora-short", "html"], origins: [{ path: "source.md", contentHash: "hash", count: 3 }],
		});
		expect(Object.isFrozen(c.verifiedRubyVariants)).toBe(true);
		expect(c.token.reading).toBe("辞書由来NG");
	});
	it("selects only whole verified variants deterministically and respects frequency", async () => {
		const v = await vocabulary(`<p>${ruby("言葉", "ことば").repeat(8)}${ruby("言葉", "げんよう")}</p>`);
		const choice = { vocabulary: v, original: token({ surface: "漢字" }), surface: "言葉", seed: 10, tokenId: "target:0" };
		const input = { ...choice, selection: chooseVocabularyCandidate(choice) };
		expect(chooseRubyVariant(input)).toEqual(chooseRubyVariant(input));
		let common = 0;
		for (let seed = 0; seed < 200; seed += 1) if (chooseRubyVariant({ ...input, seed })?.reading === "ことば") common += 1;
		expect(common).toBeGreaterThan(150);
		expect(common).toBeLessThan(200);
	});
	it("keeps surface draws and replacement count invariant under variant changes", async () => {
		const a = await opened(`<p>漢字と言葉と言葉</p>`);
		const b = await opened(`<p>${ruby("漢字", "かんじ")}と${ruby("言葉", "ことば")}と${ruby("言葉", "げんよう")}</p>`);
		for (let seed = 0; seed < 30; seed += 1) for (const level of [OFF, MEDIUM, MAX]) {
			const left = a.controller.transformRuby(seed, level); const right = b.controller.transformRuby(seed, level);
			expect(right.tokenSurfaces).toEqual(left.tokenSurfaces);
			expect(right.replacementCount).toBe(left.replacementCount);
		}
		const va = await vocabulary(`<p>${ruby("言葉", "ことば")}</p>`);
		const vb = await vocabulary(`<p>${ruby("言葉", "げんよう")}</p>`);
		expect(va.fingerprint).not.toBe(vb.fingerprint);
	});
	it("rejects multi-token and multiple-annotation candidate variants", async () => {
		const v = await vocabulary(`<p>${ruby("東京都", "とうきょうと")}${ruby("漢", "かん")}${ruby("字", "じ")}</p>`);
		expect(v.candidates.every((c) => c.verifiedRubyVariants.length === 0)).toBe(true);
	});
});

describe("Ruby lifecycle and selection", () => {
	it("excludes rt/rp even when selection endpoints lie inside readings", async () => {
		const h = await opened(`<p>${ruby("漢字", "かんじ")}と言葉</p>`);
		document.body.append(h.root);
		const rt = h.root.querySelector("rt")!.firstChild!;
		const range = document.createRange(); range.selectNodeContents(rt);
		expect(readBodySelection({ root: h.root, selection: { rangeCount: 1, getRangeAt: () => range } })).toEqual({ status: "empty" });
		range.setEndAfter(h.root.querySelector("p")!.lastChild!);
		expect(readBodySelection({ root: h.root, selection: { rangeCount: 1, getRangeAt: () => range } })).toEqual({ status: "selected", text: "と言葉" });
	});
	it("keeps Refresh, level-change and close/reopen generations consistent without source writes", async () => {
		// The production Target is built from the note string itself.
		const h = new RefreshHarness(); h.sources.set("source.md", "猫《ねこ》犬《いぬ》");
		await h.open("source.md"); const stored = h.storedBodies();
		expect(h.controller.getContainer()!.querySelectorAll("ruby")).toHaveLength(2);
		const gate = deferred<boolean>(); const before = h.controller.getContainer();
		const change = h.setBodySemantropyGated(OFF, gate.promise);
		h.close(); gate.resolve(true);
		// Closing while the change waits for its frame stops it before the write.
		expect(await change).toBe("aborted");
		expect(h.persistCalls).toEqual([]);
		h.reopen(); await h.open("source.md");
		expect(h.controller.getContainer()).not.toBe(before);
		expect(await h.setBodySemantropy(OFF)).toBe("applied");
		expect(await h.setBodySemantropy(MAX)).toBe("applied");
		expect(await h.reshuffle()).toBe("applied");
		h.markLost(); expect(h.readyState()?.freshness).toBe("stale");
		expect(await h.refreshSource()).toBe("refreshed");
		expect(h.storedBodies()).toBe(stored);
	});
});
