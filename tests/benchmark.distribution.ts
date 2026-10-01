import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDistribution } from "../scripts/buildDistribution.mjs";
import { inspectArtifact } from "../scripts/inspectArtifact.mjs";
import { generateLinderaPayloadModule } from "../scripts/lindera/linderaPayload.mjs";
import {
	linderaCompactDictionaryDir,
	linderaFullDictionaryDir,
	measureDictionaryDir,
} from "../scripts/lindera/linderaSource.mjs";
import { analyzeNoteTexts } from "../src/application/analyzeNoteTexts";
import { transformTokenSequences } from "../src/transform/transformTokens";
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { MAX } from "./readyAnalysis";
import { LONG_20K, LONG_2K, TEXT_NODE_SEQUENCE } from "./distribution/fixtures";
import {
	buildTokenize,
	compactDictionaryDir,
	fullDictionaryDir,
	initLindera,
} from "./distribution/linderaFixture";

const rootDir = process.cwd();
const artifactDir = path.join("dist", "semantropy-benchmark");

/** Cold load is measured several times so the report can carry a median. */
const COLD_LOAD_RUNS = 3;
const RESHUFFLE_RUNS = 5;
const WARM_RUNS = 5;

/** One `record(...)` entry from scripts/measure-lindera-memory.mjs. */
type MemoryPath = {
	label: string;
	firstBuildBytes: number;
	growthPerExtraBuildBytes: number;
};

/** Retired hard limit, retained only so reports remain comparable to history. */
const RETIRED_MAIN_JS_REFERENCE_BYTES = 13_500_000;
/** Performance budgets remain product gates after the size hard limit retired. */
const COLD_LOAD_BUDGET_MS = 3_000;
const LONG_ANALYSIS_BUDGET_MS = 1_000;

function median(values: number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
	}
	return sorted[middle] ?? 0;
}

function round(value: number): number {
	return Number(value.toFixed(2));
}

function summarize(samples: number[]): Record<string, unknown> {
	return {
		samples: samples.map(round),
		medianMs: round(median(samples)),
		minMs: round(Math.min(...samples)),
		maxMs: round(Math.max(...samples)),
	};
}

async function directoryBytes(dir: string): Promise<number> {
	const entries = await readdir(dir, { withFileTypes: true });
	let total = 0;
	for (const entry of entries) {
		if (entry.isFile()) {
			total += (await stat(path.join(dir, entry.name))).size;
		}
	}
	return total;
}

/**
 * Each cold load runs in its own `node --expose-gc` process, so one run's heap
 * never pollutes the next. The measured span covers evaluating the artifact
 * and then everything Open triggers: base64 decode, gzip inflate, WebAssembly
 * instantiation, `loadDictionaryFromBytes`, tokenizer construction, and the
 * first body conversion.
 */
function measureColdLoad(): Record<string, unknown> {
	const output = execFileSync(
		process.execPath,
		[
			"--expose-gc",
			path.join(rootDir, "scripts", "measure-cold-load.mjs"),
			rootDir,
			artifactDir,
		],
		{ cwd: rootDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	return JSON.parse(output) as Record<string, unknown>;
}

function repeatColdLoad(): Record<string, unknown> {
	const runs: Record<string, unknown>[] = [];
	for (let run = 0; run < COLD_LOAD_RUNS; run += 1) {
		runs.push(measureColdLoad());
	}
	const value = (key: string) => runs.map((entry) => Number(entry[key] ?? 0));

	return {
		runs,
		artifactEvaluate: summarize(value("artifactEvaluateMs")),
		coldLoad: summarize(value("coldLoadMs")),
		rssDeltaBytesMedian: Math.round(median(value("rssDeltaBytes"))),
		heapUsedDeltaBytesMedian: Math.round(median(value("heapUsedDeltaBytes"))),
		rssAfterBytesMedian: Math.round(median(value("rssAfterBytes"))),
		rssEvaluateDeltaBytesMedian: Math.round(
			median(value("rssEvaluateDeltaBytes")),
		),
	};
}

/**
 * Warm throughput: the dictionary is already built, so this measures analysis
 * and the body transform only.
 */
async function measureThroughput(
	tokenize: (text: string) => Promise<JapaneseToken[]>,
): Promise<Record<string, unknown>> {
	await tokenize("太郎は駅で花子を待っていた。");

	const results: Record<string, unknown> = {};
	for (const [label, texts] of [
		["chars2000", [LONG_2K]],
		["chars20000", [LONG_20K]],
		["textNodes", [...TEXT_NODE_SEQUENCE]],
	] as [string, string[]][]) {
		const firstAnalysis: number[] = [];
		let analyzed = await analyzeNoteTexts(texts, tokenize);
		for (let run = 0; run < WARM_RUNS; run += 1) {
			const started = performance.now();
			analyzed = await analyzeNoteTexts(texts, tokenize);
			firstAnalysis.push(performance.now() - started);
		}

		const reshuffle: number[] = [];
		for (let run = 0; run < RESHUFFLE_RUNS; run += 1) {
			const started = performance.now();
			transformTokenSequences(analyzed.tokenSequences, analyzed.pool, run + 1, MAX);
			reshuffle.push(performance.now() - started);
		}

		results[label] = {
			inputChars: texts.join("").length,
			sequenceCount: texts.length,
			tokenCount: analyzed.tokenSequences.reduce(
				(sum, sequence) => sum + sequence.length,
				0,
			),
			analysis: summarize(firstAnalysis),
			reshuffle: summarize(reshuffle),
		};
	}
	return results;
}

describe("distribution benchmark", () => {
	// The artifact is rebuilt here rather than assumed: measuring a stale
	// bundle would silently report the wrong build, and a clean clone has none.
	beforeAll(async () => {
		await buildDistribution({ rootDir, outDir: artifactDir });
		await initLindera();
	}, 600_000);

	it(
		"measures the shipped artifact against the product budgets",
		async () => {
			const main = await stat(path.join(rootDir, artifactDir, "main.js"));
			const inspection = await inspectArtifact(path.join(rootDir, artifactDir), rootDir);
			// Provisional UI-scope cap, raised to 600,000 at EXPERIENCE-LOCALE1 (see artifact.test.ts).
			expect(inspection.maskedCodeBytes).toBeLessThan(650_000);
			const fullDictionary = await measureDictionaryDir(
				linderaFullDictionaryDir(rootDir),
			);
			const compactDictionary = await measureDictionaryDir(
				linderaCompactDictionaryDir(rootDir),
			);
			const payload = await generateLinderaPayloadModule(
				rootDir,
				compactDictionaryDir(),
			);

			const full = buildTokenize(fullDictionaryDir());
			const compact = buildTokenize(compactDictionaryDir());

			const report = {
				measuredIn: "Node (vitest), not Obsidian",
				scope:
					"artifact evaluate + cold tokenizer build + tokenize + pool build + transformTokenSequences; MarkdownRenderer is not measured",
				runtime: {
					platform: process.platform,
					arch: process.arch,
					node: process.version,
					osRelease: os.release(),
					cpus: os.cpus().length,
					totalMemoryBytes: os.totalmem(),
				},
				size: {
					maskedCodeBytes: inspection.maskedCodeBytes,
					maskedProvisionalLimitBytes: 650_000,
					maskedBaselineDelta: inspection.maskedCodeBytes - 290_908,
					mainJsBytes: main.size,
					retiredReferenceBytes: RETIRED_MAIN_JS_REFERENCE_BYTES,
					shareOfRetiredReference: round(
						(main.size / RETIRED_MAIN_JS_REFERENCE_BYTES) * 100,
					),
					artifactTotalBytes: await directoryBytes(
						path.join(rootDir, artifactDir),
					),
					runtimeDictionaryAssetBytes: 0,
					fullDictionaryBytes: fullDictionary.totalBytes,
					compactDictionaryBytes: compactDictionary.totalBytes,
					embeddedPayload: {
						wasm: payload.wasm,
						dictionary: payload.dictionary,
						gzipTotalBytes:
							payload.wasm.gzipBytes +
							payload.dictionary.reduce(
								(sum, entry) => sum + entry.gzipBytes,
								0,
							),
					},
				},
				coldLoad: repeatColdLoad(),
				throughput: {
					// Both dictionaries over the same fixtures, so compaction's
					// cost is visible rather than inferred.
					linderaFull: await measureThroughput(async (text) => full(text)),
					linderaCompact: await measureThroughput(async (text) =>
						compact(text),
					),
				},
			};

			process.stdout.write(
				`\n[semantropy benchmark:distribution]\n${JSON.stringify(report, null, 2)}\n`,
			);

			expect(
				Number((report.coldLoad.coldLoad as { medianMs: number }).medianMs),
			).toBeLessThan(COLD_LOAD_BUDGET_MS);
			expect(
				Number(
					(
						report.throughput.linderaCompact["chars20000"] as {
							analysis: { medianMs: number };
						}
					).analysis.medianMs,
				),
			).toBeLessThan(LONG_ANALYSIS_BUDGET_MS);
		},
		600_000,
	);

	/**
	 * Building a tokenizer through `TokenizerBuilder` does not release the
	 * dictionary it consumed, even after `Tokenizer.free()` and
	 * `TokenizerBuilder.free()`. Constructing `Tokenizer` directly does release
	 * it, and that is the whole reason the product build constructs it
	 * directly — so zero repeated growth on the production path is a gate here,
	 * not just a number in a report.
	 *
	 * The builder's own figure is recorded rather than asserted: it is upstream
	 * behaviour in lindera-wasm 6.0.0 and nothing here can fix it. It is kept
	 * so the comparison that justified the decision stays visible.
	 */
	it(
		"holds the production tokenizer path at zero repeated WebAssembly growth",
		() => {
			const output = execFileSync(
				process.execPath,
				[
					"--expose-gc",
					path.join(rootDir, "scripts", "measure-lindera-memory.mjs"),
					rootDir,
				],
				{ cwd: rootDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
			);
			const report = JSON.parse(output) as {
				rounds: number;
				dictionaryOnly: MemoryPath;
				constructorPath: MemoryPath;
				builderPath: MemoryPath;
			};
			process.stdout.write(
				`\n[semantropy benchmark:lindera-memory]\n${JSON.stringify(report, null, 2)}\n`,
			);

			// Enough rebuilds for growth per rebuild to be measurable at all.
			expect(report.rounds).toBeGreaterThanOrEqual(3);

			// The production path: `new Tokenizer(dictionary, mode, undefined)`.
			expect(report.constructorPath.growthPerExtraBuildBytes).toBe(0);
			// Releasing the dictionary directly, which isolates the leak to the
			// builder rather than to the dictionary.
			expect(report.dictionaryOnly.growthPerExtraBuildBytes).toBe(0);
			// Both must still be doing real work, or zero growth is vacuous.
			expect(report.constructorPath.firstBuildBytes).toBeGreaterThan(
				10_000_000,
			);
			expect(report.dictionaryOnly.firstBuildBytes).toBeGreaterThan(
				10_000_000,
			);

			// Recorded, not asserted: the builder path is upstream behaviour.
			expect(
				report.builderPath.growthPerExtraBuildBytes,
			).toBeGreaterThanOrEqual(0);
		},
		600_000,
	);

	it("keeps the banner and the three files in the measured artifact", async () => {
		const files = await readdir(path.join(rootDir, artifactDir));
		expect([...files].sort()).toEqual([
			"main.js",
			"manifest.json",
			"styles.css",
		]);
		const main = await readFile(
			path.join(rootDir, artifactDir, "main.js"),
			"utf8",
		);
		expect(main.startsWith("/*")).toBe(true);
	});
});
