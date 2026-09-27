import { describe, expect, it } from "vitest";
import {
	MANUAL_ALGORITHM_VERSION,
	MANUAL_RANDOM_DOMAIN,
	manualSeed,
} from "../src/analysis/manualDisplay";

describe("MANUAL_ALGORITHM_VERSION", () => {
	it("stays 1 so established Manual draws do not move", () => {
		expect(MANUAL_ALGORITHM_VERSION).toBe(1);
		expect(MANUAL_RANDOM_DOMAIN).toBe("manual-1");
		expect(manualSeed(4, "fp", "id", 2)).toBe(2680437421);
		expect(
			manualSeed(
				7,
				"vocabulary-fingerprint-sha256-1:" + "ab".repeat(32),
				"token-1",
				3,
			),
		).toBe(268461594);
		expect(manualSeed(1, "x", "y", 0, "manual-morph-ruby-1")).toBe(162906549);
	});
});
