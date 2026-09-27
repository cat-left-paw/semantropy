import { expect, it } from "vitest";
import { readPinnedFixture } from "./support/pinnedFixture";

it.each(["manualAdjectiveBaseline", "targetChunkLineBaseline"])("rejects a mismatched %s fixture pin instead of regenerating or falling back", name => {
	expect(() => readPinnedFixture(name, "0".repeat(64))).toThrow("Regression fixture hash mismatch.");
});
