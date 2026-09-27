import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COMPACT_DICTIONARY_POLICY, generateCompactDictionary } from "./lindera/compactDictionary.mjs";
import {
	COMPACT_DICTIONARY_SHA256,
	FULL_DICTIONARY_SHA256,
	assertDictionaryHashes,
} from "./lindera/dictionaryHashes.mjs";
import {
	IPADIC_ARCHIVE,
	LINDERA_DICTIONARY_FILE_NAMES,
	LINDERA_NOTICE_FILE_NAME,
	assertLinderaWasmVersion,
	ensureArchive,
	extractArchive,
	linderaCacheDir,
	linderaCompactDictionaryDir,
	linderaFullDictionaryDir,
	measureDictionaryDir,
	sha256Hex,
} from "./lindera/linderaSource.mjs";
import { assertLinderaWasmPackage } from "./lindera/packageHashes.mjs";
import { publishDirectories } from "./publishDirectories.mjs";

/**
 * Fetches the pinned Lindera IPADIC release and derives the Semantropy-compact
 * dictionary the build embeds. This is the only step in this repository that
 * reaches the network, and it reaches exactly one pinned URL.
 *
 * It is run by `npm run prepare:dictionary`, and by `npm run build` /
 * `npm run build:distribution` (through `scripts/lindera/ensureDictionary.mjs`)
 * when the compact dictionary they embed is not already in the cache. The
 * watch build, the tests and the plugin runtime never call it.
 *
 * A cached archive that matches the pinned byte count and SHA-256 is reused;
 * anything else is re-downloaded and re-verified, and a download that does not
 * match is deleted without being extracted. Extraction and compaction happen in
 * a staging directory and are checked against the pinned hashes there; only a
 * verified result replaces what is in the cache. The replacement moves the old
 * directories aside first and puts them back if any later step — the move
 * itself, or the read-back check of what was published — fails, so a failed run
 * leaves the previous cache as it was. (A run killed in the middle of the two
 * moves is not undone; the next run finds a cache that fails its hash check and
 * prepares it again.)
 */
export async function prepareDictionary(options = {}) {
	const rootDir = options.rootDir ?? process.cwd();
	const allowDownload = options.allowDownload ?? true;
	const fetchImpl = options.fetchImpl;
	// For tests only: lets a failure be injected into the publication moves.
	const renameImpl = options.renameImpl;

	const wasmVersion = await assertLinderaWasmVersion(rootDir);
	// The build checks this too. Doing it here as well means a modified or
	// half-installed package is reported during setup rather than after a
	// dictionary download that was never the problem.
	await assertLinderaWasmPackage(rootDir);
	const archive = await ensureArchive(rootDir, { allowDownload, fetchImpl });

	const fullDir = linderaFullDictionaryDir(rootDir);
	const compactDir = linderaCompactDictionaryDir(rootDir);

	// Everything is produced under a private staging directory inside the
	// cache and moved into place only after it has matched the pinned hashes.
	await mkdir(linderaCacheDir(rootDir), { recursive: true });
	const stagingDir = await mkdtemp(
		path.join(linderaCacheDir(rootDir), ".staging-"),
	);
	let extracted;
	let compacted;
	let keepStaging = false;
	try {
		const stagedFull = path.join(stagingDir, "full");
		const stagedCompact = path.join(stagingDir, "compact");

		extracted = await extractArchive(archive.content, stagedFull);
		// What was extracted must be what the pinned archive contains. The
		// archive was just verified, and every member's CRC-32 was checked
		// while inflating, so a mismatch here means the extraction went wrong.
		await assertDictionaryHashes(stagedFull, FULL_DICTIONARY_SHA256, fullDir);

		compacted = await generateCompactDictionary(stagedFull, stagedCompact);
		// The compaction is a pure function of those bytes, so its output is
		// fixed too. Checking it here means a change to the compaction rules
		// is caught at the moment it is made, rather than at the next build.
		await assertDictionaryHashes(
			stagedCompact,
			COMPACT_DICTIONARY_SHA256,
			compactDir,
		);

		const publication = await publishDirectories(
			[
				{ staged: stagedFull, target: fullDir },
				{ staged: stagedCompact, target: compactDir },
			],
			{ backupDir: path.join(stagingDir, "previous"), renameImpl },
		);
		try {
			// Read back from the cache, not from the staging copy: what the
			// build will read is what is checked.
			await assertDictionaryHashes(fullDir, FULL_DICTIONARY_SHA256, fullDir);
			await assertDictionaryHashes(
				compactDir,
				COMPACT_DICTIONARY_SHA256,
				compactDir,
			);
		} catch (error) {
			await publication.rollback();
			throw error;
		}
		publication.commit();
	} catch (error) {
		// A rollback that could not finish leaves the previous directories in
		// the staging area; that is the only copy, so it is not deleted.
		if (error?.preserved === true) {
			keepStaging = true;
		}
		throw error;
	} finally {
		if (!keepStaging) {
			await rm(stagingDir, { recursive: true, force: true });
		}
	}

	// The extracted archive must still be the archive: the compaction step
	// writes only into its own directory.
	const untouched = [];
	for (const fileName of [
		...LINDERA_DICTIONARY_FILE_NAMES,
		LINDERA_NOTICE_FILE_NAME,
	]) {
		const content = await readFile(path.join(fullDir, fileName));
		untouched.push({
			fileName,
			bytes: content.byteLength,
			sha256: sha256Hex(content),
		});
	}

	return {
		dictionaryPolicy: COMPACT_DICTIONARY_POLICY,
		linderaWasmVersion: wasmVersion,
		linderaWasmPackageVerifiedAgainstPinnedHashes: true,
		verifiedAgainstPinnedHashes: true,
		archive: {
			url: IPADIC_ARCHIVE.url,
			bytes: archive.bytes,
			sha256: archive.sha256,
			reusedCache: !archive.downloaded,
		},
		extracted,
		fullDictionary: {
			dir: path.relative(rootDir, fullDir).replaceAll("\\", "/"),
			files: untouched,
			totalBytes: untouched.reduce((sum, file) => sum + file.bytes, 0),
		},
		compactDictionary: {
			dir: path.relative(rootDir, compactDir).replaceAll("\\", "/"),
			verifiedAgainstPinnedHashes: true,
			entryCount: compacted.entryCount,
			targetNounCount: compacted.targetNounCount,
			...(await measureDictionaryDir(compactDir)),
		},
	};
}

async function main() {
	const report = await prepareDictionary();
	process.stdout.write(
		`\n[semantropy prepare:dictionary]\n${JSON.stringify(report, null, 2)}\n`,
	);
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
