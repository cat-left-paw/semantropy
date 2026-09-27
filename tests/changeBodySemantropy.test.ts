// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { BODY_LEVEL_ERROR_MESSAGE } from "../src/application/changeBodySemantropy";
import { DEFAULT_COLLECTION_PATH } from "../src/settings/collectionPath";
import { defaultSemantropySettings } from "../src/settings/semantropySettings";
import type { StoredSemantropySettings } from "../src/settings/semantropySettings";
import { transformTokenSequences } from "../src/transform/transformTokens";
import { toSemantropyViewModel } from "../src/view/semantropyViewModel";
import { HIGH, LOW, MAX, MEDIUM, OFF } from "./readyAnalysis";
import { RefreshHarness, deferred } from "./refreshHarness";

/** Eight interchangeable single-character nouns in one paragraph. */
const BODY = "猫犬鳥魚虫貝馬牛";

async function openedHarness(
	body = BODY,
	sourcePath = "folder/note.md",
): Promise<RefreshHarness> {
	const harness = new RefreshHarness();
	harness.sources.set(sourcePath, body);
	// Start at the product default, so raising to MAX is a real change.
	harness.bodySemantropy = MEDIUM;
	await harness.open(sourcePath, "note.md");
	return harness;
}

describe("Open and Refresh carry the configured level", () => {
	it("opens at the value in force", async () => {
		const harness = new RefreshHarness();
		harness.sources.set("folder/note.md", BODY);
		harness.bodySemantropy = LOW;

		await harness.open("folder/note.md", "note.md");

		const state = harness.readyState();
		expect(state?.bodySemantropy).toBe(LOW);
		expect(state?.replaceableSlotCount).toBe(8);
		expect(state?.replacementCount).toBeLessThan(8);
		expect(harness.bodyText()).toBe(
			transformTokenSequences(
				state?.tokenSequences ?? [],
				state?.pool ?? new Map(),
				state?.bodySeed ?? 0,
				LOW,
			).texts.join(""),
		);
	});

	it("opens at 0 with the original body and a full replaceable count", async () => {
		const harness = new RefreshHarness();
		harness.sources.set("folder/note.md", BODY);
		harness.bodySemantropy = OFF;

		await harness.open("folder/note.md", "note.md");

		expect(harness.bodyText()).toBe(BODY);
		expect(harness.readyState()?.replacementCount).toBe(0);
		expect(harness.readyState()?.replaceableSlotCount).toBe(8);
	});

	it("keeps the level and only rerolls the Seed on Refresh", async () => {
		const harness = await openedHarness();
		harness.bodySemantropy = HIGH;
		await harness.setBodySemantropy(HIGH);
		const before = harness.readyState();

		harness.sources.set("folder/note.md", "鳥魚虫貝馬牛猫犬");
		expect(await harness.refreshSource()).toBe("refreshed");

		const after = harness.readyState();
		expect(after?.bodySemantropy).toBe(HIGH);
		expect(after?.bodySeed).not.toBe(before?.bodySeed);
		expect(after?.snapshot.text).toBe("鳥魚虫貝馬牛猫犬");
	});

	it("keeps the level and only rerolls the Seed on Reshuffle", async () => {
		const harness = await openedHarness();
		await harness.setBodySemantropy(LOW);
		const before = harness.readyState();

		expect(await harness.reshuffle()).toBe("applied");

		const after = harness.readyState();
		expect(after?.bodySemantropy).toBe(LOW);
		expect(after?.bodySeed).not.toBe(before?.bodySeed);
		expect(after?.snapshot).toBe(before?.snapshot);
		expect(after?.replaceableSlotCount).toBe(8);
	});
});

describe("Changing the level", () => {
	it("re-transforms from the stored analysis without any I/O", async () => {
		const harness = await openedHarness();
		const before = harness.readyState();
		harness.tokenizeCalls = [];
		harness.readCalls = [];
		harness.renderCalls = [];
		harness.hashCalls = [];
		harness.seeds = [];

		expect(await harness.setBodySemantropy(MAX)).toBe("applied");

		expect(harness.tokenizeCalls).toEqual([]);
		expect(harness.readCalls).toEqual([]);
		expect(harness.renderCalls).toEqual([]);
		expect(harness.hashCalls).toEqual([]);
		expect(harness.seeds).toEqual([]);
		const after = harness.readyState();
		expect(after?.bodySemantropy).toBe(MAX);
		expect(after?.replacementCount).toBe(8);
		expect(after?.tokenSequences).toBe(before?.tokenSequences);
		expect(after?.pool).toBe(before?.pool);
	});

	it("keeps the snapshot, its freshness, the Seed and the node count", async () => {
		const harness = await openedHarness();
		const before = harness.readyState();
		const runsBefore = harness.controller.getSequenceCount();
		const containerBefore = harness.controller.getContainer();

		await harness.setBodySemantropy(HIGH);

		const after = harness.readyState();
		expect(after?.snapshot).toBe(before?.snapshot);
		expect(after?.bodySeed).toBe(before?.bodySeed);
		expect(after?.freshness).toBe("fresh");
		expect(harness.controller.getSequenceCount()).toBe(runsBefore);
		expect(harness.controller.getContainer()).toBe(containerBefore);
		expect(harness.controller.getBodyGeneration()).toBe(
			harness.controller.getBodyGeneration(),
		);
	});

	it("persists the new value exactly once", async () => {
		const harness = await openedHarness();
		expect(await harness.setBodySemantropy(LOW)).toBe("applied");
		expect(harness.persistCalls).toEqual([LOW]);
		expect(harness.bodySemantropy).toBe(LOW);
	});

	it("treats re-selecting the current value as a no-op", async () => {
		const harness = await openedHarness();
		await harness.setBodySemantropy(LOW);
		const before = harness.readyState();
		harness.persistCalls = [];

		expect(await harness.setBodySemantropy(LOW)).toBe("unchanged");
		expect(harness.persistCalls).toEqual([]);
		expect(harness.readyState()).toBe(before);
	});

	it("stays stale after a level change", async () => {
		const harness = await openedHarness();
		harness.sources.set("folder/note.md", "別本文");
		await harness.recheckSourceFreshness();
		expect(harness.readyState()?.freshness).toBe("stale");
		const staleSnapshot = harness.readyState()?.snapshot;

		expect(await harness.setBodySemantropy(MAX)).toBe("applied");

		expect(harness.readyState()?.freshness).toBe("stale");
		expect(harness.readyState()?.snapshot).toBe(staleSnapshot);
		expect(harness.readyState()?.bodySemantropy).toBe(MAX);
	});

	it("reports failure without leaking the body or a path", async () => {
		const harness = await openedHarness("秘密本文猫犬", "/Users/x/vault/n.md");
		harness.persistFails = true;

		expect(await harness.setBodySemantropy(MAX)).toBe("failed");
		expect(BODY_LEVEL_ERROR_MESSAGE).toBe(
			"Could not change the Text level. Try again.",
		);
		expect(BODY_LEVEL_ERROR_MESSAGE).not.toContain("秘密本文");
		expect(BODY_LEVEL_ERROR_MESSAGE).not.toContain("/Users/");
		// A failed write leaves the display on the value that is still stored.
		expect(harness.readyState()?.bodySemantropy).not.toBe(MAX);
	});

	it("converges when a failed write is retried", async () => {
		const harness = await openedHarness();
		harness.persistFails = true;
		expect(await harness.setBodySemantropy(MAX)).toBe("failed");

		harness.persistFails = false;
		expect(await harness.setBodySemantropy(MAX)).toBe("applied");
		expect(harness.readyState()?.bodySemantropy).toBe(MAX);
	});

	it("reports unavailable when nothing is ready", async () => {
		const harness = new RefreshHarness();
		expect(await harness.setBodySemantropy(MAX)).toBe("unavailable");
		expect(harness.persistCalls).toEqual([]);
	});
});

describe("Level change concurrency", () => {
	it("does not touch the DOM or the session when the body generation moved", async () => {
		const harness = await openedHarness();
		const before = harness.readyState();
		const gate = deferred<boolean>();
		const changing = harness.setBodySemantropyGated(MAX, gate.promise);

		// A Refresh replaces the rendered body while the write is in flight.
		harness.controller.release();
		gate.resolve(true);

		expect(await changing).toBe("aborted");
		expect(harness.readyState()?.bodySemantropy).toBe(before?.bodySemantropy);
		expect(harness.readyState()?.replacementCount).toBe(
			before?.replacementCount,
		);
	});

	it("does not apply when the snapshot was replaced during the write", async () => {
		const harness = await openedHarness();
		const gate = deferred<boolean>();
		const changing = harness.setBodySemantropyGated(MAX, gate.promise);

		harness.sources.set("folder/note.md", "鳥魚虫");
		await harness.open("folder/note.md", "note.md");
		gate.resolve(true);

		expect(await changing).toBe("aborted");
		expect(harness.readyState()?.snapshot.text).toBe("鳥魚虫");
	});

	it("fails closed rather than partially applying a node-count mismatch", async () => {
		const harness = await openedHarness();
		const before = harness.bodyText();

		expect(
			await harness.setBodySemantropy(MAX, {
				transform: (sequences, pool, bodySeed, level) => {
					const result = transformTokenSequences(
						sequences,
						pool,
						bodySeed,
						level,
					);
					return { ...result, texts: [...result.texts, "余分"] };
				},
			}),
		).toBe("failed");

		expect(harness.bodyText()).toBe(before);
		expect(harness.readyState()?.bodySemantropy).not.toBe(MAX);
		// Nothing that failed before the body was touched may reach data.json.
		expect(harness.persistCalls).toEqual([]);
		expect(harness.bodySemantropy).toBe(MEDIUM);
	});

	it("writes nothing when the transform itself throws", async () => {
		const harness = await openedHarness();
		const before = harness.readyState();

		expect(
			await harness.setBodySemantropy(MAX, {
				transform: () => {
					throw new Error("transform blew up");
				},
			}),
		).toBe("failed");

		expect(harness.persistCalls).toEqual([]);
		expect(harness.bodySemantropy).toBe(MEDIUM);
		expect(harness.readyState()?.bodySemantropy).toBe(before?.bodySemantropy);
		expect(harness.readyState()?.replacementCount).toBe(
			before?.replacementCount,
		);
	});

	it("writes nothing when the body refuses the prepared texts", async () => {
		const harness = await openedHarness();
		const before = harness.readyState();
		const bodyBefore = harness.bodyText();

		// The body cannot take these texts at all — the old mismatch case.
		expect(
			await harness.setBodySemantropy(MAX, { prepareTexts: () => null }),
		).toBe("failed");

		expect(harness.persistCalls).toEqual([]);
		// The stored level and the shown level must not come apart.
		expect(harness.bodySemantropy).toBe(MEDIUM);
		expect(harness.readyState()?.bodySemantropy).toBe(MEDIUM);
		expect(harness.readyState()?.replacementCount).toBe(
			before?.replacementCount,
		);
		expect(harness.bodyText()).toBe(bodyBefore);
	});

	it("settles a body replaced during the write as aborted, never as failed", async () => {
		const harness = await openedHarness();
		const bodyBefore = harness.bodyText();

		// Prepare succeeds, then the commit finds the body gone.
		expect(
			await harness.setBodySemantropy(MAX, {
				prepareTexts: () => () => "stale",
			}),
		).toBe("aborted");

		// A write did happen here, but the display was never touched, so the
		// two only differ until the next Open — and the result says so.
		expect(harness.persistCalls).toEqual([MAX]);
		expect(harness.bodyText()).toBe(bodyBefore);
		expect(harness.readyState()?.bodySemantropy).toBe(MEDIUM);
	});

	it("keeps the stored level and the shown level in step across failures", async () => {
		const harness = await openedHarness();

		// A pure failure: nothing moves anywhere.
		await harness.setBodySemantropy(MAX, {
			transform: () => {
				throw new Error("transform blew up");
			},
		});
		expect(harness.bodySemantropy).toBe(MEDIUM);
		expect(harness.readyState()?.bodySemantropy).toBe(MEDIUM);

		// A successful change moves both together.
		// A body that refuses the write: still nothing stored.
		await harness.setBodySemantropy(MAX, { prepareTexts: () => null });
		expect(harness.bodySemantropy).toBe(MEDIUM);
		expect(harness.readyState()?.bodySemantropy).toBe(MEDIUM);

		// A successful change moves both together.
		expect(await harness.setBodySemantropy(LOW)).toBe("applied");
		expect(harness.bodySemantropy).toBe(LOW);
		expect(harness.readyState()?.bodySemantropy).toBe(LOW);
	});

	it("never returns failed after the setting reached disk", async () => {
		const harness = await openedHarness();
		const refusals: {
			label: string;
			options: Parameters<RefreshHarness["setBodySemantropy"]>[1];
		}[] = [
			{
				label: "transform throws",
				options: {
					transform: () => {
						throw new Error("transform blew up");
					},
				},
			},
			{
				label: "text count mismatch",
				options: {
					transform: (sequences, pool, bodySeed, level) => {
						const result = transformTokenSequences(
							sequences,
							pool,
							bodySeed,
							level,
						);
						return { ...result, texts: [...result.texts, "余分"] };
					},
				},
			},
			{ label: "body refuses", options: { prepareTexts: () => null } },
		];

		for (const refusal of refusals) {
			harness.persistCalls = [];
			expect(
				await harness.setBodySemantropy(MAX, refusal.options),
				refusal.label,
			).toBe("failed");
			expect(harness.persistCalls, refusal.label).toEqual([]);
			expect(harness.bodySemantropy, refusal.label).toBe(MEDIUM);
			expect(harness.readyState()?.bodySemantropy, refusal.label).toBe(
				MEDIUM,
			);
		}
	});

	it("starts one run when the control is used repeatedly", async () => {
		const harness = await openedHarness();
		const gate = deferred<boolean>();

		const first = harness.setBodySemantropyGated(MAX, gate.promise);
		const second = harness.setBodySemantropy(LOW);
		const third = harness.setBodySemantropy(HIGH);

		expect(await second).toBe("busy");
		expect(await third).toBe("busy");
		gate.resolve(true);
		expect(await first).toBe("applied");
		expect(harness.persistCalls).toEqual([MAX]);
	});

	it("blocks Reshuffle and Refresh while a level change is in flight", async () => {
		const harness = await openedHarness();
		const gate = deferred<boolean>();
		const changing = harness.setBodySemantropyGated(MAX, gate.promise);

		expect(await harness.reshuffle()).toBe("busy");
		expect(await harness.refreshSource()).toBe("busy");

		gate.resolve(true);
		expect(await changing).toBe("applied");
	});

	it("does not apply a level change that finished after close", async () => {
		const harness = await openedHarness();
		const gate = deferred<boolean>();
		const changing = harness.setBodySemantropyGated(MAX, gate.promise);

		harness.close();
		gate.resolve(true);

		expect(await changing).toBe("aborted");
		expect(harness.session.getState()).toEqual({ status: "empty" });
		expect(harness.controller.getTextNodes()).toHaveLength(0);
	});

	it("never writes to the note while changing the level", async () => {
		const harness = await openedHarness();
		const before = harness.storedBodies();

		await harness.setBodySemantropy(OFF);
		await harness.setBodySemantropy(MAX);

		expect(harness.storedBodies()).toBe(before);
	});
});

describe("Level and the view model", () => {
	function readyModel(harness: RefreshHarness, busy = false) {
		return toSemantropyViewModel(harness.session.getState(), { busy });
	}

	it("shows the level label, the choices and the control", async () => {
		const harness = await openedHarness();
		const model = readyModel(harness);

		expect(model.levelLabel).toBe("Text Semantropy: Medium");
		expect(model.showLevelControl).toBe(true);
		expect(model.levelControlEnabled).toBe(true);
		expect(model.levelChoices?.map((choice) => choice.label)).toEqual([
			"Off",
			"Low",
			"Medium",
			"High",
			"MAX",
		]);
	});

	it("keeps a non-preset value visible in the choices", async () => {
		const harness = new RefreshHarness();
		harness.sources.set("folder/note.md", BODY);
		harness.bodySemantropy = 37 as typeof MAX;
		await harness.open("folder/note.md", "note.md");

		const model = readyModel(harness);
		expect(model.levelLabel).toBe("Text Semantropy: 37");
		expect(model.bodySemantropy).toBe(37);
		expect(model.levelChoices?.map((choice) => choice.value)).toContain(37);
	});

	it("disables every control while busy and hides them outside ready", async () => {
		const harness = await openedHarness();
		const busy = readyModel(harness, true);
		expect(busy.levelControlEnabled).toBe(false);
		expect(busy.reshuffleEnabled).toBe(false);
		expect(busy.refreshEnabled).toBe(false);

		expect(toSemantropyViewModel({ status: "empty" }).showLevelControl).toBe(
			false,
		);
		harness.session.beginLoading();
		expect(readyModel(harness).showLevelControl).toBe(false);
	});

	it("disables Reshuffle at 0 but keeps Refresh available", async () => {
		const harness = await openedHarness();
		await harness.setBodySemantropy(OFF);
		const model = readyModel(harness);

		expect(model.reshuffleEnabled).toBe(false);
		expect(model.refreshEnabled).toBe(true);
		expect(model.levelControlEnabled).toBe(true);
		expect(model.message).toBe("Text transformation is off.");
		expect(await harness.reshuffle()).toBe("unavailable");
	});

	it("keeps Reshuffle available when a low value happened to exchange nothing", async () => {
		const harness = await openedHarness();
		await harness.setBodySemantropy(LOW);
		// Seeds where Low exchanges nothing exist; find one and check the gate.
		let attempts = 0;
		while (harness.readyState()?.replacementCount !== 0 && attempts < 200) {
			await harness.reshuffle();
			attempts += 1;
		}

		const state = harness.readyState();
		expect(state?.replacementCount).toBe(0);
		expect(state?.replaceableSlotCount).toBeGreaterThan(0);
		const model = readyModel(harness);
		expect(model.reshuffleEnabled).toBe(true);
		// Nothing exchanged is not the same as nothing to exchange.
		expect(model.message).toBeNull();
		expect(await harness.reshuffle()).toBe("applied");
	});

	it("shows the insufficient-pool message only for a genuinely empty pool", async () => {
		const harness = new RefreshHarness();
		harness.sources.set("folder/note.md", "孤");
		await harness.open("folder/note.md", "note.md");

		const model = readyModel(harness);
		expect(model.replaceableSlotCount).toBe(0);
		expect(model.message).toBe("Not enough replaceable nouns in this note.");
		expect(model.reshuffleEnabled).toBe(false);
		expect(model.refreshEnabled).toBe(true);
	});
});

describe("Level and the dictionary setting", () => {
	it("leaves the dictionary value and any future Seed untouched", async () => {
		const { SemantropySettingsStore } = await import(
			"../src/settings/SemantropySettingsStore"
		);
		let stored: unknown = {
			schemaVersion: 1,
			bodySemantropy: 50,
			dictionarySemantropy: 75,
		};
		const save = vi.fn(async (data: StoredSemantropySettings) => {
			stored = data;
		});
		const store = new SemantropySettingsStore({
			load: async () => stored,
			save,
		});
		await store.load();

		await store.setBodySemantropy(MAX);

		expect(store.getDictionarySemantropy()).toBe(75);
		expect(stored).toEqual({
			...defaultSemantropySettings(),
			bodySemantropy: 100,
			dictionarySemantropy: 75,
			collectionPath: DEFAULT_COLLECTION_PATH,
		});
		expect(JSON.stringify(stored)).not.toMatch(/seed/i);
	});
});

describe("Level changes and protected content", () => {
	it("keeps code, link labels, tags and math static, untokenized and attribute-free", async () => {
		const harness = new RefreshHarness();
		// The production Target shows protected Markdown as inert static text:
		// no link targets, classes or attributes exist to be preserved.
		harness.sources.set("folder/note.md", "猫犬鳥魚\n\n```js\n虫貝馬牛\n```\n\n前[猫犬](other.md)後\n\n#鳥魚 と $虫貝$");
		harness.bodySemantropy = MEDIUM;
		await harness.open("folder/note.md", "note.md");
		expect(harness.tokenizeCalls).toEqual(["猫犬鳥魚", "前", "後", " と "]);

		const container = harness.controller.getContainer();
		const protectedText = () => {
			const [, linkParagraph, tagParagraph] = Array.from(container?.querySelectorAll("p") ?? []);
			return {
				pre: container?.querySelector("pre")?.textContent,
				link: linkParagraph?.children[1]?.textContent,
				tag: tagParagraph?.firstElementChild?.textContent,
				math: tagParagraph?.lastElementChild?.textContent,
			};
		};
		const before = protectedText();
		expect(before).toEqual({ pre: "```js\n虫貝馬牛\n```\n", link: "猫犬", tag: "#鳥魚", math: "虫貝" });
		const runsBefore = harness.controller.getSequenceCount();

		for (const level of [OFF, LOW, MAX]) {
			expect(await harness.setBodySemantropy(level)).toBe("applied");
			expect(harness.controller.getContainer()).toBe(container);
			expect(harness.controller.getSequenceCount()).toBe(runsBefore);
			expect(protectedText()).toEqual(before);
			expect(container?.querySelector("a")).toBeNull();
			for (const element of Array.from(container?.querySelectorAll("*") ?? [])) {
				expect(element.attributes).toHaveLength(0);
			}
		}
		expect(harness.tokenizeCalls).toEqual(["猫犬鳥魚", "前", "後", " と "]);
	});

	it("returns the visible body to the original text at 0", async () => {
		const harness = await openedHarness();
		await harness.setBodySemantropy(MAX);
		expect(harness.bodyText()).not.toBe(BODY);

		expect(await harness.setBodySemantropy(OFF)).toBe("applied");
		expect(harness.bodyText()).toBe(BODY);
	});
});
