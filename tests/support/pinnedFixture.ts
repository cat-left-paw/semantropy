import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export function fixtureHash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** Pinned bytes, no regeneration/fallback, Git or network access in a gate. */
export function readPinnedFixture<T>(name: string, sha256: string): T {
	const text = readFileSync(`tests/fixtures/regression/${name}.json`, "utf8");
	if (fixtureHash(text) !== sha256) throw Error("Regression fixture hash mismatch.");
	return JSON.parse(text) as T;
}
