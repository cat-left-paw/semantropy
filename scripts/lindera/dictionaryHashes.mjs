import { readFile } from "node:fs/promises";
import path from "node:path";
import { IPADIC_ARCHIVE, PREPARE_COMMAND, sha256Hex } from "./linderaSource.mjs";

/**
 * The SHA-256 of every dictionary file the build reads, pinned in source
 * control.
 *
 * Verifying the archive is not enough on its own. The archive is checked when
 * `prepare` downloads it, but the build reads the extracted and derived
 * directories under `.cache/`, and those are ordinary files that nothing was
 * re-checking: a complete, internally consistent but modified cache passed the
 * file-existence check and became the artifact's input.
 *
 * These constants close that gap. Every value below is determined by the
 * pinned archive alone:
 *
 *   archive (bytes + SHA-256 in IPADIC_ARCHIVE)
 *     -> extraction (deflate, CRC-32 checked per member)  = FULL_DICTIONARY_SHA256
 *     -> compaction (a pure function of dict.words/.wordsidx) = COMPACT_DICTIONARY_SHA256
 *
 * so a mismatch means either the cache was altered or the compaction rules
 * changed. Neither may reach an artifact silently. Changing the compaction
 * rules is a deliberate act, and it must come with an update to
 * COMPACT_DICTIONARY_SHA256 in the same change.
 */

/** Files the extracted archive contains, and that the compact directory mirrors. */
export const VERIFIED_DICTIONARY_FILE_NAMES = Object.freeze([
	"metadata.json",
	"dict.trie",
	"dict.valsidx",
	"dict.vals",
	"dict.wordsidx",
	"dict.words",
	"matrix.mtx",
	"char_def.bin",
	"unk.bin",
	"NOTICE.txt",
]);

/** The archive's own files, as extracted. */
export const FULL_DICTIONARY_SHA256 = Object.freeze({
	"metadata.json":
		"305addfbf05e41d985a1541035c79a7b6f8ae254e4bc94f1721be21adf31068f",
	"dict.trie":
		"b176188057bbd78fa73c2161db1f00fbabf9afbc3471732c4b549bf707413dfb",
	"dict.valsidx":
		"f1b17f1c4682a5bd42dabe95ab7cefb461c888b839a18d213dd5c7133d3a1a76",
	"dict.vals":
		"62af946542a17c4f16cf1122cb069b5d26f7cf652066b3b846cc4c230b6a8aa1",
	"dict.wordsidx":
		"a38e0b55d6e0fa67555078f8beb6f634f264b2a6b2ea2c9a7aa111f085ada721",
	"dict.words":
		"fc1d924e12af84a352feccce35b772383322760ee2b3da4be0e173ad82953938",
	"matrix.mtx":
		"915733be6589bee90b8f2af5cd314c384a1f9a2fc3af498384555986447b168b",
	"char_def.bin":
		"ef37cf70d7e72ec023bec8e632783a6fe255b2d5fd1bce22600b595fccae48b1",
	"unk.bin":
		"3eeebe0ef3f8907be325aa3acb0ccbd4ccb6f5ac20ff3dd0742ff1af1c468da6",
	"NOTICE.txt":
		"2cf235bf0842d6d61eb0244fb22e645a321b12408a3cf75feb3a53577d885bde",
});

/**
 * The derived dictionary. Eight values are identical to the archive's, because
 * those files are copied byte for byte; only `dict.words` and `dict.wordsidx`
 * differ, which is the whole of the compaction.
 */
export const COMPACT_DICTIONARY_SHA256 = Object.freeze({
	"metadata.json":
		"305addfbf05e41d985a1541035c79a7b6f8ae254e4bc94f1721be21adf31068f",
	"dict.trie":
		"b176188057bbd78fa73c2161db1f00fbabf9afbc3471732c4b549bf707413dfb",
	"dict.valsidx":
		"f1b17f1c4682a5bd42dabe95ab7cefb461c888b839a18d213dd5c7133d3a1a76",
	"dict.vals":
		"62af946542a17c4f16cf1122cb069b5d26f7cf652066b3b846cc4c230b6a8aa1",
	"dict.wordsidx":
		"5744a04d9dfe064ff4d32aa793c13cbb339aa0e4691bd8548439d4c1d7d76973",
	"dict.words":
		"0629830ff5f5d8e2497c10ccceff255b1340b8d89a3798c16d7bb87a4b420514",
	"matrix.mtx":
		"915733be6589bee90b8f2af5cd314c384a1f9a2fc3af498384555986447b168b",
	"char_def.bin":
		"ef37cf70d7e72ec023bec8e632783a6fe255b2d5fd1bce22600b595fccae48b1",
	"unk.bin":
		"3eeebe0ef3f8907be325aa3acb0ccbd4ccb6f5ac20ff3dd0742ff1af1c468da6",
	"NOTICE.txt":
		"2cf235bf0842d6d61eb0244fb22e645a321b12408a3cf75feb3a53577d885bde",
});

/** The two files compaction rewrites; the rest are copied unchanged. */
export const REWRITTEN_FILE_NAMES = Object.freeze([
	"dict.words",
	"dict.wordsidx",
]);

export async function measureDictionaryHashes(dir) {
	const hashes = {};
	for (const fileName of VERIFIED_DICTIONARY_FILE_NAMES) {
		hashes[fileName] = sha256Hex(await readFile(path.join(dir, fileName)));
	}
	return hashes;
}

/**
 * Verifies a dictionary directory against the pinned hashes, naming every file
 * that does not match. The message says which of the two possible causes the
 * reader has to rule out, because they need opposite responses: an altered
 * cache must be discarded, a deliberate rule change must be recorded here.
 */
export async function assertDictionaryHashes(dir, expected, label) {
	const actual = await measureDictionaryHashes(dir);
	const mismatched = VERIFIED_DICTIONARY_FILE_NAMES.filter(
		(fileName) => actual[fileName] !== expected[fileName],
	);
	if (mismatched.length === 0) {
		return actual;
	}

	const detail = mismatched
		.map(
			(fileName) =>
				`  ${fileName}\n    expected ${expected[fileName]}\n    actual   ${actual[fileName]}`,
		)
		.join("\n");
	throw new Error(
		`The Lindera dictionary in ${label} does not match the hashes pinned in ` +
			`scripts/lindera/dictionaryHashes.mjs, so it is not the dictionary that ` +
			`${IPADIC_ARCHIVE.name} produces:\n${detail}\n` +
			`Either the cache was modified — delete .cache/lindera and run ` +
			`"${PREPARE_COMMAND}" — or the compaction rules ` +
			`changed, in which case update the pinned hashes in the same change.`,
	);
}
