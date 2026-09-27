// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeSafeTarget, buildSafeTargetDom, planSafeTarget, SafeTargetPrototype, SAFE_TARGET_ERROR, type SafeTargetModel } from "../src/render/safeTargetPrototype";
import { projectMarkdownSource } from "../src/analysis/projectMarkdownSource";
import { planTargetDisplay } from "../src/analysis/targetPresentation";
import { chooseVocabularyCandidate } from "../src/analysis/rubyVocabulary";
import { buildAnalysisDocument } from "../src/render/buildAnalysisDocument";
import { safeTargetFixtures, unsafeTargetFixtures, targetPerformanceFixtures } from "./fixtures/targetSafeFixtures";
import { token } from "./tokenFixtures";
import { MAX, OFF } from "./readyAnalysis";

const trapRenderer = vi.hoisted(() => vi.fn(() => { throw new Error("Forbidden renderer"); }));
vi.mock("obsidian", () => ({ MarkdownRenderer: { render: trapRenderer }, Component: trapRenderer }));
function tokenizer() {
	return { tokenize: vi.fn(async (text: string) => {
		const tokens = [];
		for (let i = 0; i < text.length;) {
			const word = ["漢字", "言葉", "東京", "都", "走る", "歩く", "猫", "犬"].find(w => text.startsWith(w, i));
			const surface = word ?? String.fromCodePoint(text.codePointAt(i)!);
			tokens.push(token({ surface, reading: "NOT-A-DISPLAY-READING", ...(word ? {} : { pos: "記号", isUnknown: true }) }));
			i += surface.length;
		}
		return tokens;
	}) };
}
async function model(text: string, engine = tokenizer()): Promise<SafeTargetModel> {
	const result = await analyzeSafeTarget({ text, sourcePath: "synthetic.md", contentHash: "hash", tokenizer: engine });
	if (result.status !== "ready") throw new Error("Test model failed");
	return result.model;
}
const initial = async (md: string) => buildSafeTargetDom(planSafeTarget(await model(md), 1, OFF), document);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe("safe Target presentation prototype", () => {
	it.each(safeTargetFixtures)("matches safe oracle logical / IR: $name", async f => {
		const m = await model(f.md), dom = buildSafeTargetDom(planSafeTarget(m, 1, OFF), document);
		const oracle = new DOMParser().parseFromString(f.html, "text/html");
		const expected = buildAnalysisDocument(oracle.body).document;
		expect(m.located.runs.map(r => r.run.analysisText)).toEqual(expected.runs.map(r => r.analysisText));
		expect(dom.plan.logicalText).toBe(f.logical);
		expect(dom.bindings.filter(b => b.logicalRange).map(b => b.node.data).join("")).toBe(f.logical);
		for (const b of dom.bindings) if (b.presentation.analysisRange && !b.presentation.replacement) {
			const run = m.projection.document.runs.find(r => r.runId === b.presentation.runId)!;
			expect(run.analysisText.slice(b.presentation.analysisRange.start, b.presentation.analysisRange.end)).toBe(b.node.data);
			expect(b.presentation.rawRanges.map(r => f.md.slice(r.start, r.end)).join("")).toBe(b.node.data);
		}
		for (const b of dom.bindings) if (b.presentation.rawRanges.length && !b.presentation.replacement) {
			expect(b.presentation.rawRanges.map(r => f.md.slice(r.start, r.end)).join("")).toBe(b.node.data);
		}
		expect(m.projection.document.protectedRuns.map(r => r.originalText)).toEqual(expected.protectedRuns.map(r => r.originalText));
		if (f.name === "inline decorations") for (const tag of ["em", "strong", "del"]) expect(Array.from(dom.root.querySelectorAll(tag), e => e.textContent).join("")).toBe(Array.from(oracle.querySelectorAll(tag), e => e.textContent).join(""));
	});
	it("keeps Selected Source multiline fail-closed while Target supports Japanese soft lines", async () => {
		const md = "　猫の文章。\n犬の文章。\n漢字《かんじ》。";
		expect(projectMarkdownSource(md).document.runs).toEqual([]);
		expect((await initial(md)).plan.logicalText).toBe("　猫の文章。\n犬の文章。\n漢字。");
		expect((await model(md)).located.runs).toHaveLength(3);
	});
	it.each(["漢字《かん\nじ》", "漢字《`code`中`code`よみ》", "|漢字《よみ》", "# 題名 ###", "<ruby>漢**字**<rt>かんじ</rt></ruby>"])("shows unsupported input inertly without analysis: %s", async md => {
		const m = await model(md), dom = buildSafeTargetDom(planSafeTarget(m, 1, OFF), document);
		expect(m.located.runs).toEqual([]); expect(dom.root.textContent).toBe(md);
		expect(dom.root.querySelector("pre")?.textContent).toBe(md);
	});
	it("transplants verified pairs, uses plain candidates, and restores original notation", async () => {
		for (const md of ["漢字《かんじ》と言葉《ことば》", "漢字《かんじ》と言葉"]) {
			const engine = tokenizer(), m = await model(md, engine), c = new SafeTargetPrototype(document, m);
			expect(c.prepare(1, OFF)?.commit()).toBe("applied");
			const before = c.getRoot()!.innerHTML;
			expect(c.prepare(1, MAX)?.commit()).toBe("applied");
			expect(c.getDisplay()?.plan.logicalText).toBe("言葉と漢字");
			const first = c.getDisplay()!.root.querySelector("span")!;
			expect(first.firstChild?.nodeName === "RUBY").toBe(md.endsWith("》"));
			if (md.endsWith("》")) expect(first.querySelector("rt")?.textContent).toBe("ことば");
			expect(c.getRoot()!.textContent).not.toContain("NOT-A-DISPLAY-READING");
			for (let i = 2; i < 6; i++) c.prepare(i, MAX)?.commit();
			c.prepare(1, OFF)?.commit(); expect(c.getRoot()!.innerHTML).toBe(before);
			expect(engine.tokenize).toHaveBeenCalledOnce(); c.release();
		}
	});
	it("removes a multi-token annotation on partial replacement, without transplant", async () => {
		const m = await model("｜東京都《とうきょうと》と言葉《ことば》");
		const seq = m.located.runs[0]!, surfaces = seq.tokens.map(t => t.token.surface); surfaces[0] = "言葉";
		const selection = chooseVocabularyCandidate({ vocabulary: m.vocabulary, original: seq.tokens[0]!.token, surface: "言葉", seed: 1, tokenId: seq.tokens[0]!.tokenId });
		const plan = planTargetDisplay({ ...m, surfaces: [surfaces], selections: [[selection, ...surfaces.slice(1).map(() => null)]], seed: 1 });
		const dom = buildSafeTargetDom(plan, document);
		expect(plan.logicalText).toBe("言葉都と言葉");
		expect(Array.from(dom.root.querySelectorAll("rt"), n => n.textContent)).toEqual(["ことば"]);
	});
	it("maps okurigana, emoji and a token across inline decoration without duplication", async () => {
		const dom = buildSafeTargetDom(planSafeTarget(await model("😀漢**字**と言葉🐈\n\n走《はし》ると歩《ある》く"), 1, MAX), document);
		expect(dom.plan.logicalText).toContain("😀"); expect(dom.plan.logicalText).toContain("🐈");
		const parts = dom.bindings.filter(b => b.presentation.tokenId === "run:0:token:1");
		expect(parts).toHaveLength(2); expect(parts.map(b => b.node.data).join("")).toHaveLength(2);
		expect(dom.root.querySelectorAll("rt").length).toBeGreaterThan(0);
	});
	it("excludes readings and placeholder UI from revision-bound logical selection", async () => {
		const c = new SafeTargetPrototype(document, await model("漢字《かんじ》![x](https://example.invalid/x)言葉"));
		c.prepare(1, OFF)?.commit(); const rev = c.getRevision();
		expect(c.readLogicalRange({ start: 0, end: 4 }, rev)).toBe("漢字言葉");
		expect(c.getRoot()!.textContent).toContain("[Image / embed omitted]");
		c.prepare(1, MAX)?.commit(); expect(c.readLogicalRange({ start: 0, end: 4 }, rev)).toBeNull();
		c.release(); expect(c.getRoot()).toBeNull(); expect(c.getDisplay()).toBeNull();
	});
	it("rejects stale, mutated or replayed commits all-or-none and clears pending DOM on release", async () => {
		const c = new SafeTargetPrototype(document, await model("漢字《かんじ》\n\n言葉《ことば》"));
		c.prepare(1, OFF)?.commit(); document.body.append(c.getRoot()!);
		const before = c.getRoot()!.innerHTML; let current = true;
		const stale = c.prepare(1, MAX, () => current); current = false;
		expect(stale?.commit()).toBe("stale"); expect(c.getRoot()!.innerHTML).toBe(before);
		const changed = c.prepare(1, MAX); const text = c.getDisplay()!.bindings[0]!.node;
		text.replaceWith(text.cloneNode()); expect(changed?.commit()).toBe("stale");
		const replay = c.prepare(1, MAX); expect(replay?.commit()).toBe("applied"); expect(replay?.commit()).toBe("stale");
		const old = c.prepare(1, OFF); c.release(); expect(old?.commit()).toBe("stale");
		expect(c.getPendingCount()).toBe(0); expect(document.body.childNodes).toHaveLength(0);
	});
	it("stops after await invalidation and makes coverage/errors privacy-safe", async () => {
		let current = true;
		const result = await analyzeSafeTarget({ text: "猫\n\n犬", sourcePath: "/private/secret.md", contentHash: "hash", isCurrent: () => current, tokenizer: { tokenize: async text => { current = false; return [token({ surface: text })]; } } });
		expect(result.status).toBe("stale");
		const log = vi.spyOn(console, "error");
		for (const tokenize of [async () => [], () => { throw new Error("本文 /private/secret.md"); }]) {
			expect(await analyzeSafeTarget({ text: "本文", sourcePath: "/private/secret.md", contentHash: "hash", tokenizer: { tokenize } })).toEqual({ status: "error", message: SAFE_TARGET_ERROR });
		}
		expect(log).not.toHaveBeenCalled();
	});
	it("maps live DOM Text selection and rejects reading, stale and changed bindings", async () => {
		const c = new SafeTargetPrototype(document, await model("😀漢字《かんじ》と言葉"));
		c.prepare(1, OFF)?.commit(); document.body.append(c.getRoot()!);
		const bindings = c.getDisplay()!.bindings, first = bindings[0]!, last = bindings.at(-1)!;
		const range = document.createRange(); range.setStart(first.node, 0); range.setEnd(last.node, last.node.length);
		expect(c.readDomRange(range, c.getRevision())).toBe("😀漢字と言葉");
		const reading = bindings.find(b => !b.logicalRange)!;
		range.setEnd(reading.node, 1); expect(c.readDomRange(range, c.getRevision())).toBeNull();
		range.setEnd(last.node, last.node.length); first.node.data = "altered";
		expect(c.readDomRange(range, c.getRevision())).toBeNull();
		c.release(); expect(c.readDomRange(range, c.getRevision())).toBeNull();
	});
	it("preserves exact NFC display forms and never borrows Ruby from a plain selected identity", async () => {
		const engine = { tokenize: vi.fn(async (text: string) => [token({ surface: text, baseForm: text.normalize("NFC"), reading: "same-NFC-identity" })]) };
		const m = await model("猫\n\n<ruby>か\u3099<rt>が</rt></ruby>\n\nが", engine);
		const forms = m.vocabulary.candidates.filter(c => c.surface !== "猫");
		expect(forms[0]!.candidateId).toBe(forms[1]!.candidateId);
		expect(forms[0]!.displayFormId).not.toBe(forms[1]!.displayFormId);
		for (const candidate of m.vocabulary.candidates.filter(c => c.surface !== "猫")) {
			const surfaces = m.located.runs.map(r => r.tokens.map(t => t.token.surface)); surfaces[0]![0] = candidate.surface;
			const selection = { candidateId: candidate.candidateId, displayFormId: candidate.displayFormId, surface: candidate.surface };
			const plan = planTargetDisplay({ ...m, surfaces, selections: [[selection], [null], [null]], seed: 1 });
			const dom = buildSafeTargetDom(plan, document), first = dom.root.querySelector("p")!;
			expect(first.textContent).toBe(candidate.surface + (candidate.surface.length === 2 ? "が" : ""));
			expect(first.querySelectorAll("ruby")).toHaveLength(candidate.surface.length === 2 ? 1 : 0);
		}
		let identity = 0;
		const same = await model("猫\n\n言葉《ことば》\n\n言葉", {
			tokenize: vi.fn(async (text: string) => [token({ surface: text, reading: String(identity++) })]),
		});
		const plain = same.vocabulary.candidates.find(c => c.surface === "言葉" && c.verifiedRubyVariants.length === 0)!;
		const dom = buildSafeTargetDom(planTargetDisplay({ ...same, surfaces: [["言葉"], ["言葉"], ["言葉"]], selections: [[plain], [null], [null]], seed: 1 }), document);
		expect(dom.root.querySelector("p")!.textContent).toBe("言葉"); expect(dom.root.querySelector("p")!.querySelector("ruby")).toBeNull();
	});
	it("reentrant guards cannot commit an old preparation or retain a released owner", async () => {
		const c = new SafeTargetPrototype(document, await model("猫と犬")); c.prepare(1, OFF)?.commit();
		let reenter = false;
		const old = c.prepare(1, MAX, () => { if (reenter) c.prepare(2, OFF); return true; });
		reenter = true; expect(old?.commit()).toBe("stale");
		expect(c.getDisplay()!.plan.logicalText).toBe("猫と犬");
		let fail = false;
		const throwing = c.prepare(1, MAX, () => { if (fail) throw new Error("本文 /private/path.md"); return true; });
		fail = true; expect(throwing?.commit()).toBe("stale");
		expect(c.preparePlan(c.getDisplay()!.plan, () => { throw new Error("本文 /private/path.md"); })).toBeNull();
		expect(c.preparePlan(c.getDisplay()!.plan, () => { c.release(); return true; })).toBeNull();
		expect(c.getPendingCount()).toBe(0);
	});
	it.each(unsafeTargetFixtures)("has zero active/resource/write capability detached and attached: %s", async md => {
		const trap = vi.fn(() => { throw new Error("Forbidden capability"); });
		for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "Image", "Audio", "DOMParser", "Worker", "MarkdownRenderer"]) vi.stubGlobal(name, trap);
		vi.stubGlobal("app", { vault: { read: trap, cachedRead: trap, modify: trap, create: trap }, saveData: trap, postprocessor: trap });
		vi.stubGlobal("navigator", { clipboard: { writeText: trap } });
		vi.spyOn(Element.prototype, "setAttribute").mockImplementation(trap);
		vi.spyOn(Element.prototype, "innerHTML", "set").mockImplementation(trap);
		vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(trap);
		const engine = tokenizer(), m = await model(md, engine), c = new SafeTargetPrototype(document, m);
		expect(m.vocabulary.candidates).toEqual([]); expect(engine.tokenize).not.toHaveBeenCalled();
		expect(c.prepare(1, OFF)?.commit()).toBe("applied"); document.body.append(c.getRoot()!);
		expect(c.prepare(1, MAX)?.commit()).toBe("applied"); c.release();
		expect(trap).not.toHaveBeenCalled(); expect(trapRenderer).not.toHaveBeenCalled();
	});
	it.each(targetPerformanceFixtures)("completes benchmark fixture and releases: $name", async f => {
		const m = await model(f.md); const c = new SafeTargetPrototype(document, m);
		expect(c.prepare(1, OFF)?.commit()).toBe("applied");
		expect(c.prepare(1, MAX)?.commit()).toBe("applied");
		c.release(); expect(c.getRoot()).toBeNull(); expect(c.getDisplay()).toBeNull(); expect(c.getPendingCount()).toBe(0);
	});
});
