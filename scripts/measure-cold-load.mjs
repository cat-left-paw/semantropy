import path from "node:path";
import process from "node:process";
import {
	loadPluginArtifact,
	openHarnessNote,
} from "./obsidianPluginHarness.mjs";

/**
 * Cold-load measurement for the shipped artifact, run in its own Node process
 * so the heap numbers are not polluted by anything else.
 *
 * The measured span covers evaluating `main.js`, loading the plugin and
 * running its own Open command: base64 decode, gzip inflate, WebAssembly
 * instantiation, `loadDictionaryFromBytes`, tokenizer construction, and the
 * first body conversion.
 *
 * It goes through `scripts/obsidianPluginHarness.mjs`, the same stub the
 * artifact tests use, so a plugin lifecycle change can never leave this script
 * behind while the tests still pass.
 */
function collectGarbage() {
	const gc = globalThis.gc;
	if (typeof gc === "function") {
		gc();
	}
}

function snapshot() {
	const usage = process.memoryUsage();
	return { rssBytes: usage.rss, heapUsedBytes: usage.heapUsed };
}

/**
 * Measures the shipped artifact end to end: evaluating `main.js`, loading
 * the plugin and running its own Open command. Nothing else is provided — no
 * dict/ directory, no network, no filesystem — so a number here is also
 * evidence the artifact is self-contained.
 */
async function measureArtifact(rootDir, artifactDir) {
	collectGarbage();
	const beforeEvaluate = snapshot();
	const evaluateStarted = performance.now();
	const loaded = await loadPluginArtifact(path.resolve(rootDir, artifactDir));
	const evaluateMs = performance.now() - evaluateStarted;

	let run;
	let before;
	let after;
	try {
		collectGarbage();
		before = snapshot();
		// The network traps are still installed here, so the lazy tokenizer
		// build this triggers is covered by them.
		run = await openHarnessNote(loaded);
		after = snapshot();
		loaded.plugin.onunload();
	} finally {
		loaded.restore();
	}

	return {
		coldLoadMs: run.elapsedMs,
		artifactEvaluateMs: evaluateMs,
		status: run.status,
		errorCalls: loaded.records.errorCalls.length,
		fetchCalls: loaded.records.fetchCalls.length,
		resourcePathCalls: loaded.records.resourcePathCalls.length,
		writeCalls: loaded.records.writeCalls.length,
		requiredModules: [...new Set(loaded.records.requiredModules)],
		hasTestTokenizer: loaded.records.commands.has("test-tokenizer"),
		before,
		after,
		beforeEvaluate,
	};
}

async function main() {
	const rootDir = process.argv[2] ?? process.cwd();
	const artifactDir = process.argv[3];
	if (!artifactDir) {
		throw new Error(
			"Usage: node scripts/measure-cold-load.mjs <rootDir> <artifactDir>",
		);
	}

	const result = await measureArtifact(rootDir, artifactDir);
	if (result.status !== "ready") {
		throw new Error(`Open did not reach ready: ${result.status}`);
	}

	process.stdout.write(
		JSON.stringify({
			coldLoadMs: Number(result.coldLoadMs.toFixed(2)),
			...(result.artifactEvaluateMs === undefined
				? {}
				: {
						artifactEvaluateMs: Number(result.artifactEvaluateMs.toFixed(2)),
						status: result.status,
						errorCalls: result.errorCalls,
						fetchCalls: result.fetchCalls,
						resourcePathCalls: result.resourcePathCalls,
						writeCalls: result.writeCalls,
						hasTestTokenizer: result.hasTestTokenizer,
						requiredModules: result.requiredModules,
					}),
			rssDeltaBytes: result.after.rssBytes - result.before.rssBytes,
			heapUsedDeltaBytes:
				result.after.heapUsedBytes - result.before.heapUsedBytes,
			rssBeforeBytes: result.before.rssBytes,
			rssAfterBytes: result.after.rssBytes,
			...(result.beforeEvaluate === undefined
				? {}
				: {
						rssBeforeEvaluateBytes: result.beforeEvaluate.rssBytes,
						rssEvaluateDeltaBytes:
							result.before.rssBytes - result.beforeEvaluate.rssBytes,
					}),
			forcedGcAvailable: typeof globalThis.gc === "function",
		}),
	);
}

main().catch((error) => {
	process.stderr.write(String(error instanceof Error ? error.stack : error));
	process.exitCode = 1;
});
