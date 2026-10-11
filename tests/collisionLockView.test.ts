// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "../src/collision/collisionCore";
import type { CollisionSession } from "../src/view/CollisionSession";
import type { CollisionModal } from "../src/view/CollisionModal";
import type { SemantropyView } from "../src/view/SemantropyView";
import type { CooperativeScheduler } from "../src/render/cooperativeScheduler";
import { setCurrentUiLanguage } from "../src/i18n/language";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { manualMorphHarness, lexiconTokenizer } from "./support/manualMorphHarness";
import { token } from "./collisionBatchFixtures";

/*
 * COLLISION-LOCK1, the dialog. A word of a row that can be locked is a button inside the row's text; clicking it (or
 * Enter / Space on it) locks or releases it without rebuilding anything, so the focus stays; the row's Regenerate then
 * keeps the locked words. What Copy and Collect receive is the text, locked or not.
 */

let restore: () => void;
const views: SemantropyView[] = [];
beforeAll(() => { restore = installObsidianDomHelpers(); });
beforeEach(() => {
	let entropy = 0;
	vi.spyOn(document.defaultView!.crypto, "getRandomValues").mockImplementation(array => {
		if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(++entropy);
		return array;
	});
});
afterAll(() => restore());
afterEach(async () => {
	for (const view of views.splice(0)) await view.onClose();
	setCurrentUiLanguage("en");
	vi.restoreAllMocks(); document.body.replaceChildren();
});
const words = ["都市", "猫", "海", "星", "雲", "森", "犬", "机", "光", "夢", "雨", "鳥"];
const rich = [...words.map(word => token(word)), token("研究", { detail1: "サ変接続" }),
	token("眠る", { pos: "動詞", detail1: "自立", conjugationType: "五段・ラ行", conjugationForm: "基本形" })];
const sourceText = rich.map(word => word.surface).join("");
const session = (view: SemantropyView) => Reflect.get(view, "collisionSession") as CollisionSession;
const modal = (view: SemantropyView) => Reflect.get(view, "collisionModal") as CollisionModal;
const batch = (view: SemantropyView) => session(view).read()!.batch!;
const rows = (view: SemantropyView) => Array.from(modal(view).contentEl.querySelectorAll<HTMLElement>(".semantropy-collision-row"));
const textOf = (row: HTMLElement) => row.querySelector<HTMLElement>(".semantropy-collision-text")!;
const wordsOf = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLElement>(".semantropy-collision-word"));
const regenerateOf = (row: HTMLElement) => row.querySelector<HTMLButtonElement>(".semantropy-modal-row-action[aria-label^='Regenerate'], .semantropy-modal-row-action[aria-label^='固定'], .semantropy-modal-row-action[aria-label='再生成']")!;
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function harness() {
	const h = manualMorphHarness(lexiconTokenizer(rich), 20); views.push(h.view);
	await h.open(sourceText);
	h.view.openCollision();
	return h;
}
async function generate(view: SemantropyView, recipe = "named", count: 10 | 20 | 50 = 10) {
	await session(view).generate(count, recipe); expect(batch(view)).toBeTruthy(); return batch(view);
}
const press = (target: HTMLElement, key: string) => {
	const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
	target.dispatchEvent(event); return event;
};

describe("a row's text is a set of words that can be locked", () => {
	it("builds one piece per part: nouns, modifiers and predicates are buttons named by the word, the rest is text", async () => {
		const h = await harness(); const generated = await generate(h.view, "named");
		const row = rows(h.view)[0]!, committed = generated.rows[0]!.committed;
		expect(textOf(row).textContent).toBe(committed.text);
		const buttons = wordsOf(row);
		expect(buttons.map(word => word.getAttribute("data-slot-id"))).toEqual(["n1", "n2"]);
		for (const word of buttons) {
			expect(word.getAttribute("role")).toBe("button"); expect(word.getAttribute("tabindex")).toBe("0");
			expect(word.getAttribute("aria-pressed")).toBe("false"); expect(word.classList.contains("is-locked")).toBe(false);
		}
		// "という名の" between the two nouns is a literal of the recipe: text, not an element.
		expect(Array.from(textOf(row).children).every(child => child.classList.contains("semantropy-collision-word"))).toBe(true);
		expect(Array.from(textOf(row).childNodes).map(node => node.textContent)).toEqual(committed.segments.map(segment => segment.text));
		// The same for a recipe with a modifier, a Connector and more parts: every segment is either a button or plain text.
		const standard = await generate(h.view, "");
		for (const [index, entry] of standard.rows.entries()) {
			const element = textOf(rows(h.view)[index]!);
			expect(element.textContent).toBe(entry.committed.text);
			const lockable = entry.committed.segments.filter(segment => ["noun", "modifier", "predicate"].includes(segment.kind));
			expect(wordsOf(rows(h.view)[index]!).map(word => word.getAttribute("data-slot-id"))).toEqual(lockable.map(segment => segment.slotId));
			expect(wordsOf(rows(h.view)[index]!).map(word => word.textContent)).toEqual(lockable.map(segment => segment.text));
		}
	});

	it("sets a word as text, never as markup", async () => {
		const h = await harness(); await generate(h.view, "named");
		const element = textOf(rows(h.view)[0]!);
		expect(element.innerHTML).not.toMatch(/<(?!\/?span\b)/u);
		const source = (await import("node:fs")).readFileSync("src/view/CollisionModal.ts", "utf8");
		expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/u);
	});
});

describe("locking a word", () => {
	it("is a click on it and again to release; Enter and Space do the same; other keys and other places do nothing", async () => {
		const h = await harness(); await generate(h.view, "named");
		const slot = batch(h.view).rows[0]!.rowSlotId, row = rows(h.view)[0]!;
		const [first, second] = wordsOf(row) as [HTMLElement, HTMLElement];
		first.click();
		expect(session(h.view).lockedNames(slot)).toEqual(["n1"]);
		expect(first.getAttribute("aria-pressed")).toBe("true"); expect(first.classList.contains("is-locked")).toBe(true);
		expect(second.getAttribute("aria-pressed")).toBe("false");
		first.click();
		expect(session(h.view).lockedNames(slot)).toEqual([]); expect(first.getAttribute("aria-pressed")).toBe("false");
		expect(press(second, "Enter").defaultPrevented).toBe(true);
		expect(second.getAttribute("aria-pressed")).toBe("true");
		const space = press(second, " ");
		expect(space.defaultPrevented).toBe(true); expect(second.getAttribute("aria-pressed")).toBe("false");
		for (const key of ["a", "Tab", "ArrowRight", "Escape", "Shift"]) expect(press(first, key).defaultPrevented).toBe(false);
		textOf(row).click();
		row.querySelector<HTMLElement>(".semantropy-collision-pattern")!.click();
		expect(session(h.view).lockedNames(slot)).toEqual([]);
		expect(first.getAttribute("aria-pressed")).toBe("false");
	});

	/*
	 * A drag over the words selects them (on the web page; Obsidian does not let a Modal's text be selected). The pointer
	 * press remembers the selection it found, and only a click that ends with another, non-empty selection of this row's
	 * text is the end of such a drag. A selection that was there before the press (a double click leaves one) is not.
	 */
	const pointerDown = (target: HTMLElement) => target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	const select = (node: Node) => { const selection = document.getSelection()!, range = document.createRange(); range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range); return selection; };

	it("is not a click on a word when the pointer press is followed by a new selection of the row text", async () => {
		const h = await harness(); await generate(h.view, "named");
		const slot = batch(h.view).rows[0]!.rowSlotId, row = rows(h.view)[0]!, [first] = wordsOf(row) as [HTMLElement];
		document.getSelection()!.removeAllRanges();
		pointerDown(first);
		const selection = select(textOf(row));
		expect(selection.isCollapsed).toBe(false);
		first.click();
		expect(session(h.view).lockedNames(slot)).toEqual([]);
		// The next press and click, with nothing selected, lock.
		selection.removeAllRanges();
		pointerDown(first); first.click();
		expect(session(h.view).lockedNames(slot)).toEqual(["n1"]);
	});

	it("is a click on a word when a selection was already there at the press, as it is after a double click", async () => {
		const h = await harness(); await generate(h.view, "named");
		const slot = batch(h.view).rows[0]!.rowSlotId, row = rows(h.view)[0]!, [first, second] = wordsOf(row) as [HTMLElement, HTMLElement];
		select(first.firstChild!);
		pointerDown(second); second.click();
		expect(session(h.view).lockedNames(slot)).toEqual(["n2"]);
		// A double click on a word: the first click locks it, the second makes the selection and changes nothing.
		document.getSelection()!.removeAllRanges();
		pointerDown(first); first.click();
		expect([...session(h.view).lockedNames(slot)].sort()).toEqual(["n1", "n2"]);
		pointerDown(first); select(first.firstChild!); first.click();
		expect([...session(h.view).lockedNames(slot)].sort()).toEqual(["n1", "n2"]);
		// The click after it finds that selection already there at its press, and releases the word.
		pointerDown(first); first.click();
		expect(session(h.view).lockedNames(slot)).toEqual(["n2"]);
	});

	it("is a click on a word when the new selection is not in this row text, when no pointer press came before, and for Enter and Space", async () => {
		const h = await harness(); await generate(h.view, "named");
		const slot = batch(h.view).rows[0]!.rowSlotId, row = rows(h.view)[0]!, [first, second] = wordsOf(row) as [HTMLElement, HTMLElement];
		const hint = modal(h.view).contentEl.querySelector<HTMLElement>(".semantropy-collision-hint")!;
		// A selection made elsewhere (the hint line) while the pointer was down does not stop the click.
		pointerDown(first); select(hint); first.click();
		expect(session(h.view).lockedNames(slot)).toEqual(["n1"]);
		// A click with no press before it (an assistive technology's) is never taken for a drag, whatever is selected.
		select(textOf(row)); second.click();
		expect([...session(h.view).lockedNames(slot)].sort()).toEqual(["n1", "n2"]);
		// The keys do not look at the selection at all, nor at a press that was never followed by a click.
		document.getSelection()!.removeAllRanges();
		pointerDown(first); select(textOf(row));
		press(first, "Enter");
		expect(session(h.view).lockedNames(slot)).toEqual(["n2"]);
		press(first, " ");
		expect([...session(h.view).lockedNames(slot)].sort()).toEqual(["n1", "n2"]);
	});

	it("puts three listeners on a row text and none on its words, and takes them off with the row and with the dialog", async () => {
		const adds: { target: EventTarget; type: string; listener: unknown }[] = [];
		const removes: { target: EventTarget; type: string; listener: unknown }[] = [];
		const add = vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(function (this: EventTarget, type: string, listener: unknown) {
			adds.push({ target: this, type, listener }); return undefined;
		});
		const remove = vi.spyOn(EventTarget.prototype, "removeEventListener").mockImplementation(function (this: EventTarget, type: string, listener: unknown) {
			removes.push({ target: this, type, listener }); return undefined;
		});
		try {
			const h = await harness(); await generate(h.view, "named");
			const texts = rows(h.view).map(textOf);
			const own = (target: EventTarget) => adds.filter((entry) => entry.target === target);
			for (const text of texts) expect(own(text).map((entry) => entry.type).sort()).toEqual(["click", "keydown", "pointerdown"]);
			for (const word of rows(h.view).flatMap(wordsOf)) expect(own(word)).toEqual([]);
			const taken = (entry: { target: EventTarget; type: string; listener: unknown }) => removes.some((gone) => gone.target === entry.target && gone.type === entry.type && gone.listener === entry.listener);
			const mine = adds.filter((entry) => texts.includes(entry.target as HTMLElement));
			expect(mine.length).toBe(texts.length * 3);
			expect(mine.some(taken)).toBe(false);
			// A new list takes every row of the old one off, listeners included.
			await generate(h.view, "named");
			expect(mine.every(taken)).toBe(true);
			// And closing the dialog does the same for the rows then on show.
			const later = rows(h.view).map(textOf);
			const shown = adds.filter((entry) => later.includes(entry.target as HTMLElement));
			expect(shown.length).toBe(later.length * 3);
			modal(h.view).close();
			expect(shown.every(taken)).toBe(true);
		} finally {
			add.mockRestore(); remove.mockRestore();
		}
	});

	it("rebuilds nothing: the row, its text element and the word keep their identity and the focus stays on the word", async () => {
		const h = await harness(); await generate(h.view, "named");
		const before = rows(h.view), row = before[0]!, text = textOf(row), [first] = wordsOf(row) as [HTMLElement];
		const root = modal(h.view).contentEl, list = root.querySelector<HTMLElement>(".semantropy-collision-rows")!; list.scrollTop = 40;
		first.focus(); expect(document.activeElement).toBe(first);
		press(first, "Enter");
		expect(rows(h.view).every((entry, index) => entry === before[index])).toBe(true);
		expect(textOf(row)).toBe(text); expect(wordsOf(row)[0]).toBe(first);
		expect(document.activeElement).toBe(first); expect(list.scrollTop).toBe(40);
		expect(modal(h.view).contentEl).toBe(root);
		press(first, " ");
		expect(document.activeElement).toBe(first);
	});

	it("names the row's Regenerate for the locks, and cannot be pressed once every part that can be kept is locked", async () => {
		const h = await harness(); await generate(h.view, "named");
		const row = rows(h.view)[0]!, button = regenerateOf(row), [first, second] = wordsOf(row) as [HTMLElement, HTMLElement];
		expect(button.getAttribute("aria-label")).toBe("Regenerate"); expect(button.disabled).toBe(false);
		first.click();
		expect(button.getAttribute("aria-label")).toBe("Regenerate, keeping locked words");
		expect(button.querySelector(".semantropy-action-label")!.textContent).toBe("Regenerate, keeping locked words");
		expect(button.disabled).toBe(false);
		second.click();
		expect(button.disabled).toBe(true);
		expect(rows(h.view)[1]!.querySelector<HTMLButtonElement>(".semantropy-modal-row-action")!.disabled).toBe(false);
		const spy = vi.spyOn(core, "generateLockedCollisionResult");
		await session(h.view).regenerate(batch(h.view).rows[0]!.rowSlotId);
		expect(spy).not.toHaveBeenCalled(); expect(batch(h.view).rows[0]!.committed.generationRevision).toBe(1);
		// Releasing one gives it back, and releasing the other gives the plain name back.
		first.click();
		expect(button.disabled).toBe(false); expect(button.getAttribute("aria-label")).toBe("Regenerate, keeping locked words");
		second.click();
		expect(button.getAttribute("aria-label")).toBe("Regenerate");
	});

	it("is not possible while that row, or the list, is being generated", async () => {
		const h = await harness(); await generate(h.view, "named");
		const slot = batch(h.view).rows[0]!.rowSlotId, [first] = wordsOf(rows(h.view)[0]!) as [HTMLElement];
		const waiting: (() => void)[] = [];
		// The session holds the scheduler object it was opened with; hold its paint step.
		vi.spyOn(h.host.scheduler as CooperativeScheduler, "paint").mockImplementation(() => new Promise<void>(done => waiting.push(done)));
		first.click();
		const pending = session(h.view).regenerate(slot); await flush();
		expect(session(h.view).read()!.rowDrafts[0]!.pending).toBe(true);
		first.click();
		expect(session(h.view).lockedNames(slot)).toEqual(["n1"]);
		expect(first.getAttribute("aria-disabled")).toBe("true");
		for (const done of waiting.splice(0)) done();
		await pending; await flush();
		expect(first.isConnected).toBe(false);
		expect(wordsOf(rows(h.view)[0]!)[0]!.getAttribute("aria-disabled")).toBe("false");
	});
});

describe("regenerating a row that keeps words", () => {
	it("keeps the locked word and the lock, changes the rest, and touches no other row or the list", async () => {
		const h = await harness(); const old = await generate(h.view, "named");
		const slot = old.rows[0]!.rowSlotId, before = rows(h.view), list = modal(h.view).contentEl.querySelector<HTMLElement>(".semantropy-collision-rows")!;
		list.scrollTop = 30;
		const kept = old.rows[0]!.committed.segments[0]!.text;
		wordsOf(before[0]!)[0]!.click();
		const plain = vi.spyOn(core, "generateCollisionResults"), locked = vi.spyOn(core, "generateLockedCollisionResult");
		regenerateOf(before[0]!).focus();
		await session(h.view).regenerate(slot);
		expect(locked).toHaveBeenCalledTimes(1); expect(plain).not.toHaveBeenCalled();
		expect(locked.mock.calls[0]![0]).toMatchObject({ locked: ["n1"] });
		const next = batch(h.view);
		expect(next.rows[0]!.committed.segments[0]!.text).toBe(kept);
		expect(next.rows[0]!.committed.text).not.toBe(old.rows[0]!.committed.text);
		expect(next.rows[0]!.committed.generationRevision).toBe(2);
		for (let index = 1; index < old.rows.length; index++) { expect(next.rows[index]).toBe(old.rows[index]); expect(rows(h.view)[index]).toBe(before[index]); }
		expect(rows(h.view)[0]).toBe(before[0]);
		// The lock is still on the same part of the new text, and the focus is where it was.
		const [first, second] = wordsOf(rows(h.view)[0]!) as [HTMLElement, HTMLElement];
		expect(first.textContent).toBe(kept); expect(first.getAttribute("aria-pressed")).toBe("true"); expect(second.getAttribute("aria-pressed")).toBe("false");
		expect(document.activeElement).toBe(regenerateOf(rows(h.view)[0]!)); expect(list.scrollTop).toBe(30);
		// Again: the unlocked word changes again and the locked one stays.
		await session(h.view).regenerate(slot);
		expect(batch(h.view).rows[0]!.committed.segments[0]!.text).toBe(kept);
		expect(batch(h.view).rows[0]!.committed.generationRevision).toBe(3);
		// With the lock released the whole row is drawn again, as it always was.
		wordsOf(rows(h.view)[0]!)[0]!.click();
		await session(h.view).regenerate(slot);
		expect(plain).toHaveBeenCalledTimes(1); expect(locked).toHaveBeenCalledTimes(2);
	});

	it("keeps Copy and Collect exactly as they were: the row's text, with no mark of a lock", async () => {
		const h = await harness(); const old = await generate(h.view, "named");
		const slot = old.rows[0]!.rowSlotId;
		wordsOf(rows(h.view)[0]!)[1]!.click();
		await session(h.view).write(slot, "copy"); await session(h.view).write(slot, "collect");
		expect(h.calls.copy).toEqual([old.rows[0]!.committed.text]);
		expect(h.calls.collect[0]).toMatchObject({ type: "collision", text: old.rows[0]!.committed.text, patternId: "named", rowId: old.rows[0]!.committed.rowId, batchId: old.batchId });
		expect(Object.keys(h.calls.collect[0]!).sort()).toEqual(["algorithmVersion", "batchId", "metadataVersion", "patternId", "patternSetVersion", "rowId", "text", "type", "vocabulary"]);
		expect(textOf(rows(h.view)[0]!).textContent).toBe(old.rows[0]!.committed.text);
	});

	it("drops every lock with a new Generate, and with closing the dialog", async () => {
		const h = await harness(); await generate(h.view, "named");
		const first = batch(h.view).rows[0]!.rowSlotId;
		wordsOf(rows(h.view)[0]!)[0]!.click();
		expect(session(h.view).lockedNames(first)).toEqual(["n1"]);
		const next = await generate(h.view, "named");
		expect(next.rows[0]!.rowSlotId).not.toBe(first);
		expect(session(h.view).lockedNames(next.rows[0]!.rowSlotId)).toEqual([]);
		expect(session(h.view).lockedNames(first)).toEqual([]);
		expect(wordsOf(rows(h.view)[0]!).every(word => word.getAttribute("aria-pressed") === "false")).toBe(true);
		wordsOf(rows(h.view)[0]!)[0]!.click();
		h.view.closeCollision();
		h.view.openCollision();
		expect(session(h.view).lockedNames(next.rows[0]!.rowSlotId)).toEqual([]);
		expect(rows(h.view)).toHaveLength(0);
	});

	it("keeps a lock when a Generate fails and the previous list stays", async () => {
		const h = await harness(); const old = await generate(h.view, "named");
		wordsOf(rows(h.view)[0]!)[0]!.click();
		await h.apply(["。"]); await session(h.view).generate(10, "");
		expect(batch(h.view)).toBe(old);
		expect(session(h.view).lockedNames(old.rows[0]!.rowSlotId)).toEqual(["n1"]);
		expect(wordsOf(rows(h.view)[0]!)[0]!.getAttribute("aria-pressed")).toBe("true");
	});
});

describe("the words in both languages", () => {
	it("says how to lock in the dialog's hint and names the row's Regenerate in English and in Japanese", async () => {
		const h = await harness(); await generate(h.view, "named");
		const root = modal(h.view).contentEl, hint = root.querySelector<HTMLElement>(".semantropy-collision-hint")!;
		expect(hint.textContent).toBe("Click a word to lock it. Regenerate then keeps the locked words and draws the rest again.");
		wordsOf(rows(h.view)[0]!)[0]!.click();
		setCurrentUiLanguage("ja"); h.view.languageChanged();
		expect(hint.textContent).toBe("語をクリックすると固定できます。固定した語を残して、行を再生成します。");
		const [button] = [regenerateOf(rows(h.view)[0]!)];
		expect(button.getAttribute("aria-label")).toBe("固定した語を残して再生成");
		wordsOf(rows(h.view)[0]!)[0]!.click();
		expect(button.getAttribute("aria-label")).toBe("再生成");
		// The words themselves are the Vocabulary's and do not change with the language.
		expect(textOf(rows(h.view)[0]!).textContent).toBe(batch(h.view).rows[0]!.committed.text);
	});
});
