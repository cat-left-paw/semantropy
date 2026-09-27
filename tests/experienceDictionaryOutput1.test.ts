// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { DictionaryPopoverController } from "../src/view/DictionaryPopoverController";
import { FakeDictionaryWorld, type FakeDictionaryCurrent } from "../src/application/fakeDictionaryWorld";
import { fakeDictionaryCanonicalText, fakeDictionaryFragmentFromCurrent } from "../src/application/fakeDictionaryFragmentFromReady";
import { generateFakeDefinition } from "../src/dictionary/generateFakeDefinition";
import { validateHeadword } from "../src/dictionary/headword";
import { buildDictionaryVocabularyPool } from "../src/dictionary/vocabularyPool";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { escapeFragmentMarkdown } from "../src/collect/escapeFragmentMarkdown";
import { appendCollectionEntry, createCollectionDocument } from "../src/collect/collectionDocument";
import { serializeFragmentEntryV3 } from "../src/collect/v3/serializeFragmentV3";
import { MarkdownFragmentRepositoryV4 } from "../src/collect/v4/FragmentRepositoryV4";
import { serializeFragmentEntryV4 } from "../src/collect/v4/serializeFragmentV4";
import type { CollectionEntryState, CollectionStorage, CreateCollectionResult, ProcessCollectionResult } from "../src/collect/CollectionStorage";
import type { CollectFragmentInputV4 } from "../src/collect/v4/CollectedFragmentV4";
import { collectVocabulary, COLLECT_FIXTURE_HASH } from "./collectFixtures";
import { fragmentV3, inputsV3 } from "./collectV3Fixtures";
import { fragmentV4 } from "./collectV4Fixtures";

/*
 * PRE-RELEASE-EXPERIENCE-DICTIONARY-OUTPUT1 (UX-11): Fake Dictionary Copy and
 * Collect write one canonical text — the displayed headword, one LF, the
 * definition — from the same committed current, for Modal and hover alike.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
const live: ReturnType<typeof manualMorphHarness>[] = [];
afterEach(async () => { for (const h of live.splice(0)) await h.view.onClose(); vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

const lexicon = () => lexiconTokenizer([
	token({ surface: "猫", baseForm: "猫", reading: "ネコ" }), token({ surface: "犬", baseForm: "犬", reading: "イヌ" }),
	token({ surface: "鳥", baseForm: "鳥", reading: undefined }), token({ surface: "港", detail1: "固有名詞", detail2: "地域" }),
	token({ surface: "研究", detail1: "サ変接続" }),
]);
async function harness(text = "猫犬鳥港研究。") {
	const h = manualMorphHarness(lexicon(), 5000); live.push(h); await h.open(text); return h;
}
type H = Awaited<ReturnType<typeof harness>>;
const panel = () => document.querySelector<HTMLElement>(".semantropy-dictionary-popover");
const popover = (h: H) => Reflect.get(h.view, "dictionaryPopover") as DictionaryPopoverController;
const world = (h: H) => Reflect.get(h.view, "dictionaryWorld") as FakeDictionaryWorld;
const element = (h: H, surface = "猫") => Array.from(h.root().querySelectorAll<HTMLElement>(".semantropy-token"))
	.find(el => h.controller().getSlotForElement(el) === h.current(surface))!;
const wait = (ms = 145) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
async function hover(h: H, surface = "猫") {
	element(h, surface).dispatchEvent(new MouseEvent("pointerover", { bubbles: true, altKey: true }));
	await wait(); expect(popover(h).isOpen()).toBe(true);
}
/** What the reader sees: the Popover's (or Modal's) own headword and definition text. */
const shown = (root: ParentNode = document) => ({
	headword: root.querySelector(".semantropy-definition-headword")?.textContent ?? "",
	definition: root.querySelector(".semantropy-definition-text")?.textContent ?? "",
});
const bytes = (text: string) => Buffer.from(text, "utf8");
/** Copy then Collect from the same state; returns both texts. */
async function writeBoth(h: H) {
	const copies = h.calls.copy.length, collects = h.calls.collect.length;
	expect(await h.view.copyDefinition()).toBe("copied");
	expect(await h.view.collectDefinition()).toBe("created");
	const copied = h.calls.copy[copies]!, collected = h.calls.collect[collects]!;
	if (collected.type !== "fake-dictionary") throw new Error("expected a fake-dictionary input");
	return { copied, collected: collected };
}

describe("canonical text", () => {
	const HEADWORD = (() => {
		const result = validateHeadword("猫", [token({ surface: "猫", baseForm: "猫", reading: "ネコ" })]);
		if (result.outcome !== "accepted") throw new Error("fixture");
		return result.headword;
	})();
	const POOL = buildDictionaryVocabularyPool([[token({ surface: "猫" }), token({ surface: "机" }), token({ surface: "研究", detail1: "サ変接続" })]]);
	function currentWith(definition: string | null, surface = HEADWORD.surface): FakeDictionaryCurrent {
		const world = new FakeDictionaryWorld(), requestId = world.beginRequest();
		const generated = generateFakeDefinition({ headword: HEADWORD, pool: POOL, dictionarySeed: 7, dictionarySemantropy: 50 });
		if (generated.outcome !== "generated") throw new Error("fixture");
		const result = definition === null ? { outcome: "off" as const } : { ...generated, definition };
		world.commit(requestId, { headword: { ...HEADWORD, surface }, pool: POOL, snapshot: { sourcePath: "t.md", contentHash: COLLECT_FIXTURE_HASH },
			vocabulary: collectVocabulary(["t.md"]), dictionarySeed: 7, dictionarySemantropy: assertDictionarySemantropy(50), result });
		return world.getCurrent()!;
	}

	it("is the displayed headword, one LF, the definition — nothing else", () => {
		const current = currentWith("猫科の架空の生き物。");
		expect(fakeDictionaryCanonicalText(current)).toBe("猫\n猫科の架空の生き物。");
		expect(fakeDictionaryFragmentFromCurrent(current)!.text).toBe(fakeDictionaryCanonicalText(current));
		// Reading and part of speech are not added.
		expect(fakeDictionaryCanonicalText(current)).not.toContain("ネコ");
	});

	it("writes nothing when nothing was generated", () => {
		const off = currentWith(null);
		expect(fakeDictionaryCanonicalText(off)).toBeNull();
		expect(fakeDictionaryFragmentFromCurrent(off)).toBeNull();
	});

	it("keeps Markdown symbols as literal text in Copy and escapes them only in the Collection body", () => {
		const current = currentWith("- [リンク](x) `code` <b>太字</b> #tag", "C#*");
		const text = fakeDictionaryCanonicalText(current)!;
		expect(text).toBe("C#*\n- [リンク](x) `code` <b>太字</b> #tag");
		const input = { ...fakeDictionaryFragmentFromCurrent(current)!, metadataVersion: 4 } as CollectFragmentInputV4;
		const entry = serializeFragmentEntryV4(fragmentV4(input));
		const [first, second] = escapeFragmentMarkdown(text).split("\n");
		expect(entry).toBe(`- ${first}\n  ${second}\n`);
		expect(entry).not.toContain("<!--");
		expect(first).toBe("C\\#\\*");
		expect(second).toBe("\\- \\[リンク\\]\\(x\\) \\`code\\` \\<b\\>太字\\<\\/b\\> \\#tag");
		expect(entry).not.toContain("<b>");
	});
});

describe("Modal and hover write the same canonical text from the committed current", () => {
	it("hover: Copy and Collect are byte-identical and match what the Popover shows", async () => {
		const h = await harness(); await hover(h);
		const view = shown();
		const { copied, collected } = await writeBoth(h);
		expect(copied).toBe(`${view.headword}\n${view.definition}`);
		expect(bytes(collected.text)).toEqual(bytes(copied));
		const current = world(h).getCurrent()!;
		if (current.result.outcome !== "generated") throw new Error("expected generated");
		expect(collected).toEqual({ ...fakeDictionaryFragmentFromCurrent(current), metadataVersion: 4 });
		expect(collected.type).toBe("fake-dictionary");
	});

	it("Modal: the same text for the same committed current", async () => {
		const h = await harness();
		const range = document.createRange(); range.selectNodeContents(element(h));
		document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
		expect(await h.view.defineSelectedWord({ issueSeed: () => 11 })).toBe("ready");
		const modal = document.querySelector<HTMLElement>(".semantropy-definition-headword")!.closest<HTMLElement>(".semantropy-definition")!;
		const view = shown(modal);
		const { copied, collected } = await writeBoth(h);
		expect(copied).toBe(`${view.headword}\n${view.definition}`);
		expect(copied.startsWith("猫\n")).toBe(true);
		expect(bytes(collected.text)).toEqual(bytes(copied));
	});

	it("cache hit and definition reshuffle rebuild the text from the new committed current only", async () => {
		const h = await harness(); await hover(h);
		const first = await writeBoth(h);
		popover(h).close(); await hover(h, "犬"); popover(h).close(); await hover(h);
		const hit = await writeBoth(h);
		expect(hit.copied).toBe(first.copied);
		expect(h.view.reshuffleDefinition({ issueSeed: () => 123456 })).toBe("applied");
		const reshuffled = await writeBoth(h);
		const current = world(h).getCurrent()!;
		if (current.result.outcome !== "generated") throw new Error("expected generated");
		expect(reshuffled.copied).toBe(`猫\n${current.result.definition}`);
		expect(reshuffled.collected.text).toBe(reshuffled.copied);
		expect(reshuffled.collected.templateId).toBe(current.result.templateId);
	});

	it("after a Target-only Refresh, a cache hit keeps the cached provenance with its own text", async () => {
		const h = await harness("猫犬鳥港研究。");
		expect(await h.apply(["犬猫鳥港研究。"])).toBe("applied");
		await hover(h);
		const before = await writeBoth(h);
		h.state.text = "猫犬鳥港研究。追記。";
		expect(await h.view.refreshSource()).toBe("refreshed");
		await hover(h);
		const after = await writeBoth(h);
		const current = world(h).getCurrent()!;
		// Text, Target and Vocabulary all come from the one committed current, never a later Snapshot.
		expect(after.collected.target).toEqual({ path: current.snapshot.sourcePath, contentHash: current.snapshot.contentHash });
		expect(after.collected.vocabulary).toEqual(current.vocabulary);
		expect(after.copied).toBe(fakeDictionaryCanonicalText(current));
		expect(after.collected.text).toBe(after.copied);
		// A real cache hit: the same text, with the Target the cached definition was generated from.
		expect(after.copied).toBe(before.copied);
		expect(after.collected.target).toEqual(before.collected.target);
		expect(before.copied.split("\n")[0]).toBe("猫");
	});

	it("Selected Notes: the text is the same shape and the provenance lists every Source", async () => {
		const h = await harness();
		expect(await h.apply(["猫猫犬港研究。", "猫鳥研究研究。"])).toBe("applied");
		await hover(h);
		const { copied, collected } = await writeBoth(h);
		expect(copied.startsWith("猫\n")).toBe(true);
		expect(collected.text).toBe(copied);
		expect(collected.vocabulary.sources.map(source => source.path)).toEqual(["source0.md", "source1.md"]);
	});
});

describe("nothing is written on refusal, failure, staleness or close", () => {
	it("a failed Copy leaves the Clipboard alone and does not retry; a failed Collect writes nothing", async () => {
		const h = await harness(); await hover(h);
		const clipboard = vi.fn(() => Promise.reject(new Error("denied")));
		h.host.writeClipboard = clipboard;
		expect(await h.view.copyDefinition()).toBe("failed");
		expect(clipboard).toHaveBeenCalledTimes(1);
		h.host.collectFragment = () => Promise.reject(new Error("disk"));
		expect(await h.view.collectDefinition()).toBe("failed");
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
	});

	it("a stale, cancelled or closed definition writes nothing", async () => {
		const h = await harness(); await hover(h);
		h.state.text = "猫犬鳥。変更。";
		expect(await h.view.refreshSource()).toBe("refreshed");
		expect(panel()).toBeNull();
		expect(await h.view.copyDefinition()).toBe("empty");
		expect(await h.view.collectDefinition()).toBe("empty");
		await hover(h);
		await h.view.onClose();
		expect(await h.view.copyDefinition()).toBe("aborted");
		expect(await h.view.collectDefinition()).toBe("aborted");
		expect(h.calls.copy).toEqual([]); expect(h.calls.collect).toEqual([]);
	});
});

describe("Collection: fake-dictionary type, Source conflict, append-only", () => {
	function memory(initial: string | null = null) {
		let contents = initial;
		const storage = {
			inspect: vi.fn(() => Promise.resolve<CollectionEntryState>({ status: contents === null ? "missing" : "markdown" })),
			create: vi.fn((_path: string, text: string) => { contents = text; return Promise.resolve<CreateCollectionResult>({ status: "created" }); }),
			process: vi.fn((_path: string, transform: (value: string) => string) => { contents = transform(contents ?? ""); return Promise.resolve<ProcessCollectionResult>({ status: "processed" }); }),
		} satisfies CollectionStorage;
		return { storage, read: () => contents };
	}
	async function hoveredInput() {
		const h = await harness(); await hover(h);
		const { collected } = await writeBoth(h);
		return collected as unknown as CollectFragmentInputV4;
	}

	it("refuses a Collection that is the Target or a Vocabulary Source with zero storage calls", async () => {
		const input = await hoveredInput();
		if (input.type !== "fake-dictionary") throw new Error("expected fake-dictionary");
		for (const path of [input.target.path, ...input.vocabulary.sources.map(source => source.path)]) {
			const file = memory();
			expect(await new MarkdownFragmentRepositoryV4(file.storage, () => path).append(fragmentV4(input))).toEqual({ status: "conflict", reason: "source-note" });
			expect(file.storage.inspect).not.toHaveBeenCalled(); expect(file.storage.create).not.toHaveBeenCalled(); expect(file.storage.process).not.toHaveBeenCalled();
		}
	});

	it("appends a two-line entry after older definition-only entries, keeping every byte before it", async () => {
		const input = await hoveredInput();
		// An older fake-dictionary entry, written before this slice: definition text only.
		const older = createCollectionDocument(serializeFragmentEntryV3(fragmentV3(inputsV3()[1])));
		expect(older).toContain('"type":"fake-dictionary"');
		const file = memory(older);
		const fragment = fragmentV4(input);
		expect(await new MarkdownFragmentRepositoryV4(file.storage, () => "collection.md").append(fragment)).toEqual({ status: "appended" });
		const after = file.read()!;
		expect(bytes(after).subarray(0, bytes(older).length)).toEqual(bytes(older));
		expect(after).toBe(appendCollectionEntry(older, serializeFragmentEntryV4(fragment)));
		const [headword, definition] = input.text.split("\n");
		expect(serializeFragmentEntryV4(fragment)).toBe(`- ${escapeFragmentMarkdown(headword!)}\n  ${escapeFragmentMarkdown(definition!)}\n`);
		expect(serializeFragmentEntryV4(fragment)).not.toContain("<!--");
		expect(serializeFragmentEntryV4(fragment)).not.toContain('"metadataVersion"');
	});
});
