import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { FakeProverbSession, type FakeProverbSessionHost } from "../src/view/FakeProverbSession";
import type { ManualMorphVocabulary } from "../src/transform/manualMorphology";
import { RICH_TEXT, mintOwner } from "./fakeProverbCoreFixtures";

/**
 * PRE-RELEASE-FAKE-PROVERB-VIEW1 re-review 3 (P2): the session holds the current
 * Vocabulary owner only. Nothing it keeps — the published batch, the stale
 * state, the View-lifetime BATCH1 controller — may keep an earlier owner, its
 * Snapshot or its Source analyses alive. Measured by real garbage collection,
 * on the session alone, so no View internals can hide or cause a retention.
 */
setFlagsFromString("--expose_gc");
const gc = runInNewContext("gc") as () => void;

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
/**
 * `deref()` keeps its target alive until the current job ends, so each attempt
 * yields first, collects, yields again and only then looks.
 */
async function collected(ref: WeakRef<object>): Promise<boolean> {
	for (let attempt = 0; attempt < 10; attempt++) {
		await tick(); gc(); await tick();
		if (ref.deref() === undefined) return true;
	}
	return false;
}

let material = 0;
function session() {
	let active: ManualMorphVocabulary | null = null;
	const host: FakeProverbSessionHost = {
		active: () => active,
		material: () => (++material).toString(16).padStart(64, "c"),
		scheduler: { now: () => 0, paint: async () => undefined, yieldTask: async () => undefined },
		copy: async () => undefined,
		collect: async () => ({ status: "created" }),
	};
	const fake = new FakeProverbSession(host);
	fake.attach(() => "published", () => undefined);
	return { fake, setActive: (owner: ManualMorphVocabulary | null) => { active = owner; } };
}

/** Mints an owner and returns only weak references to it, so the test itself retains nothing. */
async function mintWeak(text: string, use: (owner: ManualMorphVocabulary) => Promise<void>) {
	const { owner } = await mintOwner([text]);
	const refs = { owner: new WeakRef(owner), snapshot: new WeakRef(owner.snapshot), analyses: new WeakRef(owner.sources) };
	await use(owner);
	return refs;
}

describe("the Fake Proverb session keeps only the current owner alive", () => {
	it("observes collection at all: a held owner survives, a dropped one does not", async () => {
		const held = await mintOwner([RICH_TEXT]);
		expect(await collected(new WeakRef(held.owner))).toBe(false);
		const dropped = await mintWeak(RICH_TEXT, async () => undefined);
		expect(await collected(dropped.owner)).toBe(true);
		expect(held.owner.snapshot).toBeTruthy();
	});

	it("keeps the current owner alive while it is current", async () => {
		const { fake, setActive } = session();
		const current = await mintWeak(RICH_TEXT, async owner => { setActive(owner); await fake.generate(); setActive(null); });
		expect(await collected(current.owner)).toBe(false);
		fake.dispose();
		expect(await collected(current.owner)).toBe(true);
	});

	it("releases an earlier owner, its Snapshot and analyses once a new owner generates", async () => {
		const { fake, setActive } = session();
		const earlier = await mintWeak(RICH_TEXT, async owner => { setActive(owner); await fake.generate(); });
		expect(fake.batch()?.actualCount).toBe(10);
		await mintWeak(`${RICH_TEXT}猫は川を読む。`, async owner => { setActive(owner); await fake.generate(); });
		expect(fake.batch()?.actualCount).toBe(10);
		expect(await collected(earlier.owner)).toBe(true);
		expect(await collected(earlier.snapshot)).toBe(true);
		expect(await collected(earlier.analyses)).toBe(true);
		fake.dispose();
	});

	it("releases the earlier owner even while its batch is still the one on screen", async () => {
		const { fake, setActive } = session();
		const earlier = await mintWeak(RICH_TEXT, async owner => { setActive(owner); await fake.generate(); });
		const shown = fake.batch();
		expect(shown?.actualCount).toBe(10);
		// A new owner with no usable vocabulary: its Generate produces nothing, so the earlier batch stays published.
		await mintWeak("。", async owner => { setActive(owner); await fake.generate(); });
		expect(fake.batch()).toBe(shown);
		expect(fake.isStale()).toBe(true);
		expect(await collected(earlier.owner)).toBe(true);
		expect(await collected(earlier.snapshot)).toBe(true);
		// The batch on screen stays usable without its owner.
		expect(fake.canWrite(shown!.rows[0]!.rowSlotId)).toBe(true);
		fake.dispose();
	});

	it("releases the current owner after its own Source changes", async () => {
		const { fake, setActive } = session();
		const current = await mintWeak(RICH_TEXT, async owner => { setActive(owner); await fake.generate(); });
		setActive(null);
		fake.sourceChanged("private-note-0.md");
		expect(fake.isStale()).toBe(true);
		expect(await collected(current.owner)).toBe(true);
		fake.dispose();
	});
});
