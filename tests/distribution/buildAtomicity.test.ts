import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	DISTRIBUTION_FILE_NAMES,
	buildDistribution,
	buildProductionMain,
} from "../../scripts/buildDistribution.mjs";

// The bundler is the real one; the mock lets the one call that writes the bundle
// be made to misbehave. Other callers — the generated-input guards bundle the
// product's own compilers in memory, with `write: false` — always get the real
// behaviour, so an armed failure cannot be spent on them. `build` cannot be
// spied on directly because esbuild defines it as a non-configurable property.
type BundleOptions = { write?: boolean };
const bundler = vi.hoisted(() => ({
	real: undefined as (undefined | ((options: BundleOptions) => Promise<unknown>)),
	failure: "none",
}));

vi.mock("esbuild", async (importOriginal) => {
	const actual = await importOriginal<{
		default: { build: (options: BundleOptions) => Promise<unknown> };
	}>();
	bundler.real = actual.default.build;
	const build = async (options: BundleOptions) => {
		const failure = bundler.failure;
		if (options.write === false || failure === "none") {
			return bundler.real?.(options);
		}
		bundler.failure = "none";
		if (failure === "reject") {
			throw new Error("injected bundler failure");
		}
		await bundler.real?.(options);
		throw new Error("injected failure after bundling");
	};
	return { ...actual, default: { ...actual.default, build } };
});

/**
 * PRE-RELEASE-BUILD-BOOTSTRAP1, review 1: once the inputs have been verified,
 * a build that fails part-way must leave the previous `main.js` and the
 * previous release directory exactly as they were, with nothing left behind.
 * The bundle here is the real one, built from this checkout and its prepared
 * dictionary; only the failure is injected.
 */

let scratch: string;

beforeAll(async () => {
	scratch = await mkdtemp(path.join(os.tmpdir(), "semantropy-atomic-"));
});

afterAll(async () => {
	await rm(scratch, { recursive: true, force: true });
});

afterEach(() => {
	bundler.failure = "none";
});

const previousFiles = {
	"main.js": "previous main",
	"manifest.json": "previous manifest",
	"styles.css": "previous styles",
};

async function previousRelease(name: string): Promise<string> {
	const outDir = path.join(scratch, name, "semantropy");
	await mkdir(outDir, { recursive: true });
	for (const [fileName, content] of Object.entries(previousFiles)) {
		await writeFile(path.join(outDir, fileName), content);
	}
	return outDir;
}

async function expectPreviousRelease(outDir: string): Promise<void> {
	expect((await readdir(outDir)).sort()).toEqual([...DISTRIBUTION_FILE_NAMES].sort());
	for (const [fileName, content] of Object.entries(previousFiles)) {
		expect(await readFile(path.join(outDir, fileName), "utf8")).toBe(content);
	}
	// Nothing else next to it: no half-built directory and no backup.
	expect(await readdir(path.dirname(outDir))).toEqual(["semantropy"]);
}

/** The next bundle is written completely, then fails, as a late error would. */
function failAfterBundling(): void {
	bundler.failure = "after-writing";
}

describe("the release directory", () => {
	it("keeps the previous files, and leaves nothing behind, when the bundle fails after it was written", async () => {
		const outDir = await previousRelease("bundle-fails");
		failAfterBundling();
		await expect(buildDistribution({ outDir })).rejects.toThrow(
			"injected failure after bundling",
		);
		await expectPreviousRelease(outDir);
	}, 600_000);

	it("keeps the previous files when the bundler rejects", async () => {
		const outDir = await previousRelease("bundler-rejects");
		bundler.failure = "reject";
		await expect(buildDistribution({ outDir })).rejects.toThrow("injected bundler failure");
		await expectPreviousRelease(outDir);
	}, 600_000);

	for (const failing of [1, 2]) {
		it(`puts the previous files back when swap move ${failing} fails`, async () => {
			const outDir = await previousRelease(`swap-${failing}`);
			let calls = 0;
			await expect(
				buildDistribution({
					outDir,
					renameImpl: async (from: string, to: string) => {
						calls += 1;
						if (calls === failing) {
							throw new Error(`injected swap failure ${failing}`);
						}
						await rename(from, to);
					},
				}),
			).rejects.toThrow(`injected swap failure ${failing}`);
			await expectPreviousRelease(outDir);
		}, 600_000);
	}

	it("still replaces the previous release, and leaves nothing behind, when nothing fails", async () => {
		const outDir = await previousRelease("succeeds");
		const built = await buildDistribution({ outDir });
		expect(built.files.map((file) => file.fileName)).toEqual(
			[...DISTRIBUTION_FILE_NAMES].sort(),
		);
		expect(await readdir(outDir)).toEqual([...DISTRIBUTION_FILE_NAMES].sort());
		expect(await readFile(path.join(outDir, "main.js"), "utf8")).not.toBe("previous main");
		expect(await readdir(path.dirname(outDir))).toEqual(["semantropy"]);
	}, 600_000);

	it("creates the release directory, and its parents, when there was no previous one", async () => {
		const outDir = path.join(scratch, "fresh", "nested", "semantropy");
		await buildDistribution({ outDir });
		expect(await readdir(outDir)).toEqual([...DISTRIBUTION_FILE_NAMES].sort());
		expect(await readdir(path.dirname(outDir))).toEqual(["semantropy"]);
	}, 600_000);
});

describe("the plugin-root main.js", () => {
	it("keeps the previous file, and leaves nothing behind, when the bundle fails after it was written", async () => {
		const outfile = path.join(scratch, "main-fails", "main.js");
		await mkdir(path.dirname(outfile), { recursive: true });
		await writeFile(outfile, "previous main");
		failAfterBundling();
		await expect(buildProductionMain({ outfile })).rejects.toThrow(
			"injected failure after bundling",
		);
		expect(await readFile(outfile, "utf8")).toBe("previous main");
		expect(await readdir(path.dirname(outfile))).toEqual(["main.js"]);
	}, 600_000);

	it("produces the same bytes as the release build and leaves nothing behind", async () => {
		const outfile = path.join(scratch, "main-ok", "main.js");
		await mkdir(path.dirname(outfile), { recursive: true });
		await writeFile(outfile, "previous main");
		const outDir = path.join(scratch, "main-ok-release");
		await buildProductionMain({ outfile });
		await buildDistribution({ outDir });
		expect(Buffer.compare(await readFile(outfile), await readFile(path.join(outDir, "main.js")))).toBe(0);
		expect(await readdir(path.dirname(outfile))).toEqual(["main.js"]);
	}, 600_000);
});
