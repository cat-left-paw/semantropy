import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareDictionary } from "../../scripts/prepareDictionary.mjs";
import {
	ensureBuildDictionary,
	inspectCompactDictionary,
} from "../../scripts/lindera/ensureDictionary.mjs";
import {
	COMPACT_DICTIONARY_SHA256,
	FULL_DICTIONARY_SHA256,
	assertDictionaryHashes,
} from "../../scripts/lindera/dictionaryHashes.mjs";
import {
	IPADIC_ARCHIVE,
	linderaArchivePath,
	linderaCacheDir,
	linderaCompactDictionaryDir,
	linderaFullDictionaryDir,
	verifyArchive,
} from "../../scripts/lindera/linderaSource.mjs";

/**
 * PRE-RELEASE-BUILD-BOOTSTRAP1: the real archive, extraction and compaction,
 * run against an isolated root whose `.cache/` starts empty. The bytes are the
 * pinned archive copied from this checkout's own cache and handed over through
 * an injected `fetch`, so the suite needs the prepared dictionary (like the
 * rest of this directory) but never the network. The real-network first build
 * is a separate measurement recorded in
 * Docs/pre_release_build_bootstrap1_record.md.
 */

const sourceRoot = process.cwd();
let root: string;
let archive: Buffer;
let fetchCalls: number;

function serving(body: () => BodyInit): typeof fetch {
	return async (url: string | URL | Request) => {
		fetchCalls += 1;
		expect(typeof url === "string" ? url : "not a string").toBe(IPADIC_ARCHIVE.url);
		return new Response(body());
	};
}

const realArchive = () => serving(() => new Uint8Array(archive));
const unreachable: typeof fetch = async () => {
	fetchCalls += 1;
	throw Object.assign(new TypeError("fetch failed"), {
		cause: new Error("network unreachable"),
	});
};

async function stagingLeftovers(): Promise<string[]> {
	return (await readdir(linderaCacheDir(root))).filter((name) => name.startsWith(".staging-"));
}

async function linkNodeModules(into: string): Promise<void> {
	await symlink(path.join(sourceRoot, "node_modules"), path.join(into, "node_modules"), "junction");
}

/** Removing the junction first leaves the real node_modules alone. */
async function removeRoot(dir: string): Promise<void> {
	await rm(path.join(dir, "node_modules"), { recursive: true, force: true });
	await rm(dir, { recursive: true, force: true });
}

beforeAll(async () => {
	const verified = await verifyArchive(linderaArchivePath(sourceRoot));
	if (!verified.ok) {
		throw new Error("Run npm run prepare:dictionary before the distribution suite.");
	}
	archive = verified.content;
	root = await mkdtemp(path.join(os.tmpdir(), "semantropy-bootstrap-dist-"));
	await linkNodeModules(root);
}, 600_000);

afterAll(async () => {
	if (root !== undefined) {
		await removeRoot(root);
	}
});

describe("first build from an empty cache", () => {
	it("downloads once, verifies every stage and publishes only verified directories", async () => {
		fetchCalls = 0;
		const lines: string[] = [];
		const result = await ensureBuildDictionary(root, {
			fetchImpl: realArchive(),
			log: (line) => lines.push(line),
		});
		expect(result).toEqual({ source: "prepared", downloaded: true });
		expect(fetchCalls).toBe(1);
		expect(lines.join("\n")).toMatch(/cache is missing or incomplete[\s\S]*Downloaded and verified/);

		expect((await verifyArchive(linderaArchivePath(root))).ok).toBe(true);
		await assertDictionaryHashes(linderaFullDictionaryDir(root), FULL_DICTIONARY_SHA256, "full");
		await assertDictionaryHashes(
			linderaCompactDictionaryDir(root),
			COMPACT_DICTIONARY_SHA256,
			"compact",
		);
		expect((await inspectCompactDictionary(linderaCompactDictionaryDir(root))).ok).toBe(true);
		expect(await stagingLeftovers()).toEqual([]);
		expect((await readdir(linderaCacheDir(root))).sort()).toEqual(
			[
				"lindera-ipadic-6.0.0",
				"lindera-ipadic-6.0.0-semantropy-compact",
				IPADIC_ARCHIVE.name,
			].sort(),
		);
	}, 600_000);

	it("reuses the verified cache without the archive or the network", async () => {
		const target = path.join(linderaCompactDictionaryDir(root), "dict.words");
		const before = (await stat(target)).mtimeMs;
		fetchCalls = 0;
		const lines: string[] = [];
		const result = await ensureBuildDictionary(root, {
			fetchImpl: unreachable,
			log: (line) => lines.push(line),
			prepare: (() => {
				throw new Error("must not prepare when the cache is verified");
			}),
		});
		expect(result).toEqual({ source: "cache", downloaded: false });
		expect(fetchCalls).toBe(0);
		expect(lines).toEqual([]);
		expect((await stat(target)).mtimeMs).toBe(before);
	});

	it("repairs a corrupted compact file from the cached archive without downloading again", async () => {
		const target = path.join(linderaCompactDictionaryDir(root), "dict.wordsidx");
		const content = Buffer.from(await readFile(target));
		content.writeUInt32LE(content.readUInt32LE(4) + 1, 4);
		await writeFile(target, content);
		expect((await inspectCompactDictionary(linderaCompactDictionaryDir(root))).ok).toBe(false);

		fetchCalls = 0;
		const lines: string[] = [];
		const result = await ensureBuildDictionary(root, {
			fetchImpl: unreachable,
			log: (line) => lines.push(line),
		});
		expect(result).toEqual({ source: "prepared", downloaded: false });
		expect(fetchCalls).toBe(0);
		expect(lines.join("\n")).toMatch(/cache does not match the pinned hashes[\s\S]*no download/);
		expect((await inspectCompactDictionary(linderaCompactDictionaryDir(root))).ok).toBe(true);
	}, 600_000);
});

describe("failures never publish or damage anything", () => {
	it("keeps the extracted cache and refuses to build when the network is down and the archive is gone", async () => {
		const compactDir = linderaCompactDictionaryDir(root);
		const target = path.join(compactDir, "dict.words");
		const content = Buffer.from(await readFile(target));
		content[0] = (content[0] ?? 0) ^ 0xff;
		await writeFile(target, content);
		await rm(linderaArchivePath(root), { force: true });

		fetchCalls = 0;
		await expect(ensureBuildDictionary(root, { fetchImpl: unreachable })).rejects.toThrow(
			/Could not download[\s\S]*network unreachable[\s\S]*no artifact was produced/,
		);
		expect(fetchCalls).toBe(1);
		// The failed run changed nothing: the bad file is still bad (never
		// silently accepted) and the verified full dictionary is untouched.
		expect((await inspectCompactDictionary(compactDir)).ok).toBe(false);
		expect(Buffer.compare(await readFile(target), content)).toBe(0);
		await assertDictionaryHashes(linderaFullDictionaryDir(root), FULL_DICTIONARY_SHA256, "full");
		expect((await readdir(linderaCacheDir(root))).filter((n) => n.includes("partial"))).toEqual([]);
		expect(await stagingLeftovers()).toEqual([]);
	});

	it("rejects an interrupted download and leaves no partial archive", async () => {
		const half = archive.subarray(0, Math.floor(archive.length / 2));
		const interrupted = (async () => {
			fetchCalls += 1;
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array(half));
					controller.error(new Error("connection reset"));
				},
			});
			return new Response(stream);
		}) as unknown as typeof fetch;

		fetchCalls = 0;
		await expect(ensureBuildDictionary(root, { fetchImpl: interrupted })).rejects.toThrow(
			/connection reset/,
		);
		const entries = await readdir(linderaCacheDir(root));
		expect(entries.some((name) => name.endsWith(".zip") || name.endsWith(".partial"))).toBe(false);
	});

	it("does not extract a tampered download", async () => {
		const tampered = Buffer.from(archive);
		tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 0xff;
		const isolated = await mkdtemp(path.join(os.tmpdir(), "semantropy-bootstrap-bad-"));
		try {
			await linkNodeModules(isolated);
			await expect(
				ensureBuildDictionary(isolated, {
					fetchImpl: serving(() => new Uint8Array(tampered)),
				}),
			).rejects.toThrow(/does not match the pinned values.*Nothing was extracted/s);
			expect(await readdir(path.join(isolated, ".cache", "lindera")).catch(() => [])).toEqual([]);
		} finally {
			await removeRoot(isolated);
		}
	}, 600_000);

	it("replaces a corrupted cached archive only after the replacement verifies", async () => {
		await mkdir(linderaCacheDir(root), { recursive: true });
		await writeFile(linderaArchivePath(root), "corrupt");
		fetchCalls = 0;
		const result = await ensureBuildDictionary(root, { fetchImpl: realArchive() });
		expect(result).toEqual({ source: "prepared", downloaded: true });
		expect(fetchCalls).toBe(1);
		expect((await verifyArchive(linderaArchivePath(root))).ok).toBe(true);
		expect((await inspectCompactDictionary(linderaCompactDictionaryDir(root))).ok).toBe(true);
	}, 600_000);
});

/**
 * Review 1: the cache is replaced by moving the old directories aside and the
 * verified ones in, so a failure in that step must put the old ones back.
 * Publishing costs four moves: full aside, full in, compact aside, compact in.
 */
describe("publishing into a cache that is already populated", () => {
	async function expectCacheUnchanged(): Promise<void> {
		await assertDictionaryHashes(linderaFullDictionaryDir(root), FULL_DICTIONARY_SHA256, "full");
		await assertDictionaryHashes(
			linderaCompactDictionaryDir(root),
			COMPACT_DICTIONARY_SHA256,
			"compact",
		);
		expect((await verifyArchive(linderaArchivePath(root))).ok).toBe(true);
		expect(await stagingLeftovers()).toEqual([]);
	}

	for (const failing of [1, 2, 3, 4]) {
		it(`restores the previous cache when publishing move ${failing} fails`, async () => {
			// Populate first, so there is a valid previous cache to lose.
			await prepareDictionary({ rootDir: root, allowDownload: false });
			let calls = 0;
			await expect(
				prepareDictionary({
					rootDir: root,
					allowDownload: false,
					renameImpl: async (from: string, to: string) => {
						calls += 1;
						if (calls === failing) {
							throw new Error(`injected publishing failure ${failing}`);
						}
						await rename(from, to);
					},
				}),
			).rejects.toThrow(`injected publishing failure ${failing}`);
			await expectCacheUnchanged();
		}, 600_000);
	}

	it("restores the previous cache when the published files fail the read-back check", async () => {
		let calls = 0;
		await expect(
			prepareDictionary({
				rootDir: root,
				allowDownload: false,
				renameImpl: async (from: string, to: string) => {
					calls += 1;
					await rename(from, to);
					if (calls === 4) {
						// The compact directory is now in place; damage it.
						await writeFile(path.join(to, "dict.words"), "damaged");
					}
				},
			}),
		).rejects.toThrow(/does not match the hashes pinned/);
		await expectCacheUnchanged();
	}, 600_000);

	it("keeps the only copy of the previous cache, and says where, when the restore fails too", async () => {
		let calls = 0;
		const failure = await prepareDictionary({
			rootDir: root,
			allowDownload: false,
			renameImpl: async (from: string, to: string) => {
				calls += 1;
				// Placing the compact directory fails (4), and so does putting
				// the previous compact directory back (5).
				if (calls === 4 || calls === 5) {
					throw new Error(`injected failure ${calls}`);
				}
				await rename(from, to);
			},
		}).then(
			() => undefined,
			(error: unknown) => error as Error,
		);
		expect(failure?.message).toContain("injected failure 4");
		expect(failure?.message).toContain("previous copy kept at");
		const kept = (await stagingLeftovers()).map((name) => path.join(linderaCacheDir(root), name));
		expect(kept).toHaveLength(1);
		const previous = await readdir(path.join(kept[0] ?? "", "previous"));
		expect(previous).toContain("previous-1");
		// The previous compact dictionary is still intact where the message says.
		await assertDictionaryHashes(
			path.join(kept[0] ?? "", "previous", "previous-1"),
			COMPACT_DICTIONARY_SHA256,
			"kept compact",
		);
		// A later run finds the cache unusable and prepares it again from the archive.
		await ensureBuildDictionary(root, { fetchImpl: unreachable });
		expect((await inspectCompactDictionary(linderaCompactDictionaryDir(root))).ok).toBe(true);
	}, 600_000);
});
