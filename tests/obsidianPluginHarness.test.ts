import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	loadPluginArtifact,
	OPEN_COMMAND_ID,
	runCommandUntilNotice,
} from "../scripts/obsidianPluginHarness.mjs";

/**
 * The harness itself, tested against deliberately misbehaving artifacts.
 *
 * The real artifact tests can only ever show that a well-behaved bundle makes
 * no network call. That is not evidence the harness would notice a bad one —
 * and it did not: the traps used to be lifted at the end of `onload`, while
 * every tokenizer here initializes lazily, on the first tokenize request, from
 * an asynchronous Open. A bundle that fetched from inside that callback passed
 * the check silently.
 *
 * These fixtures close that gap by fetching exactly where a real dictionary
 * download would happen.
 */

const rootDir = process.cwd();
const fixtureRoot = path.join(rootDir, "dist", "harness-fixture");

/**
 * A minimal plugin bundle in the shape the real ones have: CJS, `require`s
 * only `obsidian`, registers an `open` command, and answers with an
 * `Open …` notice. `body` is spliced into the command's asynchronous
 * callback, which is where the lazy tokenizer build would run.
 */
function fakeArtifact(body: string): string {
	return `
"use strict";
const obsidian = require("obsidian");
class FakePlugin extends obsidian.Plugin {
	async onload() {
		this.addCommand({
			id: "open",
			name: "Open",
			callback: () => {
				void (async () => {
					// A real build reaches its dictionary here, not in onload.
					await Promise.resolve();
					try {
${body}
					} catch (error) {
						console.error("[fake] initialization failed", error);
					}
					new obsidian.Notice("Open complete.");
				})();
			},
		});
	}
	onunload() {}
}
module.exports.default = FakePlugin;
`;
}

async function writeArtifact(name: string, body: string): Promise<string> {
	const dir = path.join(fixtureRoot, name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "main.js"), fakeArtifact(body));
	return dir;
}

let quiet: string;
let asyncFetch: string;
let asyncXhr: string;
let loadTimeFetch: string;

beforeAll(async () => {
	quiet = await writeArtifact("quiet", "						void 0;");
	asyncFetch = await writeArtifact(
		"async-fetch",
		'						await fetch("https://example.invalid/dictionary.zip");',
	);
	asyncXhr = await writeArtifact(
		"async-xhr",
		"						new XMLHttpRequest();",
	);
	loadTimeFetch = await writeArtifact("load-time-fetch", "						void 0;");
	// This one fetches during onload instead, to show both windows are covered.
	await writeFile(
		path.join(loadTimeFetch, "main.js"),
		`
"use strict";
const obsidian = require("obsidian");
class FakePlugin extends obsidian.Plugin {
	async onload() {
		try {
			await fetch("https://example.invalid/at-load.zip");
		} catch (error) {
			console.error("[fake] load failed", error);
		}
	}
	onunload() {}
}
module.exports.default = FakePlugin;
`,
	);
});

afterAll(async () => {
	await rm(fixtureRoot, { recursive: true, force: true });
});

describe("network traps cover lazy initialization", () => {
	it("records a fetch made from the command's asynchronous callback", async () => {
		const loaded = await loadPluginArtifact(asyncFetch);
		try {
			// The trap must still be installed here: nothing has been fetched
			// yet at this point in a real artifact either.
			const run = await runCommandUntilNotice(loaded, OPEN_COMMAND_ID, "Open", {
				timeoutMs: 10_000,
			});
			expect(run.notice).toMatch(/^Open/);
			expect(loaded.records.fetchCalls).toEqual([
				"https://example.invalid/dictionary.zip",
			]);
		} finally {
			loaded.plugin.onunload();
			loaded.restore();
		}
	});

	it("records an XMLHttpRequest made from the command's asynchronous callback", async () => {
		const loaded = await loadPluginArtifact(asyncXhr);
		try {
			await runCommandUntilNotice(loaded, OPEN_COMMAND_ID, "Open", {
				timeoutMs: 10_000,
			});
			expect(loaded.records.fetchCalls).toEqual(["XMLHttpRequest"]);
		} finally {
			loaded.plugin.onunload();
			loaded.restore();
		}
	});

	it("still records a fetch made during onload", async () => {
		const loaded = await loadPluginArtifact(loadTimeFetch);
		try {
			expect(loaded.records.fetchCalls).toEqual([
				"https://example.invalid/at-load.zip",
			]);
		} finally {
			loaded.plugin.onunload();
			loaded.restore();
		}
	});

	it("records nothing for an artifact that makes no request", async () => {
		const loaded = await loadPluginArtifact(quiet);
		try {
			const run = await runCommandUntilNotice(loaded, OPEN_COMMAND_ID, "Open", {
				timeoutMs: 10_000,
			});
			expect(run.notice).toMatch(/^Open/);
			expect(loaded.records.fetchCalls).toEqual([]);
			expect(loaded.records.errorCalls).toEqual([]);
		} finally {
			loaded.plugin.onunload();
			loaded.restore();
		}
	});

	it("keeps the traps installed until restore, and restores exactly once", async () => {
		const before = globalThis.fetch;
		const loaded = await loadPluginArtifact(quiet);

		// Still trapped after onload resolved — this is the window the earlier
		// harness left uncovered.
		expect(globalThis.fetch).not.toBe(before);
		await runCommandUntilNotice(loaded, OPEN_COMMAND_ID, "Open", {
			timeoutMs: 10_000,
		});
		expect(globalThis.fetch).not.toBe(before);

		loaded.plugin.onunload();
		loaded.restore();
		expect(globalThis.fetch).toBe(before);

		// A second call must not reinstate anything or clobber a later trap.
		loaded.restore();
		expect(globalThis.fetch).toBe(before);
	});

	it("restores the traps when loading throws", async () => {
		const before = globalThis.fetch;
		const broken = path.join(fixtureRoot, "broken");
		await mkdir(broken, { recursive: true });
		await writeFile(
			path.join(broken, "main.js"),
			'"use strict";\nmodule.exports.default = 42;\n',
		);

		await expect(loadPluginArtifact(broken)).rejects.toThrow(
			/did not export a default plugin class/,
		);
		expect(globalThis.fetch).toBe(before);
	});

	it("refuses any require other than obsidian, and records what was asked for", async () => {
		const needsFs = path.join(fixtureRoot, "needs-fs");
		await mkdir(needsFs, { recursive: true });
		await writeFile(
			path.join(needsFs, "main.js"),
			'"use strict";\nrequire("node:fs");\n',
		);

		await expect(loadPluginArtifact(needsFs)).rejects.toThrow(
			/Unexpected runtime require: node:fs/,
		);
	});
});
