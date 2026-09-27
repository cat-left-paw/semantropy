/** Development-only probes in a private temporary copy. The checkout is read
 * only: neither normal cleanup nor forced termination can restore over edits.
 * Never imported by production.
 */
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
// VIEW1 reuses the same isolated runner; no checkout-source restoration path.
const viewMode = process.argv.includes("--view");
const mutations = [
	["owner-authentication", "if (!isManualMorphVocabulary(vocabulary))", "if (false)", "refuses raw/cloned vocabulary"],
	["zero-result-commit", 'if (generated.draft.generatedCount === 0) reject(generated.draft.shortfallReason ?? "invalid-state");', "", "does not commit zero-result"],
	["generate-supersession", "operations.clear();\n\t\t\t\toperations.set(op.ticket, op);", "operations.set(op.ticket, op);", "supersedes older generate"],
	["row-supersession", "if (op.row?.rowSlotId === rowSlotId) operations.delete(ticket);", "if (false) operations.delete(ticket);", "supersedes older regenerate"],
	["cancel-ticket", "operations.delete(op.ticket);", "// mutation: retained ticket", "cancels regenerate"],
	["completion-binding", "op.completion !== completion", "false", "does not confuse different rows"],
	["close-release", 'close: () => transition(() => release("closed")),', "close: () => transition(() => state),", "close releases captured state"],
	["selectable-policy", 'if (!declared.selectable) reject("recipe-not-selectable");', "", "never falls back from fixed hidden"],
	["same-pattern", 'selector.kind === "same" ? row.committed.recipeId : selector.recipeId', 'selector.kind === "same" ? "absent" : selector.recipeId', "regenerates Random's hidden actual recipe"],
	["concurrent-duplicate", 'if (batch.rows.some((row) => row.committed.text === result.text)) reject("duplicate-exhausted");', "", "rejects a concurrent row completion"],
	["target-only", "batch.rows.map((old) => old === op.row ? row : old)", "batch.rows.map(() => row)", "changes only the selector draft"],
	["result-identity", 'const rowId = identity(op, "row", 0);', "const rowId = op.row.committed.rowId;", "changes only the selector draft"],
	["revision-guard", "generationRevision: advance(op.row.committed.generationRevision)", "generationRevision: op.row.committed.generationRevision + 1", "rolls back the whole row commit"],
	["batch-authentication", 'if (!BATCHES.has(batch)) reject("invalid-state");', "", "rejects forged batch state"],
	["identity-collision", 'fresh.some((id) => issued.has(id))', "false", "rejects an identity already issued"],
	["state-freeze", "state = freezeAnalysis(next);", "state = next;", "commits all 10 Random rows"],
	["collect-actual", "patternId: row.committed.recipeId", 'patternId: "requested"', "keeps only the fixed Collect fields"],
	["avoid-context", "texts: op.batch.rows.map((row) => row.committed.text)", "texts: []", "changes only the selector draft"],
	["signature-context", "recentSignatures: op.batch.rows.slice(Math.max(0, index - 2), index).map((row) => row.committed.structureSignature)", "recentSignatures: []", "passes the preceding two structure signatures"],
	["reentrant-transition", 'if (transitioning) reject("busy");', "", "refuses reentrant lifecycle transitions"],
	["hidden-mutable-pattern", "if (Object.getOwnPropertySymbols(value).length !== 0) return false;", "", "refuses hidden mutable Symbol payloads"],
];

const evidence = [];
const probes = viewMode ? (await import("./viewMutations.mjs")).viewMutations : mutations.map(probe =>
	["src/collision/collisionBatch.ts", "tests/collisionBatch.test.ts", ...probe]);
let failure = null;
function removeMutationDirectory(directory) {
	if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) {
		throw new Error("Mutation directory identity changed");
	}
	rmSync(directory, { recursive: true, force: true });
}
const temporaryRoot = realpathSync(tmpdir());
const directory = realpathSync(mkdtempSync(join(temporaryRoot, "semantropy-batch-mutations-")));
const fromCheckout = relative(root, directory);
// Check the resolved deletion/mutation boundary before copying or writing.
if (dirname(directory) !== temporaryRoot || !basename(directory).startsWith("semantropy-batch-mutations-") ||
	(!isAbsolute(fromCheckout) && fromCheckout !== ".." && !fromCheckout.startsWith(`..${sep}`))) {
	throw new Error("Mutation directory must be outside the checkout");
}
try {
	// Regular copies, never source hardlinks/junctions. No .git, settings, Vault
	// data, dictionary preparation, builds or private history are needed.
	for (const entry of ["src", "tests", "package.json", "tsconfig.json", "vitest.config.ts", "scripts/vitestAliases.mjs"]) {
		const destination = join(directory, entry);
		mkdirSync(dirname(destination), { recursive: true });
		cpSync(join(root, entry), destination, { recursive: true, dereference: true });
	}
	// Reuse installed packages, but keep node_modules itself local so Vite's
	// .vite / .vite-temp caches cannot follow a junction into the checkout.
	const dependencies = join(directory, "node_modules");
	mkdirSync(dependencies);
	for (const entry of readdirSync(join(root, "node_modules"), { withFileTypes: true })) {
		if (!entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) {
			symlinkSync(join(root, "node_modules", entry.name), join(dependencies, entry.name), "junction");
		}
	}
	for (const [sourceFile, testFile, name, before, after, testName] of probes) {
		const file = join(directory, sourceFile);
		const source = readFileSync(file, "utf8");
		if (source.split(before).length !== 2) throw new Error(`Mutation anchor is not unique: ${name}`);
		writeFileSync(file, source.replace(before, after));
		const run = spawnSync(process.execPath, [resolve(dependencies, "vitest/vitest.mjs"), "run",
			testFile, "-t", testName, "--reporter=json"], {
			cwd: directory, encoding: "utf8", timeout: 30000, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
		});
		const result = JSON.parse(run.stdout);
		// A parse/import error is not a caught mutation: the named assertion must fail.
		const failures = result.testResults.flatMap((test) => test.assertionResults)
			.filter((assertion) => assertion.status === "failed" && assertion.title.includes(testName));
		if (run.status !== 1 || failures.length === 0) throw new Error(`Mutation survived or test did not run: ${name}`);
		evidence.push({ name, failedAssertions: failures.length });
		writeFileSync(file, source); // Restore only the disposable copy for the next probe.
		process.stdout.write(`[collision-${viewMode ? "view1" : "batch1"}-mutation] ${name}: caught\n`);
	}
} catch (error) {
	failure = error;
} finally {
	// Remove only this mkdtemp directory. Refuse a replaced root; rm removes
	// package junctions themselves, without traversing their installed targets.
	try {
		removeMutationDirectory(directory);
	} catch (cleanupError) {
		failure = new AggregateError(failure === null ? [cleanupError] : [failure, cleanupError], "Mutation cleanup failed");
	}
}
if (failure !== null) throw failure;
process.stdout.write(`${JSON.stringify({ caught: evidence.length, isolation: "temporary-copy", evidence })}\n`);
