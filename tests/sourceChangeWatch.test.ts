import { describe, expect, it } from "vitest";
import { SourceChangeWatch } from "../src/application/sourceChangeWatch";

const alwaysCurrent = () => true;
const neverCurrent = () => false;

describe("SourceChangeWatch", () => {
	it("reports no path before any request", () => {
		const watch = new SourceChangeWatch();
		expect(watch.pendingSourcePath(alwaysCurrent)).toBeNull();
	});

	it("keeps the path reachable while a request is in flight", () => {
		const watch = new SourceChangeWatch();
		watch.beginRequest(1, "folder/note.md");
		expect(watch.pendingSourcePath(alwaysCurrent)).toBe("folder/note.md");
	});

	it("drops the path once its request is superseded", () => {
		const watch = new SourceChangeWatch();
		watch.beginRequest(1, "folder/note.md");
		expect(watch.pendingSourcePath(neverCurrent)).toBeNull();
	});

	it("clears the binding only for the request that owns it", () => {
		const watch = new SourceChangeWatch();
		watch.beginRequest(1, "first.md");
		watch.beginRequest(2, "second.md");

		// The older request settling must not unbind the newer one.
		watch.endRequest(1);
		expect(watch.pendingSourcePath(alwaysCurrent)).toBe("second.md");

		watch.endRequest(2);
		expect(watch.pendingSourcePath(alwaysCurrent)).toBeNull();
	});

	it("binds nothing for a request with no note, dropping any older binding", () => {
		const watch = new SourceChangeWatch();
		watch.beginRequest(1, "note.md");
		watch.beginRequest(2, null);
		expect(watch.pendingSourcePath(alwaysCurrent)).toBeNull();
	});

	it("reports a change that landed after the token was taken", () => {
		const watch = new SourceChangeWatch();
		const token = watch.beginRequest(1, "note.md");
		expect(watch.changedSince(token)).toBe(false);

		watch.notifyChanged();
		expect(watch.changedSince(token)).toBe(true);
	});

	it("does not report changes that landed before the token was taken", () => {
		const watch = new SourceChangeWatch();
		watch.notifyChanged();
		const token = watch.beginRequest(1, "note.md");
		expect(watch.changedSince(token)).toBe(false);
	});

	it("invalidates outstanding tokens and the binding on reset", () => {
		const watch = new SourceChangeWatch();
		const token = watch.beginRequest(1, "note.md");
		watch.reset();

		expect(watch.changedSince(token)).toBe(true);
		expect(watch.pendingSourcePath(alwaysCurrent)).toBeNull();
	});
});
