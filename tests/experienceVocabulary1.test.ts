// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { VOCABULARY_REFRESH_REQUIRED } from "../src/application/prepareVocabulary";
import { harness, peek, text } from "./vocabularyIntegrationHarness";
import { installObsidianDomHelpers } from "./support/obsidianDom";
import { MAX } from "./readyAnalysis";
import { deferred } from "./refreshHarness";
import type { SemantropyView, SemantropyViewHost } from "../src/view/SemantropyView";
import { buildVocabularyTree, filterVocabularyTree, vocabularyNoteName } from "../src/view/vocabularyTree";
import { CURRENT_NOTE_ONLY, VOCABULARY_FILTER_LIMIT, VOCABULARY_FOLDER_PAGE } from "../src/view/VocabularyModal";

/*
 * PRE-RELEASE-EXPERIENCE-VOCABULARY1 focused regressions:
 *   UX-04 the Toolbar keeps a short summary and one entry; the picker is a View-owned Modal;
 *   UX-05 Vault notes are browsed by folder, from listed paths only.
 */

let restore: () => void;
beforeAll(() => { restore = installObsidianDomHelpers(); });
afterAll(() => restore());
afterEach(() => { vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); });

function external(listed: readonly string[] = ["B.md", "C.md"]) {
	const h = harness(20, MAX), reads: string[] = [];
	const notes = new Map<string, string>([["B.md", "森海。森森森。"], ["C.md", "空山。"], ["deep/D.md", "森空。"]]);
	const host = Reflect.get(h.view, "host") as SemantropyViewHost;
	let paths = [...listed];
	const lists: number[] = [];
	host.listVocabularyNotes = () => { lists.push(paths.length); return paths; };
	host.readCurrentText = async path => {
		reads.push(path);
		const value = path === "fixture.md" ? h.control.source : notes.get(path);
		if (value === undefined) throw Error("PRIVATE path reading");
		return value;
	};
	return { ...h, host, notes, reads, lists, setListed: (next: readonly string[]) => { paths = [...next]; } };
}
const shell = (view: SemantropyView) => peek(view).contentEl;
const entry = (view: SemantropyView) => shell(view).querySelector<HTMLButtonElement>(".semantropy-vocabulary-open")!;
const modals = () => Array.from(document.querySelectorAll<HTMLElement>(".semantropy-vocabulary-modal"));
function picker(root: HTMLElement) {
	const q = <T extends Element>(selector: string) => root.querySelector<T>(selector);
	const button = (label: string) => Array.from(root.querySelectorAll("button")).find(b => b.textContent === label) ?? null;
	const boxes = () => Array.from(root.querySelectorAll<HTMLInputElement>('.semantropy-vocabulary-tree input[type="checkbox"]'));
	const box = (name: string) => boxes().find(b => b.parentElement?.textContent === name) ?? null;
	const folder = (name: string) => Array.from(root.querySelectorAll<HTMLButtonElement>(".semantropy-vocabulary-folder-toggle"))
		.find(b => b.firstElementChild?.textContent === `${name}/`) ?? null;
	const tick = (name: string, on = true) => { const b = box(name)!; b.checked = on; b.dispatchEvent(new Event("change", { bubbles: true })); };
	const setSource = (mode: "current" | "selected") => {
		const s = q<HTMLSelectElement>('select[aria-label="Vocabulary Source"]')!; s.value = mode; s.dispatchEvent(new Event("change"));
	};
	const filter = (value: string) => { const f = q<HTMLInputElement>('input[type="search"]')!; f.value = value; f.dispatchEvent(new Event("input")); };
	/** Visible to a reader. A disabled control that is still on screen counts: that was the contradictory display. */
	const exposed = (el: Element | null) => {
		if (!el?.isConnected) return false;
		for (let node: Element | null = el; node; node = node.parentElement) {
			if (node instanceof HTMLElement && (node.hidden || node.hasAttribute("inert"))) return false;
		}
		return true;
	};
	return { root, q, button, boxes, box, folder, tick, setSource, filter, exposed,
		status: () => q(".semantropy-vocabulary-picker-status")!.textContent ?? "",
		selected: () => q(".semantropy-vocabulary-selected")!.textContent ?? "",
		apply: () => button("Apply Vocabulary")!, cancel: () => button("Cancel")!.click() };
}
function openPicker(view: SemantropyView) {
	entry(view).click();
	const root = modals().at(-1)!;
	return picker(root);
}
/** Lets an Apply run to its end through the real async chain; bounded, never a fixed sleep. */
const waitFor = async (done: () => boolean) => {
	for (let i = 0; i < 200 && !done(); i += 1) await new Promise(resolve => setTimeout(resolve, 0));
	expect(done()).toBe(true);
};

describe("vocabulary tree model (metadata only)", () => {
	it("groups listed paths by folder, keeps root notes, sorts and counts deterministically", () => {
		const tree = buildVocabularyTree(["z.md", "a/b/c.md", "a/a.md", "b.md", "a/b/c.md", "a/b/d.md", "q/r.md"]);
		expect(tree.path).toBe("");
		expect(tree.notes).toEqual(["b.md", "z.md"]);
		expect(tree.folders.map(f => f.path)).toEqual(["a", "q"]);
		expect(tree.folders[0]!.notes).toEqual(["a/a.md"]);
		expect(tree.folders[0]!.folders[0]).toMatchObject({ name: "b", path: "a/b", notes: ["a/b/c.md", "a/b/d.md"], count: 2 });
		expect(tree.count).toBe(6);
		expect(buildVocabularyTree(["q/r.md", "b.md", "a/b/d.md", "a/a.md", "z.md", "a/b/c.md"])).toEqual(tree);
		expect(Object.isFrozen(tree) && Object.isFrozen(tree.folders[0]!.notes)).toBe(true);
		expect(vocabularyNoteName("a/b/c.md")).toBe("c.md");
		expect(vocabularyNoteName("root.md")).toBe("root.md");
	});

	it("filters by path, case-insensitively, keeping the folders that lead to a match", () => {
		const tree = buildVocabularyTree(["Draft/Scene.md", "draft/other.md", "notes/scene 2.md", "x.md"]);
		expect(filterVocabularyTree(tree, "")).toBe(tree);
		const found = filterVocabularyTree(tree, "SCENE");
		expect(found.count).toBe(2);
		expect(found.folders.map(f => f.path)).toEqual(["Draft", "notes"]);
		expect(found.notes).toEqual([]);
		expect(filterVocabularyTree(tree, "nothing").count).toBe(0);
	});
});

describe("UX-04 the Toolbar keeps a summary and one entry", () => {
	it("does not grow with the number of notes, selected paths or stale Sources", async () => {
		const many = Array.from({ length: 3000 }, (_, i) => `f${i % 30}/n${i}.md`);
		const h = external(["B.md", "C.md", ...many]);
		await h.open("猫犬。");
		const group = shell(h.view).querySelector(".semantropy-toolbar-group.is-vocabulary")!;
		// EXPERIENCE-CONTROLS1: the summary is status, in the status line; the Toolbar keeps the entry only.
		const summary = shell(h.view).querySelector(".semantropy-status .semantropy-vocabulary-status")!;
		const before = group.querySelectorAll("*").length;
		const summaryBefore = summary.querySelectorAll("*").length;
		h.view.setVocabularyDraft({ mode: "selected", paths: ["B.md", "C.md"], drawMode: "uniform" });
		expect(await h.view.applyVocabulary()).toBe("applied");
		h.view.notifyVocabularySourceEvent("B.md"); h.view.notifyVocabularySourceEvent("C.md", "missing");
		expect(group.querySelectorAll("*").length).toBe(before);
		expect(summary.querySelectorAll("*").length).toBe(summaryBefore);
		expect(group.querySelectorAll("select, input, details, li").length).toBe(0);
		// A fixed category label and one item holding the one icon-only entry; nothing that grows.
		expect(Array.from(group.children).map(c => c.className)).toEqual(["semantropy-toolbar-group-label", "semantropy-toolbar-items"]);
		expect(group.children[0]!.textContent).toBe("Vocabulary");
		expect(Array.from(group.children[1]!.children).map(c => c.className)).toEqual(["semantropy-toolbar-item is-vocabulary"]);
		expect(Array.from(group.children[1]!.children[0]!.children).map(c => c.className)).toEqual(["semantropy-action semantropy-vocabulary-open is-toolbar-icon has-icon"]);
		expect(summary.textContent).toBe("Vocabulary: Selected Notes (2) · Draw mode: Uniform · stale: 2 Sources");
		expect(entry(h.view).getAttribute("aria-label")).toBe("Change vocabulary");
		expect(h.lists).toEqual([]);
		expect(entry(h.view).getAttribute("aria-haspopup")).toBe("dialog");
		expect(entry(h.view).hasAttribute("title")).toBe(false);
	});
});

describe("UX-05 folder browsing reads paths, never note text", () => {
	it("opens with top-level folders collapsed and only root notes as rows", async () => {
		const many = Array.from({ length: 5000 }, (_, i) => `f${String(i % 50).padStart(2, "0")}/n${String(i).padStart(4, "0")}.md`);
		const h = external(["B.md", "C.md", ...many]);
		await h.open("猫犬。");
		const reads = h.reads.length;
		const p = openPicker(h.view);
		p.setSource("selected");
		expect(h.reads.length).toBe(reads);
		expect(h.lists).toEqual([5002]);
		expect(p.boxes().map(b => b.parentElement!.textContent)).toEqual(["B.md", "C.md"]);
		expect(p.root.querySelectorAll(".semantropy-vocabulary-folder-toggle")).toHaveLength(50);
		expect(p.folder("f00")!.getAttribute("aria-expanded")).toBe("false");
		expect(p.folder("f00")!.textContent).toBe("f00/ (100)");
		expect(p.q(".semantropy-vocabulary-tree-note")!.textContent).toBe("5002 notes.");
		// Expand and collapse: rows exist only while their folder is open.
		p.folder("f07")!.click();
		expect(p.folder("f07")!.getAttribute("aria-expanded")).toBe("true");
		expect(p.boxes()).toHaveLength(102);
		p.folder("f07")!.click();
		expect(p.boxes()).toHaveLength(2);
		expect(h.reads.length).toBe(reads);
	});

	it("pages a very large folder and moves focus to the first new row", async () => {
		const big = Array.from({ length: 450 }, (_, i) => `big/n${String(i).padStart(3, "0")}.md`);
		const h = external(big);
		await h.open("猫犬。");
		const p = openPicker(h.view);
		p.setSource("selected");
		p.folder("big")!.click();
		expect(p.boxes()).toHaveLength(VOCABULARY_FOLDER_PAGE);
		p.button(`Show 200 more of 250 remaining notes`)!.click();
		expect(p.boxes()).toHaveLength(2 * VOCABULARY_FOLDER_PAGE);
		expect(document.activeElement).toBe(p.boxes()[VOCABULARY_FOLDER_PAGE]);
		p.button("Show 50 more of 50 remaining notes")!.click();
		expect(p.boxes()).toHaveLength(450);
		expect(p.button("Show 50 more of 50 remaining notes")).toBeNull();
	});

	it("caps the rows a filter draws and says so", async () => {
		const many = Array.from({ length: 1200 }, (_, i) => `f${i % 12}/match${i}.md`);
		const h = external(many);
		await h.open("猫犬。");
		const p = openPicker(h.view);
		p.setSource("selected");
		p.filter("MATCH");
		expect(p.boxes()).toHaveLength(VOCABULARY_FILTER_LIMIT);
		expect(p.q(".semantropy-vocabulary-tree-note")!.textContent).toBe("1200 notes match; showing 500. Refine the filter to see the rest.");
		p.filter("match1199");
		expect(p.boxes().map(b => b.parentElement!.textContent)).toEqual(["match1199.md"]);
		expect(p.q(".semantropy-vocabulary-tree-note")!.textContent).toBe("1 note matches.");
		p.filter("");
		expect(p.boxes()).toHaveLength(0);
		expect(h.reads).not.toContain("f0/match0.md");
	});

	it("shows paths only as text", async () => {
		const h = external(["<b>x<b>/<img src=x onerror=alert(1)>.md", "<i>root<i>.md"]);
		await h.open("猫犬。");
		const p = openPicker(h.view);
		p.setSource("selected");
		p.folder("<b>x<b>")!.click();
		p.tick("<img src=x onerror=alert(1)>.md");
		expect(p.root.querySelectorAll("img, b, i")).toHaveLength(0);
		expect(p.selected()).toContain("<b>x<b>/<img src=x onerror=alert(1)>.md");
		expect(p.root.textContent).toContain("<i>root<i>.md");
	});
});

describe("VOCABULARY1 draft, Apply and Cancel keep the existing contracts", () => {
	it("keeps a selected note in the draft when a filter or a collapsed folder hides it", async () => {
		const h = external(["B.md", "C.md", "deep/D.md"]);
		await h.open("猫犬。");
		const p = openPicker(h.view);
		expect(p.exposed(p.box("B.md"))).toBe(false);
		p.setSource("selected");
		expect(p.exposed(p.box("B.md"))).toBe(true);
		expect(p.box("B.md")!.disabled).toBe(false);
		p.folder("deep")!.click();
		p.tick("D.md"); p.tick("B.md");
		expect(h.view.getVocabularyState().draft.paths).toEqual(["deep/D.md", "B.md"]);
		p.folder("deep")!.click();
		p.filter("C.md");
		expect(p.boxes().map(b => b.parentElement!.textContent)).toEqual(["C.md"]);
		expect(h.view.getVocabularyState().draft.paths).toEqual(["deep/D.md", "B.md"]);
		expect(p.selected()).toContain("B.md");
		expect(p.selected()).toContain("deep/D.md");
		expect(p.status()).toBe("2 note(s) selected");
		// Committed selection untouched until Apply; no note read by the draft.
		expect(h.view.getVocabularyState().selection.mode).toBe("current");
		expect(h.reads).not.toContain("B.md");
	});

	it("updates only the Selected row that changed, however many are selected", async () => {
		const many = Array.from({ length: 300 }, (_, i) => `f/n${String(i).padStart(3, "0")}.md`);
		const h = external(many);
		await h.open("猫犬。");
		const p = openPicker(h.view);
		p.setSource("selected");
		h.view.setVocabularyDraft({ mode: "selected", paths: many.slice(50), drawMode: "uniform" });
		const rows = () => Array.from(p.root.querySelectorAll(".semantropy-vocabulary-selected li"));
		const before = rows();
		expect(before).toHaveLength(250);
		p.folder("f")!.click();
		p.tick("n010.md");
		const after = rows();
		expect(after).toHaveLength(251);
		expect(after.filter(row => before.includes(row))).toHaveLength(250);
		expect(after.map(row => row.firstElementChild!.textContent)).toEqual(["f/n010.md", ...many.slice(50)]);
		p.tick("n100.md", false);
		expect(rows()).toHaveLength(250);
		expect(rows().some(row => row.firstElementChild!.textContent === "f/n100.md")).toBe(false);
		h.view.setVocabularyDraft({ mode: "selected", paths: [], drawMode: "uniform" });
		expect(rows().map(row => row.textContent)).toEqual(["No notes selected."]);
	});

	it("applies Selected Notes, closes, and returns focus to the entry", async () => {
		const h = external(["B.md", "C.md"]);
		await h.open("猫犬。");
		const p = openPicker(h.view);
		expect(document.activeElement).toBe(p.q('select[aria-label="Vocabulary Source"]'));
		p.setSource("selected");
		expect(p.apply().disabled).toBe(true);
		p.tick("B.md");
		expect(p.apply().disabled).toBe(false);
		p.apply().click(); await waitFor(() => modals().length === 0);
		expect(document.activeElement).toBe(entry(h.view));
		expect(h.view.getVocabularyState().selection).toEqual({ mode: "selected", paths: ["B.md"], drawMode: "uniform" });
		expect(h.reads).toEqual(["B.md"]);
		expect(text(h.view).length).toBeGreaterThan(0);
	});

	it("applies Current Note from the picker and keeps no selected paths", async () => {
		const h = external(["B.md"]);
		await h.open("猫犬。");
		h.view.setVocabularyDraft({ mode: "selected", paths: ["B.md"], drawMode: "uniform" });
		await h.view.applyVocabulary();
		const p = openPicker(h.view);
		expect(p.exposed(p.box("B.md"))).toBe(true);
		expect(p.box("B.md")!.checked).toBe(true);
		p.setSource("current");
		expect(p.exposed(p.q(".semantropy-vocabulary-browse"))).toBe(false);
		expect(p.status()).toBe(CURRENT_NOTE_ONLY);
		p.apply().click(); await waitFor(() => modals().length === 0);
		expect(h.view.getVocabularyState().selection).toEqual({ mode: "current", paths: [], drawMode: "uniform" });
	});

	it("lists a selected path that left the Vault, lets the reader remove it, and keeps the committed Vocabulary", async () => {
		const h = external(["B.md", "C.md"]);
		await h.open("猫犬。");
		h.view.setVocabularyDraft({ mode: "selected", paths: ["B.md", "C.md"], drawMode: "uniform" });
		expect(await h.view.applyVocabulary()).toBe("applied");
		const snapshot = h.view.getVocabularyState().snapshot;
		h.setListed(["B.md"]); h.notes.delete("C.md");
		h.view.notifyVocabularySourceEvent("C.md", "missing");
		const p = openPicker(h.view);
		expect(p.selected()).toContain("C.md (not found in the Vault, missing)");
		expect(p.boxes().map(b => b.parentElement!.textContent)).toEqual(["B.md"]);
		// Apply with it still selected fails and changes nothing.
		p.apply().click(); await waitFor(() => !h.view.getVocabularyState().preparing && !p.apply().disabled);
		expect(modals()).toHaveLength(1);
		expect(p.status()).toBe("Could not prepare Vocabulary. Check selected notes and retry.");
		expect(h.view.getVocabularyState().snapshot).toBe(snapshot);
		const remove = p.root.querySelector<HTMLButtonElement>('button[aria-label="Remove C.md"]')!;
		remove.click();
		expect(h.view.getVocabularyState().draft.paths).toEqual(["B.md"]);
		expect(p.selected()).not.toContain("C.md");
		expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove B.md");
		p.apply().click(); await waitFor(() => modals().length === 0);
		expect(h.view.getVocabularyState().staleSources).toEqual([]);
	});

	it("drops the draft on Cancel, and a reopened picker starts from the committed selection", async () => {
		const h = external(["B.md", "C.md"]);
		await h.open("猫犬。");
		const snapshot = h.view.getVocabularyState().snapshot;
		let p = openPicker(h.view);
		p.setSource("selected"); p.tick("C.md");
		p.cancel();
		expect(modals()).toHaveLength(0);
		expect(document.activeElement).toBe(entry(h.view));
		expect(h.view.getVocabularyState().draft).toEqual(h.view.getVocabularyState().selection);
		expect(h.view.getVocabularyState().snapshot).toBe(snapshot);
		p = openPicker(h.view);
		expect(p.box("C.md")!.checked).toBe(false);
		expect((p.q('select[aria-label="Vocabulary Source"]') as HTMLSelectElement).value).toBe("current");
		expect(h.reads).toEqual([]);
	});

	it("aborts an in-flight Apply on Cancel / Esc, a Source change or View close, without replacing the Vocabulary", async () => {
		for (const cause of ["close", "source", "view"] as const) {
			const h = external(["B.md", "C.md"]);
			await h.open("猫犬。");
			const snapshot = h.view.getVocabularyState().snapshot;
			const gate = deferred<string>(), entered = deferred<void>();
			h.host.readCurrentText = async path => { h.reads.push(path); entered.resolve(); return await gate.promise; };
			const p = openPicker(h.view);
			p.setSource("selected"); p.tick("B.md");
			p.apply().click(); await entered.promise;
			expect(p.status()).toMatch(/^Preparing: 0 \/ 1$/);
			expect(p.apply().disabled).toBe(true);
			if (cause === "close") p.cancel(); // Obsidian's Escape closes the Modal the same way.
			if (cause === "source") h.view.notifyVocabularySourceEvent("B.md");
			if (cause === "view") await h.view.onClose();
			// Apply is available again before the abandoned read settles: nothing waits on a stale promise.
			if (cause === "source") expect(p.apply().disabled).toBe(false);
			gate.resolve("森海。"); await waitFor(() => !h.view.getVocabularyState().preparing);
			if (cause !== "view") expect(h.view.getVocabularyState().snapshot).toBe(snapshot);
			expect(h.view.getVocabularyState().selection.mode).toBe("current");
			if (cause === "source") {
				// The picker stays open with the draft, ready to retry.
				expect(modals()).toHaveLength(1);
				expect(h.view.getVocabularyState().draft.paths).toEqual(["B.md"]);
				expect(p.apply().disabled).toBe(false);
				p.cancel();
			} else expect(modals()).toHaveLength(0);
			document.body.replaceChildren();
		}
	});

	it("keeps two Views' pickers, drafts and focus apart", async () => {
		const a = external(["B.md", "C.md"]), b = external(["B.md", "C.md"]);
		await a.open("猫犬。"); await b.open("猫犬。");
		const pa = openPicker(a.view), pb = openPicker(b.view);
		expect(modals()).toHaveLength(2);
		pa.setSource("selected"); pa.tick("B.md");
		pb.setSource("selected"); pb.tick("C.md");
		expect(a.view.getVocabularyState().draft.paths).toEqual(["B.md"]);
		expect(b.view.getVocabularyState().draft.paths).toEqual(["C.md"]);
		expect(pb.box("B.md")!.checked).toBe(false);
		pa.cancel();
		expect(document.activeElement).toBe(entry(a.view));
		expect(b.view.getVocabularyState().draft.paths).toEqual(["C.md"]);
		expect(modals()).toEqual([pb.root]);
		entry(b.view).click();
		expect(modals()).toHaveLength(1);
		pb.apply().click(); await waitFor(() => modals().length === 0);
		expect(b.view.getVocabularyState().selection.paths).toEqual(["C.md"]);
		expect(a.view.getVocabularyState().selection.mode).toBe("current");
	});

	it("keeps its listeners delegated and releases every row on close", async () => {
		const many = Array.from({ length: 2000 }, (_, i) => `f${i % 4}/n${i}.md`);
		const h = external(many);
		await h.open("猫犬。");
		const add = vi.spyOn(EventTarget.prototype, "addEventListener");
		const remove = vi.spyOn(EventTarget.prototype, "removeEventListener");
		const p = openPicker(h.view);
		p.setSource("selected");
		p.folder("f0")!.click(); p.folder("f1")!.click();
		expect(p.boxes()).toHaveLength(2 * VOCABULARY_FOLDER_PAGE);
		const added = add.mock.calls.length;
		expect(added).toBeLessThanOrEqual(12);
		p.cancel();
		expect(remove.mock.calls.length).toBeGreaterThanOrEqual(added);
		expect(p.root.querySelectorAll("input, li")).toHaveLength(0);
		expect(Reflect.get(h.view, "vocabularyModal")).toBeNull();
	});
});

describe("Current Note does not present a file selection", () => {
	/** True when a file row was connected outside a concealed region. Opening on Current Note must stay false. */
	function watchFileSelection() {
		let shown = false;
		const append = Object.getOwnPropertyDescriptor(Element.prototype, "append")?.value as (this: Element, ...nodes: (string | Node)[]) => void;
		const regionOf = (start: Element | null) => {
			for (let host: Element | null = start; host; host = host.parentElement) {
				if (host.classList.contains("semantropy-vocabulary-browse") || host.classList.contains("semantropy-vocabulary-selected")) return host;
			}
			return null;
		};
		const concealed = (el: Element) => {
			for (let host: Element | null = el; host; host = host.parentElement) {
				if (host instanceof HTMLElement && (host.hidden || host.hasAttribute("inert"))) return true;
			}
			return false;
		};
		Element.prototype.append = function (this: Element, ...nodes: (string | Node)[]) {
			for (const node of nodes) {
				if (!(node instanceof Element)) continue;
				const region = regionOf(node) ?? regionOf(this);
				if (region && !concealed(region)) shown = true;
			}
			return append.apply(this, nodes);
		};
		return { leaked: () => shown, stop: () => { Element.prototype.append = append; } };
	}

	it("opens on Current Note with the file selection already concealed", async () => {
		const h = external(["B.md", "C.md", "deep/D.md"]);
		await h.open("猫犬。");
		const watch = watchFileSelection();
		let p: ReturnType<typeof picker>;
		try { p = openPicker(h.view); }
		finally { watch.stop(); }
		expect(watch.leaked()).toBe(false);
		const browse = p!.q(".semantropy-vocabulary-browse")!;
		const selected = p!.q(".semantropy-vocabulary-selected")!;
		expect((browse as HTMLElement).hidden && browse.hasAttribute("inert")).toBe(true);
		expect((selected as HTMLElement).hidden && selected.hasAttribute("inert")).toBe(true);
		expect(p!.status()).toBe(CURRENT_NOTE_ONLY);
		expect(p!.q<HTMLElement>(".semantropy-vocabulary-current-note")!.hidden).toBe(true);
		expect(p!.exposed(p!.box("B.md"))).toBe(false);
		expect(p!.exposed(p!.folder("deep"))).toBe(false);
		expect(p!.exposed(p!.q('input[type="search"]'))).toBe(false);
		expect(p!.exposed(p!.q('select[aria-label="Draw mode"]'))).toBe(true);
		expect(p!.exposed(p!.apply())).toBe(true);
		expect(p!.apply().disabled).toBe(false);
		expect(p!.exposed(p!.button("Cancel"))).toBe(true);
		const box = p!.box("B.md")!;
		box.focus();
		expect(document.activeElement).not.toBe(box);
		box.checked = true;
		box.dispatchEvent(new Event("change", { bubbles: true }));
		p!.folder("deep")!.click();
		expect(h.view.getVocabularyState().draft).toEqual({ mode: "current", paths: [], drawMode: "uniform" });
		expect(p!.folder("deep")!.getAttribute("aria-expanded")).toBe("false");
	});

	it("restores the Selected Notes draft when switching back before Apply", async () => {
		const h = external(["B.md", "C.md"]);
		await h.open("猫犬。");
		const p = openPicker(h.view);
		p.setSource("selected");
		p.tick("B.md");
		p.tick("C.md");
		expect(h.view.getVocabularyState().draft.paths).toEqual(["B.md", "C.md"]);
		p.setSource("current");
		expect(p.exposed(p.q(".semantropy-vocabulary-browse"))).toBe(false);
		expect(p.exposed(p.q(".semantropy-vocabulary-selected"))).toBe(false);
		expect(p.exposed(p.box("B.md"))).toBe(false);
		expect(p.exposed(p.root.querySelector('button[aria-label="Remove B.md"]'))).toBe(false);
		expect(p.status()).toBe(CURRENT_NOTE_ONLY);
		expect(h.view.getVocabularyState().draft).toEqual({ mode: "current", paths: ["B.md", "C.md"], drawMode: "uniform" });
		const remove = p.root.querySelector<HTMLButtonElement>('button[aria-label="Remove B.md"]')!;
		remove.focus();
		expect(document.activeElement).not.toBe(remove);
		remove.click();
		expect(h.view.getVocabularyState().draft.paths).toEqual(["B.md", "C.md"]);
		const draw = p.q<HTMLSelectElement>('select[aria-label="Draw mode"]')!;
		draw.value = "frequency";
		draw.dispatchEvent(new Event("change"));
		expect(h.view.getVocabularyState().draft).toEqual({ mode: "current", paths: ["B.md", "C.md"], drawMode: "frequency" });
		expect(p.q<HTMLElement>(".semantropy-vocabulary-browse")!.hidden).toBe(true);
		p.setSource("selected");
		expect(p.exposed(p.box("B.md"))).toBe(true);
		expect(p.box("B.md")!.checked).toBe(true);
		expect(p.box("C.md")!.checked).toBe(true);
		expect(p.selected()).toContain("B.md");
		expect(p.selected()).toContain("C.md");
		expect(p.status()).toBe("2 note(s) selected");
		expect(h.view.getVocabularyState().selection).toEqual({ mode: "current", paths: [], drawMode: "uniform" });
	});

	it("clears selected paths after Current Note Apply, including on the next open", async () => {
		const h = external(["B.md", "C.md"]);
		await h.open("猫犬。");
		let p = openPicker(h.view);
		p.setSource("selected");
		p.tick("B.md");
		p.tick("C.md");
		p.setSource("current");
		p.apply().click();
		await waitFor(() => modals().length === 0);
		expect(h.reads).toEqual([]);
		expect(h.view.getVocabularyState().selection).toEqual({ mode: "current", paths: [], drawMode: "uniform" });
		expect(h.view.getVocabularyState().draft).toEqual(h.view.getVocabularyState().selection);
		p = openPicker(h.view);
		expect(p.status()).toBe(CURRENT_NOTE_ONLY);
		expect(p.exposed(p.q(".semantropy-vocabulary-browse"))).toBe(false);
		p.setSource("selected");
		expect(p.box("B.md")!.checked).toBe(false);
		expect(p.box("C.md")!.checked).toBe(false);
		expect(p.selected()).toBe("Selected notesNo notes selected.");
		expect(h.view.getVocabularyState().draft.paths).toEqual([]);
	});

	it("Cancel keeps the committed Vocabulary and drops only the uncommitted draft", async () => {
		const h = external(["B.md", "C.md"]);
		await h.open("猫犬。");
		const snapshot = h.view.getVocabularyState().snapshot;
		let p = openPicker(h.view);
		p.setSource("selected");
		p.tick("B.md");
		p.tick("C.md");
		p.setSource("current");
		p.cancel();
		expect(h.view.getVocabularyState().selection).toEqual({ mode: "current", paths: [], drawMode: "uniform" });
		expect(h.view.getVocabularyState().draft).toEqual(h.view.getVocabularyState().selection);
		expect(h.view.getVocabularyState().snapshot).toBe(snapshot);
		p = openPicker(h.view);
		p.setSource("selected");
		expect(p.box("B.md")!.checked).toBe(false);
		expect(p.box("C.md")!.checked).toBe(false);
		p.cancel();

		h.view.setVocabularyDraft({ mode: "selected", paths: ["B.md"], drawMode: "uniform" });
		expect(await h.view.applyVocabulary()).toBe("applied");
		const committed = h.view.getVocabularyState().selection;
		const applied = h.view.getVocabularyState().snapshot;
		p = openPicker(h.view);
		p.setSource("current");
		p.cancel();
		expect(h.view.getVocabularyState().selection).toEqual(committed);
		expect(h.view.getVocabularyState().draft).toEqual(committed);
		expect(h.view.getVocabularyState().snapshot).toBe(applied);
		p = openPicker(h.view);
		expect(p.box("B.md")!.checked).toBe(true);
		expect(p.exposed(p.box("B.md"))).toBe(true);
	});

	it("keeps the committed Vocabulary and the draft when Apply fails or a Source changes", async () => {
		const h = external(["B.md", "C.md"]);
		await h.open("猫犬。");
		const snapshot = h.view.getVocabularyState().snapshot;
		const p = openPicker(h.view);
		p.setSource("selected");
		p.tick("B.md");
		p.setSource("current");
		h.view.notifyVocabularySourceEvent("B.md");
		expect(h.view.getVocabularyState().draft.paths).toEqual(["B.md"]);
		expect(h.view.getVocabularyState().selection.paths).toEqual([]);
		h.view.notifyVocabularySourceEvent("fixture.md");
		p.apply().click();
		await waitFor(() => !h.view.getVocabularyState().preparing && p.status() === VOCABULARY_REFRESH_REQUIRED);
		expect(modals()).toHaveLength(1);
		expect(p.q<HTMLElement>(".semantropy-vocabulary-current-note")!.hidden).toBe(false);
		expect(p.exposed(p.q(".semantropy-vocabulary-browse"))).toBe(false);
		expect(h.view.getVocabularyState().selection).toEqual({ mode: "current", paths: [], drawMode: "uniform" });
		expect(h.view.getVocabularyState().draft).toEqual({ mode: "current", paths: ["B.md"], drawMode: "uniform" });
		expect(h.view.getVocabularyState().snapshot).toBe(snapshot);
		p.setSource("selected");
		expect(p.box("B.md")!.checked).toBe(true);
		expect(p.exposed(p.box("B.md"))).toBe(true);
		expect(p.status()).toBe("1 note(s) selected");
	});
});

describe("Apply and Cancel stay in reach while the lists scroll", () => {
	const css = readFileSync("styles.css", "utf8");
	const declarations = (selector: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").flatMap(block => {
		const [head = "", body] = block.split("{");
		if (!body || !head.split(",").some(part => part.trim() === selector)) return [];
		return [body];
	}).join("\n");

	it("places both buttons after the list region, in every mode and at either selection size", async () => {
		const listed = ["B.md", ...Array.from({ length: 40 }, (_, index) => `folder/n${index}.md`)];
		const h = external(listed);
		await h.open("猫犬。");
		const check = (root: HTMLElement, mode: "current" | "selected", applyEnabled: boolean) => {
			const scroll = root.querySelector(".semantropy-vocabulary-scroll");
			const actions = root.querySelector(".semantropy-vocabulary-actions");
			const apply = Array.from(root.querySelectorAll("button")).find(button => button.textContent === "Apply Vocabulary");
			const cancel = Array.from(root.querySelectorAll("button")).find(button => button.textContent === "Cancel");
			expect(scroll).not.toBeNull();
			expect(actions).not.toBeNull();
			expect(scroll!.contains(root.querySelector(".semantropy-vocabulary-selected"))).toBe(true);
			expect(scroll!.contains(root.querySelector(".semantropy-vocabulary-browse"))).toBe(true);
			expect(scroll!.contains(actions)).toBe(false);
			expect(scroll!.compareDocumentPosition(actions!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
			expect(actions!.contains(apply!)).toBe(true);
			expect(actions!.contains(cancel!)).toBe(true);
			expect(apply!.disabled).toBe(!applyEnabled);
			expect(cancel!.disabled).toBe(false);
			expect(apply!.tabIndex).toBeGreaterThanOrEqual(0);
			expect(cancel!.tabIndex).toBeGreaterThanOrEqual(0);
			for (const button of [apply!, cancel!]) {
				for (let node: Element | null = button; node; node = node.parentElement) {
					expect(node instanceof HTMLElement && (node.hidden || node.hasAttribute("inert"))).toBe(false);
				}
			}
			expect(root.querySelector(".semantropy-vocabulary-selected")!.hasAttribute("hidden")).toBe(mode !== "selected");
		};
		const p = openPicker(h.view);
		check(p.root, "current", true);
		p.setSource("selected");
		check(p.root, "selected", false);
		expect(p.selected()).toContain("No notes selected.");
		h.view.setVocabularyDraft({ mode: "selected", paths: listed.slice(0, 30), drawMode: "uniform" });
		check(p.root, "selected", true);
		expect(p.root.querySelectorAll(".semantropy-vocabulary-selected li")).toHaveLength(30);
	});

	it("lets the lists shrink and keeps the buttons from scrolling away with them", () => {
		expect(declarations(".semantropy-vocabulary-modal")).toMatch(/max-height:\s*90vh;/);
		expect(declarations(".semantropy-vocabulary-modal")).toMatch(/overflow:\s*auto;/);
		expect(declarations(".semantropy-vocabulary-modal .modal-content")).toMatch(/min-height:\s*0;/);
		expect(declarations(".semantropy-vocabulary-modal .modal-content")).toMatch(/overflow:\s*auto;/);
		expect(declarations(".semantropy-vocabulary-scroll")).toMatch(/min-height:\s*0;/);
		expect(declarations(".semantropy-vocabulary-scroll")).toMatch(/overflow:\s*hidden;/);
		expect(declarations(".semantropy-vocabulary-actions")).toMatch(/flex:\s*0 0 auto;/);
		expect(declarations(".semantropy-vocabulary-selected ul")).toMatch(/min-height:\s*0;/);
		expect(declarations(".semantropy-vocabulary-selected ul")).toMatch(/overflow-y:\s*auto;/);
		expect(declarations(".semantropy-vocabulary-tree")).toMatch(/min-height:\s*0;/);
		expect(declarations(".semantropy-vocabulary-tree")).toMatch(/overflow-y:\s*auto;/);
		expect(css).not.toMatch(/max-height:\s*min\(25vh,\s*12rem\)/);
		expect(css).not.toMatch(/max-height:\s*min\(45vh,\s*24rem\)/);
	});
});
