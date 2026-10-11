// @vitest-environment jsdom
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphVocabulary } from "../src/transform/manualMorphology";
import { enclosedTermSyntax } from "../src/vocabulary/enclosedTerms";
import { RecomposePane } from "../src/view/RecomposePane";
import { RecomposeSession, type RecomposeHost } from "../src/view/RecomposeSession";
import type { RecomposeFragmentInputV5 } from "../src/collect/v4/CollectedFragmentV4";

/**
 * WORKBENCH-UI2 stage 3 (`Docs/release_0_2_0_plan.md` §3.3): a Recompose
 * session lives as long as its View, so nothing it keeps — the output, the
 * model cache, the status message, the leap of each piece — may keep an earlier
 * Vocabulary owner, its Snapshot or its Source analyses alive. The output keeps
 * the provenance it was made from, and nothing else of the owner. Measured by
 * real garbage collection on the session and a pane attached to it, so no View
 * internals can hide or cause a retention.
 */
setFlagsFromString("--expose_gc");
const gc = runInNewContext("gc") as () => void;

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
/** `deref()` keeps its target alive until the current job ends, so each attempt yields first, collects, yields again and only then looks. */
async function collected(ref: WeakRef<object>): Promise<boolean> {
	for (let attempt = 0; attempt < 10; attempt++) {
		await tick(); gc(); await tick();
		if (ref.deref() === undefined) return true;
	}
	return false;
}

const LEXICON = [
	...["猫", "犬", "森", "川", "空"].map((surface) => token({ surface })),
	token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
	token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
	token({ surface: "た", pos: "助動詞", detail1: "*" }),
];
const TEXT = "猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。";

async function mint(text: string, path: string): Promise<ManualMorphVocabulary> {
	const answer = await analyzeManualMorphSource({ text, sourcePath: path, tokenizer: lexiconTokenizer(LEXICON), mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
	if (answer.status !== "ready") throw Error("fixture");
	return buildManualMorphVocabulary({ sources: [answer.analysis], drawMode: "uniform" });
}

function session() {
	let active: ManualMorphVocabulary | null = null, nonce = 1;
	const collects: RecomposeFragmentInputV5[] = [];
	const host: RecomposeHost = {
		active: () => active, nonce: () => nonce++, paint: async () => undefined,
		copy: async () => undefined, collect: async input => { collects.push(input); return { status: "created" }; },
	};
	const recompose = new RecomposeSession(host);
	const screen = new RecomposePane(document.createElement("div"), recompose);
	return { recompose, screen, collects, setActive: (owner: ManualMorphVocabulary | null) => { active = owner; } };
}

/** Mints an owner, makes it active for `use`, and returns only weak references to it, so the test itself retains nothing. */
async function useWeak(path: string, setActive: (owner: ManualMorphVocabulary | null) => void, use: () => Promise<void>) {
	const owner = await mint(TEXT, path);
	const refs = { owner: new WeakRef(owner), snapshot: new WeakRef(owner.snapshot), analyses: new WeakRef(owner.sources) };
	setActive(owner);
	await use();
	return refs;
}

describe("the Recompose session keeps no Vocabulary owner alive", () => {
	it("observes collection at all: an owner still active survives, a dropped one does not", async () => {
		const { recompose, screen, setActive } = session();
		const held = await useWeak("a.md", setActive, () => screen.run("new"));
		expect(recompose.text()).not.toBe("");
		expect(await collected(held.owner)).toBe(false);
		const dropped = await useWeak("b.md", () => undefined, async () => undefined);
		expect(await collected(dropped.owner)).toBe(true);
	});

	it("after another owner becomes active, the earlier one, its Snapshot and analyses go, while the output and its provenance stay", async () => {
		const { recompose, screen, collects, setActive } = session();
		const first = await useWeak("a.md", setActive, async () => { await screen.run("new"); await screen.run("more"); });
		const text = recompose.text();
		const next = await mint(TEXT, "b.md");
		setActive(next);
		screen.sync();
		expect(Reflect.get(recompose, "cache")).toBeNull();
		for (const ref of [first.owner, first.snapshot, first.analyses]) expect(await collected(ref)).toBe(true);
		expect(recompose.text()).toBe(text);
		expect(recompose.read().changed).toBe(true);
		await screen.collect();
		expect(collects.at(-1)!.vocabulary.sources.map(source => source.path)).toEqual(["a.md"]);
		expect(collects.at(-1)!.text).toBe(text);
		expect(next.snapshot).toBeTruthy();
	});

	it("goes even before any screen reads the session again, and when no owner is active at all", async () => {
		const { recompose, screen, setActive } = session();
		const first = await useWeak("a.md", setActive, () => screen.run("new"));
		const next = await mint(TEXT, "b.md");
		setActive(next);
		// No read since the switch: the model cached for the earlier owner keeps only copied text.
		expect(Reflect.get(recompose, "cache")).not.toBeNull();
		for (const ref of [first.owner, first.snapshot, first.analyses]) expect(await collected(ref)).toBe(true);
		const second = await useWeak("c.md", setActive, () => screen.run("new"));
		setActive(null);
		screen.sync();
		expect(Reflect.get(recompose, "cache")).toBeNull();
		for (const ref of [second.owner, second.snapshot, second.analyses]) expect(await collected(ref)).toBe(true);
		expect(recompose.text()).not.toBe("");
		expect(next.snapshot).toBeTruthy();
	});

	it("a disposed session keeps nothing it made", async () => {
		const { recompose, screen, setActive } = session();
		const first = await useWeak("a.md", setActive, () => screen.run("new"));
		setActive(null);
		screen.dispose(); recompose.dispose();
		expect([recompose.text(), recompose.isDisposed()]).toEqual(["", true]);
		expect(await collected(first.owner)).toBe(true);
	});
});

/**
 * FAKE-DICT-RECOMPOSE1: a word of the text looked up, with the real View around it. The definition shown, the pool kept for
 * the Vocabulary, the cached definition and the hover target together must not keep the Vocabulary the text came from: when
 * another one becomes the active one the earlier owner, its Snapshot and its Source analyses are collected.
 */
describe("a looked-up Recompose word keeps no Vocabulary owner alive", () => {
	const WORDS = [
		...["猫", "犬", "森", "川", "空", "駅"].map(surface => token({ surface, reading: "ヨミ" })),
		token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
		token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
		token({ surface: "た", pos: "助動詞", detail1: "*" }),
	];
	const FIRST = ["猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。駅が空を見た。"];
	const SECOND = ["犬が猫を見た。駅が森を見た。空が川を見た。猫が駅を見た。川が空を見た。"];
	const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

	async function lookedUp() {
		const h = manualMorphHarness(lexiconTokenizer(WORDS), 5000);
		h.host.workbenchTabs = true;
		await h.view.onOpen();
		expect(await h.apply(FIRST)).toBe("applied");
		const view = h.view as unknown as { standaloneVocabulary: ManualMorphVocabulary | null; recomposeScreen: RecomposePane; dictionaryPopover: { isOpen(): boolean; close(): void }; dictionaryWorld: { getCurrent(): unknown } };
		h.peek.contentEl.querySelector<HTMLButtonElement>(".semantropy-tab-recompose")!.click();
		for (let step = 0; step < 6 && !view.recomposeScreen.outputElement().querySelector(".semantropy-recompose-word"); step += 1) await view.recomposeScreen.run("new");
		const word = view.recomposeScreen.outputElement().querySelector<HTMLElement>(".semantropy-recompose-word")!;
		word.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, altKey: true }));
		await wait(145);
		expect(view.dictionaryPopover.isOpen()).toBe(true);
		expect(view.dictionaryWorld.getCurrent()).not.toBeNull();
		const owner = view.standaloneVocabulary!;
		const refs = { owner: new WeakRef(owner), snapshot: new WeakRef(owner.snapshot), analyses: new WeakRef(owner.sources) };
		return { h, view, refs };
	}

	it("while its Vocabulary is the active one it is held (the control), and once another is active it, its Snapshot and analyses are collected", async () => {
		const { h, view, refs } = await lookedUp();
		for (const ref of [refs.owner, refs.snapshot, refs.analyses]) expect(await collected(ref)).toBe(false);
		expect(await h.apply(SECOND)).toBe("applied");
		expect(view.dictionaryPopover.isOpen()).toBe(false);
		for (const ref of [refs.owner, refs.snapshot, refs.analyses]) expect(await collected(ref)).toBe(true);
		// The text stays on screen, noted as made from another Vocabulary.
		expect(view.recomposeScreen.outputElement().querySelector(".semantropy-recompose-word")).not.toBeNull();
		await h.view.onClose();
	});

	it("also when the Popover is still open on the word and the Vocabulary changes under it", async () => {
		const { h, view, refs } = await lookedUp();
		expect(view.dictionaryPopover.isOpen()).toBe(true);
		expect(await h.apply(SECOND)).toBe("applied");
		for (const ref of [refs.owner, refs.snapshot, refs.analyses]) expect(await collected(ref)).toBe(true);
		expect(view.dictionaryPopover.isOpen()).toBe(false);
		await h.view.onClose();
	});
});
