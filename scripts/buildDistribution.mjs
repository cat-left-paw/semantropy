import esbuild from "esbuild";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { baseBuildOptions } from "./esbuildShared.mjs";
import {
	COMPACT_DICTIONARY_SHA256,
	assertDictionaryHashes,
} from "./lindera/dictionaryHashes.mjs";
import { ensureBuildDictionary } from "./lindera/ensureDictionary.mjs";
import { buildLinderaNotice } from "./lindera/linderaNotice.mjs";
import { assertLinderaWasmPackage } from "./lindera/packageHashes.mjs";
import { linderaPayloadPlugin } from "./lindera/linderaPayload.mjs";
import { publishDirectories } from "./publishDirectories.mjs";
import {
	assertStandardTemplatesGenerated,
	standardTemplatesPlugin,
} from "./fakeDictionary/standardTemplates.mjs";
import {
	assertStandardCollisionPatternsGenerated,
	standardCollisionPatternsPlugin,
} from "./collision/standardPatterns.mjs";
import {
	assertStandardFakeProverbRecipesGenerated,
	standardFakeProverbRecipesPlugin,
} from "./fakeProverb/standardRecipes.mjs";
import {
	LINDERA_DICTIONARY_FILE_NAMES,
	LINDERA_NOTICE_FILE_NAME,
	PREPARE_COMMAND,
	assertDictionaryDir,
	assertLinderaWasmVersion,
	linderaCompactDictionaryDir,
	measureDictionaryDir,
} from "./lindera/linderaSource.mjs";

/** Exactly what a Community Plugin install pulls, and nothing else. */
export const DISTRIBUTION_FILE_NAMES = ["main.js", "manifest.json", "styles.css"];

/** Where `npm run build:distribution` puts those three files. */
export const DEFAULT_DISTRIBUTION_DIR = path.join("dist", "semantropy");

function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Everything the bundle needs before esbuild runs, checked in the order that
 * reports the most useful failure first.
 *
 * A build never downloads anything on its own. If the prepared dictionary is
 * missing or incomplete it stops with a message naming the prepare command, and
 * if the installed lindera-wasm is not the pinned version it stops as well.
 * The two command-line entry points (`npm run build`, `npm run
 * build:distribution`) opt in to `dictionaryBootstrap`, which prepares the
 * default compact dictionary first when it is not already a verified cache; see
 * ./lindera/ensureDictionary.mjs. That step only produces files. Everything
 * below still runs afterwards, on whatever is now in the cache.
 *
 * Both build inputs are then checked byte for byte against hashes pinned in
 * source control, because a version number and a file listing are claims about
 * a directory, not statements about its bytes:
 *
 *   the lindera-wasm package  `scripts/lindera/packageHashes.mjs` — the WASM
 *                             module, the glue and the LICENSE all end up in
 *                             the artifact, and npm's integrity hash is only
 *                             checked while installing, never at build time;
 *   the compact dictionary    `scripts/lindera/dictionaryHashes.mjs`, which is
 *                             determined by the pinned archive. The archive's
 *                             own SHA-256 is verified when `prepare`
 *                             downloads it, but the build reads the extracted
 *                             and derived directories, so a complete,
 *                             internally consistent but modified cache would
 *                             otherwise become the artifact's input.
 *
 * Neither comparison can be redirected. `rootDir` and `dictionaryDir` choose
 * which trees to read; they cannot change what those trees have to contain, so
 * pointing a build at modified inputs fails rather than producing an artifact
 * labelled as verified.
 */
async function prepareBundleInputs(rootDir, dictionaryDir, bootstrap) {
	if (bootstrap !== undefined && dictionaryDir !== undefined) {
		throw new Error(
			"dictionaryBootstrap prepares the default compact dictionary and cannot be combined with dictionaryDir.",
		);
	}
	const resolved = dictionaryDir ?? linderaCompactDictionaryDir(rootDir);
	const label = path.relative(rootDir, resolved).replaceAll("\\", "/");

	// The standard Fake Dictionary templates, Collision patterns and Fake
	// Proverb recipes are re-derived from their Markdown documents and
	// compared with the generated modules before anything is bundled. A
	// missing, malformed or stale document fails the build here rather than
	// at plugin load, and there is no fallback to whatever data happens to be
	// on disk. Every build path —
	// production, distribution and watch — comes through this function, so
	// none of them can use different data from the others. The matching
	// plugins repeat the check inside the bundle itself, which is what covers
	// a watch's later rebuilds.
	await assertStandardTemplatesGenerated({ rootDir });
	await assertStandardCollisionPatternsGenerated({ rootDir });
	await assertStandardFakeProverbRecipesGenerated({ rootDir });

	// Version first: it is the cheaper, more obvious failure to report. It is
	// not sufficient on its own, so the package's bytes are checked next.
	await assertLinderaWasmVersion(rootDir);
	await assertLinderaWasmPackage(rootDir);
	// Only now, after every input that is cheap to check has been, is the
	// dictionary prepared if it has to be: a stale generated module or a
	// mismatched package fails before any network access.
	if (bootstrap !== undefined) {
		await ensureBuildDictionary(rootDir, bootstrap);
	}
	// Existence before hashes, so a missing file is reported as missing rather
	// than as a hash mismatch.
	await assertDictionaryDir(resolved, label, [
		...LINDERA_DICTIONARY_FILE_NAMES,
		LINDERA_NOTICE_FILE_NAME,
	]);
	// Always the pinned hashes. There is deliberately no way for a caller to
	// supply its own: a caller that could pass hashes matching whatever
	// dictionary it points at would make the check vacuous, while the result
	// still claimed the dictionary was the pinned one.
	await assertDictionaryHashes(resolved, COMPACT_DICTIONARY_SHA256, label);

	return {
		dictionaryDir: resolved,
		dictionaryLabel: label,
		// Read after the package hashes are verified, so the licence text the
		// banner reproduces is the licence text that was pinned.
		banner: await buildLinderaNotice(rootDir, resolved),
	};
}

/**
 * The one bundle definition. The plugin-root build, the distribution build and
 * the watch build differ only in where the file lands and whether it is
 * minified; the entry point, the externals, the embedded payload and the
 * licence banner are the same in all three, so a development build cannot
 * quietly use a different tokenizer or a different dictionary from the one
 * that ships.
 */
export function bundleOptions(rootDir, { outfile, banner, dictionaryDir, minify, sourcemap }) {
	return {
		...baseBuildOptions(),
		absWorkingDir: rootDir,
		banner: { js: banner },
		entryPoints: [path.join(rootDir, "src", "main.ts")],
		// Named explicitly because the Fake Proverb guard resolves this entry to
		// register its watch files, and esbuild applies a tsconfig to a
		// plugin-resolved path only when the build names one. It is the same
		// file esbuild would otherwise discover, so the bundle is unchanged.
		tsconfig: path.join(rootDir, "tsconfig.json"),
		outfile,
		// The template, Collision pattern and Fake Proverb recipe guards run
		// on every build and rebuild, including a watch's; the payload plugin
		// embeds the dictionary. All four are in all three builds. The Fake
		// Proverb guard registers its watch files while resolving the entry
		// point, so it composes with the Collision guard's entry loader in
		// either order.
		plugins: [
			standardTemplatesPlugin(rootDir),
			standardCollisionPatternsPlugin(rootDir),
			standardFakeProverbRecipesPlugin(rootDir),
			linderaPayloadPlugin(rootDir, dictionaryDir),
		],
		minify,
		sourcemap,
		// A source map that repeated the 12 MB base64 payload would dwarf the
		// bundle it describes; mappings alone are enough to step through code.
		sourcesContent: false,
	};
}

/**
 * Production `main.js` in the plugin root: what `npm run build` produces and
 * what Obsidian loads from a development vault. Byte-for-byte the `main.js`
 * of the distribution artifact, because it is the same bundle.
 */
export async function buildProductionMain(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const { banner, dictionaryDir, dictionaryLabel } = await prepareBundleInputs(
		rootDir,
		options.dictionaryDir,
		options.dictionaryBootstrap,
	);
	const outfile = path.resolve(rootDir, options.outfile ?? "main.js");

	// Built beside the target and renamed over it only once esbuild has
	// finished, so a failed build leaves the existing `main.js` as it was.
	// The output does not depend on where it is written.
	const pending = path.join(
		path.dirname(outfile),
		`.${path.basename(outfile)}.building-${process.pid}`,
	);
	try {
		await esbuild.build({
			...bundleOptions(rootDir, {
				outfile: pending,
				banner,
				dictionaryDir,
				minify: true,
				sourcemap: false,
			}),
			logLevel: options.logLevel ?? "warning",
		});
		await rename(pending, outfile);
	} finally {
		await rm(pending, { force: true });
	}

	const content = await readFile(outfile);
	return {
		outfile,
		bytes: content.byteLength,
		sha256: sha256(content),
		bannerBytes: Buffer.byteLength(banner),
		linderaWasmPackage: { verifiedAgainstPinnedHashes: true },
		dictionary: {
			dir: dictionaryLabel,
			verifiedAgainstPinnedHashes: true,
		},
	};
}

/**
 * A watching development build. It uses the same embedded payload as the
 * production build — there is no external-dictionary mode to fall back to — so
 * the prepared dictionary is required here too.
 */
export async function watchDevelopmentBuild(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const { banner, dictionaryDir } = await prepareBundleInputs(
		rootDir,
		options.dictionaryDir,
	);

	const context = await esbuild.context({
		...bundleOptions(rootDir, {
			outfile: path.resolve(rootDir, options.outfile ?? "main.js"),
			banner,
			dictionaryDir,
			minify: false,
			sourcemap: "inline",
		}),
		logLevel: options.logLevel ?? "info",
	});
	await context.watch();
	return context;
}

/**
 * The release artifact: `main.js`, `manifest.json` and `styles.css` in one
 * directory and nothing else. `manifest.json` and `styles.css` ship verbatim.
 */
export async function buildDistribution(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const outDir = path.resolve(rootDir, options.outDir ?? DEFAULT_DISTRIBUTION_DIR);
	const { banner, dictionaryDir, dictionaryLabel } = await prepareBundleInputs(
		rootDir,
		options.dictionaryDir,
		options.dictionaryBootstrap,
	);

	// The release directory is completed under a temporary name beside it and
	// swapped in only after every file has been written and checked. A failure
	// at any earlier step leaves the previous `outDir` untouched, and a failed
	// swap puts it back.
	await mkdir(path.dirname(outDir), { recursive: true });
	const building = await mkdtemp(
		path.join(path.dirname(outDir), `.${path.basename(outDir)}-building-`),
	);
	const previous = `${building}-previous`;
	let keepPrevious = false;
	const files = [];
	try {
		await esbuild.build({
			...bundleOptions(rootDir, {
				outfile: path.join(building, "main.js"),
				banner,
				dictionaryDir,
				minify: true,
				sourcemap: false,
			}),
			logLevel: options.logLevel ?? "warning",
		});

		for (const fileName of ["manifest.json", "styles.css"]) {
			await writeFile(
				path.join(building, fileName),
				await readFile(path.join(rootDir, fileName)),
			);
		}

		const entries = await readdir(building, { withFileTypes: true });
		for (const entry of entries.sort((x, y) => x.name.localeCompare(y.name))) {
			if (!entry.isFile()) {
				throw new Error(
					`Distribution directory must contain files only; found ${entry.name}.`,
				);
			}
			const content = await readFile(path.join(building, entry.name));
			files.push({
				fileName: entry.name,
				bytes: content.byteLength,
				sha256: sha256(content),
			});
		}

		const publication = await publishDirectories(
			[{ staged: building, target: outDir }],
			{ backupDir: previous, renameImpl: options.renameImpl },
		);
		publication.commit();
	} catch (error) {
		if (error?.preserved === true) {
			keepPrevious = true;
		}
		throw error;
	} finally {
		// `building` is gone after a successful swap; `force` makes that a no-op.
		await rm(building, { recursive: true, force: true });
		if (!keepPrevious) {
			await rm(previous, { recursive: true, force: true });
		}
	}

	return {
		outDir,
		bannerBytes: Buffer.byteLength(banner),
		linderaWasmPackage: { verifiedAgainstPinnedHashes: true },
		dictionary: {
			dir: dictionaryLabel,
			verifiedAgainstPinnedHashes: true,
			...(await measureDictionaryDir(dictionaryDir)),
		},
		files,
	};
}

async function main() {
	const twice = process.argv.includes("--twice");
	const first = await buildDistribution({
		logLevel: "info",
		dictionaryBootstrap: { log: (line) => process.stdout.write(line + "\n") },
	});
	const report = { artifact: first };

	if (twice) {
		const recheckDir = `${DEFAULT_DISTRIBUTION_DIR}-recheck`;
		const second = await buildDistribution({ outDir: recheckDir });
		report.reproducible = DISTRIBUTION_FILE_NAMES.every((fileName) => {
			const a = first.files.find((file) => file.fileName === fileName);
			const b = second.files.find((file) => file.fileName === fileName);
			return a !== undefined && b !== undefined && a.sha256 === b.sha256;
		});
		report.secondBuild = second.files;
		await rm(path.resolve(process.cwd(), recheckDir), {
			recursive: true,
			force: true,
		});
	}

	process.stdout.write(
		`\n[semantropy build:distribution]\n${JSON.stringify(report, null, 2)}\n`,
	);
	if (report.reproducible === false) {
		throw new Error(
			`Two builds from the same input produced different files. The dictionary was not re-prepared between them (${PREPARE_COMMAND}), so the build is not deterministic.`,
		);
	}
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	pathToFileURL(path.resolve(process.argv[1])).href ===
		pathToFileURL(fileURLToPath(import.meta.url)).href;

if (invokedDirectly) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
