import { describe, expect, it, vi } from "vitest";
import {
	invokeSemantropyViewCommand,
	selectSemantropyView,
} from "../src/application/selectSemantropyView";

describe("selectSemantropyView", () => {
	it("prefers the active view, then the first existing one", () => {
		expect(
			selectSemantropyView({ activeView: "active", existingViews: ["first"] }),
		).toBe("active");
		expect(
			selectSemantropyView({
				activeView: null,
				existingViews: ["first", "second"],
			}),
		).toBe("first");
		expect(
			selectSemantropyView({ activeView: undefined, existingViews: [] }),
		).toBeNull();
	});
});

describe("invokeSemantropyViewCommand", () => {
	it("runs the command against the selected view exactly once", () => {
		const run = vi.fn(() => "refreshed");
		expect(
			invokeSemantropyViewCommand({
				activeView: { id: "view" },
				existingViews: [{ id: "other" }],
				run,
			}),
		).toEqual({ status: "ran", outcome: "refreshed" });
		expect(run).toHaveBeenCalledTimes(1);
		expect(run).toHaveBeenCalledWith({ id: "view" });
	});

	it("does not create or adopt a view when none exists", () => {
		const run = vi.fn();
		expect(
			invokeSemantropyViewCommand({
				activeView: null,
				existingViews: [],
				run,
			}),
		).toEqual({ status: "missing" });
		expect(run).not.toHaveBeenCalled();
	});
});
