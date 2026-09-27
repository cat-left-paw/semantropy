import { describe, expect, it, vi } from "vitest";
import { dispatchSourceEvent } from "../src/application/dispatchSourceEvent";

type FakeView = { id: string; sourcePath: string | null };

const view = (id: string, sourcePath: string | null): FakeView => ({
	id,
	sourcePath,
});

function dispatch(
	event: Parameters<typeof dispatchSourceEvent<FakeView>>[0]["event"],
	views: FakeView[],
) {
	const recheck = vi.fn();
	const markLost = vi.fn();
	const targets = dispatchSourceEvent({
		event,
		views,
		getSourcePath: (candidate) => candidate.sourcePath,
		recheck,
		markLost,
	});
	return { targets, recheck, markLost };
}

describe("dispatchSourceEvent", () => {
	it("notifies every view built from the changed path, active or not", () => {
		const background = view("background", "note.md");
		const other = view("other", "note.md");
		const { targets, recheck } = dispatch(
			{ kind: "changed", sourcePath: "note.md", editorText: "body" },
			[background, other],
		);

		expect(targets).toEqual([background, other]);
		expect(recheck).toHaveBeenCalledTimes(2);
		expect(recheck).toHaveBeenNthCalledWith(1, background, "body");
		expect(recheck).toHaveBeenNthCalledWith(2, other, "body");
	});

	it("ignores changes to a different note", () => {
		const { targets, recheck, markLost } = dispatch(
			{ kind: "changed", sourcePath: "other.md", editorText: "body" },
			[view("a", "note.md"), view("b", "folder/note.md")],
		);

		expect(targets).toEqual([]);
		expect(recheck).not.toHaveBeenCalled();
		expect(markLost).not.toHaveBeenCalled();
	});

	it("ignores views with no ready snapshot", () => {
		const { targets, recheck } = dispatch(
			{ kind: "changed", sourcePath: "note.md", editorText: null },
			[view("empty", null)],
		);

		expect(targets).toEqual([]);
		expect(recheck).not.toHaveBeenCalled();
	});

	it("passes a null editor text through rather than treating it as empty", () => {
		const target = view("a", "note.md");
		const { recheck } = dispatch(
			{ kind: "changed", sourcePath: "note.md", editorText: null },
			[target],
		);

		expect(recheck).toHaveBeenCalledWith(target, null);
	});

	it("marks a renamed or deleted source lost without rechecking it", () => {
		const target = view("a", "note.md");
		const { targets, recheck, markLost } = dispatch(
			{ kind: "lost", sourcePath: "note.md" },
			[target, view("b", "other.md")],
		);

		expect(targets).toEqual([target]);
		expect(markLost).toHaveBeenCalledTimes(1);
		expect(markLost).toHaveBeenCalledWith(target);
		expect(recheck).not.toHaveBeenCalled();
	});

	it("does not follow a rename to any other path", () => {
		const { markLost } = dispatch({ kind: "lost", sourcePath: "old.md" }, [
			view("a", "new.md"),
		]);

		expect(markLost).not.toHaveBeenCalled();
	});
});
