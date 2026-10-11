// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import type { App } from "obsidian";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/** Every request the View (or a test) makes of the core. The wrapper delegates, so every Alert is genuine. */
const requests = vi.hoisted(() => [] as { level: number; nonce: number; recent: readonly string[] | undefined; recentWords: readonly string[] | undefined }[]);
vi.mock("../src/fakeAlert/fakeAlertCore", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/fakeAlert/fakeAlertCore")>();
	return {
		...actual,
		generateFakeAlert: (input: Parameters<typeof actual.generateFakeAlert>[0]) => {
			requests.push({ level: input.level, nonce: input.nonce, recent: input.recent === undefined ? undefined : [...input.recent],
				recentWords: input.recentWords === undefined ? undefined : [...input.recentWords] });
			return actual.generateFakeAlert(input);
		},
	};
});
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { lexiconTokenizer, manualMorphHarness } from "./support/manualMorphHarness";
import { ALERT_LEXICON, NO_NOUN_TEXT, RICH_TEXT, richOwner } from "./fakeAlertCoreFixtures";
import { noun } from "./fakeProverbCoreFixtures";
import { generateFakeAlert, type FakeAlert } from "../src/fakeAlert/fakeAlertCore";
import { FAKE_ALERT_BUTTON_SETS, type FakeAlertButton } from "../src/fakeAlert/recipeData";
import { FAKE_ALERT_BRAND_ICON, FAKE_ALERT_BRAND_TEXT, FAKE_ALERT_KIND_ICONS, FakeAlertModal } from "../src/view/FakeAlertModal";
import type { SemantropyView } from "../src/view/SemantropyView";
import { TOOLBAR_CONTROLS } from "../src/view/SemantropyToolbar";
import { EN_MESSAGES, UI_CATALOGS } from "../src/i18n/catalog";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { localize } from "../src/i18n/messages";
import { assertBodySemantropy } from "../src/settings/bodySemantropy";

/*
 * FAKE-ALERT-VIEW1 (Docs/fake_alert_policy1.md §8, §9): the dialog that shows
 * a core-made Fake Alert, and its Toolbar entry in the View.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { document.body.replaceChildren(); setCurrentUiLanguage("en"); });

const APP = {} as App;

/** The first Alert over nonces 1, 2, … that `wanted` accepts. */
async function alertWhere(level: number, wanted: (alert: FakeAlert) => boolean): Promise<FakeAlert> {
	const owner = await richOwner();
	for (let nonce = 1; nonce < 2000; nonce += 1) {
		const result = generateFakeAlert({ owner, level, nonce });
		if (result.ok && wanted(result.alert)) return result.alert;
	}
	throw new Error("fixture: no such Alert");
}
const isDialog = (alert: FakeAlert) => alert.shape === "dialog" && alert.prompt.buttons.length === 2;
const isTerminal = (alert: FakeAlert) => alert.shape === "terminal";

function open(alert: FakeAlert, origin: HTMLElement | null = null) {
	const closed: number[] = [];
	const modal = new FakeAlertModal(APP, alert, () => closed.push(1), origin);
	modal.open();
	return { modal, closed };
}
const buttonsOf = (modal: FakeAlertModal) => Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".semantropy-fake-alert-buttons button"));
const linesOf = (modal: FakeAlertModal) => Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".semantropy-fake-alert-message p"), (p) => p.textContent);
const titleOf = (modal: FakeAlertModal) => modal.titleEl.querySelector(".semantropy-fake-alert-title")!.textContent;
/** The accessible name, read the way `aria-labelledby` composes it. */
const nameOf = (modal: FakeAlertModal) => modal.modalEl.getAttribute("aria-labelledby")!.split(" ")
	.map((id) => document.getElementById(id)!.textContent).join(" ");

describe("FAKE-ALERT-VIEW1 the dialog", () => {
	it("shows only an Alert the core made: a copy, a clone or a hand-made object is refused before anything opens", async () => {
		const alert = await alertWhere(50, isDialog);
		for (const forged of [{ ...alert }, structuredClone(alert), JSON.parse(JSON.stringify(alert)) as FakeAlert, null as unknown as FakeAlert]) {
			expect(() => new FakeAlertModal(APP, forged, null, null)).toThrow("only a generated Fake Alert");
		}
		expect(document.body.children).toHaveLength(0);
	});

	it("is an ordinary dialog named by Semantropy's brand and the kind, never an alertdialog or a live alert", async () => {
		const alert = await alertWhere(50, isDialog);
		const { modal } = open(alert);
		const root = modal.modalEl;
		expect([root.getAttribute("role"), root.getAttribute("aria-modal"), root.dataset.kind]).toEqual(["dialog", "true", alert.prompt.kind]);
		expect(document.querySelector('[role="alertdialog"], [role="alert"]')).toBeNull();
		expect(nameOf(modal)).toBe(`Semantropy Fake Alert ${UI_CATALOGS.en.fakeAlert.kinds[alert.prompt.kind]}`);
		// Owner decision: the visible mark is the tab's icon and the name "Semantropy", small at the left of the
		// button row, before the buttons. It is hidden from assistive technology, which reads the full name above.
		const brand = root.querySelector<HTMLElement>(".semantropy-fake-alert-footer > .semantropy-fake-alert-brand")!;
		expect(brand.nextElementSibling).toBe(root.querySelector(".semantropy-fake-alert-buttons"));
		expect([brand.getAttribute("aria-hidden"), brand.textContent, brand.querySelector("svg")!.getAttribute("class")])
			.toEqual(["true", FAKE_ALERT_BRAND_TEXT, `svg-icon lucide-${FAKE_ALERT_BRAND_ICON}`]);
		expect(FAKE_ALERT_BRAND_TEXT).toBe("Semantropy");
		expect(modal.titleEl.querySelector("svg")).toBeNull();
		expect(FAKE_ALERT_BRAND_ICON).toBe("brain-circuit");
		const icon = root.querySelector<HTMLElement>(".semantropy-fake-alert-icon")!;
		expect([icon.getAttribute("aria-hidden"), icon.querySelector("svg")!.getAttribute("class")])
			.toEqual(["true", `svg-icon lucide-${FAKE_ALERT_KIND_ICONS[alert.prompt.kind]}`]);
		const message = root.querySelector<HTMLElement>(".semantropy-fake-alert-message")!;
		expect([root.getAttribute("aria-describedby"), message.getAttribute("aria-live")]).toEqual([message.id, "polite"]);
	});

	it("shows the lines as plain text and the buttons in the set's order, the affirmative one last, focused and primary", async () => {
		const alert = await alertWhere(50, isDialog);
		const { modal } = open(alert);
		expect(linesOf(modal)).toEqual(alert.prompt.lines);
		for (const p of Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".semantropy-fake-alert-message p"))) {
			expect(Array.from(p.childNodes, (node) => node.nodeType)).toEqual([Node.TEXT_NODE]);
		}
		const buttons = buttonsOf(modal);
		expect(buttons.map((button) => button.textContent)).toEqual(alert.prompt.buttons.map((button) => UI_CATALOGS.en.fakeAlert.buttons[button]));
		expect(Object.values(FAKE_ALERT_BUTTON_SETS).some((set) => set.join() === alert.prompt.buttons.join())).toBe(true);
		expect(buttons.map((button) => [button.type, button.classList.contains("mod-cta")])).toEqual([["button", false], ["button", true]]);
		expect(document.activeElement).toBe(buttons.at(-1));
	});

	it("turns a Prompt's button into the page drawn for it, and that page's OK closes the dialog and returns focus", async () => {
		for (const index of [0, 1]) {
			const alert = await alertWhere(50, isDialog);
			const origin = document.body.appendChild(document.createElement("button"));
			const { modal, closed } = open(alert, origin);
			const pressed = alert.prompt.buttons[index] as FakeAlertButton;
			const outcome = alert.outcomes[pressed]!;
			buttonsOf(modal)[index]!.click();
			expect(closed).toEqual([]);
			expect(linesOf(modal)).toEqual(outcome.lines);
			expect([modal.modalEl.dataset.kind, titleOf(modal)]).toEqual([outcome.kind, UI_CATALOGS.en.fakeAlert.kinds[outcome.kind]]);
			expect(buttonsOf(modal).map((button) => button.textContent)).toEqual(["OK"]);
			expect(document.activeElement).toBe(buttonsOf(modal)[0]);
			buttonsOf(modal)[0]!.click();
			expect(closed).toEqual([1]);
			expect(modal.contentEl.childNodes).toHaveLength(0);
			expect(document.activeElement).toBe(origin);
		}
	});

	it("reports each page as it is shown: the Prompt on open, the Outcome a button leads to, nothing on close (VARIETY1)", async () => {
		const alert = await alertWhere(50, isDialog);
		const reported: unknown[] = [];
		const modal = new FakeAlertModal(APP, alert, null, null, (item) => reported.push(item));
		modal.open();
		expect(reported).toEqual([alert.prompt]);
		buttonsOf(modal)[1]!.click();
		expect(reported).toEqual([alert.prompt, alert.outcomes[alert.prompt.buttons[1]!]]);
		modal.close();
		expect(reported).toHaveLength(2);
	});

	it("closes on an Outcome's OK even when the Prompt itself had an OK button", async () => {
		const alert = await alertWhere(50, (value) => value.shape === "dialog" && value.prompt.buttons.join() === "cancel,ok");
		const { modal, closed } = open(alert);
		buttonsOf(modal)[1]!.click();
		expect(linesOf(modal)).toEqual(alert.outcomes.ok!.lines);
		buttonsOf(modal)[0]!.click();
		expect(closed).toEqual([1]);
	});

	it("closes a Prompt at once on Close or Escape without showing an Outcome", async () => {
		// An Outcome whose text differs from the Prompt's, so its appearance can be told apart.
		const alert = await alertWhere(50, (value) => isDialog(value) &&
			Object.values(value.outcomes).every((outcome) => outcome.lines.join() !== value.prompt.lines.join()));
		const { modal, closed } = open(alert);
		const observer = new MutationObserver(() => undefined);
		observer.observe(modal.modalEl, { childList: true, subtree: true, characterData: true });
		modal.close();
		// Review 1, P3: the observer's callback runs only after this test has moved on, so read
		// every node added while closing synchronously — even one shown and removed at once.
		const added = observer.takeRecords().flatMap((record) => Array.from(record.addedNodes, (node) => node.textContent ?? ""));
		observer.disconnect();
		expect(closed).toEqual([1]);
		for (const outcome of Object.values(alert.outcomes)) {
			for (const line of outcome.lines) expect(added.some((text) => text.includes(line)), line).toBe(false);
		}
		// A second close is harmless and does not report twice.
		modal.close();
		expect(closed).toEqual([1]);
		// Obsidian's Modal, and the stub that follows it since DEFINE-DIALOG-FIX1, runs onClose() once for the two
		// close() calls above. A host that reported the close again must not make the dialog report it twice either.
		modal.onClose();
		expect(closed).toEqual([1]);
	});

	it("closes a one-shot Alert on its OK", async () => {
		const alert = await alertWhere(100, isTerminal);
		expect(alert.outcomes).toEqual({});
		const { modal, closed } = open(alert);
		expect(buttonsOf(modal).map((button) => button.textContent)).toEqual(["OK"]);
		expect(linesOf(modal)).toEqual(alert.prompt.lines);
		buttonsOf(modal)[0]!.click();
		expect(closed).toEqual([1]);
	});

	it("re-words the title, the brand and the buttons in the interface language, and never the generated lines", async () => {
		const alert = await alertWhere(50, isDialog);
		const { modal } = open(alert);
		const lines = linesOf(modal);
		const before = buttonsOf(modal);
		setCurrentUiLanguage("ja");
		modal.relabel();
		const ja = UI_CATALOGS.ja.fakeAlert;
		expect(nameOf(modal)).toBe(`${ja.brand} ${ja.kinds[alert.prompt.kind]}`);
		expect(buttonsOf(modal).map((button) => button.textContent)).toEqual(alert.prompt.buttons.map((button) => ja.buttons[button]));
		expect(buttonsOf(modal)).toEqual(before);
		expect(linesOf(modal)).toEqual(lines);
	});

	it("builds its DOM from text nodes only: no HTML parser, no Markdown renderer and no Copy or Collect", async () => {
		// The code without its comments, which explain why there is no alertdialog.
		const code = (await readFile("src/view/FakeAlertModal.ts", "utf8")).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
		expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|MarkdownRenderer|DOMParser|createContextualFragment|Notice|alertdialog|"alert"|[Cc]ollect|[Cc]lipboard/u);
		// Policy §9: no Notice and no error wording. It reads only the kind titles, the buttons and the brand.
		expect([...code.matchAll(/^import .* from "([^"]+)";$/gmu)].map((match) => match[1])).toEqual(["obsidian", "../fakeAlert/fakeAlertCore", "../fakeAlert/recipeData", "../i18n/catalog"]);
		expect(code).not.toMatch(/noVocabulary|insufficient|failed|MESSAGE|localize/u);
		expect([...code.matchAll(/text\.(\w+)/gu)].map((match) => match[1]).sort()).toEqual(["brand", "buttons", "kinds"]);
	});
});

const fakeAlertModal = (view: SemantropyView) => Reflect.get(view, "fakeAlertModal") as FakeAlertModal | null;
const shownAlert = (modal: FakeAlertModal) => Reflect.get(modal, "alert") as FakeAlert;

/** A View with the Target `猫は犬。` open (its Current Note Vocabulary is active), or, with `target: false`, none. */
/** Forty more nouns, so a run of Alerts shows more distinct words than the View keeps. */
const MANY_NOUNS = "山 川 海 空 森 林 花 草 木 石 岩 砂 雪 雨 風 雲 星 月 火 水 土 金 銀 鉄 紙 布 針 箱 鍵 扉 壁 床 庭 道 橋 駅 港 塔 城 村".split(" ");
const MANY_TEXT = MANY_NOUNS.map((surface) => `${surface}。`).join("");

async function harness(level = 0, target = true) {
	const h = manualMorphHarness(lexiconTokenizer([...ALERT_LEXICON, ...MANY_NOUNS.map(noun)]));
	const notices: string[] = [];
	h.host.showNotice = (message) => { notices.push(message); };
	h.state.level = assertBodySemantropy(level);
	if (target) await h.open("猫は犬。\n");
	else await h.view.onOpen();
	return { ...h, notices };
}

describe("FAKE-ALERT-VIEW1 the Toolbar entry", () => {
	it("sits in Phrase generation with the message-square-warning icon and the owner's names", async () => {
		expect(TOOLBAR_CONTROLS.fakeAlert).toMatchObject({ icon: "message-square-warning", name: "Fake alert" });
		expect(UI_CATALOGS.ja.toolbar.controls.fakeAlert.name).toBe("不条理警告");
		const h = await harness();
		const entry = h.peek.contentEl.querySelector<HTMLButtonElement>(".semantropy-fake-alert-open")!;
		expect(entry.getAttribute("aria-label")).toBe("Fake alert");
		expect(entry.querySelector(".semantropy-icon svg")!.getAttribute("class")).toBe("svg-icon lucide-message-square-warning");
		expect(entry.closest(".semantropy-toolbar-group")!.querySelector(".semantropy-collision-open")).not.toBeNull();
	});

	it("opens one Fake Alert from the active Vocabulary at the Text Semantropy level, all its pages drawn before it opens", async () => {
		const h = await harness(0);
		expect(await h.apply([RICH_TEXT])).toBe("applied");
		h.peek.contentEl.querySelector<HTMLButtonElement>(".semantropy-fake-alert-open")!.click();
		const modal = fakeAlertModal(h.view)!;
		expect(modal).toBeTruthy();
		const alert = shownAlert(modal);
		expect([alert.level, alert.shape]).toEqual([0, "dialog"]);
		expect(Object.keys(alert.outcomes).sort()).toEqual([...alert.prompt.buttons].sort());
		expect(alert.provenance.sources.map((source) => source.path)).toEqual(["source0.md"]);
		expect(h.notices).toEqual([]);
		// At most one: a second request while it is open does nothing.
		h.view.openFakeAlert();
		expect(fakeAlertModal(h.view)).toBe(modal);
		expect(document.querySelectorAll(".semantropy-fake-alert")).toHaveLength(1);
		modal.close();
		expect(fakeAlertModal(h.view)).toBeNull();

		h.state.level = assertBodySemantropy(100);
		h.view.openFakeAlert();
		expect(shownAlert(fakeAlertModal(h.view)!).level).toBe(100);
	});

	it("passes the recent openings so the next draw can avoid them, keeping at most eight, with a fresh nonce each time", async () => {
		const h = await harness(100);
		await h.apply([RICH_TEXT]);
		requests.length = 0;
		const opened: string[] = [];
		for (let index = 0; index < 12; index += 1) {
			h.view.openFakeAlert();
			const modal = fakeAlertModal(h.view)!;
			expect(requests.at(-1)).toMatchObject({ level: 100, recent: opened.slice(-8) });
			opened.push(shownAlert(modal).prompt.recipeId);
			modal.close();
		}
		expect(requests).toHaveLength(12);
		const nonces = requests.map((request) => request.nonce);
		expect(nonces.every((nonce) => Number.isInteger(nonce) && nonce >= 0 && nonce <= 0xffffffff)).toBe(true);
		expect(new Set(nonces).size).toBeGreaterThan(1);
		expect(Reflect.get(h.view, "fakeAlertRecent")).toEqual(opened.slice(-8));
		await h.view.onClose();
		expect(Reflect.get(h.view, "fakeAlertRecent")).toEqual([]);
	});

	it("passes the words of the pages actually shown, newest last and at most 24, so the next draw makes them rarer (VARIETY1)", async () => {
		const h = await harness(100);
		await h.apply([RICH_TEXT + MANY_TEXT]);
		requests.length = 0;
		// What the View should hold: each shown page's words move to the newest end.
		let expected: string[] = [];
		const remember = (item: { words: readonly { surface: string }[] }) => {
			const shown = new Set(item.words.map((word) => word.surface));
			expected = [...expected.filter((word) => !shown.has(word)), ...shown].slice(-24);
		};
		for (let index = 0; index < 30; index += 1) {
			h.view.openFakeAlert();
			expect(requests.at(-1)!.recentWords).toEqual(expected);
			const modal = fakeAlertModal(h.view)!;
			const alert = shownAlert(modal);
			remember(alert.prompt);
			// Every other Alert is answered: only the page that button leads to is counted, never the others.
			if (index % 2 === 1 && alert.shape === "dialog") {
				buttonsOf(modal)[0]!.click();
				remember(alert.outcomes[alert.prompt.buttons[0]!]!);
			}
			modal.close();
		}
		expect(Reflect.get(h.view, "fakeAlertRecentWords")).toEqual(expected);
		// More distinct words were shown than the View keeps, so the limit was reached and held.
		expect(expected).toHaveLength(24);
		await h.view.onClose();
		expect(Reflect.get(h.view, "fakeAlertRecentWords")).toEqual([]);
	});

	it("shows a Notice, never a Fake Alert, when there is no usable Vocabulary or no noun in it", async () => {
		const none = await harness(0, false);
		none.view.openFakeAlert();
		expect(fakeAlertModal(none.view)).toBeNull();
		expect(none.notices).toEqual([EN_MESSAGES.fakeAlert.noVocabulary]);

		// A Vocabulary whose Source changed after Apply is not used (the same freshness rule as Collision).
		const stale = await harness();
		expect(await stale.apply([RICH_TEXT])).toBe("applied");
		stale.view.notifyVocabularySourceEvent("source0.md");
		stale.view.openFakeAlert();
		expect(fakeAlertModal(stale.view)).toBeNull();
		expect(stale.notices).toEqual([EN_MESSAGES.fakeAlert.noVocabulary]);

		const empty = await harness();
		expect(await empty.apply([NO_NOUN_TEXT])).toBe("applied");
		empty.view.openFakeAlert();
		expect(fakeAlertModal(empty.view)).toBeNull();
		expect(empty.notices).toEqual([EN_MESSAGES.fakeAlert.insufficient]);
		expect(document.querySelector(".semantropy-fake-alert")).toBeNull();

		setCurrentUiLanguage("ja");
		expect(localize(EN_MESSAGES.fakeAlert.noVocabulary)).toBe(UI_CATALOGS.ja.fakeAlert.noVocabulary);
		expect(localize(EN_MESSAGES.fakeAlert.insufficient)).toBe(UI_CATALOGS.ja.fakeAlert.insufficient);
	});

	it("leaves an open Fake Alert as it is when a Source changes: the fiction is finished", async () => {
		const h = await harness(50);
		await h.apply([RICH_TEXT]);
		h.view.openFakeAlert();
		const modal = fakeAlertModal(h.view)!;
		const before = modal.modalEl.cloneNode(true) as HTMLElement;
		h.view.notifyVocabularySourceEvent("source0.md");
		h.view.notifyVocabularySourceEvent("target.md");
		expect(fakeAlertModal(h.view)).toBe(modal);
		expect(modal.modalEl.isEqualNode(before)).toBe(true);
		expect(h.notices).toEqual([]);
	});

	it("closes with the View and with a plugin disable, and re-words with a language change", async () => {
		const h = await harness();
		await h.apply([RICH_TEXT]);
		h.view.openFakeAlert();
		const modal = fakeAlertModal(h.view)!;
		setCurrentUiLanguage("ja");
		h.view.languageChanged();
		expect(nameOf(modal)).toContain(UI_CATALOGS.ja.fakeAlert.brand);
		setCurrentUiLanguage("en");
		await h.view.onClose();
		expect([fakeAlertModal(h.view), document.querySelector(".semantropy-fake-alert")]).toEqual([null, null]);

		const other = await harness();
		await other.apply([RICH_TEXT]);
		other.view.openFakeAlert();
		other.view.disableAutomatic();
		expect([fakeAlertModal(other.view), document.querySelector(".semantropy-fake-alert")]).toEqual([null, null]);
	});
});
