import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";

const temporaryRoot = realpathSync(tmpdir());
const sourceRelative = "src/collision/collisionBatch.ts";
const scriptRelative = "scripts/collision/verifyBatchMutations.mjs";

/** Only our immediate mkdtemp children; never delete a checkout or follow a link. */
function removeTemporary(directory: string, prefix: string) {
	if (dirname(directory) !== temporaryRoot || !basename(directory).startsWith(prefix) ||
		lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) {
		throw new Error("Unexpected temporary directory");
	}
	rmSync(directory, { recursive: true, force: true });
}

function fixture(mode: "normal" | "edit" | "kill", view: boolean) {
	const directory = realpathSync(mkdtempSync(join(temporaryRoot, "semantropy-mutation-script-test-")));
	const testedSource = view ? "src/view/CollisionSession.ts" : sourceRelative;
	const original = readFileSync(testedSource);
	const source = join(directory, testedSource);
	const script = join(directory, scriptRelative);
	const report = join(directory, "runner-report.json");
	for (const name of ["src/collision", "scripts/collision", "tests", "node_modules/vitest"]) {
		mkdirSync(join(directory, name), { recursive: true });
	}
	mkdirSync(dirname(source), { recursive: true });
	writeFileSync(source, original);
	writeFileSync(script, readFileSync(scriptRelative));
	if (view) {
		writeFileSync(join(directory, "scripts/collision/viewMutations.mjs"), readFileSync("scripts/collision/viewMutations.mjs"));
		for (const file of ["src/view/CollisionSession.ts", "src/view/CollisionModal.ts", "src/view/SemantropyToolbar.ts", "src/SemantropyPlugin.ts"]) {
			mkdirSync(dirname(join(directory, file)), { recursive: true });
			writeFileSync(join(directory, file), readFileSync(file));
		}
	}
	for (const name of ["package.json", "tsconfig.json", "vitest.config.ts", "scripts/vitestAliases.mjs"]) {
		writeFileSync(join(directory, name), name.endsWith(".json") ? "{}" : "export {};\n");
	}
	// A fake test executable checks filesystem isolation only. The real 21/10
	// mutation assertions are exercised separately by the actual script run.
	const runner = join(directory, "node_modules/vitest/vitest.mjs");
	writeFileSync(runner, `
import { existsSync, writeFileSync } from "node:fs";
const report = ${JSON.stringify(report)};
const source = ${JSON.stringify(source)};
const mode = ${JSON.stringify(mode)};
if (!existsSync(report)) {
  if (mode !== "normal") writeFileSync(source, "concurrent editor bytes");
  writeFileSync(report, JSON.stringify({ directory: process.cwd() }));
}
if (mode === "kill") {
  setInterval(() => {}, 1000);
} else {
  const title = process.argv[process.argv.indexOf("-t") + 1];
  process.stdout.write(JSON.stringify({ testResults: [{ assertionResults: [{ status: "failed", title }] }] }));
  process.exitCode = 1;
}
`);
	return { directory, source, script, report, runner, original };
}

function start(script: string, directory: string, view: boolean) {
	const child = spawn(process.execPath, [script, ...(view ? ["--view"] : [])], {
		cwd: directory, windowsHide: true, detached: process.platform !== "win32",
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
	child.stderr.on("data", (data: Buffer) => { output += data.toString(); });
	const finished = new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", resolve);
	});
	return { child, finished, output: () => output };
}

function terminateTree(child: ChildProcess) {
	if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
	// Only the PID/process group this test spawned, including its fake runner.
	if (process.platform === "win32") {
		execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
	} else {
		process.kill(-child.pid, "SIGKILL");
	}
}

describe.each([false, true])("Collision mutation script checkout isolation (view: %s)", view => {
	it.each(["normal", "edit", "kill"] as const)("preserves the checkout during %s", async (mode) => {
		const fixtureCopy = fixture(mode, view);
		const before = statSync(fixtureCopy.source, { bigint: true });
		const task = start(fixtureCopy.script, fixtureCopy.directory, view);
		let scratch: string | undefined;
		try {
			if (mode === "kill") {
				const deadline = Date.now() + 10000;
				while (!existsSync(fixtureCopy.report) && Date.now() < deadline) await delay(20);
				expect(existsSync(fixtureCopy.report), task.output()).toBe(true);
				const running = JSON.parse(readFileSync(fixtureCopy.report, "utf8")) as { directory: string };
				const mutated = view ? "src/view/CollisionSession.ts" : sourceRelative;
				// Check before termination: Windows taskkill can kill the runner
				// first, allowing its parent to clean up before it too is killed.
				expect(readFileSync(join(running.directory, mutated))).not.toEqual(readFileSync(mutated));
				terminateTree(task.child);
				await task.finished;
			} else {
				expect(await task.finished, task.output()).toBe(0);
				expect(task.output()).toContain(`"caught":${view ? 10 : 21},"isolation":"temporary-copy"`);
			}
			const report = JSON.parse(readFileSync(fixtureCopy.report, "utf8")) as { directory: string };
			scratch = report.directory;
			expect(dirname(scratch)).toBe(temporaryRoot);
			expect(basename(scratch)).toMatch(/^semantropy-batch-mutations-/u);
			expect(scratch).not.toBe(fixtureCopy.directory);
			if (mode === "normal") {
				expect(readFileSync(fixtureCopy.source)).toEqual(fixtureCopy.original);
				expect(statSync(fixtureCopy.source, { bigint: true }).mtimeNs).toBe(before.mtimeNs);
			} else {
				expect(readFileSync(fixtureCopy.source, "utf8")).toBe("concurrent editor bytes");
			}
			expect(existsSync(fixtureCopy.runner)).toBe(true);
			// Normal cleanup is required. Forced termination may leave the temp
			// copy or permit cleanup, but must never restore over the checkout.
			if (mode !== "kill") expect(existsSync(scratch)).toBe(false);
			if (mode === "kill" && existsSync(scratch)) {
				const mutated = view ? "src/view/CollisionSession.ts" : sourceRelative;
				expect(readFileSync(join(scratch, mutated))).not.toEqual(readFileSync(mutated));
			}
		} finally {
			terminateTree(task.child);
			await task.finished;
			if (scratch && existsSync(scratch)) removeTemporary(scratch, "semantropy-batch-mutations-");
			removeTemporary(fixtureCopy.directory, "semantropy-mutation-script-test-");
		}
	}, 20000);
});
