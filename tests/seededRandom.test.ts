import { describe, expect, it, vi } from "vitest";
import {
	SEMANTROPY_ALGORITHM_VERSION,
	UINT32_MAX,
	assertUint32Seed,
	createSeededRandom,
	issueUint32Seed,
	type Uint32RandomSource,
} from "../src/random/seededRandom";

describe("Mulberry32", () => {
	it("exposes the current body algorithm version", () => {
		expect(SEMANTROPY_ALGORITHM_VERSION).toBe(9);
	});

	it("emits a frozen uint32 sequence for seed 0", () => {
		const random = createSeededRandom(0);
		expect(Array.from({ length: 8 }, () => random.nextUint32())).toEqual([
			1144304738, 1416247, 958946056, 627933444, 2007157716, 2340967985,
			2642484575, 2787370982,
		]);
	});

	it("emits a frozen uint32 sequence for seed 1", () => {
		const random = createSeededRandom(1);
		expect(Array.from({ length: 8 }, () => random.nextUint32())).toEqual([
			2693262067, 11749833, 2265367787, 4213581821, 4159151403, 1207330352,
			2632122864, 3095568220,
		]);
	});

	it("reproduces the same sequence for seed 0 on a new generator", () => {
		const first = createSeededRandom(0);
		const second = createSeededRandom(0);
		expect(Array.from({ length: 5 }, () => first.nextUint32())).toEqual(
			Array.from({ length: 5 }, () => second.nextUint32()),
		);
	});

	it("accepts seed 0xffffffff", () => {
		const random = createSeededRandom(UINT32_MAX);
		expect(random.nextUint32()).toBe(3850105811);
	});
});

describe("assertUint32Seed", () => {
	it.each([1.5, -1, UINT32_MAX + 1, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects %s with RangeError",
		(seed) => {
			expect(() => assertUint32Seed(seed)).toThrow(RangeError);
			expect(() => createSeededRandom(seed)).toThrow(RangeError);
		},
	);

	it("accepts 0 and UINT32_MAX", () => {
		expect(assertUint32Seed(0)).toBe(0);
		expect(assertUint32Seed(UINT32_MAX)).toBe(UINT32_MAX);
	});
});

describe("issueUint32Seed", () => {
	it("reads one uint32 from the injected Web Crypto source", () => {
		const source = {
			getRandomValues<T extends ArrayBufferView>(array: T): T {
				const view = new Uint32Array(
					array.buffer,
					array.byteOffset,
					1,
				);
				view[0] = 123456789;
				return array;
			},
		};

		expect(issueUint32Seed(source)).toBe(123456789);
	});

	it("does not fall back to Math.random", () => {
		const randomSpy = vi.spyOn(Math, "random");
		expect(() =>
			issueUint32Seed({} as Uint32RandomSource),
		).toThrow(/Web Crypto getRandomValues is unavailable/);
		expect(randomSpy).not.toHaveBeenCalled();
		randomSpy.mockRestore();
	});
});
