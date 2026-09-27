import { createHash } from "node:crypto";
import {
	access,
	mkdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * Everything about the build's dictionary inputs that must not drift. The
 * archive is pinned by URL, byte count and SHA-256; the WASM package is pinned
 * by version in package.json / package-lock.json and re-checked here so a
 * mismatched install fails the build rather than silently changing the
 * artifact.
 */

/**
 * The explicit command that fetches and derives the dictionary. Named in every
 * failure below. `npm run build` and `npm run build:distribution` run the same
 * step themselves when the cache is missing or unusable; nothing else does.
 */
export const PREPARE_COMMAND = "npm run prepare:dictionary";

/** Upper bound for one archive download, so a stalled connection cannot hang a build forever. */
export const DOWNLOAD_TIMEOUT_MS = 300_000;
export const LINDERA_WASM_PACKAGE = "lindera-wasm";
export const LINDERA_WASM_VERSION = "6.0.0";

export const IPADIC_ARCHIVE = Object.freeze({
	name: "lindera-ipadic-6.0.0.zip",
	url: "https://github.com/lindera/lindera/releases/download/v6.0.0/lindera-ipadic-6.0.0.zip",
	bytes: 10_519_550,
	sha256: "8433dbbb80d7588a565fb9247c1ac7aed3ca50c7463329e495f8bd905aece356",
	/** The single top-level directory every archive member sits under. */
	rootEntry: "lindera-ipadic",
});

/** Entries known to be present in the source dictionary, in `loadDictionaryFromBytes` argument order. */
export const LINDERA_DICTIONARY_FILE_NAMES = Object.freeze([
	"metadata.json",
	"dict.trie",
	"dict.valsidx",
	"dict.vals",
	"dict.wordsidx",
	"dict.words",
	"matrix.mtx",
	"char_def.bin",
	"unk.bin",
]);

/** The two system-dictionary files compaction rewrites. Everything else is copied byte-for-byte. */
export const COMPACTED_FILE_NAMES = Object.freeze(["dict.words", "dict.wordsidx"]);

export const LINDERA_NOTICE_FILE_NAME = "NOTICE.txt";

export function linderaCacheDir(rootDir) {
	return path.join(rootDir, ".cache", "lindera");
}

export function linderaArchivePath(rootDir) {
	return path.join(linderaCacheDir(rootDir), IPADIC_ARCHIVE.name);
}

/** Untouched archive contents. The build never writes into this directory. */
export function linderaFullDictionaryDir(rootDir) {
	return path.join(linderaCacheDir(rootDir), "lindera-ipadic-6.0.0");
}

/** The derived Semantropy-compact dictionary, generated beside the full one. */
export function linderaCompactDictionaryDir(rootDir) {
	return path.join(
		linderaCacheDir(rootDir),
		"lindera-ipadic-6.0.0-semantropy-compact",
	);
}

/** The installed package directory every other lindera-wasm path is under. */
export function linderaWasmPackageDir(rootDir) {
	return path.join(rootDir, "node_modules", LINDERA_WASM_PACKAGE);
}

export function linderaWasmPath(rootDir) {
	return path.join(linderaWasmPackageDir(rootDir), "lindera_wasm_bg.wasm");
}

export function linderaWasmGluePath(rootDir) {
	return path.join(linderaWasmPackageDir(rootDir), "lindera_wasm.js");
}

export function linderaWasmLicensePath(rootDir) {
	return path.join(linderaWasmPackageDir(rootDir), "LICENSE");
}

export function sha256Hex(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Confirms the cached archive is the pinned one. Size is checked before the
 * hash so a truncated download reports the cheaper, more obvious failure.
 */
export async function verifyArchive(archivePath) {
	let content;
	try {
		content = await readFile(archivePath);
	} catch {
		return { ok: false, reason: "missing" };
	}
	if (content.byteLength !== IPADIC_ARCHIVE.bytes) {
		return {
			ok: false,
			reason: "size",
			expected: IPADIC_ARCHIVE.bytes,
			actual: content.byteLength,
		};
	}
	const digest = sha256Hex(content);
	if (digest !== IPADIC_ARCHIVE.sha256) {
		return {
			ok: false,
			reason: "sha256",
			expected: IPADIC_ARCHIVE.sha256,
			actual: digest,
		};
	}
	return { ok: true, content, bytes: content.byteLength, sha256: digest };
}

export function describeArchiveMismatch(result) {
	if (result.reason === "missing") {
		return `the archive is not present at the expected path`;
	}
	if (result.reason === "size") {
		return `expected ${result.expected} bytes, got ${result.actual}`;
	}
	return `expected SHA-256 ${result.expected}, got ${result.actual}`;
}

/**
 * Reads a response body without ever holding more than the pinned archive's
 * size plus one chunk, so a wrong or hostile response is refused early instead
 * of being buffered whole.
 */
async function readBoundedBody(response) {
	const limit = IPADIC_ARCHIVE.bytes;
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > limit) {
		throw new Error(
			`The server announced ${declared} bytes; the pinned archive is ${limit} bytes.`,
		);
	}
	if (response.body === null) {
		throw new Error("The response has no body.");
	}
	const chunks = [];
	let received = 0;
	const reader = response.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		received += value.byteLength;
		if (received > limit) {
			await reader.cancel();
			throw new Error(
				`The response is larger than the pinned archive (${limit} bytes).`,
			);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

function describeFetchFailure(error) {
	const cause = error instanceof Error ? error.cause : undefined;
	const detail =
		cause instanceof Error
			? cause.message
			: error instanceof Error
				? error.message
				: String(error);
	return detail;
}

/**
 * Downloads the pinned archive over HTTPS. It is reached only from the
 * dictionary bootstrap (`npm run prepare:dictionary`, or the first
 * `npm run build` / `npm run build:distribution` on a checkout with no
 * usable cache); tests, the watch build and the plugin runtime never call it.
 *
 * The response is written to a temporary name and verified against the pinned
 * byte count and SHA-256 *before* it is renamed into place, so an interrupted
 * or mismatching download can never be mistaken for a verified cache entry and
 * never replaces one. `fetchImpl` exists so tests can serve bytes without a
 * network; production callers leave it unset.
 */
async function downloadArchive(archivePath, fetchImpl = globalThis.fetch) {
	let content;
	try {
		const response = await fetchImpl(IPADIC_ARCHIVE.url, {
			redirect: "follow",
			signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
		});
		if (!response.ok) {
			throw new Error(
				`Downloading ${IPADIC_ARCHIVE.url} failed with HTTP ${response.status} ${response.statusText}.`,
			);
		}
		content = await readBoundedBody(response);
	} catch (error) {
		throw new Error(
			`Could not download the pinned Lindera IPADIC archive from ${IPADIC_ARCHIVE.url}: ${describeFetchFailure(error)}. ` +
				`The first build needs network access to that URL; nothing was extracted and no artifact was produced. ` +
				`To build offline, place the verified archive (${IPADIC_ARCHIVE.bytes} bytes, SHA-256 ${IPADIC_ARCHIVE.sha256}) at .cache/lindera/${IPADIC_ARCHIVE.name}.`,
			{ cause: error },
		);
	}
	await mkdir(path.dirname(archivePath), { recursive: true });
	const pending = `${archivePath}.partial`;
	await writeFile(pending, content);
	const verified = await verifyArchive(pending);
	if (!verified.ok) {
		await rm(pending, { force: true });
		throw new Error(
			`The downloaded archive does not match the pinned values (${describeArchiveMismatch(verified)}). Nothing was extracted.`,
		);
	}
	await rename(pending, archivePath);
	return verified;
}

/**
 * Returns the verified archive, reusing a correct cache entry and downloading
 * only when `allowDownload` is set.
 */
export async function ensureArchive(
	rootDir,
	{ allowDownload = false, fetchImpl } = {},
) {
	const archivePath = linderaArchivePath(rootDir);
	const cached = await verifyArchive(archivePath);
	if (cached.ok) {
		return { archivePath, downloaded: false, ...cached };
	}
	if (!allowDownload) {
		throw new Error(
			`The pinned Lindera IPADIC archive is unusable (${describeArchiveMismatch(cached)}). ` +
				`Run "${PREPARE_COMMAND}" to fetch it; nothing else in this repository downloads it.`,
		);
	}
	// A cached file that fails verification is never reused and never
	// extracted. It is only removed once a fresh download has verified, so a
	// failed attempt leaves the previous state as it was.
	const downloaded = await downloadArchive(archivePath, fetchImpl);
	return { archivePath, downloaded: true, ...downloaded };
}

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let index = 0; index < 256; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value;
	}
	return table;
})();

function crc32(buffer) {
	let crc = -1;
	for (const byte of buffer) {
		crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
	}
	return (crc ^ -1) >>> 0;
}

/**
 * Minimal ZIP reader: central directory, stored and deflated members, CRC-32
 * checked per member. Implemented here rather than shelled out to `unzip` so
 * the prepare step behaves the same on every platform and adds no dependency.
 */
export function readZipEntries(archive) {
	const EOCD_SIGNATURE = 0x06054b50;
	let eocd = -1;
	for (let offset = archive.length - 22; offset >= 0; offset -= 1) {
		if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
			eocd = offset;
			break;
		}
	}
	if (eocd < 0) {
		throw new Error("The archive has no ZIP end-of-central-directory record.");
	}

	const entryCount = archive.readUInt16LE(eocd + 10);
	let cursor = archive.readUInt32LE(eocd + 16);
	const entries = [];
	for (let index = 0; index < entryCount; index += 1) {
		if (archive.readUInt32LE(cursor) !== 0x02014b50) {
			throw new Error(
				`The archive's central directory entry ${index} has a bad signature.`,
			);
		}
		const method = archive.readUInt16LE(cursor + 10);
		const crc = archive.readUInt32LE(cursor + 16);
		const compressedSize = archive.readUInt32LE(cursor + 20);
		const uncompressedSize = archive.readUInt32LE(cursor + 24);
		const nameLength = archive.readUInt16LE(cursor + 28);
		const extraLength = archive.readUInt16LE(cursor + 30);
		const commentLength = archive.readUInt16LE(cursor + 32);
		const localHeader = archive.readUInt32LE(cursor + 42);
		const name = archive
			.subarray(cursor + 46, cursor + 46 + nameLength)
			.toString("utf8");
		entries.push({
			name,
			method,
			crc,
			compressedSize,
			uncompressedSize,
			localHeader,
		});
		cursor += 46 + nameLength + extraLength + commentLength;
	}

	return entries.map((entry) => {
		if (entry.name.endsWith("/")) {
			return { name: entry.name, content: null };
		}
		if (archive.readUInt32LE(entry.localHeader) !== 0x04034b50) {
			throw new Error(`The archive member ${entry.name} has a bad local header.`);
		}
		const nameLength = archive.readUInt16LE(entry.localHeader + 26);
		const extraLength = archive.readUInt16LE(entry.localHeader + 28);
		const start = entry.localHeader + 30 + nameLength + extraLength;
		const raw = archive.subarray(start, start + entry.compressedSize);
		let content;
		if (entry.method === 0) {
			content = Buffer.from(raw);
		} else if (entry.method === 8) {
			content = inflateRawSync(raw);
		} else {
			throw new Error(
				`The archive member ${entry.name} uses unsupported compression method ${entry.method}.`,
			);
		}
		if (content.byteLength !== entry.uncompressedSize) {
			throw new Error(
				`The archive member ${entry.name} inflated to ${content.byteLength} bytes, expected ${entry.uncompressedSize}.`,
			);
		}
		if (crc32(content) !== entry.crc) {
			throw new Error(`The archive member ${entry.name} failed its CRC-32 check.`);
		}
		return { name: entry.name, content };
	});
}

/**
 * Extracts the pinned archive into the cache. Members are flattened out of the
 * single `lindera-ipadic/` root; any member outside that root, or any path
 * segment that could escape the output directory, aborts the extraction.
 */
export async function extractArchive(archive, outDir) {
	const entries = readZipEntries(archive);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	const written = [];
	for (const entry of entries) {
		if (entry.content === null) {
			continue;
		}
		const prefix = `${IPADIC_ARCHIVE.rootEntry}/`;
		if (!entry.name.startsWith(prefix)) {
			throw new Error(
				`The archive member ${entry.name} is outside ${prefix}; extraction aborted.`,
			);
		}
		const relative = entry.name.slice(prefix.length);
		if (relative.includes("/") || relative === "" || relative.startsWith(".")) {
			throw new Error(
				`The archive member ${entry.name} is not a plain file in ${prefix}; extraction aborted.`,
			);
		}
		await writeFile(path.join(outDir, relative), entry.content);
		written.push({ fileName: relative, bytes: entry.content.byteLength });
	}
	return written.sort((left, right) =>
		left.fileName.localeCompare(right.fileName),
	);
}

/**
 * Fails with every missing file named, so a partial dictionary can never reach
 * the compaction step or the artifact.
 */
export async function assertDictionaryDir(dir, label, fileNames = LINDERA_DICTIONARY_FILE_NAMES) {
	try {
		await access(dir, constants.R_OK);
	} catch {
		throw new Error(
			`The Lindera dictionary directory is missing (${label}). Run "${PREPARE_COMMAND}".`,
		);
	}
	const missing = [];
	for (const fileName of fileNames) {
		try {
			await access(path.join(dir, fileName), constants.R_OK);
		} catch {
			missing.push(fileName);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`The Lindera dictionary is incomplete (${label}): missing ${missing.join(", ")}. ` +
				`Run "${PREPARE_COMMAND}".`,
		);
	}
}

export async function measureDictionaryDir(dir, fileNames = LINDERA_DICTIONARY_FILE_NAMES) {
	const files = [];
	let totalBytes = 0;
	for (const fileName of fileNames) {
		const { size } = await stat(path.join(dir, fileName));
		files.push({ fileName, bytes: size });
		totalBytes += size;
	}
	return { files, totalBytes };
}

/**
 * Guards against an install that no longer matches the pinned WASM version.
 *
 * This reads only the package's own claim about itself. It is the cheaper,
 * clearer failure to report first, but it is not sufficient on its own:
 * `assertLinderaWasmPackage` in ./packageHashes.mjs checks the bytes the build
 * actually embeds, and both run before any artifact is produced.
 */
export async function assertLinderaWasmVersion(rootDir) {
	const manifestPath = path.join(
		linderaWasmPackageDir(rootDir),
		"package.json",
	);
	let installed;
	try {
		installed = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch {
		throw new Error(
			`${LINDERA_WASM_PACKAGE} is not installed. Run npm install.`,
		);
	}
	if (installed.version !== LINDERA_WASM_VERSION) {
		throw new Error(
			`${LINDERA_WASM_PACKAGE} must be exactly ${LINDERA_WASM_VERSION}; found ${installed.version}.`,
		);
	}
	return installed.version;
}
