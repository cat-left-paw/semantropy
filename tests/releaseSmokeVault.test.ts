import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareReleaseSmokeVault } from "../scripts/prepareReleaseSmokeVault.mjs";

let scratch: string;
let distributionDir: string;

beforeEach(async () => {
	scratch = await mkdtemp(path.join(os.tmpdir(), "semantropy-smoke-test-"));
	distributionDir = path.join(scratch, "dist");
	await mkdir(distributionDir);
	await writeFile(path.join(distributionDir, "main.js"), "release bundle");
	await writeFile(path.join(distributionDir, "styles.css"), "release styles");
	await writeFile(
		path.join(distributionDir, "manifest.json"),
		JSON.stringify({ id: "semantropy", version: "0.0.1", isDesktopOnly: true }),
	);
});

afterEach(async () => {
	await rm(scratch, { recursive: true, force: true });
});

describe("release-only native smoke Vault preparation", () => {
	it("copies only the three release assets into a unique Vault and verifies their bytes", async () => {
		const first = await prepareReleaseSmokeVault({ distributionDir, temporaryRoot: scratch });
		const second = await prepareReleaseSmokeVault({ distributionDir, temporaryRoot: scratch });
		expect(first.vaultPath).not.toBe(second.vaultPath);
		expect(first.version).toBe("0.0.1");
		expect((await readdir(first.pluginPath)).sort()).toEqual(
			["main.js", "manifest.json", "styles.css"],
		);
		for (const asset of first.assets) {
			expect(await readFile(path.join(first.pluginPath, asset.name))).toEqual(
				await readFile(path.join(distributionDir, asset.name)),
			);
			expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
		}
		const configDirectoryName = path.relative(first.vaultPath, first.pluginPath).split(path.sep)[0];
		expect((await readdir(first.vaultPath)).sort()).toEqual([
			configDirectoryName,
			"Smoke Target.md",
			"Smoke Vocabulary.md",
		]);
		expect(await readFile(path.join(first.vaultPath, "Smoke Target.md"), "utf8")).toContain("猫が庭を歩いた");
	});

	it("refuses a distribution with an extra file before creating a Vault", async () => {
		await writeFile(path.join(distributionDir, "data.json"), "{}");
		await expect(
			prepareReleaseSmokeVault({ distributionDir, temporaryRoot: scratch }),
		).rejects.toThrow(/exactly three regular distribution files/);
		expect(await readdir(scratch)).toEqual(["dist"]);
	});

	it("refuses an invalid or non-desktop manifest before creating a Vault", async () => {
		await writeFile(path.join(distributionDir, "manifest.json"), "{");
		await expect(
			prepareReleaseSmokeVault({ distributionDir, temporaryRoot: scratch }),
		).rejects.toThrow(/not valid JSON/);
		await writeFile(
			path.join(distributionDir, "manifest.json"),
			JSON.stringify({ id: "semantropy", version: "0.0.1", isDesktopOnly: false }),
		);
		await expect(
			prepareReleaseSmokeVault({ distributionDir, temporaryRoot: scratch }),
		).rejects.toThrow(/not a desktop Semantropy release manifest/);
		expect(await readdir(scratch)).toEqual(["dist"]);
	});
});
