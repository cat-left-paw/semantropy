import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDistribution, buildProductionMain } from "../scripts/buildDistribution.mjs";
import {
	ensureBuildDictionary,
	inspectCompactDictionary,
} from "../scripts/lindera/ensureDictionary.mjs";
import {
	IPADIC_ARCHIVE,
	ensureArchive,
	linderaArchivePath,
	linderaCacheDir,
	verifyArchive,
} from "../scripts/lindera/linderaSource.mjs";

/**
 * PRE-RELEASE-BUILD-BOOTSTRAP1, network-free half. Nothing here reaches the
 * network or needs the prepared dictionary: downloads are served by an injected
 * `fetch`, and the pinned values are never weakened, so no fake body can
 * verify. The real archive, extraction and compaction run in
 * tests/distribution/buildBootstrap.test.ts.
 */

let scratch: string;

beforeEach(async () => {
	scratch = await mkdtemp(path.join(os.tmpdir(), "semantropy-bootstrap-"));
});

afterEach(async () => {
	await rm(scratch, { recursive: true, force: true });
});

function responding(body: Uint8Array | string, init?: ResponseInit): typeof fetch {
	return vi.fn(async () => new Response(body as BodyInit, init));
}

async function cacheEntries(): Promise<string[]> {
	try {
		return await readdir(linderaCacheDir(scratch));
	} catch {
		return [];
	}
}

describe("archive download", () => {
	it("never downloads unless the caller allows it", async () => {
		const fetchImpl = responding("unused");
		await expect(ensureArchive(scratch, { fetchImpl })).rejects.toThrow(
			/npm run prepare:dictionary/,
		);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("requests exactly the pinned URL", async () => {
		const fetchImpl = responding("x");
		await expect(
			ensureArchive(scratch, { allowDownload: true, fetchImpl }),
		).rejects.toThrow();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe(IPADIC_ARCHIVE.url);
	});

	it("rejects a body that is not the pinned archive and leaves no cache entry", async () => {
		const body = Buffer.alloc(IPADIC_ARCHIVE.bytes, 7);
		await expect(
			ensureArchive(scratch, { allowDownload: true, fetchImpl: responding(body) }),
		).rejects.toThrow(/does not match the pinned values.*Nothing was extracted/s);
		expect(await cacheEntries()).toEqual([]);
	});

	it("rejects a short body", async () => {
		await expect(
			ensureArchive(scratch, {
				allowDownload: true,
				fetchImpl: responding(Buffer.alloc(1024)),
			}),
		).rejects.toThrow(/expected 10519550 bytes, got 1024/);
		expect(await cacheEntries()).toEqual([]);
	});

	it("refuses a response larger than the pinned archive without buffering it whole", async () => {
		await expect(
			ensureArchive(scratch, {
				allowDownload: true,
				fetchImpl: responding(Buffer.alloc(IPADIC_ARCHIVE.bytes + 1)),
			}),
		).rejects.toThrow(/larger than the pinned archive/);
		expect(await cacheEntries()).toEqual([]);
	});

	it("names the URL, the offline path and that nothing was produced when the network fails", async () => {
		const fetchImpl = vi.fn(async () => {
			throw Object.assign(new TypeError("fetch failed"), {
				cause: new Error("getaddrinfo ENOTFOUND github.com"),
			});
		}) as unknown as typeof fetch;
		const failure = await ensureArchive(scratch, { allowDownload: true, fetchImpl }).then(
			() => undefined,
			(error: unknown) => (error instanceof Error ? error.message : String(error)),
		);
		expect(failure).toContain(IPADIC_ARCHIVE.url);
		expect(failure).toContain("ENOTFOUND");
		expect(failure).toContain("no artifact was produced");
		expect(failure).toContain(`.cache/lindera/${IPADIC_ARCHIVE.name}`);
		expect(await cacheEntries()).toEqual([]);
	});

	it("reports an HTTP error without touching the cache", async () => {
		await expect(
			ensureArchive(scratch, {
				allowDownload: true,
				fetchImpl: responding("gone", { status: 404, statusText: "Not Found" }),
			}),
		).rejects.toThrow(/HTTP 404/);
		expect(await cacheEntries()).toEqual([]);
	});

	it("keeps an unusable cached archive as it was when the replacement fails", async () => {
		const archivePath = linderaArchivePath(scratch);
		await mkdir(path.dirname(archivePath), { recursive: true });
		await writeFile(archivePath, "corrupt");
		const failing = vi.fn(async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof fetch;
		await expect(
			ensureArchive(scratch, { allowDownload: true, fetchImpl: failing }),
		).rejects.toThrow(/Could not download/);
		expect(await readFile(archivePath, "utf8")).toBe("corrupt");
		expect((await verifyArchive(archivePath)).ok).toBe(false);
	});
});

describe("dictionary bootstrap", () => {
	it("treats a missing compact dictionary as unusable without throwing", async () => {
		const result = await inspectCompactDictionary(path.join(scratch, "nope"));
		expect(result.ok).toBe(false);
	});

	it("prepares once, with downloads allowed, when the cache is missing", async () => {
		const prepare = vi.fn(async () => ({
			archive: { reusedCache: false, url: IPADIC_ARCHIVE.url, bytes: 1, sha256: "x" },
		}));
		const lines: string[] = [];
		const result = await ensureBuildDictionary(scratch, {
			prepare: prepare as never,
			log: (line) => lines.push(line),
		});
		expect(prepare).toHaveBeenCalledTimes(1);
		expect(prepare.mock.calls[0]).toEqual([
			{ rootDir: scratch, allowDownload: true, fetchImpl: undefined },
		]);
		expect(result).toEqual({ source: "prepared", downloaded: true });
		expect(lines.join("\n")).toMatch(/cache is missing or incomplete[\s\S]*Downloaded and verified/);
	});

	it("says so when the cached archive was reused", async () => {
		const lines: string[] = [];
		const result = await ensureBuildDictionary(scratch, {
			prepare: (async () => ({
				archive: { reusedCache: true, url: IPADIC_ARCHIVE.url, bytes: 1, sha256: "x" },
			})) as never,
			log: (line) => lines.push(line),
		});
		expect(result).toEqual({ source: "prepared", downloaded: false });
		expect(lines.join("\n")).toMatch(/no download/);
	});

	it("does not swallow a failed preparation", async () => {
		await expect(
			ensureBuildDictionary(scratch, {
				prepare: (async () => {
					throw new Error("prepare failed");
				}),
			}),
		).rejects.toThrow("prepare failed");
	});
});

describe("build entry points", () => {
	it("checks the generated inputs before any preparation, so a bad input never reaches the network", async () => {
		const prepare = vi.fn();
		const dictionaryBootstrap = { prepare: prepare as never };
		await expect(
			buildProductionMain({
				rootDir: scratch,
				outfile: path.join(scratch, "main.js"),
				dictionaryBootstrap,
			}),
		).rejects.toThrow();
		await expect(
			buildDistribution({
				rootDir: scratch,
				outDir: path.join(scratch, "out"),
				dictionaryBootstrap,
			}),
		).rejects.toThrow();
		expect(prepare).not.toHaveBeenCalled();
		expect(await readdir(scratch)).toEqual([]);
	});

	it("refuses to combine bootstrap with an explicit dictionary directory", async () => {
		await expect(
			buildProductionMain({
				rootDir: scratch,
				dictionaryDir: path.join(scratch, "dictionary"),
				dictionaryBootstrap: {},
			}),
		).rejects.toThrow(/cannot be combined with dictionaryDir/);
	});

	it("does not bootstrap unless asked, and then names the explicit command", async () => {
		await expect(
			buildProductionMain({ rootDir: process.cwd(), dictionaryDir: path.join(scratch, "absent") }),
		).rejects.toThrow(/npm run prepare:dictionary/);
	});
});
