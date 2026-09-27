import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DISTRIBUTION_DIR = path.resolve(SCRIPT_DIR, "../dist/semantropy");
const ASSET_NAMES = ["main.js", "manifest.json", "styles.css"];

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function sameNames(actual, expected) {
	return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

/**
 * Prepare a fresh, isolated native smoke-test Vault from the three files that
 * Obsidian installs from a Release. Never touches an existing Vault, never
 * copies development data.json or dictionary cache, and never enables a plugin.
 * The caller owns the unique temporary directory until they remove it.
 */
export async function prepareReleaseSmokeVault({
	distributionDir = DEFAULT_DISTRIBUTION_DIR,
	temporaryRoot = os.tmpdir(),
} = {}) {
	const sourceDir = path.resolve(distributionDir);
	const entries = await readdir(sourceDir, { withFileTypes: true });
	if (
		!sameNames(entries.map((entry) => entry.name), ASSET_NAMES) ||
		entries.some((entry) => !entry.isFile())
	) {
		throw new Error(
			`Expected exactly three regular distribution files in ${sourceDir}: ${ASSET_NAMES.join(", ")}. Run npm run build:distribution first.`,
		);
	}

	const sources = await Promise.all(
		ASSET_NAMES.map(async (name) => {
			const bytes = await readFile(path.join(sourceDir, name));
			return { name, bytes, sha256: sha256(bytes) };
		}),
	);
	let manifest;
	try {
		manifest = JSON.parse(
			sources.find((source) => source.name === "manifest.json").bytes.toString("utf8"),
		);
	} catch {
		throw new Error("The distribution manifest.json is not valid JSON.");
	}
	if (
		manifest?.id !== "semantropy" ||
		!/^\d+\.\d+\.\d+$/.test(manifest.version) ||
		manifest.isDesktopOnly !== true
	) {
		throw new Error("The distribution manifest is not a desktop Semantropy release manifest.");
	}

	const root = await mkdtemp(path.join(path.resolve(temporaryRoot), "semantropy-release-smoke-"));
	const vaultPath = path.join(root, "vault");
	const pluginPath = path.join(vaultPath, ".obsidian", "plugins", "semantropy");
	await mkdir(pluginPath, { recursive: true });
	for (const source of sources) {
		const target = path.join(pluginPath, source.name);
		await copyFile(path.join(sourceDir, source.name), target);
		if (sha256(await readFile(target)) !== source.sha256) {
			throw new Error(`The copied release asset ${source.name} failed its SHA-256 check; the test Vault is at ${vaultPath}.`);
		}
	}
	await writeFile(
		path.join(vaultPath, "Smoke Target.md"),
		"# スモークテスト\n\n猫が庭を歩いた。犬が窓を見た。鳥が空を飛んだ。\n\n花と木と川のある町で、友人は古い本を読んだ。\n",
		"utf8",
	);
	await writeFile(
		path.join(vaultPath, "Smoke Vocabulary.md"),
		"# 語彙ノート\n\n猫、犬、鳥、花、木、川、町、庭、窓、本、友人、山、海、森、橋、時計、机、手紙。\n",
		"utf8",
	);

	const copied = await readdir(pluginPath);
	if (!sameNames(copied, ASSET_NAMES)) {
		throw new Error(`The test plugin directory contains an unexpected file: ${pluginPath}.`);
	}
	return {
		vaultPath,
		pluginPath,
		version: manifest.version,
		assets: sources.map(({ name, bytes, sha256: hash }) => ({ name, bytes: bytes.byteLength, sha256: hash })),
	};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const result = await prepareReleaseSmokeVault({
			distributionDir: process.argv[2] ?? DEFAULT_DISTRIBUTION_DIR,
		});
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
