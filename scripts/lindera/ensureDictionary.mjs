import { prepareDictionary } from "../prepareDictionary.mjs";
import {
	COMPACT_DICTIONARY_SHA256,
	assertDictionaryHashes,
} from "./dictionaryHashes.mjs";
import {
	LINDERA_DICTIONARY_FILE_NAMES,
	LINDERA_NOTICE_FILE_NAME,
	assertDictionaryDir,
	linderaCompactDictionaryDir,
} from "./linderaSource.mjs";

/**
 * The build's dictionary bootstrap.
 *
 * `npm run build` and `npm run build:distribution` call this before they read
 * the compact dictionary, so a checkout with no `.cache/` needs only
 * `npm ci` and one build command. It is the *only* way a build reaches the
 * network, it is reached only from those two entry points (never from
 * `npm ci`, the watch build, the tests or the plugin runtime), and it never
 * relaxes anything the build checks afterwards:
 *
 *   - a compact dictionary that already matches the pinned SHA-256 of every
 *     file is reused, and neither the archive nor the network is touched;
 *   - otherwise `prepareDictionary()` runs. It reuses a cached archive that
 *     matches the pinned byte count and SHA-256, and downloads the one pinned
 *     URL only when there is none. The archive, the extracted files and the
 *     compact files are all checked against pinned values before they replace
 *     anything, and a failure leaves the previous cache and every artifact
 *     as they were;
 *   - whatever happens here, the caller re-verifies the compact directory
 *     against the pinned hashes before bundling. Nothing in this module is
 *     trusted to have produced good bytes.
 *
 * There is no fallback: if the dictionary cannot be verified, this throws.
 */

/**
 * Whether the compact dictionary in `compactDir` is complete and byte-for-byte
 * the pinned one. Never throws; the reason is a fixed phrase for the log line
 * only, so a path or file content never reaches it.
 */
export async function inspectCompactDictionary(compactDir) {
	try {
		await assertDictionaryDir(compactDir, compactDir, [
			...LINDERA_DICTIONARY_FILE_NAMES,
			LINDERA_NOTICE_FILE_NAME,
		]);
	} catch {
		return { ok: false, reason: "is missing or incomplete" };
	}
	try {
		await assertDictionaryHashes(
			compactDir,
			COMPACT_DICTIONARY_SHA256,
			compactDir,
		);
	} catch {
		return { ok: false, reason: "does not match the pinned hashes" };
	}
	return { ok: true };
}

/**
 * @param {string} rootDir
 * @param {{ prepare?: typeof prepareDictionary, fetchImpl?: typeof fetch,
 *   log?: (line: string) => void }} [options] `prepare` and `fetchImpl` exist
 *   for tests; production callers leave them unset.
 */
export async function ensureBuildDictionary(rootDir, options = {}) {
	const prepare = options.prepare ?? prepareDictionary;
	const log = options.log ?? (() => {});

	const cached = await inspectCompactDictionary(
		linderaCompactDictionaryDir(rootDir),
	);
	if (cached.ok) {
		return { source: "cache", downloaded: false };
	}

	log(
		`[semantropy build] The compact dictionary cache ${cached.reason}. ` +
			`Preparing it from the pinned Lindera IPADIC archive; a missing archive is downloaded once from the pinned URL.`,
	);
	const report = await prepare({
		rootDir,
		allowDownload: true,
		fetchImpl: options.fetchImpl,
	});
	const downloaded = report.archive.reusedCache === false;
	log(
		downloaded
			? `[semantropy build] Downloaded and verified ${report.archive.url} (${report.archive.bytes} bytes, SHA-256 ${report.archive.sha256}).`
			: `[semantropy build] Reused the cached archive (${report.archive.bytes} bytes, SHA-256 ${report.archive.sha256}); no download.`,
	);
	return { source: "prepared", downloaded };
}
