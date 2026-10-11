// @vitest-environment jsdom
import type { App } from "obsidian";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "./support/obsidianDom";

/*
 * FAKE-ALERT-VIEW1 independent review 1, P2: Obsidian 1.13.7's `Modal.open()`
 * runs `onOpen()` and then, with a physical keyboard, focuses the first
 * focusable control inside the modal. A dialog that focuses its affirmative
 * button only in `onOpen()` therefore opened with the negative one focused, so
 * Enter took the other branch. The ordinary stub and the web shim do not move
 * focus after `onOpen()`, which is why no earlier test saw it.
 *
 * This file's `Modal` behaves like that host: after `onOpen()` it focuses the
 * first focusable element in `modalEl`. A control Modal below shows the
 * emulation really overrides a focus made in `onOpen()`.
 */
// The same candidates Obsidian 1.13.7 tries, in document order (read from its bundled app.js).
const FOCUSABLE = ["a[href]", "button", "input", "select", "textarea", '[contenteditable]:not([contenteditable="false"])', "[tabindex]"]
	.map((selector) => `${selector}:not([disabled]):not([tabindex="-1"])`).join(",");
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	class HostModal extends actual.Modal {
		open(): void {
			super.open();
			for (const el of Array.from(this.modalEl.querySelectorAll<HTMLElement>(FOCUSABLE))) {
				if (!el.hidden && !el.closest("[hidden]")) { el.focus({ preventScroll: true }); break; }
			}
		}
	}
	return { ...actual, Modal: HostModal };
});

const { Modal } = await import("obsidian");
const { FakeAlertModal } = await import("../src/view/FakeAlertModal");
const { generateFakeAlert } = await import("../src/fakeAlert/fakeAlertCore");
const { ALERT_LEXICON, mintOwner, sahen } = await import("./fakeAlertCoreFixtures");

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => document.body.replaceChildren());

const APP = {} as App;

describe("FAKE-ALERT-VIEW1 focus after the host has opened the dialog (review 1, P2)", () => {
	it("is a host that moves focus to the first control after onOpen (control)", () => {
		class TwoButtons extends Modal {
			onOpen(): void {
				const first = this.contentEl.appendChild(document.createElement("button"));
				const last = this.contentEl.appendChild(document.createElement("button"));
				first.textContent = "First";
				last.textContent = "Last";
				last.focus();
			}
		}
		new TwoButtons(APP).open();
		expect(document.activeElement?.textContent).toBe("First");
	});

	it("leaves the affirmative button focused once open() returns, for every two-button set", async () => {
		// The reviewer's input (「猫を観察する。」, level 0, nonces 1, 2 and 11 at the time of review 1). Since VARIETY1 its
		// single sahen noun makes the sahen dialogs rare, so a Vocabulary with a full pool of sahen nouns covers every set.
		const reviewer = (await mintOwner(["猫を観察する。"], "uniform", ALERT_LEXICON)).owner;
		const sahenNouns = ["観察", "絶望", "信頼", "散歩", "記憶", "散策", "検討", "調査", "研究", "練習", "料理", "旅行", "運動", "勉強", "掃除", "洗濯", "説明", "計算", "記録", "報告"];
		const full = (await mintOwner([sahenNouns.map((surface) => `${surface}。`).join("") + "猫。犬。"], "uniform", [...ALERT_LEXICON, ...sahenNouns.map(sahen)])).owner;
		const sets = new Set<string>();
		for (const [owner, level] of [reviewer, full].flatMap((value) => [0, 50, 100].map((item) => [value, item] as const))) {
			for (let nonce = 1; nonce <= 40; nonce += 1) {
				const result = generateFakeAlert({ owner, level, nonce });
				if (!result.ok || result.alert.prompt.buttons.length < 2) continue;
				const modal = new FakeAlertModal(APP, result.alert, null, null);
				modal.open();
				const buttons = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".semantropy-fake-alert-buttons button"));
				expect(document.activeElement, `${level}/${nonce}`).toBe(buttons.at(-1));
				sets.add(result.alert.prompt.buttons.join());
				modal.close();
			}
		}
		expect([...sets].sort()).toEqual(["cancel,ok", "cancel,retry", "ignore,retry", "no,yes"]);
	});
});
