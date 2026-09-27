// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { morphToken, suffix } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { MANUAL_ALGORITHM_VERSION } from "../src/analysis/manualDisplay";
import {
	buildCollectedFragment,
	type BodyFragmentInput,
	type FakeDictionaryFragmentInput,
} from "../src/collect/CollectedFragment";
import { FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER, serializeFragmentMetadata } from "../src/collect/fragmentMetadata";
import type { FakeDictionaryWorld } from "../src/application/fakeDictionaryWorld";

let restore: () => void;
const live: ReturnType<typeof manualMorphHarness>[] = [];
beforeAll(() => {
	restore = installObsidianDomHelpers();
});
afterAll(() => restore());
afterEach(async () => {
	for (const h of live.splice(0)) {
		await h.view.onClose();
	}
	document.getSelection()?.removeAllRanges();
	document.body.replaceChildren();
});

const tokenizer = () =>
	lexiconTokenizer([
		morphToken("書い"),
		morphToken("描い"),
		suffix("て"),
		token({ surface: "猫" }),
		token({ surface: "犬" }),
		token({ surface: "机" }),
	]);

function harness() {
	const h = manualMorphHarness(tokenizer());
	live.push(h);
	return h;
}

const whole = (root: Node) => {
	const range = document.createRange();
	range.selectNodeContents(root);
	return { rangeCount: 1, getRangeAt: () => range };
};

const slice = (node: Text, start: number, end: number) => {
	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, end);
	return { rangeCount: 1, getRangeAt: () => range };
};

function bodyInput(h: ReturnType<typeof manualMorphHarness>): BodyFragmentInput {
	const input = h.calls.collect.at(-1);
	if (!input || input.type !== "body") {
		throw new Error("expected body collect");
	}
	return input;
}

describe("PRE-RELEASE-COLLECT-V2 view provenance", () => {
	it("collects overlapping Manual overrides, including a partial word, and omits outsiders", async () => {
		const h = harness();
		await h.open("書いて猫。");
		await h.apply(["描いて犬机。"]);
		expect(h.controller().shuffleManual(h.current("書い"))).toBe("applied");
		expect(h.controller().shuffleManual(h.current("猫"))).toBe("applied");
		const writtenId = h.current("書い").tokenId;
		const catId = h.current("猫").tokenId;
		expect(await h.view.collectSelectedFragment({ selection: whole(h.root()) })).toBe("created");
		const all = bodyInput(h);
		expect(all.hasManualEdits).toBe(true);
		if (!all.hasManualEdits) {
			throw new Error("expected manual");
		}
		expect(all.manualAlgorithmVersion).toBe(MANUAL_ALGORITHM_VERSION);
		expect(all.manualOverrides.map((record) => record.tokenId).sort()).toEqual(
			[writtenId, catId].sort(),
		);

		h.calls.collect.length = 0;
		const writtenNode = h.controller().getTextNodes().find((node) => node.data.includes(h.current("書い").displaySurface));
		if (!writtenNode) {
			throw new Error("expected written node");
		}
		expect(
			await h.view.collectSelectedFragment({
				selection: slice(writtenNode, 0, 1),
			}),
		).toBe("created");
		const partial = bodyInput(h);
		expect(partial.hasManualEdits).toBe(true);
		if (!partial.hasManualEdits) {
			throw new Error("expected manual");
		}
		expect(partial.manualOverrides).toEqual([
			expect.objectContaining({ tokenId: writtenId }),
		]);
		expect(partial.manualOverrides.some((record) => record.tokenId === catId)).toBe(false);

		h.calls.collect.length = 0;
		const catNode = h.controller().getTextNodes().find((node) => node.data.includes(h.current("猫").displaySurface));
		if (!catNode) {
			throw new Error("expected cat node");
		}
		expect(
			await h.view.collectSelectedFragment({
				selection: slice(catNode, 0, catNode.data.length),
			}),
		).toBe("created");
		const catOnly = bodyInput(h);
		expect(catOnly.hasManualEdits).toBe(true);
		if (!catOnly.hasManualEdits) {
			throw new Error("expected manual");
		}
		expect(catOnly.manualOverrides.map((record) => record.tokenId)).toEqual([catId]);
	});

	it("drops Manual metadata after Use automatic result", async () => {
		const h = harness();
		await h.open("書いて。");
		await h.apply(["描いて。"]);
		expect(h.controller().shuffleManual(h.current("書い"))).toBe("applied");
		expect(h.controller().useAutomatic(h.current("書い"))).toBe("applied");
		expect(await h.view.collectSelectedFragment({ selection: whole(h.root()) })).toBe("created");
		expect(bodyInput(h).hasManualEdits).toBe(false);
		expect(bodyInput(h)).not.toHaveProperty("manualOverrides");
		expect(bodyInput(h)).not.toHaveProperty("manualAlgorithmVersion");
	});

	it("keeps the Snapshot that produced a stale body", async () => {
		const h = harness();
		await h.open("猫。");
		await h.apply(["犬机。"]);
		const fingerprint = h.controller().getAutomaticProvenance()!.vocabularyFingerprint;
		h.view.markSourceLost();
		expect(await h.view.collectSelectedFragment({ selection: whole(h.root()) })).toBe("created");
		expect(bodyInput(h).vocabulary.fingerprint).toBe(fingerprint);
		expect(bodyInput(h).vocabulary.sources.map((source) => source.path)).toEqual([
			"source0.md",
		]);
	});

	it("does not mix a later Apply into a cached Fake Definition, then expires Collect", async () => {
		const h = harness();
		await h.open("猫。");
		await h.apply(["犬机。"]);
		const firstFingerprint = h.controller().getVocabularySnapshot()!.fingerprint;
		const slot = h.current("猫");
		expect(slot.dictionaryAvailable).toBe(true);
		expect(await h.view.defineSelectedWord({ selection: whole(h.controller().getContainer()!.querySelector(".semantropy-token")!) })).toBe("ready");
		expect(await h.view.collectDefinition()).toBe("created");
		const first = h.calls.collect.at(-1) as FakeDictionaryFragmentInput;
		expect(first.type).toBe("fake-dictionary");
		expect(first.vocabulary.fingerprint).toBe(firstFingerprint);
		expect(Object.keys(JSON.parse(serializeFragmentMetadata(buildCollectedFragment(first, {
			id: "11111111-2222-4333-8444-555555555555",
			created: "2026-09-05T12:34:56.000Z",
		}).metadata)) as object)).toEqual([...FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER]);

		(
			Reflect.get(h.view, "definitionModal") as { close(): void } | null
		)?.close();
		expect(await h.apply(["犬机研究。"])).toBe("applied");
		expect(h.controller().getVocabularySnapshot()!.fingerprint).not.toBe(firstFingerprint);
		expect(await h.view.collectDefinition()).toBe("empty");
		expect(h.calls.collect.at(-1)).toBe(first);
	});

	it("uses the same Fake Dictionary Collect contract from Modal and hover", async () => {
		const modalView = harness();
		await modalView.open("猫。");
		await modalView.apply(["犬机。"]);
		const tokenEl = modalView.controller().getContainer()!.querySelector(".semantropy-token")!;
		expect(await modalView.view.defineSelectedWord({ selection: whole(tokenEl) })).toBe("ready");
		expect(await modalView.view.collectDefinition()).toBe("created");
		const modal = modalView.calls.collect.at(-1) as FakeDictionaryFragmentInput;

		const hover = harness();
		await hover.open("猫。");
		await hover.apply(["犬机。"]);
		const hoverToken = hover.controller().getContainer()!.querySelector(".semantropy-token")!;
		hoverToken.dispatchEvent(
			new MouseEvent("pointerover", { bubbles: true, cancelable: true, altKey: true }),
		);
		await new Promise<void>((resolve) => window.setTimeout(resolve, 145));
		expect(document.querySelector(".semantropy-dictionary-popover")).not.toBeNull();
		expect(await hover.view.collectDefinition()).toBe("created");
		const fromHover = hover.calls.collect.at(-1) as FakeDictionaryFragmentInput;
		expect(modal.type).toBe("fake-dictionary");
		expect(fromHover.type).toBe("fake-dictionary");
		expect(Object.keys(modal).sort()).toEqual(Object.keys(fromHover).sort());
		expect(modal.vocabulary.drawMode).toBe(fromHover.vocabulary.drawMode);
		expect(modal.templateSetVersion).toBe(fromHover.templateSetVersion);
		expect(modal).toHaveProperty("metadataVersion", 4);
		expect(fromHover).not.toHaveProperty("seed");
	});

	it.each(["modal", "hover"] as const)(
		"keeps cached Target and Vocabulary together after Target Refresh (%s)",
		async (entry) => {
			const h = harness();
			await h.open("猫。");
			await h.apply(["犬机。"]);
			const define = async () => {
				const tokenEl = h.controller().getContainer()!.querySelector(".semantropy-token");
				if (!tokenEl) {
					throw new Error("expected token");
				}
				if (entry === "modal") {
					expect(await h.view.defineSelectedWord({ selection: whole(tokenEl) })).toBe("ready");
					return;
				}
				tokenEl.dispatchEvent(
					new MouseEvent("pointerover", { bubbles: true, cancelable: true, altKey: true }),
				);
				await new Promise<void>((resolve) => window.setTimeout(resolve, 145));
				expect(document.querySelector(".semantropy-dictionary-popover")).not.toBeNull();
			};
			await define();
			expect(await h.view.collectDefinition()).toBe("created");
			const first = h.calls.collect.at(-1) as FakeDictionaryFragmentInput;
			const firstResult = (Reflect.get(h.view, "dictionaryWorld") as FakeDictionaryWorld).getCurrent()?.result;
			expect(first.type).toBe("fake-dictionary");
			expect(first.target.path).toBe("target.md");
			expect(first.vocabulary.sources.map((source) => source.path)).toEqual(["source0.md"]);
			const firstHash = first.target.contentHash;
			const firstFingerprint = first.vocabulary.fingerprint;

			h.state.text = "猫です。";
			expect(await h.view.refreshSource()).toBe("refreshed");
			const refreshed = h.peek.session.getReadySnapshot();
			expect(refreshed?.contentHash).not.toBe(firstHash);
			expect(h.controller().getVocabularySnapshot()!.fingerprint).toBe(firstFingerprint);

			await define();
			expect(await h.view.collectDefinition()).toBe("created");
			const second = h.calls.collect.at(-1) as FakeDictionaryFragmentInput;
			expect(second.type).toBe("fake-dictionary");
			expect(second.text).toBe(first.text);
			expect(second.target).toEqual(first.target);
			expect(second.vocabulary).toEqual(first.vocabulary);
			expect(second.target.contentHash).not.toBe(refreshed?.contentHash);
			expect(
				(Reflect.get(h.view, "dictionaryWorld") as FakeDictionaryWorld).getCurrent()?.result,
			).toBe(firstResult);
		},
	);
});
