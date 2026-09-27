import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	LINDERA_WASM_PACKAGE,
	LINDERA_WASM_VERSION,
	linderaWasmPackageDir,
	sha256Hex,
} from "./linderaSource.mjs";

/**
 * The SHA-256 of every file the build reads out of the installed lindera-wasm
 * package, pinned in source control.
 *
 * Checking the installed version is not enough on its own. `package.json` is
 * a claim about what a directory contains, not a statement about its bytes: a
 * modified or truncated `lindera_wasm_bg.wasm` under a manifest still saying
 * 6.0.0 would be embedded in the artifact unchecked. `package-lock.json`
 * carries an npm integrity hash, but npm only verifies it while installing —
 * an ordinary `npm run build` re-reads `node_modules` and never revalidates
 * it, and neither does anything that edits those files after install.
 *
 * All three files below are build inputs, and all three end up in what ships:
 *
 *   lindera_wasm_bg.wasm  embedded byte-for-byte as gzip + base64
 *   lindera_wasm.js       bundled after its loader block is rewritten
 *   LICENSE               reproduced verbatim in the artifact's banner
 *
 * so a change to any of them changes the artifact, and the last one changes
 * the licence text users receive. Updating lindera-wasm is a deliberate act,
 * and it must come with an update to these hashes in the same change.
 */
export const LINDERA_WASM_PACKAGE_SHA256 = Object.freeze({
	"lindera_wasm_bg.wasm":
		"4ee783f6025e66e0217febd2c78f9ef87b405ec8df884902239e7ee8a9df4ee4",
	"lindera_wasm.js":
		"86fefd1c6997ae89e07a5405ea8c9fde1c53ed169834f19aada2d491bd63dc55",
	LICENSE: "8c4895986c32387571617c9bdb61f416e9370aa2daec8d041bc8b686fb28c1cf",
});

export const LINDERA_WASM_PACKAGE_FILE_NAMES = Object.freeze(
	Object.keys(LINDERA_WASM_PACKAGE_SHA256),
);

export async function measureLinderaWasmPackageHashes(packageDir) {
	const hashes = {};
	for (const fileName of LINDERA_WASM_PACKAGE_FILE_NAMES) {
		hashes[fileName] = sha256Hex(await readFile(path.join(packageDir, fileName)));
	}
	return hashes;
}

/**
 * Verifies the installed package's bytes against the pinned hashes, naming
 * every file that does not match.
 *
 * There is deliberately no parameter for the expected hashes. A caller that
 * could supply hashes matching whatever install it points at would make this
 * check vacuous while the build still reported the package as the pinned one.
 * `rootDir` only chooses which tree to read.
 */
export async function assertLinderaWasmPackage(rootDir) {
	const packageDir = linderaWasmPackageDir(rootDir);

	let actual;
	try {
		actual = await measureLinderaWasmPackageHashes(packageDir);
	} catch (error) {
		throw new Error(
			`${LINDERA_WASM_PACKAGE} is missing a file the build reads ` +
				`(${error instanceof Error ? error.message : String(error)}). Run npm ci.`,
		);
	}

	const mismatched = LINDERA_WASM_PACKAGE_FILE_NAMES.filter(
		(fileName) => actual[fileName] !== LINDERA_WASM_PACKAGE_SHA256[fileName],
	);
	if (mismatched.length === 0) {
		return actual;
	}

	const detail = mismatched
		.map(
			(fileName) =>
				`  ${fileName}\n    expected ${LINDERA_WASM_PACKAGE_SHA256[fileName]}\n    actual   ${actual[fileName]}`,
		)
		.join("\n");
	throw new Error(
		`The installed ${LINDERA_WASM_PACKAGE} does not match the hashes pinned in ` +
			`scripts/lindera/packageHashes.mjs, so it is not the ${LINDERA_WASM_VERSION} ` +
			`package this artifact is built from — the version in its package.json ` +
			`says otherwise:\n${detail}\n` +
			`Either node_modules was modified — delete it and run "npm ci" — or ` +
			`lindera-wasm was deliberately updated, in which case update the pinned ` +
			`hashes in the same change.`,
	);
}
