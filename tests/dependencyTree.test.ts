import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

/**
 * Kuromoji and its `doublearray` trie were the plugin's analyzer until the
 * Lindera migration. Removing the code is not enough on its own: a dependency
 * left in `package.json` or in the lockfile would be reinstalled by
 * `npm ci`, would appear in a licence audit of the published package, and
 * would have to be listed in the third-party notices for material that is not
 * actually shipped.
 */
const REMOVED_PACKAGES = ["@faanau/kuromoji", "doublearray"];

async function readJson(file: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(path.join(rootDir, file), "utf8")) as Record<
		string,
		unknown
	>;
}

describe("the dependency tree", () => {
	it("declares no runtime dependencies at all", async () => {
		const manifest = await readJson("package.json");
		// Everything the plugin needs at runtime is either supplied by Obsidian
		// or embedded in main.js, so there is nothing left to install.
		expect(manifest["dependencies"] ?? {}).toEqual({});
	});

	it("keeps lindera-wasm as a build-time dependency", async () => {
		const manifest = await readJson("package.json");
		const dev = manifest["devDependencies"] as Record<string, string>;
		// The WebAssembly module and its glue are read at build time and
		// embedded in the bundle; nothing resolves the package at runtime.
		expect(dev["lindera-wasm"]).toBe("6.0.0");
		expect(
			(manifest["dependencies"] as Record<string, string> | undefined)?.[
				"lindera-wasm"
			],
		).toBeUndefined();
	});

	it("names Kuromoji and doublearray nowhere in package.json", async () => {
		const manifest = await readFile(path.join(rootDir, "package.json"), "utf8");
		for (const name of REMOVED_PACKAGES) {
			expect(manifest).not.toContain(name);
		}
	});

	it("names Kuromoji and doublearray nowhere in the lockfile", async () => {
		const lock = await readFile(path.join(rootDir, "package-lock.json"), "utf8");
		for (const name of REMOVED_PACKAGES) {
			expect(lock).not.toContain(name);
		}
	});

	it("resolves neither package from the installed tree", async () => {
		for (const name of REMOVED_PACKAGES) {
			await expect(
				readFile(path.join(rootDir, "node_modules", name, "package.json")),
			).rejects.toThrow();
		}
	});

	it("has every declared script pointing at a script file that exists", async () => {
		const manifest = await readJson("package.json");
		const scripts = manifest["scripts"] as Record<string, string>;
		const referenced = new Set<string>();
		for (const command of Object.values(scripts)) {
			for (const match of command.matchAll(/(scripts\/[\w./-]+\.mjs)/g)) {
				referenced.add(match[1]!);
			}
		}

		expect(referenced.size).toBeGreaterThan(0);
		for (const file of referenced) {
			await expect(readFile(path.join(rootDir, file))).resolves.toBeDefined();
		}
	});
});
