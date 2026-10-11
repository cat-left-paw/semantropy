// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer } from "./support/manualMorphHarness";
import { token } from "./tokenFixtures";
import { analyzeManualMorphSource, buildManualMorphVocabulary, type ManualMorphVocabulary } from "../src/transform/manualMorphology";
import { enclosedTermSyntax } from "../src/vocabulary/enclosedTerms";
import { assertDictionarySemantropy } from "../src/settings/dictionarySemantropy";
import { validateHeadword, type FakeDictionaryHeadword } from "../src/dictionary/headword";
import { generateFakeDefinition } from "../src/dictionary/generateFakeDefinition";
import { snapshotDictionaryPool } from "../src/application/prepareVocabulary";
import { SnapshotPoolCache } from "../src/application/snapshotPoolCache";
import { collectVocabularyFromSnapshot } from "../src/application/collectVocabulary";
import { cachedDefinitionCommit, DefinitionCache, definitionCacheKey, type CachedFakeDefinition } from "../src/application/definitionCache";
import { FakeDictionaryWorld, type FakeDictionaryCommit, type FakeDictionaryCurrent } from "../src/application/fakeDictionaryWorld";
import { fakeDictionaryCanonicalText, fakeDictionaryFragmentFromCurrent } from "../src/application/fakeDictionaryFragmentFromReady";
import { runDefineSelectedWord } from "../src/application/defineSelectedWord";
import { runChangeDictionarySemantropy } from "../src/application/runChangeDictionarySemantropy";
import { runReshuffleDefinition } from "../src/application/runReshuffleDefinition";
import { dictionaryPoolIsCallable } from "../src/analysis/displaySlots";
import { toFakeDefinitionViewModel } from "../src/view/fakeDefinitionViewModel";
import { FakeDefinitionPresenter } from "../src/view/FakeDefinitionPresenter";
import { RecomposePane } from "../src/view/RecomposePane";
import { RecomposeSession, type RecomposeHost } from "../src/view/RecomposeSession";

/**
 * FAKE-DICT-RECOMPOSE1, the generation path: a definition for a word of a Recompose sentence, which belongs to a
 * Vocabulary and has no Target note. It must be representable (the current definition, the cache, the define and
 * level runs), must never be collectable, and must not change what the Shuffle side makes, caches or collects.
 */
let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());

const LEXICON = [
	...["猫", "犬", "森", "川", "空", "駅", "窓", "雨"].map(surface => token({ surface })),
	token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "を", pos: "助詞", detail1: "格助詞" }),
	token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }),
	token({ surface: "た", pos: "助動詞", detail1: "*" }),
];
const TEXT = "猫が森を見た。犬が川を見た。空が猫を見た。森が犬を見た。駅が窓を見た。雨が駅を見た。";

async function mint(path: string, text = TEXT, lexicon = LEXICON): Promise<ManualMorphVocabulary> {
	const answer = await analyzeManualMorphSource({ text, sourcePath: path, tokenizer: lexiconTokenizer(lexicon), mode: "target-prototype", enclosedTerms: enclosedTermSyntax([]) });
	if (answer.status !== "ready") throw Error("fixture");
	return buildManualMorphVocabulary({ sources: [answer.analysis], drawMode: "uniform" });
}

function headwordOf(surface: string): FakeDictionaryHeadword {
	const validation = validateHeadword(surface, [LEXICON.find(entry => entry.surface === surface)!]);
	if (validation.outcome !== "accepted") throw Error("fixture");
	return validation.headword;
}

const TARGET_A = { sourcePath: "a.md", contentHash: "hash-a1" };
const TARGET_A2 = { sourcePath: "a.md", contentHash: "hash-a2" };

async function commitFor(snapshot: FakeDictionaryCurrent["snapshot"], level = 50, seed = 7, surface = "猫"): Promise<{ commit: FakeDictionaryCommit; owner: ManualMorphVocabulary }> {
	const owner = await mint("v.md");
	const pool = snapshotDictionaryPool(owner.snapshot);
	const headword = headwordOf(surface);
	const result = generateFakeDefinition({ headword, pool, dictionarySeed: seed, dictionarySemantropy: assertDictionarySemantropy(level) });
	return { owner, commit: { headword, pool, snapshot, vocabulary: collectVocabularyFromSnapshot(owner.snapshot), dictionarySeed: seed, dictionarySemantropy: assertDictionarySemantropy(level), result } };
}

describe("a definition with no Target", () => {
	it("is generated, copied as the same plain text, and has nothing to collect", async () => {
		const { commit } = await commitFor(null);
		expect(commit.result.outcome).toBe("generated");
		const world = new FakeDictionaryWorld();
		const id = world.beginRequest();
		expect(world.commit(id, commit)).toBe(true);
		const current = world.getCurrent()!;
		expect(current.snapshot).toBeNull();
		expect(fakeDictionaryCanonicalText(current)).toBe(`猫\n${(commit.result as { definition: string }).definition}`);
		expect(fakeDictionaryFragmentFromCurrent(current)).toBeNull();
		// The same definition with a Target is collectable: only the Target decides.
		const withTarget = (await commitFor(TARGET_A)).commit;
		const world2 = new FakeDictionaryWorld();
		world2.commit(world2.beginRequest(), withTarget);
		const input = fakeDictionaryFragmentFromCurrent(world2.getCurrent()!);
		expect(input).not.toBeNull();
		expect(input!.target).toEqual({ path: "a.md", contentHash: "hash-a1" });
	});

	it("keeps Copy and refuses Collect in the view model, whatever else is true", async () => {
		const none = (await commitFor(null)).commit, some = (await commitFor(TARGET_A)).commit;
		const model = (commit: FakeDictionaryCommit) => toFakeDefinitionViewModel({
			current: { requestId: 1, ...commit }, dictionarySemantropy: assertDictionarySemantropy(50), pendingRequestId: null, isPendingCurrent: false, errorMessage: null, busy: false, levelError: null,
		});
		expect(model(none)).toMatchObject({ status: "ready", copyEnabled: true, reshuffleEnabled: true, collectEnabled: false, levelControlEnabled: true });
		expect(model(some)).toMatchObject({ status: "ready", copyEnabled: true, reshuffleEnabled: true, collectEnabled: true });
	});

	it("hides the Collect button when the host says Collect is not offered, and shows it otherwise", async () => {
		const { commit } = await commitFor(null);
		const current: FakeDictionaryCurrent = { requestId: 1, ...commit };
		const host = (offered?: () => boolean) => ({
			getModel: () => toFakeDefinitionViewModel({ current, dictionarySemantropy: assertDictionarySemantropy(50), pendingRequestId: null, isPendingCurrent: false, errorMessage: null, busy: false, levelError: null }),
			onReshuffle: () => undefined, onCopy: () => undefined, onCollect: () => undefined, onSemantropyChange: () => undefined, ...(offered ? { collectOffered: offered } : {}),
		});
		const shown = (offered?: () => boolean) => {
			const container = document.createElement("div");
			const presenter = new FakeDefinitionPresenter(container, host(offered));
			presenter.sync();
			return container.querySelector<HTMLButtonElement>(".semantropy-collect-definition")!;
		};
		expect(shown().hidden).toBe(false);
		expect(shown(() => true).hidden).toBe(false);
		expect(shown(() => false).hidden).toBe(true);
	});

	it("can be reshuffled and re-levelled without a Target, and stays without one", async () => {
		const { commit } = await commitFor(null);
		const world = new FakeDictionaryWorld();
		world.commit(world.beginRequest(), commit);
		let seed = 100;
		expect(runReshuffleDefinition({ world, modalOpen: true, issueSeed: () => seed++, isAbandoned: () => false })).toBe("applied");
		expect(world.getCurrent()!.snapshot).toBeNull();
		expect(world.getCurrent()!.dictionarySeed).toBe(100);
		const outcome = await runChangeDictionarySemantropy({ world, next: assertDictionarySemantropy(80), persist: async () => true, isAbandoned: () => false, modalOpen: true });
		expect(outcome).toBe("applied");
		expect(world.getCurrent()!.snapshot).toBeNull();
		expect(world.getCurrent()!.dictionarySemantropy).toBe(80);
		expect(fakeDictionaryFragmentFromCurrent(world.getCurrent()!)).toBeNull();
	});

	it("does not let a level change land on a definition that has since been replaced by one with a Target", async () => {
		const { commit } = await commitFor(null);
		const world = new FakeDictionaryWorld();
		world.commit(world.beginRequest(), commit);
		const change = runChangeDictionarySemantropy({
			world, next: assertDictionarySemantropy(80), isAbandoned: () => false, modalOpen: true,
			// Committed under the change's own request id, so only the Target tells it from the definition it began with.
			persist: async () => { world.commit(world.currentRequestId(), { ...commit, snapshot: TARGET_A }); return true; },
		});
		// The Target appeared while the change waited: it is not the definition the change began with.
		expect(await change).toBe("aborted");
	});
});

describe("looking a word up with no Target", () => {
	const lookup = async (over: { snapshot: typeof TARGET_A | null; current: typeof TARGET_A | null }) => {
		const owner = await mint("v.md");
		const pool = snapshotDictionaryPool(owner.snapshot);
		return runDefineSelectedWord({
			selection: "猫", identified: validateHeadword("猫", [LEXICON.find(entry => entry.surface === "猫")!]), snapshot: over.snapshot, tokenSequences: [], preparedPool: pool,
			dictionarySeed: 5, dictionarySemantropy: assertDictionarySemantropy(50), getTokenizer: () => { throw new Error("must not tokenize"); }, isCurrent: () => true, getSnapshotIdentity: () => over.current,
		});
	};

	it("is ready with no Target when the caller names none and none appears", async () => {
		const answer = await lookup({ snapshot: null, current: null });
		expect(answer.status).toBe("ready");
		if (answer.status === "ready") {
			expect(answer.snapshot).toBeNull();
			expect(answer.result.outcome).toBe("generated");
		}
	});

	it("is stale when a Target appears that the lookup was not made for, and when one disappears", async () => {
		expect((await lookup({ snapshot: null, current: TARGET_A })).status).toBe("stale");
		expect((await lookup({ snapshot: TARGET_A, current: null })).status).toBe("stale");
		expect((await lookup({ snapshot: TARGET_A, current: TARGET_A2 })).status).toBe("stale");
		expect((await lookup({ snapshot: TARGET_A, current: TARGET_A })).status).toBe("ready");
	});
});

describe("the definition cache and the Target", () => {
	const entry = async (target: CachedFakeDefinition["target"], seed = 7) => {
		const { commit, owner } = await commitFor(target, 50, seed);
		const key = definitionCacheKey(commit.headword, seed, 50, owner.snapshot);
		return { key, value: { result: commit.result, target, vocabulary: commit.vocabulary } as CachedFakeDefinition, owner, commit };
	};

	it("keeps a Target-made entry as it is when the Recompose side remembers the same definition (made Shuffle, hit Recompose)", async () => {
		const made = await entry(TARGET_A);
		const cache = new DefinitionCache();
		cache.set(made.key, made.value);
		const before = cache.get(made.key)!;
		cache.set(made.key, { ...made.value, target: null });
		const after = cache.get(made.key)!;
		expect(after).toBe(before);
		expect(after.target).toEqual(TARGET_A);
		expect(cache.getForWorld(made.key)).toBe(before);
	});

	it("keeps a Target-made entry when the Shuffle side remembers it again (made Shuffle, hit Shuffle)", async () => {
		const made = await entry(TARGET_A);
		const cache = new DefinitionCache();
		cache.set(made.key, made.value);
		cache.set(made.key, made.value);
		expect(cache.get(made.key)!.target).toEqual(TARGET_A);
		expect(cache.size).toBe(1);
	});

	it("gives a no-Target entry the Shuffle side's Target when the Shuffle side commits it, and then treats it as its own (made Recompose, hit Shuffle)", async () => {
		const made = await entry(null);
		const cache = new DefinitionCache();
		cache.set(made.key, made.value);
		const hit = cache.getForWorld(made.key)!;
		expect(hit.target).toBeNull();
		// The Shuffle side commits with the Target it has now: `cachedDefinitionCommit` offers none, the caller falls back to its own.
		const provenance = cachedDefinitionCommit(hit, hit.result);
		expect(provenance).not.toBeNull();
		expect(provenance!.target ?? TARGET_A).toEqual(TARGET_A);
		// Remembering the committed definition writes that Target into the entry.
		cache.set(made.key, { result: hit.result, target: provenance!.target ?? TARGET_A, vocabulary: provenance!.vocabulary });
		expect(cache.get(made.key)!.target).toEqual(TARGET_A);
		// The Target alone is reloaded: the Shuffle side's next hit still pairs the old Target with the old definition.
		const again = cache.getForWorld(made.key)!;
		expect(cachedDefinitionCommit(again, again.result)!.target ?? TARGET_A2).toEqual(TARGET_A);
		// And the Recompose side meeting that entry later leaves it alone.
		cache.set(made.key, { ...made.value, target: null });
		expect(cache.get(made.key)!.target).toEqual(TARGET_A);
	});

	it("keeps a no-Target entry without a Target when the Recompose side meets it (made Recompose, hit Recompose)", async () => {
		const made = await entry(null);
		const cache = new DefinitionCache();
		cache.set(made.key, made.value);
		cache.set(made.key, made.value);
		expect(cache.get(made.key)!.target).toBeNull();
		expect(cache.size).toBe(1);
	});

	it("still lets the reshuffle index find a Recompose-made definition by word, like any other", async () => {
		const first = await entry(null, 7), second = await entry(null, 9);
		const cache = new DefinitionCache();
		cache.set(first.key, first.value);
		cache.set(second.key, second.value);
		expect(cache.size).toBe(1);
		expect(cache.getForWorld(first.key)!.result).toBe(second.value.result);
	});
});

describe("the pool of a Vocabulary", () => {
	it("is the one the Shuffle body gets from the same Snapshot, made once", async () => {
		const owner = await mint("v.md");
		const cache = new SnapshotPoolCache();
		const pool = cache.poolOf(owner.snapshot);
		expect(pool).toEqual(snapshotDictionaryPool(owner.snapshot));
		expect(cache.poolOf(owner.snapshot)).toBe(pool);
		expect(cache.poolOf((await mint("w.md")).snapshot)).not.toBe(pool);
	});

	it("can fill a template for a noun Vocabulary and cannot for one with no noun", async () => {
		expect(dictionaryPoolIsCallable((await mint("v.md")).snapshot)).toBe(true);
		const verbs = [token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }), token({ surface: "た", pos: "助動詞", detail1: "*" })];
		expect(dictionaryPoolIsCallable((await mint("n.md", "見た。見た。見た。", verbs)).snapshot)).toBe(false);
	});
});

describe("when the text on screen can be looked up", () => {
	function harness() {
		let active: ManualMorphVocabulary | null = null, nonce = 1;
		const host: RecomposeHost = { active: () => active, nonce: () => nonce++, paint: async () => undefined, copy: async () => undefined, collect: async () => ({ status: "created" }) };
		const session = new RecomposeSession(host);
		const pane = new RecomposePane(document.createElement("div"), session);
		return { session, pane, setActive: (owner: ManualMorphVocabulary | null) => { active = owner; } };
	}

	it("is not before a text exists, is once one was made from the active Vocabulary, and stops with the text's Vocabulary", async () => {
		const { session, pane, setActive } = harness();
		const first = await mint("a.md");
		setActive(first);
		expect(session.read().lookup).toBe(false);
		await pane.run("new");
		expect(session.read().lookup).toBe(true);
		await pane.run("more");
		expect(session.read().lookup).toBe(true);
		setActive(await mint("b.md"));
		expect(session.read().lookup).toBe(false);
		expect(session.read().changed).toBe(true);
		setActive(first);
		expect(session.read().lookup).toBe(true);
		setActive(null);
		expect(session.read().lookup).toBe(false);
	});

	it("is not while a step runs, and is again when it ends", async () => {
		const { session, pane, setActive } = harness();
		setActive(await mint("a.md"));
		await pane.run("new");
		const during: boolean[] = [];
		const running = pane.run("more");
		during.push(session.read().lookup);
		await running;
		expect(during).toEqual([false]);
		expect(session.read().lookup).toBe(true);
	});

	it("is not when the Vocabulary's pool cannot fill a template, however many words the text has", async () => {
		const { session, pane, setActive } = harness();
		const nouns = [token({ surface: "猫" }), token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }), token({ surface: "た", pos: "助動詞", detail1: "*" })];
		const owner = await mint("n.md", "猫が見た。猫が見た。", nouns);
		setActive(owner);
		await pane.run("new");
		const expected = dictionaryPoolIsCallable(owner.snapshot);
		expect(session.read().lookup).toBe(expected);
		const verbs = [token({ surface: "が", pos: "助詞", detail1: "格助詞" }), token({ surface: "見", pos: "動詞", detail1: "自立", conjugationType: "一段", conjugationForm: "連用形", baseForm: "見る" }), token({ surface: "た", pos: "助動詞", detail1: "*" })];
		const none = await mint("v2.md", "見た。見た。見た。", verbs);
		setActive(none);
		await pane.run("new");
		expect(dictionaryPoolIsCallable(none.snapshot)).toBe(false);
		expect(session.read().paragraphs).not.toBeNull();
		expect(session.read().lookup).toBe(false);
	});
});
