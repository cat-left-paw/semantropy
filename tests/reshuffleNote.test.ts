import { describe, expect, it } from "vitest";
import {
	MAX_DISTINCT_SEED_ATTEMPTS,
	issueDistinctUint32Seed,
	planReshuffle,
} from "../src/application/reshuffleNote";
import {
	buildVocabularyPool,
	transformTokenSequences,
} from "../src/transform/transformTokens";
import { token } from "./tokenFixtures";
import { MAX } from "./readyAnalysis";

const particle = token({ surface: "は", pos: "助詞", detail1: "係助詞" });
const andParticle = token({ surface: "と", pos: "助詞", detail1: "並立助詞" });
const cat = token({ surface: "猫" });
const dog = token({ surface: "犬" });
const bird = token({ surface: "鳥" });

const sequences = [
	[cat, particle],
	[dog, andParticle, bird],
] as const;
const pool = buildVocabularyPool(sequences);

describe("issueDistinctUint32Seed", () => {
	it("returns a different uint32 seed", () => {
		expect(issueDistinctUint32Seed(1, () => 2)).toEqual({
			status: "ok",
			seed: 2,
		});
	});

	it("rejects the current seed a finite number of times", () => {
		let calls = 0;
		const result = issueDistinctUint32Seed(7, () => {
			calls += 1;
			return 7;
		});
		expect(result).toEqual({ status: "same-seed" });
		expect(calls).toBe(MAX_DISTINCT_SEED_ATTEMPTS);
	});

	it("keeps going until a different seed appears within the limit", () => {
		const values = [4, 4, 9];
		const result = issueDistinctUint32Seed(4, () => values.shift() ?? 4);
		expect(result).toEqual({ status: "ok", seed: 9 });
	});

	it("fails when seed issuance throws", () => {
		expect(
			issueDistinctUint32Seed(1, () => {
				throw new Error("crypto unavailable");
			}),
		).toEqual({ status: "failed" });
	});
});

describe("planReshuffle", () => {
	it("plans texts from saved tokenSequences and pool, not from current display strings", () => {
		const currentDisplay = transformTokenSequences(sequences, pool, 0, MAX);
		const planned = planReshuffle({
			tokenSequences: sequences,
			pool,
			currentBodySeed: 0,
			bodySemantropy: MAX,
			expectedNodeCount: 2,
			issueSeed: () => 1,
		});
		expect(planned.status).toBe("planned");
		if (planned.status !== "planned") {
			return;
		}
		expect(planned.plan.texts).toEqual(
			transformTokenSequences(sequences, pool, 1, MAX).texts,
		);
		expect(planned.plan.texts).not.toEqual(currentDisplay.texts);
		expect(planned.plan.bodySeed).toBe(1);
	});

	it("fails closed when the text count does not match", () => {
		expect(
			planReshuffle({
				tokenSequences: sequences,
				pool,
				currentBodySeed: 0,
			bodySemantropy: MAX,
				expectedNodeCount: 9,
				issueSeed: () => 1,
			}),
		).toEqual({ status: "failed", reason: "count-mismatch" });
	});

	it("fails closed when transform throws", () => {
		expect(
			planReshuffle({
				tokenSequences: sequences,
				pool,
				currentBodySeed: 0,
			bodySemantropy: MAX,
				expectedNodeCount: 2,
				issueSeed: () => 1,
				transform: () => {
					throw new Error("transform exploded");
				},
			}),
		).toEqual({ status: "failed", reason: "transform" });
	});
});
