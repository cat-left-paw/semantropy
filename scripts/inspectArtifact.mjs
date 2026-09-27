import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
	KUROMOJI_MARKERS,
	WASM_RUNTIME_DEPENDENCY_MARKERS,
	machineMarkers,
	maskBase64Literals,
	splitBanner,
} from "./artifactMarkers.mjs";
import { DISTRIBUTION_FILE_NAMES } from "./buildDistribution.mjs";
import { LINDERA_DICTIONARY_FILE_NAMES } from "./lindera/linderaSource.mjs";

/** A date the archive could have been fetched on would look like one of these. */
const TIMESTAMP_PATTERNS = [
	/\b20\d{2}-[01]\d-[0-3]\d\b/,
	/\b20\d{2}\/[01]\d\/[0-3]\d\b/,
	/\bGMT[+-]\d/,
];

export async function inspectArtifact(outDir, rootDir = process.cwd()) {
	const entries = await readdir(outDir, { withFileTypes: true });
	const files = [];
	const unexpected = [];
	for (const entry of [...entries].sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		if (!entry.isFile()) {
			unexpected.push(`${entry.name}/`);
			continue;
		}
		const content = await readFile(path.join(outDir, entry.name));
		files.push({
			fileName: entry.name,
			bytes: content.byteLength,
			sha256: createHash("sha256").update(content).digest("hex"),
		});
		if (!DISTRIBUTION_FILE_NAMES.includes(entry.name)) {
			unexpected.push(entry.name);
		}
	}

	const raw = await readFile(path.join(outDir, "main.js"), "utf8");
	const { banner, code } = splitBanner(raw);
	// The payload is masked before every scan below: see maskBase64Literals.
	const { masked, literals } = maskBase64Literals(code, LINDERA_DICTIONARY_FILE_NAMES);

	const payloadChars = literals.reduce(
		(sum, literal) => sum + literal.chars,
		0,
	);

	const leakedMachineMarkers = machineMarkers(rootDir).filter((marker) =>
		masked.includes(marker),
	);
	const runtimeDependencyMarkers = WASM_RUNTIME_DEPENDENCY_MARKERS.filter(
		(marker) => masked.includes(marker),
	);
	const kuromojiMarkers = KUROMOJI_MARKERS.filter((marker) =>
		masked.includes(marker),
	);
	const timestampMarkers = TIMESTAMP_PATTERNS.flatMap((pattern) => {
		const match = pattern.exec(masked);
		return match ? [match[0]] : [];
	});
	const missingDictionaryKeys = LINDERA_DICTIONARY_FILE_NAMES.filter(
		(fileName) => !code.includes(JSON.stringify(fileName)),
	);

	return {
		outDir,
		files,
		fileNames: files.map((file) => file.fileName),
		unexpected,
		bannerBytes: Buffer.byteLength(banner),
		codeBytes: Buffer.byteLength(code),
		/** Bundle code with the base64 payload removed: what actually runs. */
		maskedCodeBytes: Buffer.byteLength(masked),
		payloadLiteralCount: literals.length,
		payloadChars,
		leakedMachineMarkers,
		runtimeDependencyMarkers,
		kuromojiMarkers,
		timestampMarkers,
		missingDictionaryKeys,
		totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
	};
}
