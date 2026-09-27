import { readFileSync } from "node:fs";
import path from "node:path";
import initLinderaWasm, {
	Tokenizer,
	loadDictionaryFromBytes,
} from "virtual:semantropy-lindera-wasm";
import {
	linderaCompactDictionaryDir,
	linderaFullDictionaryDir,
	linderaWasmPath,
} from "../../scripts/lindera/linderaSource.mjs";
import type { JapaneseToken } from "../../src/tokenizer/JapaneseTokenizer";
import { LINDERA_TOKENIZER_MODE } from "../../src/tokenizer/lindera/linderaEngine";
import { LINDERA_DICTIONARY_FILE_NAMES } from "../../src/tokenizer/lindera/linderaPayload";
import { toJapaneseTokensFromLindera } from "../../src/tokenizer/lindera/linderaToken";

export type Tokenize = (text: string) => JapaneseToken[];

const rootDir = process.cwd();

let wasmReady: Promise<unknown> | null = null;

/**
 * Instantiates the WebAssembly module once per test process. The bytes are
 * read here with Node because this is a test harness; the code under test is
 * handed bytes and never looks at a path.
 */
export function initLindera(): Promise<unknown> {
	wasmReady ??= initLinderaWasm({
		module_or_path: new Uint8Array(readFileSync(linderaWasmPath(rootDir))),
	});
	return wasmReady;
}

/**
 * Builds a tokenizer over one dictionary directory — optionally with some
 * files replaced by in-memory bytes, for a candidate dictionary that is never
 * written to the build cache — through the same adapter
 * and the same direct `new Tokenizer(...)` construction the plugin uses — so
 * the comparison is between dictionaries, not between two different mapping
 * rules or two different construction paths.
 */
export function buildTokenize(
	dictionaryDir: string,
	overrides: Readonly<Record<string, Uint8Array>> = {},
): Tokenize {
	const buffers = LINDERA_DICTIONARY_FILE_NAMES.map(
		(fileName) =>
			overrides[fileName] ??
			new Uint8Array(readFileSync(path.join(dictionaryDir, fileName))),
	);
	const dictionary = loadDictionaryFromBytes(
		buffers[0]!,
		buffers[1]!,
		buffers[2]!,
		buffers[3]!,
		buffers[4]!,
		buffers[5]!,
		buffers[6]!,
		buffers[7]!,
		buffers[8]!,
	);
	const tokenizer = new Tokenizer(dictionary, LINDERA_TOKENIZER_MODE, undefined);
	return (text) =>
		toJapaneseTokensFromLindera(
			text,
			tokenizer.tokenize(text) as never[],
		);
}

export function fullDictionaryDir(): string {
	return linderaFullDictionaryDir(rootDir);
}

export function compactDictionaryDir(): string {
	return linderaCompactDictionaryDir(rootDir);
}

/** The projection Semantropy's token policy actually reads. */
export function semantropyProjection(token: JapaneseToken): string {
	return [
		token.surface,
		token.isUnknown ? "U" : "K",
		token.pos,
		token.detail1,
		token.detail2,
	].join("|");
}

export const TARGET_NOUN_DETAIL1 = new Set([
	"一般",
	"固有名詞",
	"サ変接続",
	"形容動詞語幹",
]);

export function isTargetNounToken(token: JapaneseToken): boolean {
	return token.pos === "名詞" && TARGET_NOUN_DETAIL1.has(token.detail1);
}
