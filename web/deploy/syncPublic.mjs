/**
 * Copies the web Playground (and what it needs) from this private repository
 * into the public repository's local checkout, by an explicit list.
 *
 *   node web/deploy/syncPublic.mjs --to <public checkout>            dry run: show what would change
 *   node web/deploy/syncPublic.mjs --to <public checkout> --apply    copy, and extend the allowlist
 *   ... --apply --prune    also delete files in the synced trees that no longer exist here
 *   ... --since <private commit>   0.1.0: also the plugin release (see RELEASE_* below)
 *
 * With `--since`, the commit is the private source of the last public sync
 * (7253c57 for 0.0.1). Then every committed file the public checkout already
 * has is updated, and every file added here since that commit under
 * RELEASE_TREES is added. Nothing else is published: internal `Docs/`,
 * `AGENTS.md`, this repository's own `.gitignore` and files the public
 * repository never had stay private.
 *
 * Follows Docs/community_plugin_release_runbook.md §7: never a recursive copy
 * of the whole repository, never a push. Only files committed here are copied
 * (from the working tree, which must match HEAD for them), the destination must
 * be a clean checkout of cat-left-paw/semantropy, and the public `.gitignore`
 * allowlist is extended line by line in its own style instead of replaced.
 * Afterwards review `git status` / `git diff` in the public checkout, build and
 * test there, then commit and push from there.
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Existing public files this change updates. */
const FILES = ["package.json", "package-lock.json", "eslint.config.mts", "vitest.web.config.ts", "tests/recompose.test.ts"];
/** Trees owned by the web Playground: every committed file under them. */
const TREES = ["web", "src/recompose"];
/** 0.1.0 plugin release (`--since`): where a file added here since the last public sync may be published. */
const RELEASE_TREES = ["src/", "tests/", "web/", "scripts/", "resources/"];
/** Never published by `--since`, even when the public checkout has a file of that name. */
const RELEASE_PRIVATE = [/^Docs\//u, /^AGENTS\.md$/u, /^\.gitignore$/u, /^\.claude\//u];
/** Files published under another path. */
const MAPPED = new Map([
	["web/deploy/github-pages.yml", ".github/workflows/pages.yml"],
	// 0.1.0: tag pushes build an attested draft Release on GitHub's runner.
	["web/deploy/github-release.yml", ".github/workflows/release.yml"],
]);
const PUBLIC_REMOTE = /[/:]cat-left-paw\/semantropy(?:\.git)?$/u;

function git(cwd, args) {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function fail(message) {
	console.error(`sync: ${message}`);
	process.exit(1);
}

function parseArgs(argv) {
	const args = { to: null, apply: false, prune: false, allowDirty: false, since: null };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--to") args.to = argv[++i] ?? null;
		else if (arg === "--apply") args.apply = true;
		else if (arg === "--prune") args.prune = true;
		else if (arg === "--allow-dirty") args.allowDirty = true;
		else if (arg === "--since") args.since = argv[++i] ?? null;
		else fail(`unknown option ${arg}`);
	}
	if (!args.to) fail("pass --to <path of the public repository checkout>");
	return args;
}

/** Every allowlist line a public path needs, in the public `.gitignore` style. */
function allowlistLines(file) {
	const parts = file.split("/");
	const lines = [];
	for (let depth = 1; depth < parts.length; depth += 1) {
		const dir = parts.slice(0, depth).join("/");
		lines.push(`!/${dir}/`, `/${dir}/*`);
	}
	lines.push(`!/${file}`);
	return lines;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const target = path.resolve(args.to);

	let top;
	try {
		top = path.resolve(git(target, ["rev-parse", "--show-toplevel"]).trim());
	} catch {
		fail(`${target} is not a git checkout`);
	}
	if (top !== target) fail(`--to must be the root of the public checkout (${top})`);
	const remote = git(target, ["remote", "get-url", "origin"]).trim();
	if (!PUBLIC_REMOTE.test(remote)) fail(`the destination's origin is not cat-left-paw/semantropy (${remote})`);
	if (path.resolve(sourceDir) === target) fail("source and destination are the same checkout");
	if (!args.allowDirty && git(target, ["status", "--porcelain"]).trim()) fail("the public checkout has uncommitted changes");

	const webTracked = git(sourceDir, ["ls-files", "-z", "--", ...FILES, ...TREES]).split("\0").filter(Boolean);
	for (const file of FILES) if (!webTracked.includes(file)) fail(`${file} is not committed in this repository`);
	let tracked = webTracked;
	if (args.since) {
		// The plugin release: files the public repository already has, and files added here since the last sync.
		try { git(sourceDir, ["rev-parse", "--verify", `${args.since}^{commit}`]); } catch { fail(`--since ${args.since} is not a commit here`); }
		const all = git(sourceDir, ["ls-files", "-z"]).split("\0").filter(Boolean);
		const publicFiles = new Set(git(target, ["ls-files", "-z"]).split("\0").filter(Boolean));
		const added = new Set(git(sourceDir, ["diff", "--name-only", "-z", "--diff-filter=AR", `${args.since}`, "HEAD"]).split("\0").filter(Boolean));
		const release = all.filter((file) => !RELEASE_PRIVATE.some((pattern) => pattern.test(file)) &&
			(publicFiles.has(MAPPED.get(file) ?? file) || (added.has(file) && RELEASE_TREES.some((tree) => file.startsWith(tree)))));
		tracked = [...new Set([...webTracked, ...release])].sort();
	}
	const dirty = git(sourceDir, ["status", "--porcelain", "--", ...tracked]).trim();
	if (dirty && !args.allowDirty) fail(`these paths differ from HEAD here; commit them first:\n${dirty}`);

	const pairs = tracked.map((file) => [file, MAPPED.get(file) ?? file]);
	const publishedTargets = new Set(pairs.map(([, to]) => to));
	const plan = { add: [], update: [], same: [], stale: [] };
	for (const [from, to] of pairs) {
		const source = await readFile(path.join(sourceDir, from));
		let existing = null;
		try {
			existing = await readFile(path.join(target, to));
		} catch {
			existing = null;
		}
		if (existing === null) plan.add.push([from, to]);
		else if (Buffer.compare(existing, source) !== 0) plan.update.push([from, to]);
		else plan.same.push([from, to]);
	}
	// With --since, a file of the synced trees that is gone here is stale in public too.
	const ownedTrees = args.since ? [...TREES, ...RELEASE_TREES.map((tree) => tree.replace(/\/$/u, ""))] : TREES;
	const ownedInTarget = git(target, ["ls-files", "-z", "--", ...ownedTrees]).split("\0").filter(Boolean);
	for (const file of ownedInTarget) if (!publishedTargets.has(file)) plan.stale.push(file);

	const gitignorePath = path.join(target, ".gitignore");
	const gitignore = await readFile(gitignorePath, "utf8");
	const present = new Set(gitignore.split(/\r?\n/u));
	const missing = [];
	for (const [, to] of pairs) for (const line of allowlistLines(to)) if (!present.has(line) && !missing.includes(line)) missing.push(line);

	const head = git(sourceDir, ["rev-parse", "--short", "HEAD"]).trim();
	const show = (label, list) => {
		console.log(`${label} (${list.length})`);
		for (const item of list) console.log(`  ${Array.isArray(item) ? (item[0] === item[1] ? item[0] : `${item[0]} -> ${item[1]}`) : item}`);
	};
	console.log(`source: private ${head}\ntarget: ${target}\n`);
	show("add", plan.add);
	show("update", plan.update);
	console.log(`unchanged (${plan.same.length})`);
	show(args.prune ? "delete (no longer here)" : "stale in public (use --prune to delete)", plan.stale);
	console.log(`\n.gitignore allowlist lines to add (${missing.length})`);
	for (const line of missing) console.log(`  ${line}`);

	if (!args.apply) {
		console.log("\nDry run. Nothing was written. Re-run with --apply to copy.");
		return;
	}
	for (const [from, to] of [...plan.add, ...plan.update]) {
		await mkdir(path.dirname(path.join(target, to)), { recursive: true });
		await copyFile(path.join(sourceDir, from), path.join(target, to));
	}
	if (args.prune) for (const file of plan.stale) await rm(path.join(target, file));
	if (missing.length > 0) {
		const block = `\n# ${args.since ? "Release" : "Web Playground"} (synced from private ${head} by web/deploy/syncPublic.mjs)\n${missing.join("\n")}\n`;
		await writeFile(gitignorePath, gitignore.replace(/\n*$/u, "\n") + block);
	}
	const ignored = [];
	for (const [, to] of pairs) {
		try {
			git(target, ["check-ignore", "-q", "--", to]);
			ignored.push(to);
		} catch {
			// Exit status 1: not ignored, as required.
		}
	}
	if (ignored.length > 0) fail(`still ignored by the public .gitignore:\n  ${ignored.join("\n  ")}`);
	console.log("\nCopied. In the public checkout: review `git status` and `git diff`, then run");
	console.log("  npm ci && npm run typecheck:web && npm run lint:web && npm run test:web && npm run build:web");
	console.log("  npm run typecheck && npm run lint && npm test");
	console.log(`and commit with a message that names private ${head}.`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
