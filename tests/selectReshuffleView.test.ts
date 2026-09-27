import { describe, expect, it, vi } from "vitest";
import {
	invokeReshuffleCommand,
	selectReshuffleView,
} from "../src/application/selectReshuffleView";

describe("selectReshuffleView", () => {
	it("prefers the active Semantropy view", () => {
		expect(
			selectReshuffleView({
				activeView: "active",
				existingViews: ["first", "second"],
			}),
		).toBe("active");
	});

	it("falls back to the first existing Semantropy view", () => {
		expect(
			selectReshuffleView({
				activeView: null,
				existingViews: ["first", "second"],
			}),
		).toBe("first");
	});

	it("returns null when no Semantropy view exists", () => {
		expect(
			selectReshuffleView({
				activeView: undefined,
				existingViews: [],
			}),
		).toBeNull();
	});
});

describe("invokeReshuffleCommand", () => {
	it("uses the same reshuffle function as the button path", () => {
		const reshuffle = vi.fn(() => "applied");
		const result = invokeReshuffleCommand({
			activeView: { id: "view" },
			existingViews: [],
			reshuffle,
		});
		expect(result).toEqual({ status: "ran", outcome: "applied" });
		expect(reshuffle).toHaveBeenCalledTimes(1);
		expect(reshuffle).toHaveBeenCalledWith({ id: "view" });
	});

	it("does not create a view or reshuffle when none exists", () => {
		const reshuffle = vi.fn();
		expect(
			invokeReshuffleCommand({
				activeView: null,
				existingViews: [],
				reshuffle,
			}),
		).toEqual({ status: "missing" });
		expect(reshuffle).not.toHaveBeenCalled();
	});
});
