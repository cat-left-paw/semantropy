// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { AutomaticPosToolbar, AUTOMATIC_POS_SETTINGS_ERROR } from "../src/view/AutomaticPosToolbar";
import { AutomaticPosSettingsController } from "../src/settings/AutomaticPosSettingsController";
import { DEFAULT_AUTOMATIC_POS } from "../src/settings/automaticPosSettings";

const disposables: AutomaticPosToolbar[] = [];
afterEach(() => { disposables.forEach(x => x.dispose()); disposables.length = 0; document.body.replaceChildren(); });
function setup() {
	const prepare = vi.fn(async () => true), commit = vi.fn(async () => true);
	const controller = new AutomaticPosSettingsController({ prepare, commit });
	const host = document.createElement("div"); document.body.appendChild(host);
	const toolbar = new AutomaticPosToolbar(host, controller.toolbarPort()); disposables.push(toolbar);
	return { toolbar, controller, prepare, commit, host };
}
function button(root: HTMLElement, label: string) { return root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
function check(root: HTMLElement, label: string) { return root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; }
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }

it("renders named native controls in DOM Tab order and restores focus with Escape", () => {
	const { toolbar } = setup(), root = toolbar.root;
	button(root, "Automatic parts of speech").click();
	expect(Array.from(root.querySelectorAll("input")).map(el => el.getAttribute("aria-label"))).toEqual(["Nouns", "Verbs", "i-adjectives", "Adverbs"]);
	expect(Array.from(root.querySelectorAll("input")).map(el => el.type)).toEqual(["checkbox", "checkbox", "checkbox", "checkbox"]);
	expect(root.querySelectorAll('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')).toHaveLength(0);
	expect(document.activeElement).toBe(check(root, "Nouns")); expect(check(root, "Nouns").checked).toBe(true);
	check(root, "Verbs").click(); expect(check(root, "Verbs").checked).toBe(true);
	check(root, "Adverbs").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
	expect(document.activeElement).toBe(button(root, "Automatic parts of speech"));
	expect(button(root, "Automatic parts of speech").getAttribute("aria-expanded")).toBe("false");
	expect(root.querySelector<HTMLElement>('[aria-label="Automatic parts of speech options"]')!.hidden).toBe(true);
});
it("keeps toggles draft-only and applies all OFF as one immutable request", async () => {
	const { toolbar, controller, prepare, commit } = setup(); toolbar.open();
	check(toolbar.root, "Nouns").click(); expect(controller.read().effective).toEqual(DEFAULT_AUTOMATIC_POS);
	expect(prepare).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
	expect(button(toolbar.root, "Apply").disabled).toBe(false); button(toolbar.root, "Apply").click();
	expect(button(toolbar.root, "Apply").disabled).toBe(true); button(toolbar.root, "Apply").click();
	await flush(); expect(prepare).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledTimes(1);
	expect(controller.read().effective).toEqual({ noun: false, verb: false, iAdjective: false, adverb: false });
});
it.each(["Cancel", "Automatic parts of speech", "outside", "dispose"])("discards draft on %s", action => {
	const { toolbar, controller, commit } = setup(); toolbar.open(); check(toolbar.root, "Verbs").click();
	if (action === "dispose") toolbar.dispose();
	else if (action === "outside") document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	else button(toolbar.root, action).click();
	expect(controller.read().draft).toBeNull(); expect(controller.read().effective).toEqual(DEFAULT_AUTOMATIC_POS); expect(commit).not.toHaveBeenCalled();
});
it("isolates IDs drafts and listener disposal between Toolbars", () => {
	const first = setup(), second = setup(); first.toolbar.open(); second.toolbar.open();
	const ids = Array.from(document.querySelectorAll("[id]")).map(el => el.id); expect(new Set(ids).size).toBe(ids.length);
	check(first.toolbar.root, "Verbs").click(); expect(second.controller.read().draft?.verb).toBe(false);
	const oldButton = button(first.toolbar.root, "Automatic parts of speech");
	first.toolbar.dispose(); oldButton.click(); expect(first.controller.read().draft).toBeNull();
	check(second.toolbar.root, "Adverbs").click(); expect(second.controller.read().draft?.adverb).toBe(true);
	expect(second.toolbar.root.isConnected).toBe(true);
});
it("does not let an old Apply completion close a newly opened draft", async () => {
	const { toolbar, controller, prepare, commit } = setup(); let resolve!: (x: boolean) => void;
	prepare.mockReturnValueOnce(new Promise(r => { resolve = r; }));
	toolbar.open(); button(toolbar.root, "Apply").click(); toolbar.close(); toolbar.open(); check(toolbar.root, "Verbs").click();
	resolve(true); await flush();
	expect(controller.read().draft?.verb).toBe(true); expect(commit).not.toHaveBeenCalled();
	expect(button(toolbar.root, "Automatic parts of speech").getAttribute("aria-expanded")).toBe("true");
});
it("reports only fixed error wording when host preparation throws", async () => {
	const { toolbar, prepare } = setup(); prepare.mockRejectedValue(Error("private.md 本文 surface reading nonce"));
	toolbar.open(); button(toolbar.root, "Apply").click(); await flush();
	expect(toolbar.root.querySelector('[role="status"]')?.textContent).toBe(AUTOMATIC_POS_SETTINGS_ERROR);
	expect(toolbar.root.textContent).not.toMatch(/private|本文|surface|reading|nonce/u);
});
it("keeps narrow chrome bounded with wrapping and refuses a body scroll host", () => {
	const { toolbar, controller, host } = setup();
	expect(toolbar.root.style.flexWrap).toBe("wrap"); expect(toolbar.root.style.maxWidth).toBe("100%");
	expect(toolbar.root.style.minWidth).toBe("0px");
	for (const element of Array.from(toolbar.root.querySelectorAll<HTMLElement>("button,label"))) expect(element.style.maxWidth).toBe("100%");
	expect(toolbar.root.style.fontFamily).toBe(""); expect(toolbar.root.style.color).toBe(""); expect(toolbar.root.style.background).toBe("");
	host.className = "semantropy-scroll"; expect(() => new AutomaticPosToolbar(host, controller.toolbarPort())).toThrow("Automatic options require a Toolbar host");
});
it("removes the exact document listener without removing another Toolbar listener", () => {
	const add = vi.spyOn(document, "addEventListener"), remove = vi.spyOn(document, "removeEventListener");
	const first = setup(), second = setup();
	const handlers = add.mock.calls.filter(call => call[0] === "pointerdown").map(call => call[1]);
	expect(handlers).toHaveLength(2); first.toolbar.dispose();
	expect(remove.mock.calls.filter(call => call[0] === "pointerdown").map(call => call[1])).toEqual([handlers[0]]);
	second.toolbar.open(); document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); expect(second.controller.read().draft).toBeNull();
	second.toolbar.dispose(); expect(remove.mock.calls.filter(call => call[0] === "pointerdown").map(call => call[1])).toEqual(handlers);
	add.mockRestore(); remove.mockRestore();
});
