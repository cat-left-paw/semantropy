// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { App, Plugin } from "obsidian";
import type { CollectionEntryState, CollectionStorage, CreateCollectionResult, ProcessCollectionResult } from "../src/collect/CollectionStorage";
import { COLLECTION_DOCUMENT_VERSION, appendCollectionEntry } from "../src/collect/collectionDocument";
import { escapeFragmentMarkdown } from "../src/collect/escapeFragmentMarkdown";
import { localCollectionDate } from "../src/collect/localCollectionDate";
import { serializeFragmentEntryV3 } from "../src/collect/v3/serializeFragmentV3";
import { attributionMarkdown, collectAttributionSnapshot, COLLECT_ATTRIBUTION_LINE_KEYS } from "../src/collect/v4/collectAttribution";
import { MarkdownFragmentRepositoryV4 } from "../src/collect/v4/FragmentRepositoryV4";
import { buildCollectedFragmentV4 } from "../src/collect/v4/CollectedFragmentV4";
import { serializeFragmentEntryV4 } from "../src/collect/v4/serializeFragmentV4";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { UI_CATALOGS } from "../src/i18n/catalog";
import {
	COLLECT_ATTRIBUTION_KEYS, DEFAULT_COLLECT_ATTRIBUTION, parseAutomaticPosSettings, parseCollectAttribution,
	serializeAutomaticPosSettings, validateAutomaticPosSettingsPatch, validateCollectAttribution,
} from "../src/settings/automaticPosSettings";
import { AutomaticPosSettingsStore } from "../src/settings/AutomaticPosSettingsStore";
import { SemantropySettingTab } from "../src/view/SemantropySettingTab";
import { COLLECT_FIXTURE_CREATED, COLLECT_FIXTURE_FINGERPRINT, COLLECT_FIXTURE_HASH, collectPath, collectVocabulary } from "./collectFixtures";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { fragmentV3 } from "./collectV3Fixtures";
import { FIXTURE_BATCH_ID, FIXTURE_CANONICAL, FIXTURE_ROW_ID, fragmentV4, identityV4, inputsV4 } from "./collectV4Fixtures";

let restoreDom: () => void;
beforeAll(() => { restoreDom = installObsidianDomHelpers(); });
afterAll(() => restoreDom());

const LF = String.fromCharCode(10);
const pinned = JSON.parse(readFileSync("tests/fixtures/regression/collectV2.json", "utf8")) as { collection: string };
const kept = { bodySemantropy: 40, dictionarySemantropy: 75, collectionPath: "Kept.md", uiLanguage: "en" as const, showRibbonIcon: false };
const allOn = collectAttributionSnapshot({ feature: true, target: true, vocabulary: true, semantropy: true,
	date: true, uiLanguage: "ja", localDate: localCollectionDate(COLLECT_FIXTURE_CREATED) });

function memory(initial: string | null = null) {
	let contents = initial;
	const storage = {
		inspect: vi.fn(() => Promise.resolve<CollectionEntryState>({ status: contents === null ? "missing" : "markdown" })),
		create: vi.fn((_path: string, text: string) => { contents = text; return Promise.resolve<CreateCollectionResult>({ status: "created" }); }),
		process: vi.fn((_path: string, transform: (contents: string) => string) => { contents = transform(contents ?? ""); return Promise.resolve<ProcessCollectionResult>({ status: "processed" }); }),
	} satisfies CollectionStorage;
	return { storage, read: () => contents };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((settle) => { resolve = settle; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function listItem(body: string, lines: readonly string[] = []): string {
	const [first = "", ...rest] = body.split(LF);
	const item = [first ? `- ${first}` : "-", ...rest.map((line) => (line ? `  ${line}` : ""))].join(LF) + LF;
	return lines.length === 0 ? item : `${item}${LF}${lines.map((line, index) => `  ${line}${index < lines.length - 1 ? "  " : ""}`).join(LF)}${LF}`;
}
function featureName(type: string, language: "en" | "ja"): string {
	const labels = UI_CATALOGS[language].attribution;
	if (type === "body") return labels.body;
	if (type === "fake-dictionary") return labels.dictionary;
	if (type === "collision") return labels.collision;
	return labels.fakeProverb;
}

it("keeps COLLECT-COMMENT1 bytes when every attribution item is off", () => {
	expect(COLLECTION_DOCUMENT_VERSION).toBe(1);
	expect([...COLLECT_ATTRIBUTION_LINE_KEYS]).toEqual([...COLLECT_ATTRIBUTION_KEYS]);
	for (const input of inputsV4()) {
		const fragment = fragmentV4(input);
		const bare = serializeFragmentEntryV4(fragment);
		expect(serializeFragmentEntryV4(fragment, collectAttributionSnapshot()), input.type).toBe(bare);
		if (input.type === "collision" || input.type === "fake-proverb") {
			expect(serializeFragmentEntryV4(fragment, collectAttributionSnapshot({ target: true, semantropy: true }))).toBe(bare);
		}
	}
});

it("writes only the items that exist for each of the four types", () => {
	for (const input of inputsV4()) {
		const fragment = fragmentV4(input);
		const labels = UI_CATALOGS.ja.attribution;
		const target = input.type === "body" || input.type === "fake-dictionary" ? input.target.path : null;
		const semantropy = input.type === "body" ? input.bodySemantropy : input.type === "fake-dictionary" ? input.dictionarySemantropy : null;
		const lines = [
			`${labels.feature}: ${featureName(input.type, "ja")}`,
			...(target === null ? [] : [`${labels.target}: ${escapeFragmentMarkdown(target)}`]),
			`${labels.vocabulary}: ${escapeFragmentMarkdown(input.vocabulary.sources[0]!.path)}`,
			...input.vocabulary.sources.slice(1).map((source) => escapeFragmentMarkdown(source.path)),
			...(semantropy === null ? [] : [`${labels.semantropy}: ${String(semantropy)}`]),
			`${labels.date}: ${escapeFragmentMarkdown(localCollectionDate(fragment.metadata.created))}`,
		];
		const body = input.type === "fake-proverb" ? FIXTURE_CANONICAL : escapeFragmentMarkdown(input.text);
		const entry = serializeFragmentEntryV4(fragment, allOn);
		expect(entry, input.type).toBe(listItem(body, lines));
		expect(entry, input.type).not.toContain("<!--");
		expect(entry, input.type).not.toContain("metadataVersion");
		expect(entry, input.type).not.toContain(COLLECT_FIXTURE_HASH);
		expect(entry, input.type).not.toContain("vocabulary-fingerprint");
		expect(entry, input.type).not.toContain(FIXTURE_BATCH_ID);
		expect(entry, input.type).not.toContain(FIXTURE_ROW_ID);
		expect(fragment.metadata.created).toBe(COLLECT_FIXTURE_CREATED);
		expect(entry).toMatch(/ {2}\n {2}(?:対象ノート|語彙|Semantropy|日付):/u);
	}
	const english = serializeFragmentEntryV4(fragmentV4(inputsV4()[0]), collectAttributionSnapshot({ feature: true, uiLanguage: "en" }));
	expect(english).toContain("Generation feature: Reshuffle text");
	expect(english).not.toContain("本文シャッフル");
	expect(english).not.toContain("対象ノート:");
	const proverb = serializeFragmentEntryV4(fragmentV4(), allOn);
	const quoteAt = proverb.indexOf(`${LF}  > `);
	const attributionAt = proverb.indexOf(`${LF}${LF}  生成機能:`);
	expect(quoteAt).toBeGreaterThan(0);
	expect(attributionAt).toBeGreaterThan(quoteAt);
	expect(proverb.slice(quoteAt, attributionAt)).not.toContain("生成機能");
	expect(proverb.split(LF).filter((line) => line.startsWith("  生成") || line.startsWith("  語彙") || line.startsWith("  日付"))
		.every((line) => !line.startsWith("  >"))).toBe(true);
});

it("uses the user's local calendar day rather than the UTC clock time", () => {
	const before = process.env.TZ;
	try {
		process.env.TZ = "America/Los_Angeles";
		const input = inputsV4()[0]!;
		const created = "2026-09-27T00:30:00.000Z";
		const fragment = buildCollectedFragmentV4(input, { ...identityV4, created });
		const localDate = localCollectionDate(created);
		expect(localDate).toBe("2026-09-26");
		const entry = serializeFragmentEntryV4(fragment, collectAttributionSnapshot({ date: true, uiLanguage: "en", localDate }));
		expect(entry).toContain("  Date: 2026\\-09\\-26");
		expect(entry).not.toContain("00\\:30");
		expect(() => serializeFragmentEntryV4(fragment, collectAttributionSnapshot({ date: true, uiLanguage: "en" })))
			.toThrow("invalid-attribution-date");
	} finally {
		if (before === undefined) delete process.env.TZ;
		else process.env.TZ = before;
	}
});

it("escapes a hostile path and leaves the fake-proverb quote closed", () => {
	const hostile = "notes/a-->b\n> quote [[link]](http:x) <!--secret--> <b>.md";
	const input = inputsV4().find((item) => item.type === "fake-proverb")!;
	const fragment = fragmentV4({ ...input, vocabulary: collectVocabulary([hostile]) });
	const entry = serializeFragmentEntryV4(fragment, collectAttributionSnapshot({ vocabulary: true, uiLanguage: "ja" }));
	const escaped = escapeFragmentMarkdown(hostile).split(LF);
	expect(entry).toContain(`  語彙: ${escaped[0]}`);
	expect(entry).toContain(`    ${escaped[1]}`);
	expect(entry).not.toContain("<!--");
	expect(entry).not.toContain("a-->b");
	expect(entry).not.toContain("<b>");
	expect(entry).not.toContain("[[link]]");
	expect(entry).not.toContain(COLLECT_FIXTURE_FINGERPRINT);
	expect(entry).not.toContain("offered-to");
	expect(entry).not.toContain("SOURCE-BODY");
	const quote = entry.indexOf(`${LF}  > `);
	const pathLine = entry.indexOf(`${LF}  語彙:`);
	expect(pathLine).toBeGreaterThan(quote);
	expect(entry.slice(quote, pathLine)).not.toMatch(/\n {2}語彙/u);
	expect(collectPath(hostile).path).toBe(hostile);
});

it("preserves existing bytes and refuses a Source with no storage call", async () => {
	const unknown = `<!-- kept-tool: {"leave":true} -->${LF}- hand written <!-- semantropy: {"metadataVersion":99} -->`;
	const before = appendCollectionEntry(`${pinned.collection}${LF}${unknown}`, serializeFragmentEntryV3(fragmentV3()));
	const file = memory(before);
	const fragment = fragmentV4(inputsV4()[0]);
	const snapshot = collectAttributionSnapshot({ feature: true, uiLanguage: "ja" });
	expect(await new MarkdownFragmentRepositoryV4(file.storage, () => "collection.md", () => snapshot).append(fragment)).toEqual({ status: "appended" });
	const after = file.read()!;
	expect(Buffer.from(after).subarray(0, Buffer.byteLength(before))).toEqual(Buffer.from(before));
	expect(after.endsWith(serializeFragmentEntryV4(fragment, snapshot))).toBe(true);
	expect(after).toContain("<!-- semantropy:");
	for (const input of inputsV4()) {
		const paths = [...("target" in input ? [input.target.path] : []), ...input.vocabulary.sources.map((source) => source.path)];
		for (const path of paths) {
			const blocked = memory("unchanged");
			expect(await new MarkdownFragmentRepositoryV4(blocked.storage, () => path, () => allOn).append(fragmentV4(input))).toEqual({ status: "conflict", reason: "source-note" });
			expect(blocked.storage.inspect).not.toHaveBeenCalled();
			expect(blocked.storage.create).not.toHaveBeenCalled();
			expect(blocked.storage.process).not.toHaveBeenCalled();
			expect(blocked.read()).toBe("unchanged");
		}
	}
});

it("freezes the queued entry when the language and settings change while the write waits", async () => {
	const gate = deferred<CollectionEntryState>();
	let contents: string | null = null;
	let reads = 0;
	let snapshot = collectAttributionSnapshot({ feature: true, vocabulary: true, uiLanguage: "ja" });
	const storage = {
		inspect: vi.fn(() => gate.promise),
		create: vi.fn((_path: string, text: string) => { contents = text; return Promise.resolve<CreateCollectionResult>({ status: "created" }); }),
		process: vi.fn(() => Promise.resolve<ProcessCollectionResult>({ status: "processed" })),
	} satisfies CollectionStorage;
	const fragment = fragmentV4(inputsV4()[0]);
	const pending = new MarkdownFragmentRepositoryV4(storage, () => "collection.md", () => { reads += 1; return snapshot; }).append(fragment);
	try {
		await flush();
		expect(reads).toBe(1);
		snapshot = collectAttributionSnapshot({ uiLanguage: "en" });
		setCurrentUiLanguage("en");
		gate.resolve({ status: "missing" });
		expect(await pending).toEqual({ status: "created" });
		expect(reads).toBe(1);
		expect(contents).toContain("生成機能: 本文シャッフル");
		expect(contents).toContain("語彙:");
		expect(contents).not.toContain("Reshuffle text");
		expect(contents).not.toContain("changed-while-waiting.md");
		expect(contents).not.toContain("current-open-note.md");
		expect(storage.process).not.toHaveBeenCalled();
	} finally {
		setCurrentUiLanguage("en");
	}
});

it("reads schema 1–6 as all off and repairs only the bad schema 7 item", () => {
	for (const schemaVersion of [1, 2, 3, 4, 5, 6]) {
		const parsed = parseAutomaticPosSettings({
			schemaVersion, ...kept, collectAttribution: { feature: true, target: true, vocabulary: true, semantropy: true, date: true, secret: "SOURCE-BODY" },
		});
		expect(parsed.collectAttribution, `schema ${schemaVersion}`).toEqual(DEFAULT_COLLECT_ATTRIBUTION);
		expect(parsed.showRibbonIcon).toBe(schemaVersion === 6 ? false : true);
		expect(parsed.bodySemantropy).toBe(40);
		expect(parsed.collectionPath).toBe(schemaVersion === 1 ? "Semantropy Fragments.md" : "Kept.md");
		expect(JSON.stringify(parsed)).not.toContain("SOURCE-BODY");
	}
	const mixed = parseAutomaticPosSettings({
		schemaVersion: 7, ...kept, collectAttribution: { feature: "yes", target: true, vocabulary: false, semantropy: 1, date: true, nonce: 9 },
	});
	expect(mixed.collectAttribution).toEqual({ feature: false, target: true, vocabulary: false, semantropy: false, date: true });
	expect(mixed.bodySemantropy).toBe(40);
	expect(mixed.showRibbonIcon).toBe(false);
	expect(mixed.uiLanguage).toBe("en");
	expect(Object.keys(serializeAutomaticPosSettings(mixed).collectAttribution)).toEqual([...COLLECT_ATTRIBUTION_KEYS]);
	expect(JSON.stringify(serializeAutomaticPosSettings(mixed))).not.toContain("nonce");
	const getter = vi.fn(() => true);
	const raw = Object.defineProperty({ schemaVersion: 7, ...kept, collectAttribution: { ...DEFAULT_COLLECT_ATTRIBUTION } }, "collectAttribution", {
		get: getter, enumerable: true,
	});
	expect(parseAutomaticPosSettings(raw).collectAttribution).toEqual(DEFAULT_COLLECT_ATTRIBUTION);
	expect(getter).not.toHaveBeenCalled();
	expect(parseCollectAttribution(6, { feature: true })).toEqual(DEFAULT_COLLECT_ATTRIBUTION);
	expect(validateCollectAttribution({ feature: true })).toBeNull();
	expect(validateCollectAttribution({ ...DEFAULT_COLLECT_ATTRIBUTION, secret: false })).toBeNull();
	expect(validateAutomaticPosSettingsPatch({ collectAttribution: { feature: true } })).toBeNull();
	expect(validateAutomaticPosSettingsPatch({ collectAttribution: { ...DEFAULT_COLLECT_ATTRIBUTION, feature: true } })).toEqual({
		collectAttribution: { ...DEFAULT_COLLECT_ATTRIBUTION, feature: true },
	});
	expect(attributionMarkdown(fragmentV4().metadata, collectAttributionSnapshot())).toEqual([]);
});

it("applies one attribution item at a time and restores the toggle when the save fails", async () => {
	const gate = deferred<void>();
	const saved: unknown[] = [];
	const store = new AutomaticPosSettingsStore({
		load: async () => ({ schemaVersion: 7, ...kept, collectAttribution: DEFAULT_COLLECT_ATTRIBUTION }),
		save: async (data) => { saved.push(data); if (saved.length === 1) await gate.promise; },
	});
	await store.load();
	const feature = store.setCollectAttribution("feature", true);
	const date = store.setCollectAttribution("date", true);
	await flush();
	expect(saved).toHaveLength(1);
	gate.resolve();
	expect(await Promise.all([feature, date])).toEqual([true, true]);
	expect(store.getCollectAttribution()).toEqual({ ...DEFAULT_COLLECT_ATTRIBUTION, feature: true, date: true });

	let fail = true;
	let disk: unknown = serializeAutomaticPosSettings(store.getSettings());
	const failing = new AutomaticPosSettingsStore({
		load: async () => disk,
		save: async (data) => { if (fail) throw new Error("disk full"); disk = data; },
	});
	await failing.load();
	const tab = new SemantropySettingTab({ vault: {} } as unknown as App, {} as Plugin, {
		getCollectionPath: () => failing.getCollectionPath(), setCollectionPath: async () => true,
		getUiLanguage: () => failing.getUiLanguage(), setUiLanguage: async () => true,
		getShowRibbonIcon: () => failing.getShowRibbonIcon(), setShowRibbonIcon: async () => true,
		getCollectAttribution: () => failing.getCollectAttribution(),
		setCollectAttribution: (key, value) => failing.setCollectAttribution(key, value),
	});
	setCurrentUiLanguage("ja");
	tab.show();
	try {
		const rows = Array.from(tab.containerEl.querySelectorAll(".semantropy-attribution-setting"));
		expect(tab.containerEl.querySelector(".semantropy-attribution-group .setting-group-heading")?.textContent).toBe("収集ノートに生成由来を記録");
		expect(rows.map((row) => row.querySelector(".setting-item-name")?.textContent)).toEqual([
			"生成の種類を記録", "対象ノートを記録", "語彙ノートを記録", "生成時のSemantropy値を記録", "収集した日付を記録",
		]);
		const featureSwitch = rows[0]?.querySelector("[role=switch]") as HTMLElement | null;
		expect(featureSwitch?.getAttribute("aria-checked")).toBe("true");
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		featureSwitch?.click();
		await failing.whenSettled();
		expect(failing.getCollectAttribution().feature).toBe(true);
		expect(featureSwitch?.getAttribute("aria-checked")).toBe("true");
		const statuses = tab.containerEl.querySelectorAll(".semantropy-attribution-status");
		expect(statuses[0]?.textContent).toBe("この収集の由来の設定を保存できませんでした。以前の設定のままです。");
		expect(failing.getCollectAttribution().date).toBe(true);
		expect(error.mock.calls.flat().join(" ")).not.toContain("disk full");
		error.mockRestore();

		fail = false;
		document.body.append(tab.containerEl);
		featureSwitch?.focus();
		tab.containerEl.scrollTop = 48;
		setCurrentUiLanguage("en");
		tab.relabel();
		expect(document.activeElement).toBe(featureSwitch);
		expect(tab.containerEl.scrollTop).toBe(48);
		expect(featureSwitch?.isConnected).toBe(true);
		expect(featureSwitch?.getAttribute("aria-checked")).toBe("true");
		expect(tab.containerEl.querySelector(".semantropy-attribution-group .setting-group-heading")?.textContent).toBe("Record generation details in Collection");
		expect(rows[0]?.querySelector(".setting-item-name")?.textContent).toBe("Record generation type");
		expect(rows[0]?.querySelector(".setting-item-description")?.textContent).toContain("Collision");
		expect(rows[4]?.querySelector(".setting-item-name")?.textContent).toBe("Record collection date");
	} finally {
		tab.hide();
		tab.containerEl.remove();
		setCurrentUiLanguage("en");
	}
});

it("does not put an old pending save result on a reopened settings row", async () => {
	const pendingSave = deferred<boolean>();
	const tab = new SemantropySettingTab({ vault: {} } as unknown as App, {} as Plugin, {
		getCollectionPath: () => "Collection.md", setCollectionPath: async () => true,
		getUiLanguage: () => "ja", setUiLanguage: async () => true,
		getShowRibbonIcon: () => true, setShowRibbonIcon: async () => true,
		getCollectAttribution: () => DEFAULT_COLLECT_ATTRIBUTION,
		setCollectAttribution: () => pendingSave.promise,
	});
	setCurrentUiLanguage("ja");
	try {
		tab.show();
		const oldSave = tab.changeCollectAttribution("feature", true);
		tab.hide();
		tab.show();
		const current = tab.containerEl.querySelector(".semantropy-attribution-status");
		expect(current?.textContent).toBe("");
		pendingSave.resolve(false);
		expect(await oldSave).toBe(false);
		expect(current?.textContent).toBe("");
	} finally {
		tab.hide();
		setCurrentUiLanguage("en");
	}
});
