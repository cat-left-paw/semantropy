import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDistribution } from "../../scripts/buildDistribution.mjs";
import {
	createHarnessRecords,
	createObsidianApp,
	createObsidianStub,
} from "../../scripts/obsidianPluginHarness.mjs";

const run = promisify(execFile);
const rootDir = process.cwd();
const artifactDir = path.join("dist", "semantropy-coldload");

/**
 * `scripts/measure-cold-load.mjs` used to carry its own Obsidian stub. When
 * the plugin started subscribing to source events, that stub was not updated
 * and the benchmark began failing with "this.app.workspace.on is not a
 * function" — while the artifact test, which had its own, newer stub, kept
 * passing.
 *
 * Both now use `scripts/obsidianPluginHarness.mjs`. These tests guard the fix
 * from two sides: the stub is checked against what the plugin's lifecycle
 * needs, and the measurement script is actually run.
 */
describe("cold-load benchmark harness", () => {
	beforeAll(async () => {
		await buildDistribution({ rootDir, outDir: artifactDir });
	}, 600_000);

	it("supplies every Obsidian API the plugin's onload calls", () => {
		const records = createHarnessRecords();
		const obsidian = createObsidianStub(records) as {
			Plugin: new (app: unknown, manifest: unknown) => Record<string, unknown>;
		};
		const app = createObsidianApp(records) as {
			workspace: Record<string, unknown>;
			vault: Record<string, unknown>;
		};

		const plugin = new obsidian.Plugin(app, { dir: "plugins/semantropy" });
		for (const method of [
			"addCommand",
			"registerView",
			"registerEvent",
			"loadData",
			"saveData",
		]) {
			expect(typeof plugin[method]).toBe("function");
		}
		for (const method of ["on", "getActiveViewOfType", "getLeavesOfType", "getLeaf"]) {
			expect(typeof app.workspace[method]).toBe("function");
		}
		for (const method of ["on", "getAbstractFileByPath"]) {
			expect(typeof app.vault[method]).toBe("function");
		}
		expect(typeof obsidian).toBe("object");
	});

	it("measures the distribution artifact without throwing, and with no network", async () => {
		const { stdout } = await run(
			process.execPath,
			[
				"--expose-gc",
				path.join(rootDir, "scripts", "measure-cold-load.mjs"),
				rootDir,
				artifactDir,
			],
			{ cwd: rootDir, maxBuffer: 64 * 1024 * 1024 },
		);

		const report = JSON.parse(stdout) as {
			coldLoadMs: number;
			status: string;
			errorCalls: number;
			fetchCalls: number;
			resourcePathCalls: number;
			writeCalls: number;
			hasTestTokenizer: boolean;
			requiredModules: string[];
		};

		expect(report.status).toBe("ready");
		expect(report.hasTestTokenizer).toBe(false);
		expect(report.coldLoadMs).toBeGreaterThan(0);
		expect(report.errorCalls).toBe(0);
		expect(report.fetchCalls).toBe(0);
		expect(report.resourcePathCalls).toBe(0);
		expect(report.writeCalls).toBe(0);
		expect(report.requiredModules).toEqual(["obsidian"]);
	}, 600_000);
});
