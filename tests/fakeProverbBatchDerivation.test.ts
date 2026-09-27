import { describe, expect, it, vi } from "vitest";

/**
 * How many times a Generate derives the CORE1 authority from the Snapshot.
 * Each derivation reads the owner's Sources through
 * `readManualMorphVocabularySources()` exactly once, so counting that call
 * counts derivations. The wrapper delegates to the real module, so owners
 * minted through it are genuine.
 */
const counter = vi.hoisted(() => ({ reads: 0 }));
vi.mock("../src/transform/manualMorphology", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/transform/manualMorphology")>();
	return {
		...actual,
		readManualMorphVocabularySources: (value: Parameters<typeof actual.readManualMorphVocabularySources>[0]) => {
			counter.reads += 1;
			return actual.readManualMorphVocabularySources(value);
		},
	};
});

const { createFakeProverbBatchController } = await import("../src/fakeProverb/fakeProverbBatch");
const { createFakeProverbAuthority, inspectFakeProverbAuthority } = await import("../src/fakeProverb/fakeProverbAuthority");
const { generateFakeProverbs } = await import("../src/fakeProverb/fakeProverbCore");
const { RICH_TEXT, mintOwner, ok, standardSet } = await import("./fakeProverbCoreFixtures");

let materialCounter = 0;
const material = (): string => (++materialCounter).toString(16).padStart(64, "b");

describe("CORE1 authority derivations per Generate", () => {
	it("derives once per (owner, recipe set), never once per draft or per Generate", async () => {
		const { owner: vocabulary } = await mintOwner([RICH_TEXT]);
		const recipeSet = standardSet();
		const controller = ok(createFakeProverbBatchController({ identityMaterial: material() }));
		const generate = (owner = vocabulary, set = recipeSet) => {
			const before = counter.reads;
			const ticket = ok(controller.beginGenerate({ vocabulary: owner, recipeSet: set, operationMaterial: material() }));
			ok(controller.complete(ticket, ok(controller.prepare(ticket))));
			return counter.reads - before;
		};
		expect(generate()).toBe(1);
		expect(generate()).toBe(0);
		expect(generate()).toBe(0);
		// Another recipe set object, or another owner, is another authority.
		expect(generate(vocabulary, standardSet())).toBe(1);
		const { owner: other } = await mintOwner([RICH_TEXT]);
		expect(generate(other)).toBe(1);
	});

	it("keeps CORE1 generation free of re-derivation while an explicit inspection still audits", async () => {
		const { owner: vocabulary } = await mintOwner([RICH_TEXT]);
		const recipeSet = standardSet();
		let before = counter.reads;
		const authority = ok(createFakeProverbAuthority({ vocabulary, recipeSet }));
		expect(counter.reads - before).toBe(1);
		before = counter.reads;
		for (let nonce = 0; nonce < 5; nonce += 1) ok(generateFakeProverbs({ authority, recipeSet, drawMode: "uniform", count: 10, nonce }));
		expect(counter.reads - before).toBe(0);
		before = counter.reads;
		expect(ok(inspectFakeProverbAuthority({ authority, recipeSet }))).toBe(true);
		expect(counter.reads - before).toBe(1);
	});
});
