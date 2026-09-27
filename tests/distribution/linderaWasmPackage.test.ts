import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildDistribution, buildProductionMain } from "../../scripts/buildDistribution.mjs";
import {
	LINDERA_WASM_PACKAGE_FILE_NAMES,
	LINDERA_WASM_PACKAGE_SHA256,
	assertLinderaWasmPackage,
	measureLinderaWasmPackageHashes,
} from "../../scripts/lindera/packageHashes.mjs";
import {
	LINDERA_WASM_VERSION,
	linderaWasmPackageDir,
	sha256Hex,
} from "../../scripts/lindera/linderaSource.mjs";

const rootDir = process.cwd();
const scratchDir = path.join("dist", "semantropy-wasm-scratch");
const packageDir = linderaWasmPackageDir(rootDir);

afterAll(async () => {
	await rm(path.resolve(rootDir, scratchDir), { recursive: true, force: true });
});

/**
 * Stages a copy of the installed package under a fake root, so a tampered
 * install can be verified without touching `node_modules`.
 */
async function stagePackage(name: string): Promise<string> {
	const fakeRoot = path.resolve(rootDir, scratchDir, name);
	const target = linderaWasmPackageDir(fakeRoot);
	await rm(fakeRoot, { recursive: true, force: true });
	await mkdir(target, { recursive: true });
	for (const fileName of [...LINDERA_WASM_PACKAGE_FILE_NAMES, "package.json"]) {
		await copyFile(
			path.join(packageDir, fileName),
			path.join(target, fileName),
		);
	}
	return fakeRoot;
}

async function flipLastByte(file: string): Promise<void> {
	const content = Buffer.from(await readFile(file));
	content[content.length - 1] = (content.at(-1) ?? 0) ^ 0xff;
	await writeFile(file, content);
}

describe("the installed lindera-wasm package is pinned by bytes", () => {
	it("matches the pinned hashes as installed", async () => {
		expect(await measureLinderaWasmPackageHashes(packageDir)).toEqual({
			...LINDERA_WASM_PACKAGE_SHA256,
		});
	});

	it("pins every file the build actually reads", () => {
		// The WASM module is embedded, the glue is bundled, and the LICENSE is
		// reproduced in the banner users receive. All three change the artifact.
		expect([...LINDERA_WASM_PACKAGE_FILE_NAMES].sort()).toEqual([
			"LICENSE",
			"lindera_wasm.js",
			"lindera_wasm_bg.wasm",
		]);
	});

	it("accepts the real install", async () => {
		await expect(assertLinderaWasmPackage(rootDir)).resolves.toEqual({
			...LINDERA_WASM_PACKAGE_SHA256,
		});
	});

	for (const fileName of ["lindera_wasm_bg.wasm", "lindera_wasm.js", "LICENSE"]) {
		it(`rejects a one-byte change to ${fileName}, even though package.json still says ${LINDERA_WASM_VERSION}`, async () => {
			const fakeRoot = await stagePackage(`tampered-${fileName}`);
			await flipLastByte(path.join(linderaWasmPackageDir(fakeRoot), fileName));

			// The version claim is untouched — this is exactly the case a
			// version check alone would wave through.
			const manifest = JSON.parse(
				await readFile(
					path.join(linderaWasmPackageDir(fakeRoot), "package.json"),
					"utf8",
				),
			) as { version: string };
			expect(manifest.version).toBe(LINDERA_WASM_VERSION);

			await expect(assertLinderaWasmPackage(fakeRoot)).rejects.toThrow(
				new RegExp(
					`does not match the hashes pinned[\\s\\S]*${fileName.replace(".", "\\.")}[\\s\\S]*expected ${LINDERA_WASM_PACKAGE_SHA256[fileName]}`,
				),
			);
		});
	}

	it("cannot be told which hashes to compare against", async () => {
		// The check takes no expected-hash argument, so a caller holding the
		// tampered install's own hashes still cannot make it pass. If this ever
		// gains such a parameter, the check becomes vacuous while still
		// reporting the package as pinned.
		const fakeRoot = await stagePackage("tampered-self-consistent");
		const target = path.join(
			linderaWasmPackageDir(fakeRoot),
			"lindera_wasm_bg.wasm",
		);
		await flipLastByte(target);

		const selfHashes = await measureLinderaWasmPackageHashes(
			linderaWasmPackageDir(fakeRoot),
		);
		expect(selfHashes["lindera_wasm_bg.wasm"]).not.toBe(
			LINDERA_WASM_PACKAGE_SHA256["lindera_wasm_bg.wasm"],
		);

		await expect(
			(assertLinderaWasmPackage as (
				root: string,
				expected?: unknown,
			) => Promise<unknown>)(fakeRoot, selfHashes),
		).rejects.toThrow(/does not match the hashes pinned/);
	});

	it("reports a missing file as an install problem, not a hash mismatch", async () => {
		const fakeRoot = await stagePackage("missing-license");
		await rm(path.join(linderaWasmPackageDir(fakeRoot), "LICENSE"));

		await expect(assertLinderaWasmPackage(fakeRoot)).rejects.toThrow(
			/is missing a file the build reads[\s\S]*npm ci/,
		);
	});
});

/**
 * The check has to be wired into the commands that emit artifacts, not merely
 * available. This tampers with the real install, runs the real build commands,
 * and restores the bytes afterwards.
 */
describe("a modified install stops the build before anything is emitted", () => {
	const wasmPath = path.join(packageDir, "lindera_wasm_bg.wasm");
	const outDir = path.join(scratchDir, "out-should-not-exist");
	const outfile = path.join(scratchDir, "should-not-exist.js");

	it("fails npm run build:distribution and npm run build, and leaves no output", async () => {
		const original = Buffer.from(await readFile(wasmPath));
		try {
			await flipLastByte(wasmPath);

			await expect(buildDistribution({ outDir })).rejects.toThrow(
				/does not match the hashes pinned[\s\S]*lindera_wasm_bg\.wasm/,
			);
			await expect(buildProductionMain({ outfile })).rejects.toThrow(
				/does not match the hashes pinned[\s\S]*lindera_wasm_bg\.wasm/,
			);

			// Verified before anything is written, so a failed build cannot
			// leave a half-made artifact behind.
			await expect(stat(path.resolve(rootDir, outDir))).rejects.toThrow();
			await expect(stat(path.resolve(rootDir, outfile))).rejects.toThrow();
		} finally {
			await writeFile(wasmPath, original);
		}

		// The install is back to the pinned bytes for every later test.
		expect(sha256Hex(await readFile(wasmPath))).toBe(
			LINDERA_WASM_PACKAGE_SHA256["lindera_wasm_bg.wasm"],
		);
	}, 600_000);
});
