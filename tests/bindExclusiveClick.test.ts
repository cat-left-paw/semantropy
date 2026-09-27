// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
	bindExclusiveClick,
	bindExclusiveListener,
} from "../src/view/bindExclusiveClick";

describe("bindExclusiveClick", () => {
	it("does not accumulate click handlers when rebound", () => {
		const element = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
		const first = vi.fn();
		const second = vi.fn();
		const unbindFirst = bindExclusiveClick(null, element as unknown as HTMLElement, first);
		expect(element.addEventListener).toHaveBeenCalledTimes(1);
		const unbindSecond = bindExclusiveClick(
			unbindFirst,
			element as unknown as HTMLElement,
			second,
		);
		expect(element.removeEventListener).toHaveBeenCalledTimes(1);
		expect(element.addEventListener).toHaveBeenCalledTimes(2);
		unbindSecond();
		expect(element.removeEventListener).toHaveBeenCalledTimes(2);
	});
});

describe("bindExclusiveListener", () => {
	it("binds a change handler once per render and unbinds the previous one", () => {
		const element = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
		const first = vi.fn();
		const second = vi.fn();

		const unbindFirst = bindExclusiveListener(
			null,
			element as unknown as HTMLElement,
			"change",
			first,
		);
		expect(element.addEventListener).toHaveBeenCalledWith("change", first);

		// A re-render rebinds; the old handler must go first.
		const unbindSecond = bindExclusiveListener(
			unbindFirst,
			element as unknown as HTMLElement,
			"change",
			second,
		);
		expect(element.removeEventListener).toHaveBeenCalledWith("change", first);
		expect(element.addEventListener).toHaveBeenCalledTimes(2);

		unbindSecond();
		expect(element.removeEventListener).toHaveBeenCalledWith("change", second);
		expect(element.removeEventListener).toHaveBeenCalledTimes(2);
	});

	it("fires the level handler once for one change on a real element", () => {
		const select = document.createElement("select");
		const handler = vi.fn();

		let unbind = bindExclusiveListener(null, select, "change", handler);
		// Three renders in a row must still leave exactly one handler.
		unbind = bindExclusiveListener(unbind, select, "change", handler);
		unbind = bindExclusiveListener(unbind, select, "change", handler);

		select.dispatchEvent(new Event("change"));
		expect(handler).toHaveBeenCalledTimes(1);

		unbind();
		select.dispatchEvent(new Event("change"));
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
