import os from "node:os";
import path from "node:path";

/**
 * The scans a self-contained artifact has to pass. Kept apart from the
 * inspector so a rule reads as a rule rather than as one step of one script.
 */

/** Structural path segments that carry no information about the machine. */
const GENERIC_PATH_SEGMENTS = new Set([
	"Users",
	"home",
	"Volumes",
	"mnt",
	"media",
	"plugins",
	"obsidian",
	".obsidian",
	"node_modules",
	// Windows' generic temporary directory is also a substring of coreTemplates.
	// Full paths and explicit vault/user names are still checked below.
	"Temp",
	// GitHub-hosted runners check out to /home/runner/work/<repo>/<repo>, and
	// "work" is an ordinary word in the bundled code. The full path, "/home/"
	// and the runner's user name are still checked.
	"work",
]);

/**
 * Anything that would reveal the build machine. Checked against the code
 * section only: the verbatim notice banner legitimately carries upstream URLs.
 */
export function machineMarkers(rootDir) {
	const markers = new Set([
		"/Users/",
		"/home/",
		"/Volumes/",
		"C:\\",
		"node_modules",
		rootDir,
	]);

	const projectName = path.basename(rootDir);
	const ancestors = path.dirname(rootDir).split(path.sep);
	for (const [index, segment] of ancestors.entries()) {
		// The directory holding `.obsidian` is the vault name.
		if (segment === ".obsidian" && index > 0) {
			const vaultName = ancestors[index - 1];
			if (vaultName) {
				markers.add(vaultName);
			}
		}
		if (
			segment.length >= 4 &&
			segment !== projectName &&
			!GENERIC_PATH_SEGMENTS.has(segment)
		) {
			markers.add(segment);
		}
	}

	try {
		const { username, homedir } = os.userInfo();
		if (username && username.length >= 3) {
			markers.add(username);
		}
		if (homedir) {
			markers.add(homedir);
		}
	} catch {
		// userInfo can fail on systems without a passwd entry; the path-derived
		// markers above still apply.
	}

	return [...markers].filter((marker) => marker.length > 2);
}

/**
 * Anything that would mean the installed plugin still needs a file, a browser
 * storage area or a server at runtime.
 */
export const RUNTIME_DEPENDENCY_MARKERS = [
	"fetch(",
	"XMLHttpRequest",
	"getResourcePath",
	"http://",
	"https://",
	"app://",
	"capacitor://",
	"dict/",
	'require("fs")',
	'require("node:fs")',
];

/**
 * Traces of the Kuromoji tokenizer this plugin used before Lindera. A hit
 * would mean a bundle still carried the removed analyzer, its trie library or
 * its external dictionary files.
 */
export const KUROMOJI_MARKERS = [
	"kuromoji",
	"Kuromoji",
	"@faanau",
	"doublearray",
	"DoubleArray",
	"DynamicDictionaries",
	"DictionaryLoader",
	"base.dat.gz",
	"unk.dat.gz",
	"tid_map.dat.gz",
];

/** The extra routes a WebAssembly build could take to acquire its own bytes. */
export const WASM_RUNTIME_DEPENDENCY_MARKERS = [
	...RUNTIME_DEPENDENCY_MARKERS,
	"instantiateStreaming",
	"import.meta",
	"navigator.storage",
	"getDirectory",
	"createSyncAccessHandle",
	"createWritable",
	"downloadDictionary",
	"loadDictionaryFiles",
];

export function splitBanner(content) {
	const end = content.indexOf("*/");
	if (end < 0 || content.trimStart().slice(0, 2) !== "/*") {
		return { banner: "", code: content };
	}
	return { banner: content.slice(0, end + 2), code: content.slice(end + 2) };
}

const BASE64_LITERAL = /"[A-Za-z0-9+/]{4096,}={0,2}"/g;

/**
 * Replaces the embedded base64 payload literals with a fixed placeholder
 * before the marker scan. The known dictionary keys cover the three gzip
 * literals shorter than the general 4096-character threshold.
 *
 * Without this the scan is unsound in both directions: several markers
 * ("dict/", "node_modules") are spellable in the base64 alphabet, so a
 * megabytes-long payload can produce a false positive by chance, and there is
 * no way to tell such a hit from a real one. Masking the payload makes every
 * remaining hit a genuine reference in the code, and the literals are checked
 * separately for being pure base64.
 */
export function maskBase64Literals(code, dictionaryFileNames = []) {
	const literals = [];
	let masked = code;
	if (dictionaryFileNames.length) {
		const keys = dictionaryFileNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
		const named = new RegExp(`"(${keys})"(\\s*:\\s*)"([A-Za-z0-9+/]+={0,2})"`, "g");
		const seen = new Set();
		masked = masked.replace(named, (_match, key, separator, value) => {
			if (seen.has(key)) throw new Error(`Duplicate embedded dictionary payload: ${key}`);
			seen.add(key);
			literals.push({ chars: value.length });
			return `"${key}"${separator}"<base64-payload>"`;
		});
		if (seen.size !== dictionaryFileNames.length) throw new Error("Embedded dictionary payload is missing or malformed.");
	}
	masked = masked.replace(BASE64_LITERAL, (match) => {
		literals.push({ chars: match.length - 2 });
		return '"<base64-payload>"';
	});
	return { masked, literals };
}
