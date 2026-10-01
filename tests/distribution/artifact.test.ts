import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	DISTRIBUTION_FILE_NAMES,
	buildDistribution,
	buildProductionMain,
} from "../../scripts/buildDistribution.mjs";
import { inspectArtifact } from "../../scripts/inspectArtifact.mjs";
import { machineMarkers, maskBase64Literals, splitBanner } from "../../scripts/artifactMarkers.mjs";
import { canonicalizeMinifiedIdentifiers } from "../../scripts/canonicalizeArtifactCode.mjs";
import {
	IPADIC_ARCHIVE,
	LINDERA_DICTIONARY_FILE_NAMES,
	LINDERA_NOTICE_FILE_NAME,
	LINDERA_WASM_VERSION,
	linderaArchivePath,
	linderaCompactDictionaryDir,
	linderaFullDictionaryDir,
	measureDictionaryDir,
	sha256Hex,
	verifyArchive,
} from "../../scripts/lindera/linderaSource.mjs";
import { buildCompactWords } from "../../scripts/lindera/compactDictionary.mjs";
import {
	COMPACT_DICTIONARY_SHA256,
	FULL_DICTIONARY_SHA256,
	REWRITTEN_FILE_NAMES,
	VERIFIED_DICTIONARY_FILE_NAMES,
	measureDictionaryHashes,
} from "../../scripts/lindera/dictionaryHashes.mjs";
import {
	createHarnessRecords,
	DEFAULT_OPEN_MARKDOWN,
	emulateCollectionMarkdown,
	loadPluginArtifact,
	openHarnessNote,
	runCommandUntilNotice,
} from "../../scripts/obsidianPluginHarness.mjs";
import { DEFAULT_COLLECTION_PATH } from "../../src/settings/collectionPath";
import { DEFAULT_DICTIONARY_SEMANTROPY } from "../../src/settings/dictionarySemantropy";
import { SEMANTROPY_SETTINGS_SCHEMA_VERSION } from "../../src/settings/semantropySettings";
import type { SemantropyView } from "../../src/view/SemantropyView";
import type { CollisionSession } from "../../src/view/CollisionSession";
import type { CollisionModal } from "../../src/view/CollisionModal";

type Inspection = Awaited<ReturnType<typeof inspectArtifact>>;
type Build = Awaited<ReturnType<typeof buildDistribution>>;

const rootDir = process.cwd();
const primaryDir = path.join("dist", "semantropy");
const rebuildDir = path.join("dist", "semantropy-rebuild-test");
const scratchDir = path.join("dist", "semantropy-scratch");
/** The plugin-root build goes to its own path here, so a test run never
 * overwrites the `main.js` a developer has loaded in Obsidian. */
const productionMainPath = path.join(scratchDir, "production-main.js");

/**
 * MAX-VIEW1: a saved 100 is MAX. The relaxed noun family lets all three nouns
 * (太郎 / 駅 / 花子) move, so every slot changes, only to another of the
 * three nouns, and the particles and verb stay exactly as written. Which
 * permutation appears depends on the private nonce and is not pinned.
 */
function expectMaxOpenBody(text: string): void {
	const match = /^(太郎|花子|駅)は(太郎|花子|駅)で(太郎|花子|駅)を待っていた。$/u.exec(text);
	expect(match).not.toBeNull();
	expect(match!.slice(1)).not.toContain(undefined);
	expect([match![1] !== "太郎", match![2] !== "駅", match![3] !== "花子"]).toEqual([true, true, true]);
}

function recordsWithMaxBodySemantropy() {
	const records = createHarnessRecords();
	records.savedData = {
		schemaVersion: SEMANTROPY_SETTINGS_SCHEMA_VERSION,
		bodySemantropy: 100,
		dictionarySemantropy: DEFAULT_DICTIONARY_SEMANTROPY,
		collectionPath: DEFAULT_COLLECTION_PATH,
	};
	return records;
}

let firstBuild: Build;
let inspection: Inspection;

beforeAll(async () => {
	firstBuild = await buildDistribution({ outDir: primaryDir });
	inspection = await inspectArtifact(firstBuild.outDir, rootDir);
}, 600_000);

afterAll(async () => {
	for (const dir of [path.dirname(rebuildDir), rebuildDir, scratchDir]) {
		if (dir === "dist") {
			continue;
		}
		await rm(path.resolve(rootDir, dir), { recursive: true, force: true });
	}
});

describe("distribution artifact shape", () => {
	it("normalizes short named payloads without hiding unrelated short strings", () => {
		const original = 'var x={"metadata.json":"QUJD","char_def.bin":"REVG","unk.bin":"R0hJ"};var other="QUJD";';
		const changed = 'var x={"metadata.json":"QUJDQUJD","char_def.bin":"REVGREVG","unk.bin":"R0hJR0hJ"};var other="QUJD";';
		const keys = ["metadata.json", "char_def.bin", "unk.bin"];
		const first = maskBase64Literals(original, keys);
		const second = maskBase64Literals(changed, keys);
		expect(first.literals).toHaveLength(3);
		expect(first.masked).toBe(second.masked);
		expect(first.masked).toContain('var other="QUJD"');
		expect(() => maskBase64Literals(original, [...keys, "dict.trie"])).toThrow("Embedded dictionary payload is missing or malformed.");
	});
	it("normalizes minified bindings while retaining their references and public names", () => {
		const original = "var a=1,b=2;globalThis.answer=a+b;";
		const renamed = "var x=1,y=2;globalThis.answer=x+y;";
		const wrongReference = "var x=1,y=2;globalThis.answer=y+y;";
		const changedProperty = "var x=1,y=2;globalThis.result=x+y;";
		const canonical = canonicalizeMinifiedIdentifiers(original);
		expect(canonicalizeMinifiedIdentifiers(renamed)).toBe(canonical);
		expect(canonicalizeMinifiedIdentifiers(wrongReference)).not.toBe(canonical);
		expect(canonicalizeMinifiedIdentifiers(changedProperty)).not.toBe(canonical);
	});
	it("pins the Manual paragraph rebuild code independently of compressed payload bytes", async () => {
		const bytes = await readFile(path.join(firstBuild.outDir, "main.js"));
		// Historical whole-artifact measurements; the production contract is tested below.
		// History: MAX-VIEW1 (unchanged through Fake Proverb TEMPLATES1-COLLECT1) was 15,610,350 bytes / bd456eec…22ae;
		// FAKE-PROVERB-VIEW1 was 15,661,073 bytes / bb49a45b…e5c3; EXPERIENCE-DISPLAY1 was 15,661,812 bytes / b58e80fe…5bf5;
		// the first VOCABULARY1 submission was 15,671,085 bytes / 320d8cdf…b919;
		// the Current Note P1 correction was 15,672,282 bytes / a78e718e…05dd;
		// the accepted VOCABULARY1 (Apply / Cancel visibility correction) was 15,672,335 bytes / 14c6c758…6e08;
		// the first TOKEN-UI1 submission was 15,674,622 bytes / 67dc7fb0…40bc;
		// the accepted TOKEN-UI1 was 15,675,393 bytes / c6769ad4…490c;
		// the accepted DICTIONARY-OUTPUT1 was 15,675,471 bytes / 7d11fb7e…a57e;
		// the first CONTROLS1 submission (icon + label, before the owner's icon-only row policy) was 15,675,922 bytes / cd61305e…85ae3;
		// the icon-only row submitted for review 1 was 15,684,034 bytes / 3b3bc3e7…5990;
		// the review 1 correction submitted for re-review 2 was 15,684,299 bytes / 8a7f1178…4972;
		// the accepted CONTROLS1 (committed as 5b54bfa) was 15,686,030 bytes / 7b3f7c49…8aee;
		// the accepted DICTIONARY-LEVEL1 (committed as dcf92ec) was 15,686,040 bytes / 3e6a82be…112a;
		// the accepted LOCALE1 (committed as 52f8870) was 15,737,957 bytes / 7cecd1f0…980f;
		// the accepted MODAL-LAYOUT1 (committed as 1ab3812) was 15,738,015 bytes / 21dc556e…e986.
		// the accepted WORDING1 (committed as cd06aa3) was 15,738,403 bytes / ba7fe3d9…d074.
		// Accepted TOOLBAR-FINISH1 (committed as ee64ab6) was 15,738,440 bytes / fb1a7e6c…d5c on Windows.
		// The pin below was 556,854 masked / 705,545 canonical / 8b93626f…d009.
		// UI-POLISH1 before the ribbon correction was 15,743,331 bytes / e5957e86…a601.
		// Masked code was 560,888; canonical identifiers were 710,160 / fc7bf2da…1726.
		// The ribbon registration correction is 15,743,445 bytes / 5905c54f…5a3b on Windows.
		// Masked code was 561,002; canonical identifiers were 710,294 / 00987d7f…f249.
		// COLLECT-COMMENT1 (committed as 004969c) is 15,743,252 bytes / bfb351a7…8f75 on Windows.
		// Masked code was 560,809; canonical identifiers were 710,024 / f805c859…3b38.
		// COLLECT-ATTRIBUTION1 (uncommitted) is 15,750,440 bytes / df516020…b231 on Windows.
		// Masked code is 567,997; canonical identifiers are 718,710 / 38b3159f…e55c.
		// The Strict line breaks and owner UI/date revision is 15,751,892 bytes / 3345891e…1286 on Windows.
		// Masked code is 569,449; canonical identifiers are 720,420 / 955bec50…27c7.
		// 0.1.0 (S1–S5 and their review corrections) was 15,794,886 bytes / 475d3584…ed43 on Windows.
		// Masked code was 611,148; canonical identifiers were 773,817 / b94c220e…b359.
		// With the owner's Recompose provenance (mixed method, leap range) it was 15,795,800 bytes / 64f0725d…3f83.
		// Masked code was 612,062; canonical identifiers were 775,118 / 65d38cd2…ae0a.
		// With the delayed Collision row note (no flicker) it was 15,796,378 bytes / d33c45ed…942f.
		// Masked code was 612,640; canonical identifiers were 775,814 / c9c11249…5d8e.
		// With the pencil-sparkles icon, the plain Recompose title and uncapped popups it was
		// 15,796,580 bytes / c634e41a…e207. Masked code was 612,842; canonical identifiers were 776,081 / 6fc6786f…0c7b.
		// With wand-sparkles (and its fallback), the compact Display settings and the output scrolling it is
		// 15,796,866 bytes / 4fd24c6a…bd32b. Masked code is 613,128; canonical identifiers are 776,464 / 7374d3ea…587d.
		// This PR is 15,739,297 bytes on Windows and 14,170,925 on macOS. The bundle
		// embeds host-compressed payloads. Native esbuild builds also choose different
		// short local names on macOS and Windows, while the token sequence and every
		// non-identifier value match. Pin the code after masking payloads and naming
		// resolved short bindings by declaration order. The byte-identical rebuild
		// test below still checks all three files within each build environment.
		const { code } = splitBanner(bytes.toString("utf8"));
		const { masked, literals } = maskBase64Literals(code, LINDERA_DICTIONARY_FILE_NAMES);
		expect(literals).toHaveLength(10);
		expect(literals.filter(literal => literal.chars < 4096)).toHaveLength(3);
		expect(Buffer.byteLength(masked)).toBe(613128);
		const canonical = canonicalizeMinifiedIdentifiers(masked);
		expect(Buffer.byteLength(canonical)).toBe(776464);
		expect(sha256Hex(Buffer.from(canonical))).toBe("7374d3eac0d2dde49993ba54e177fd7f8ba1e43f4c1f9b82517b0dd78926587d");
	});
	it("contains only main.js, manifest.json and styles.css", () => {
		expect(inspection.fileNames).toEqual(DISTRIBUTION_FILE_NAMES);
		expect(inspection.unexpected).toEqual([]);
	});

	it("records main.js bytes as a monitoring metric", () => {
		const main = inspection.files.find(
			(file: { fileName: string }) => file.fileName === "main.js",
		);
		expect(main?.bytes).toEqual(expect.any(Number));
		expect(main?.bytes).toBeGreaterThan(0);
	});

	it("carries no machine-specific absolute path, vault name or user name", () => {
		expect(inspection.leakedMachineMarkers).toEqual([]);
	});

	it("does not mistake coreTemplates for a Windows temporary-directory leak", () => {
		const temporaryRoot = path.join(path.parse(rootDir).root, "Users", "fixture-user", "AppData", "Local", "Temp", "history-free");
		const markers = machineMarkers(temporaryRoot);
		expect(markers.filter((marker) => '{"coreTemplates":[]}'.includes(marker))).toEqual([]);
		expect(markers).toContain(temporaryRoot);
		expect(markers).toContain("fixture-user");
	});

	it("still detects an explicitly named Temp vault and its complete path", () => {
		const vaultRoot = path.join(path.parse(rootDir).root, "Temp", ".obsidian", "plugins", "semantropy");
		const markers = machineMarkers(vaultRoot);
		expect(markers).toContain("Temp");
		expect(markers).toContain(vaultRoot);
	});

	it("requests no external dictionary URL and no runtime download", () => {
		expect(inspection.runtimeDependencyMarkers).toEqual([]);
	});

	it("carries no trace of the removed Kuromoji tokenizer or its dictionary", () => {
		expect(inspection.kuromojiMarkers).toEqual([]);
	});

	it("records no archive download date", () => {
		expect(inspection.timestampMarkers).toEqual([]);
	});

	it("embeds all nine dictionary files plus the WebAssembly module", async () => {
		const { totalBytes } = await measureDictionaryDir(
			linderaCompactDictionaryDir(rootDir),
		);

		expect(inspection.missingDictionaryKeys).toEqual([]);
		// Ten gzip payloads: the module and the nine dictionary files. Three of
		// them are small enough to fall under the masking threshold.
		expect(inspection.payloadLiteralCount).toBe(10);
		// base64 of gzip, so smaller than the raw dictionary but far larger than
		// the code around it.
		expect(inspection.payloadChars).toBeGreaterThan(8_000_000);
		expect(inspection.payloadChars).toBeLessThan(totalBytes);
		// Owner amendment, 2026-09-21: former 350k stop retired for VIEW1.
		// EXPERIENCE-CONTROLS1 review 1, 2026-09-24: the provisional UI-scope cap is reset
		// from 500,000 to 520,000 (CONTROLS1 is 504,015). Growth is still recorded per slice,
		// and exceeding this cap needs another explicit decision. The owner approved
		// 520,000 after the final CONTROLS1 independent re-review.
		// EXPERIENCE-LOCALE1, 2026-09-25: the owner raised the provisional UI-scope cap to
		// 600,000 for the English / Japanese catalog (option A, esbuild charset unchanged).
		// It is not a usage target; growth is still recorded per slice, and a slice expected
		// to exceed it needs another explicit decision.
		// 0.1.0, 2026-10-01: with S4 at 585,835 and S5 (Recompose in Obsidian) expected to
		// exceed 600,000, the owner raised the provisional cap to 650,000 on the same terms.
		expect(inspection.maskedCodeBytes).toBeLessThan(650_000);
	});

	it("rebuilds byte-identically from the same dictionary source", async () => {
		const rebuilt = await buildDistribution({ outDir: rebuildDir });

		for (const fileName of DISTRIBUTION_FILE_NAMES) {
			const before = firstBuild.files.find(
				(file: { fileName: string }) => file.fileName === fileName,
			);
			const after = rebuilt.files.find(
				(file: { fileName: string }) => file.fileName === fileName,
			);
			expect(after?.sha256).toBe(before?.sha256);
		}
	}, 600_000);
});

describe("the licence and notice banner", () => {
	let banner: string;

	beforeAll(async () => {
		const main = await readFile(path.join(firstBuild.outDir, "main.js"), "utf8");
		banner = main.slice(0, main.indexOf("*/") + 2);
	});

	it("reproduces the lindera-wasm MIT licence and the mecab-ipadic notice", () => {
		expect(banner).toContain("MIT License");
		expect(banner).toContain(`lindera-wasm ${LINDERA_WASM_VERSION}`);
		expect(banner).toContain("mecab-ipadic-2.7.0-20070801");
		expect(banner).toContain("Nara Institute of Science and Technology");
		expect(banner).toContain("NO WARRANTY");
		expect(banner).toContain(IPADIC_ARCHIVE.name);
	});

	it("reproduces Semantropy's own MIT licence and public repository", async () => {
		const ownLicense = await readFile(path.join(rootDir, "LICENSE"), "utf8");
		expect(banner).toContain("Semantropy's own plugin code is licensed under the MIT License.");
		expect(banner).toContain("Semantropy - LICENSE (verbatim)");
		expect(banner).toContain(ownLicense.trimEnd());
		expect(banner).not.toContain("0-BSD");
		expect(banner).toContain("Cat Left Paw");
		expect(banner).toContain("https://github.com/cat-left-paw/semantropy");
	});

	it("states what the build changed, including the compaction rules", () => {
		expect(banner).toContain("392,126");
		expect(banner).toContain("dict.words");
		expect(banner).toContain("dict.wordsidx");
		expect(banner).toContain("一般");
		expect(banner).toContain("固有名詞");
		expect(banner).toContain("サ変接続");
		expect(banner).toContain("形容動詞語幹");
		expect(banner).toContain("Independent verbs and i-adjectives retain the third subcategory");
		expect(banner).toContain("conjugation type, conjugation form, base form and reading");
		expect(banner).toContain("Pronunciation is dropped");
		expect(banner).not.toContain("Conjugation type, conjugation form and pronunciation are dropped");
		expect(banner).toContain("byte-for-byte");
	});

	it("no longer describes itself as a spike or as something other than the product build", () => {
		// The banner is what a user reads inside the shipped file; it must
		// describe the build that actually ships, not the experiment it grew
		// out of.
		for (const stale of [
			"experimental technical spike",
			"not the Semantropy standard tokenizer",
			"is not the Semantropy",
			"spike",
		]) {
			expect(banner).not.toContain(stale);
		}
	});
});

describe("the shipped Target display path", () => {
	it("contains no MarkdownRenderer, postprocessor or HTML-parsing path", async () => {
		const main = await readFile(path.join(firstBuild.outDir, "main.js"), "utf8");
		for (const forbidden of [
			"MarkdownRenderer",
			"registerMarkdownPostProcessor",
			"MarkdownPreviewRenderer",
			"DOMParser",
			"insertAdjacentHTML",
			"createContextualFragment",
		]) {
			expect(main).not.toContain(forbidden);
		}
	});

	it("opens a resource-bearing note without MarkdownRenderer, fetch or writes", async () => {
		const loaded = await loadPluginArtifact(firstBuild.outDir, {
			records: recordsWithMaxBodySemantropy(),
		});
		try {
			const run = await openHarnessNote(loaded, {
				markdown: "猫と犬![remote](https://semantropy-target-safe.invalid/x)\n\n![[referenced-note]]",
			});
			expect(run.status).toBe("ready");
			expect(loaded.records.markdownRenderCalls).toEqual([]);
			expect(loaded.records.fetchCalls).toEqual([]);
			expect(loaded.records.writeCalls).toEqual([]);
			expect(run.message).toContain("[Image / embed omitted]");
			loaded.plugin.onunload();
		} finally {
			loaded.restore();
		}
	}, 600_000);
});

describe("the prepared dictionary the artifact is built from", () => {
	it("is the pinned archive, unmodified by the compaction step", async () => {
		const archive = await verifyArchive(linderaArchivePath(rootDir));
		if (!archive.ok) {
			throw new Error(`The cached archive is not the pinned one: ${archive.reason}.`);
		}
		expect(archive.bytes).toBe(IPADIC_ARCHIVE.bytes);
		expect(archive.sha256).toBe(IPADIC_ARCHIVE.sha256);
	});

	it("rebuilds all 392,126 entries with nine detail slots each", async () => {
		const fullDir = linderaFullDictionaryDir(rootDir);
		const compact = buildCompactWords(
			await readFile(path.join(fullDir, "dict.words")),
			await readFile(path.join(fullDir, "dict.wordsidx")),
		);

		expect(compact.entryCount).toBe(392_126);
		expect(compact.targetNounCount).toBeGreaterThan(0);
		expect(compact.targetNounCount).toBeLessThan(compact.entryCount);

		const slotCounts = new Set<number>();
		let offset = 0;
		for (let entry = 0; entry < compact.entryCount; entry += 1) {
			const length = compact.words.readUInt32LE(offset);
			const payload = compact.words.subarray(offset + 4, offset + 4 + length);
			let separators = 0;
			for (const byte of payload) {
				if (byte === 0) {
					separators += 1;
				}
			}
			slotCounts.add(separators + 1);
			offset += 4 + length;
		}
		expect([...slotCounts]).toEqual([9]);

		// Byte-for-byte what the prepare step wrote, so the artifact is built
		// from exactly this.
		const compactDir = linderaCompactDictionaryDir(rootDir);
		expect(sha256Hex(compact.words)).toBe(
			sha256Hex(await readFile(path.join(compactDir, "dict.words"))),
		);
		expect(sha256Hex(compact.wordsIdx)).toBe(
			sha256Hex(await readFile(path.join(compactDir, "dict.wordsidx"))),
		);
	}, 600_000);

	it("leaves every other dictionary file identical to the archive's", async () => {
		const fullDir = linderaFullDictionaryDir(rootDir);
		const compactDir = linderaCompactDictionaryDir(rootDir);
		const rewritten = new Set(["dict.words", "dict.wordsidx"]);

		for (const fileName of [
			...LINDERA_DICTIONARY_FILE_NAMES,
			LINDERA_NOTICE_FILE_NAME,
		]) {
			const source = await readFile(path.join(fullDir, fileName));
			const derived = await readFile(path.join(compactDir, fileName));
			if (rewritten.has(fileName)) {
				expect(sha256Hex(derived)).not.toBe(sha256Hex(source));
			} else {
				expect(sha256Hex(derived)).toBe(sha256Hex(source));
			}
		}
	});
});

describe("the build input is bound to the pinned archive", () => {
	it("matches the pinned hashes for the extracted archive", async () => {
		expect(await measureDictionaryHashes(linderaFullDictionaryDir(rootDir))).toEqual(
			{ ...FULL_DICTIONARY_SHA256 },
		);
	});

	it("matches the pinned hashes for the derived compact dictionary", async () => {
		expect(
			await measureDictionaryHashes(linderaCompactDictionaryDir(rootDir)),
		).toEqual({ ...COMPACT_DICTIONARY_SHA256 });
	});

	it("pins the same hash as the archive for every file it does not rewrite", () => {
		for (const fileName of VERIFIED_DICTIONARY_FILE_NAMES) {
			if (REWRITTEN_FILE_NAMES.includes(fileName)) {
				expect(COMPACT_DICTIONARY_SHA256[fileName]).not.toBe(
					FULL_DICTIONARY_SHA256[fileName],
				);
			} else {
				expect(COMPACT_DICTIONARY_SHA256[fileName]).toBe(
					FULL_DICTIONARY_SHA256[fileName],
				);
			}
		}
	});

	it("reports that the build verified them", () => {
		expect(firstBuild.dictionary.verifiedAgainstPinnedHashes).toBe(true);
	});
});

describe("the build refuses to run on bad inputs", () => {
	async function stageDictionary(name: string): Promise<string> {
		const target = path.resolve(rootDir, scratchDir, name);
		await rm(target, { recursive: true, force: true });
		await mkdir(target, { recursive: true });
		const source = linderaCompactDictionaryDir(rootDir);
		for (const fileName of [
			...LINDERA_DICTIONARY_FILE_NAMES,
			LINDERA_NOTICE_FILE_NAME,
		]) {
			await copyFile(
				path.join(source, fileName),
				path.join(target, fileName),
			);
		}
		return target;
	}

	it("stops on a complete but modified cache, even though every file is present", async () => {
		// The failure this covers: the archive's SHA-256 is checked when
		// `prepare` downloads it, but the build reads the derived cache. A
		// file-existence check would accept a fully populated, internally
		// consistent, modified directory.
		for (const fileName of ["dict.words", "matrix.mtx"]) {
			const dictionaryDir = await stageDictionary(`tampered-${fileName}`);
			const target = path.join(dictionaryDir, fileName);
			const content = Buffer.from(await readFile(target));
			content[content.length - 1] = (content.at(-1) ?? 0) ^ 0xff;
			await writeFile(target, content);

			await expect(
				buildDistribution({
					dictionaryDir,
					outDir: path.join(scratchDir, `out-tampered-${fileName}`),
				}),
			).rejects.toThrow(
				new RegExp(
					`does not match the hashes pinned[\\s\\S]*${fileName.replace(".", "\\.")}`,
				),
			);
		}
	}, 600_000);

	it("stops the plugin-root build on the same modified cache", async () => {
		// `npm run build` and `npm run build:distribution` must fail closed on
		// exactly the same inputs; a development build that quietly accepted a
		// modified dictionary would be the one a developer actually runs.
		const dictionaryDir = await stageDictionary("tampered-production");
		const target = path.join(dictionaryDir, "dict.vals");
		const content = Buffer.from(await readFile(target));
		content[content.length - 1] = (content.at(-1) ?? 0) ^ 0xff;
		await writeFile(target, content);

		await expect(
			buildProductionMain({
				dictionaryDir,
				outfile: path.join(scratchDir, "out-tampered-production.js"),
			}),
		).rejects.toThrow(/does not match the hashes pinned[\s\S]*dict\.vals/);
	}, 600_000);

	it("cannot be told to accept a modified dictionary as verified", async () => {
		// `dictionaryDir` chooses which directory to read; it must not be able
		// to change what that directory has to contain. The build takes no
		// expected-hash argument, so a caller holding the modified dictionary's
		// own hashes still cannot get an artifact out of it.
		const dictionaryDir = await stageDictionary("tampered-self-consistent");
		const target = path.join(dictionaryDir, "dict.words");
		const content = Buffer.from(await readFile(target));
		content[content.length - 1] = (content.at(-1) ?? 0) ^ 0xff;
		await writeFile(target, content);

		const selfHashes = await measureDictionaryHashes(dictionaryDir);
		expect(selfHashes["dict.words"]).not.toBe(
			COMPACT_DICTIONARY_SHA256["dict.words"],
		);

		await expect(
			buildDistribution({
				dictionaryDir,
				// Passed deliberately: an earlier revision accepted an
				// `expectedDictionaryHashes` override here, which made the check
				// vacuous while still reporting the dictionary as pinned.
				expectedDictionaryHashes: selfHashes,
				outDir: path.join(scratchDir, "out-tampered-self"),
			} as never),
		).rejects.toThrow(/does not match the hashes pinned/);
	}, 600_000);

	it("names the pinned and the actual hash so the cause can be told apart", async () => {
		const dictionaryDir = await stageDictionary("tampered-detail");
		const target = path.join(dictionaryDir, "dict.wordsidx");
		const content = Buffer.from(await readFile(target));
		content.writeUInt32LE(content.readUInt32LE(4) + 1, 4);
		await writeFile(target, content);

		await expect(
			buildDistribution({
				dictionaryDir,
				outDir: path.join(scratchDir, "out-tampered-detail"),
			}),
		).rejects.toThrow(
			new RegExp(
				`expected ${COMPACT_DICTIONARY_SHA256["dict.wordsidx"]}[\\s\\S]*` +
					`Either the cache was modified[\\s\\S]*or the compaction rules`,
			),
		);
	}, 600_000);

	it("stops when a dictionary file is missing", async () => {
		const dictionaryDir = await stageDictionary("missing-file");
		await rm(path.join(dictionaryDir, "matrix.mtx"));

		await expect(
			buildDistribution({
				dictionaryDir,
				outDir: path.join(scratchDir, "out-missing"),
			}),
		).rejects.toThrow(/incomplete.*matrix\.mtx/s);
	}, 600_000);

	it("names the prepare command when the dictionary directory does not exist", async () => {
		await expect(
			buildDistribution({
				dictionaryDir: path.resolve(rootDir, scratchDir, "not-there"),
				outDir: path.join(scratchDir, "out-absent"),
			}),
		).rejects.toThrow(/npm run prepare:dictionary/);
	}, 600_000);

	it("stops on a malformed dict.words / dict.wordsidx pair", async () => {
		const fullDir = linderaFullDictionaryDir(rootDir);
		const words = await readFile(path.join(fullDir, "dict.words"));
		const wordsIdx = await readFile(path.join(fullDir, "dict.wordsidx"));

		const brokenIdx = Buffer.from(wordsIdx);
		brokenIdx.writeUInt32LE(words.length + 1024, 4);
		expect(() => buildCompactWords(words, brokenIdx)).toThrow();

		const brokenWords = Buffer.from(words);
		brokenWords.writeUInt32LE(words.length * 2, 0);
		expect(() => buildCompactWords(brokenWords, wordsIdx)).toThrow(
			/past the end/,
		);
	}, 600_000);

	it("stops when the cached archive does not match the pinned SHA-256", async () => {
		const staged = path.resolve(rootDir, scratchDir, IPADIC_ARCHIVE.name);
		await mkdir(path.dirname(staged), { recursive: true });
		const archive = await readFile(linderaArchivePath(rootDir));
		const tampered = Buffer.from(archive);
		tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 0xff;
		await writeFile(staged, tampered);

		const result = await verifyArchive(staged);
		if (result.ok) {
			throw new Error("A tampered archive was accepted as the pinned one.");
		}
		expect(result.reason).toBe("sha256");
		expect(result.expected).toBe(IPADIC_ARCHIVE.sha256);
	});

	it("stops when the cached archive is the wrong size", async () => {
		const staged = path.resolve(rootDir, scratchDir, "short.zip");
		await mkdir(path.dirname(staged), { recursive: true });
		await writeFile(
			staged,
			(await readFile(linderaArchivePath(rootDir))).subarray(0, 1024),
		);

		const result = await verifyArchive(staged);
		if (result.ok) {
			throw new Error("A truncated archive was accepted as the pinned one.");
		}
		expect(result.reason).toBe("size");
		expect(result.expected).toBe(IPADIC_ARCHIVE.bytes);
	});
});

/**
 * Runs the published bundle the way Obsidian would, through the shared stub in
 * `scripts/obsidianPluginHarness.mjs`: no dict/ directory, no filesystem
 * handle, `fetch` and `XMLHttpRequest` trapped, `getResourcePath` trapped, and
 * every `require` recorded. A successful Open under those conditions is
 * the evidence the artifact is self-contained.
 */
describe("distribution artifact behaviour", () => {
	let loaded: Awaited<ReturnType<typeof loadPluginArtifact>>;
	let run: Awaited<ReturnType<typeof openHarnessNote>>;
	let mainJs: string;

	beforeAll(async () => {
		loaded = await loadPluginArtifact(firstBuild.outDir, {
			records: recordsWithMaxBodySemantropy(),
		});
		mainJs = await readFile(path.join(firstBuild.outDir, "main.js"), "utf8");
		expect(
			(loaded.plugin as unknown as { tokenizer?: unknown }).tokenizer,
		).toBeNull();
		run = await openHarnessNote(loaded);
	}, 600_000);

	afterAll(() => {
		loaded.plugin.onunload();
		loaded.restore();
	});

	it("does not register the development tokenizer command", () => {
		expect(loaded.records.commands.has("test-tokenizer")).toBe(false);
		expect(mainJs).not.toContain("test-tokenizer");
		expect(mainJs).not.toContain("tokenizer smoke tokens");
		expect(mainJs).not.toContain("runTokenizerSmoke");
	});

	it("opens a fixed Markdown note and transforms it at MAX without a dict/ directory", () => {
		expect(loaded.records.errorCalls).toEqual([]);
		expect(run.status).toBe("ready");
		expect(run.message).toContain("Target: smoke.md");
		expect(run.replaceableSlotCount).toBe(3);
		expect(run.replacementCount).toBe(3);
		expectMaxOpenBody(run.bodyText);
		expect(run.snapshotText).toBe(DEFAULT_OPEN_MARKDOWN);
		expect(loaded.records.note?.text).toBe(DEFAULT_OPEN_MARKDOWN);
		expect(
			(
				loaded.plugin as unknown as {
					tokenizer: { isInitialized(): boolean };
				}
			).tokenizer.isInitialized(),
		).toBe(true);
	});

	it("never calls fetch or XMLHttpRequest", () => {
		expect(loaded.records.fetchCalls).toEqual([]);
	});

	it("never asks the Vault adapter for a resource path", () => {
		expect(loaded.records.resourcePathCalls).toEqual([]);
	});

	it("never writes the source note", () => {
		expect(loaded.records.writeCalls).toEqual([]);
	});

	it("does not emit tokenizer smoke debug output", () => {
		expect(
			loaded.records.debugCalls.map(
				(entry: { message: string }) => entry.message,
			),
		).not.toContain("[Semantropy] tokenizer smoke tokens");
	});

	it("requires no module other than obsidian", () => {
		expect([...new Set(loaded.records.requiredModules)]).toEqual(["obsidian"]);
	});

	it("registers the source-change commands and events", () => {
		expect([...loaded.records.commands.keys()]).toEqual([
			"open",
			"reshuffle",
			"refresh-source",
			"copy-selected-fragment",
			"collect-selected-fragment",
			"define-selected-word",
			"reshuffle-definition",
		]);
		expect(loaded.records.settingTabs).toHaveLength(1);
		expect(loaded.records.subscribedEvents).toEqual([
			"workspace:active-leaf-change",
			"workspace:editor-change",
			"vault:modify",
			"vault:rename",
			"vault:delete",
		]);
		// Every subscription goes through registerEvent, so unload detaches it.
		expect(loaded.records.registeredEvents).toHaveLength(
			loaded.records.subscribedEvents.length,
		);
	});

	it("unloads without error", () => {
		expect(() => loaded.plugin.onunload()).not.toThrow();
	});
});

describe("distribution artifact Collision", () => {
	it("generates, regenerates and explicitly collects through the final offline artifact", async () => {
		const loaded = await loadPluginArtifact(firstBuild.outDir, { records: recordsWithMaxBodySemantropy() });
		const markdown = "猫と犬と鳥と海と森と星と雲と夢と机と空。研究する。眠る。赤い。";
		let view: SemantropyView | undefined;
		try {
			const opened = await openHarnessNote(loaded, { markdown }); expect(opened.status).toBe("ready"); view = opened.view as SemantropyView;
			view.openCollision();
			const session = Reflect.get(view, "collisionSession") as CollisionSession;
			const modal = Reflect.get(view, "collisionModal") as CollisionModal;
			await session.generate(10, "named"); const first = session.read()!.batch!;
			expect(first.actualCount).toBe(10); expect(modal.contentEl.querySelectorAll(".semantropy-collision-row")).toHaveLength(10);
			const row = first.rows[0]!; await session.regenerate(row.rowSlotId);
			const next = session.read()!.batch!.rows[0]!;
			expect(next.committed.rowId).not.toBe(row.committed.rowId); expect(next.committed.generationRevision).toBe(2);
			expect(loaded.records.writeCalls).toEqual([]);
			emulateCollectionMarkdown(loaded, { path: DEFAULT_COLLECTION_PATH }); await session.write(row.rowSlotId, "collect");
			expect(loaded.records.writeCalls).toEqual(["create"]);
			expect(loaded.records.collection?.contents).not.toContain(next.committed.rowId);
			expect(loaded.records.collection?.contents).not.toContain("<!-- semantropy:");
			expect(loaded.records.collection?.contents).toContain(next.committed.text);
			expect(loaded.records.fetchCalls).toEqual([]); expect(loaded.records.note?.text).toBe(markdown);
			view.closeCollision(); expect(session.read()).toBeNull(); expect(modal.contentEl.children).toHaveLength(0);
		} finally { await view?.onClose(); loaded.plugin.onunload(); loaded.restore(); }
	});
});

describe("distribution artifact Collect", () => {
	it("writes only the emulated Collection path, never the source note", async () => {
		const loaded = await loadPluginArtifact(firstBuild.outDir, {
			records: recordsWithMaxBodySemantropy(),
		});
		try {
			const run = await openHarnessNote(loaded);
			expect(run.status).toBe("ready");
			expect(loaded.records.writeCalls).toEqual([]);

			emulateCollectionMarkdown(loaded, { path: DEFAULT_COLLECTION_PATH });

			const container = (
				run.view as {
					targetBody: { getContainer(): HTMLElement | null };
				}
			).targetBody.getContainer();
			expect(container).not.toBeNull();
			const range = document.createRange();
			range.selectNodeContents(container as HTMLElement);
			window.getSelection()?.removeAllRanges();
			window.getSelection()?.addRange(range);

			const collected = await runCommandUntilNotice(
				loaded,
				"collect-selected-fragment",
				"Collected.",
			);
			expect(collected.notice).toBe("Collected.");
			expect(loaded.records.writeCalls).toEqual(["create"]);
			expect(loaded.records.collection?.path).toBe(DEFAULT_COLLECTION_PATH);
			expect(loaded.records.collection?.contents).toContain(
				"semantropy-collection-version: 1",
			);
			expect(loaded.records.collection?.contents).toContain(run.bodyText);
			expectMaxOpenBody(run.bodyText);
			expect(loaded.records.note?.text).toBe(DEFAULT_OPEN_MARKDOWN);
			expect(loaded.records.note?.text).not.toContain(
				"semantropy-collection-version",
			);
			expect(JSON.stringify(loaded.records.notices)).not.toContain(
				"/Users/",
			);
			loaded.plugin.onunload();
		} finally {
			loaded.restore();
		}
	}, 600_000);

	it("does not write when the source note is the configured Collection path", async () => {
		const loaded = await loadPluginArtifact(firstBuild.outDir, {
			records: recordsWithMaxBodySemantropy(),
		});
		try {
			const run = await openHarnessNote(loaded, {
				sourcePath: DEFAULT_COLLECTION_PATH,
				sourceName: DEFAULT_COLLECTION_PATH,
			});
			expect(run.status).toBe("ready");
			expect(loaded.records.writeCalls).toEqual([]);

			const container = (
				run.view as {
					targetBody: { getContainer(): HTMLElement | null };
				}
			).targetBody.getContainer();
			expect(container).not.toBeNull();
			const range = document.createRange();
			range.selectNodeContents(container as HTMLElement);
			window.getSelection()?.removeAllRanges();
			window.getSelection()?.addRange(range);

			const refused = await runCommandUntilNotice(
				loaded,
				"collect-selected-fragment",
				"A Target or Vocabulary Source note cannot be used as the Collection file.",
			);
			expect(refused.notice).toBe(
				"A Target or Vocabulary Source note cannot be used as the Collection file.",
			);
			expect(loaded.records.writeCalls).toEqual([]);
			expect(loaded.records.note?.text).toBe(DEFAULT_OPEN_MARKDOWN);
			expect(loaded.records.collection).toBeNull();
			loaded.plugin.onunload();
		} finally {
			loaded.restore();
		}
	}, 600_000);
});

describe("distribution artifact Collection path settings", () => {
	// COLLECT-ATTRIBUTION1: the bundled plugin writes schema 7. Schema 1-4 keep an English interface; schema 1-5 read the ribbon as on; attribution reads as off until schema 7.
	it("applies schema 4 and collects committed Body 11 options from the bundled plugin, reading a saved 100 as MAX", async () => {
		const loaded = await loadPluginArtifact(firstBuild.outDir, { records: recordsWithMaxBodySemantropy() });
		try {
			const run = await openHarnessNote(loaded); expect(run.status).toBe("ready");
			const view = run.view as { applyAutomaticPos(options: { noun: boolean; verb: boolean; iAdjective: boolean; adverb: boolean }): Promise<string>;
				targetBody: { getContainer(): HTMLElement; getAutomaticProvenance(): { bodyAlgorithmVersion: number; algorithmVersion: number; projectionVersion: string; vocabularyFingerprint: string; bodySemantropy: number } } };
			for (const flag of [true, false]) {
				const options = { noun: flag, verb: flag, iAdjective: flag, adverb: flag };
				expect(await view.applyAutomaticPos(options)).toBe("committed");
				// 0.1.0 S2: the live writer is settings schema 8.
				expect(loaded.records.savedData).toMatchObject({ schemaVersion: 8, automaticPos: options, uiLanguage: "en", showRibbonIcon: true });
			}
			// MAX-VIEW1: the bundled body path is MAX-CORE1, one compatible version set, with the saved 100 kept as 100 (MAX).
			expect(view.targetBody.getAutomaticProvenance()).toMatchObject({ bodyAlgorithmVersion: 11, algorithmVersion: 3, projectionVersion: "automatic-body-projection-3", bodySemantropy: 100 });
			expect(view.targetBody.getAutomaticProvenance().vocabularyFingerprint).toMatch(/^vocabulary-fingerprint-sha256-3:/u);
			expect(loaded.records.savedData).toMatchObject({ schemaVersion: 8, bodySemantropy: 100, uiLanguage: "en", showRibbonIcon: true });
			expect(loaded.records.writeCalls).toEqual([]); expect(loaded.records.fetchCalls).toEqual([]);
			emulateCollectionMarkdown(loaded);
			const range = document.createRange(); range.selectNodeContents(view.targetBody.getContainer());
			window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
			expect((await runCommandUntilNotice(loaded, "collect-selected-fragment", "Collected.")).notice).toBe("Collected.");
			// The last Apply turns every automatic part off, so the committed selection is the source sentence.
			// Body 11 provenance stays on the view above and is not written into the Collection.
			expect(loaded.records.collection?.contents).toContain("semantropy-collection-version: 1");
			expect(loaded.records.collection?.contents).toContain(DEFAULT_OPEN_MARKDOWN);
			expect(loaded.records.collection?.contents).not.toContain(run.bodyText);
			expect(loaded.records.collection?.contents).not.toContain('"metadataVersion"');
			expect(loaded.records.collection?.contents).not.toContain('"automaticPartsOfSpeech"');
			expect(loaded.records.collection?.contents).not.toContain('"fingerprint":');
			expect(loaded.records.collection?.contents).not.toContain("<!-- semantropy:");
			expect(loaded.records.note?.text).toBe(DEFAULT_OPEN_MARKDOWN);
			loaded.plugin.onunload();
		} finally { loaded.restore(); }
	}, 600_000);
	it("registers a SettingTab that Collect reads on the next save", async () => {
		const records = recordsWithMaxBodySemantropy();
		records.savedData = {
			schemaVersion: SEMANTROPY_SETTINGS_SCHEMA_VERSION,
			bodySemantropy: 100,
			dictionarySemantropy: 75,
			collectionPath: DEFAULT_COLLECTION_PATH,
		};
		const loaded = await loadPluginArtifact(firstBuild.outDir, {
			records,
		});
		try {
			expect(loaded.records.settingTabs).toHaveLength(1);
			const tab = loaded.records.settingTabs[0] as {
				show(): void;
				getSettingDefinitions(): Array<{
					name?: string;
					type?: string;
					heading?: string;
					items?: Array<{ name?: string; render?: unknown; searchable?: boolean | (() => boolean) }>;
					render?: unknown;
					searchable?: boolean | (() => boolean);
				}>;
				containerEl: HTMLElement;
			};
			const definitions = tab.getSettingDefinitions();
			// LOCALE1: schema 3 data keeps English; the Interface language row comes first.
			// 0.1.0 S4 adds the extra enclosed-term delimiters row before the attribution group.
			expect(definitions.map(item => item.name)).toEqual(["Interface language", "Show ribbon icon", "Collection file", "Extra term delimiters", undefined]);
			expect(definitions[4]).toMatchObject({ type: "group", heading: "Record generation details in Collection" });
			expect(definitions[4]?.items?.map(item => item.name)).toEqual([
				"Record generation type", "Record Target note", "Record Vocabulary notes", "Record generation Semantropy level", "Record collection date",
			]);
			for (const definition of definitions.flatMap(item => item.items ?? [item])) {
				expect(typeof definition.render).toBe("function");
				expect(definition.searchable).not.toBe(false);
			}
			tab.show();
			const input = tab.containerEl.querySelector("input");
			expect(input).toBeInstanceOf(HTMLInputElement);
			expect((input as HTMLInputElement).value).toBe(DEFAULT_COLLECTION_PATH);

			const nextPath = "Other Fragments.md";
			(input as HTMLInputElement).value = nextPath;
			const save = tab.containerEl.querySelector(
				".semantropy-collection-path-save",
			);
			if (!(save instanceof HTMLButtonElement)) {
				throw new Error("The artifact SettingTab did not render Save.");
			}
			save.click();
			const deadline = Date.now() + 10_000;
			for (;;) {
				const stored = loaded.records.savedData as {
					collectionPath?: string;
				} | null;
				if (stored?.collectionPath === nextPath) {
					break;
				}
				if (Date.now() >= deadline) {
					throw new Error(
						`Collection path was not saved. Notices: ${JSON.stringify(loaded.records.notices)} Status: ${tab.containerEl.querySelector(".semantropy-settings-status")?.textContent ?? ""}`,
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			expect(loaded.records.writeCalls).toEqual([]);
			expect(loaded.records.savedData).toMatchObject({
				schemaVersion: 8,
				uiLanguage: "en",
				showRibbonIcon: true,
				bodySemantropy: 100,
				dictionarySemantropy: 75,
				collectionPath: nextPath,
			});
			expect(JSON.stringify(loaded.records.notices)).not.toContain(nextPath);
			expect(JSON.stringify(loaded.records.errorCalls)).not.toContain(
				nextPath,
			);

			const run = await openHarnessNote(loaded);
			expect(run.status).toBe("ready");
			emulateCollectionMarkdown(loaded, { path: nextPath });

			const container = (
				run.view as {
					targetBody: { getContainer(): HTMLElement | null };
				}
			).targetBody.getContainer();
			expect(container).not.toBeNull();
			const range = document.createRange();
			range.selectNodeContents(container as HTMLElement);
			window.getSelection()?.removeAllRanges();
			window.getSelection()?.addRange(range);

			const collected = await runCommandUntilNotice(
				loaded,
				"collect-selected-fragment",
				"Collected.",
			);
			expect(collected.notice).toBe("Collected.");
			expect(loaded.records.writeCalls).toEqual(["create"]);
			expect(loaded.records.collection?.path).toBe(nextPath);
			expect(loaded.records.note?.text).toBe(DEFAULT_OPEN_MARKDOWN);
			loaded.plugin.onunload();
		} finally {
			loaded.restore();
		}
	}, 600_000);
});

describe("distribution artifact Fake Dictionary", () => {
	it("defines a selected word from the artifact without network or source writes", async () => {
		const loaded = await loadPluginArtifact(firstBuild.outDir, {
			records: recordsWithMaxBodySemantropy(),
		});
		try {
			const run = await openHarnessNote(loaded);
			expect(run.status).toBe("ready");
			expect(loaded.records.writeCalls).toEqual([]);
			expect(loaded.records.fetchCalls).toEqual([]);
			const snapshotText = run.snapshotText;
			const bodySeed = (
				run.view as {
					session: { getState(): { bodySeed?: number } };
				}
			).session.getState().bodySeed;

			const container = (
				run.view as {
					targetBody: { getContainer(): HTMLElement | null };
				}
			).targetBody.getContainer();
			expect(container).not.toBeNull();
			// MAX may move every noun (expectMaxOpenBody), so the word comes from the
			// committed body itself: its first slot always holds one of the three nouns.
			expectMaxOpenBody(run.bodyText);
			const word = /^(太郎|花子|駅)/u.exec(run.bodyText)![1]!;
			const walker = document.createTreeWalker(
				container as HTMLElement,
				NodeFilter.SHOW_TEXT,
			);
			let node = walker.nextNode();
			let selected = false;
			while (node) {
				const text = node.nodeValue ?? "";
				const index = text.indexOf(word);
				if (index >= 0) {
					const range = document.createRange();
					range.setStart(node, index);
					range.setEnd(node, index + word.length);
					window.getSelection()?.removeAllRanges();
					window.getSelection()?.addRange(range);
					selected = true;
					break;
				}
				node = walker.nextNode();
			}
			expect(selected).toBe(true);

			const command = loaded.records.commands.get("define-selected-word");
			if (typeof command !== "function") {
				throw new Error("The artifact did not register define-selected-word.");
			}
			command();

			const deadline = Date.now() + 120_000;
			let definition = "";
			let templateId = "";
			let dictionarySeed: number | null = null;
			for (;;) {
				const world = (
					run.view as {
						dictionaryWorld: {
							getCurrent(): {
								result: {
									outcome: string;
									definition?: string;
									templateId?: string;
								};
								dictionarySeed: number;
							} | null;
						};
					}
				).dictionaryWorld.getCurrent();
				if (world?.result.outcome === "generated" && world.result.definition) {
					definition = world.result.definition;
					templateId = world.result.templateId ?? "";
					dictionarySeed = world.dictionarySeed;
					break;
				}
				if (Date.now() >= deadline) {
					throw new Error(
						`Define did not produce a definition. Errors: ${JSON.stringify(loaded.records.errorCalls)} Notices: ${JSON.stringify(loaded.records.notices)}`,
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 5));
			}

			const textEl = document.querySelector(".semantropy-definition-text");
			expect(textEl?.textContent).toBe(definition);
			expect(textEl?.querySelector("b")).toBeNull();
			expect(definition.length).toBeGreaterThan(0);
			expect(templateId.length).toBeGreaterThan(0);
			expect(typeof dictionarySeed).toBe("number");
			expect(
				(
					run.view as {
						session: { getState(): { bodySeed?: number } };
					}
				).session.getState().bodySeed,
			).toBe(bodySeed);
			expect(
				(
					run.view as {
						session: { getState(): { snapshot?: { text: string } } };
					}
				).session.getState().snapshot?.text,
			).toBe(snapshotText);
			expect(loaded.records.note?.text).toBe(DEFAULT_OPEN_MARKDOWN);
			expect(loaded.records.writeCalls).toEqual([]);
			expect(loaded.records.fetchCalls).toEqual([]);
			expect(JSON.stringify(loaded.records.notices)).not.toContain("/Users/");
			for (const noun of ["太郎", "花子", "駅"]) expect(JSON.stringify(loaded.records.errorCalls)).not.toContain(noun);
			loaded.plugin.onunload();
		} finally {
			loaded.restore();
		}
	}, 600_000);
});

/**
 * `npm run build` writes `main.js` into the plugin root, which is what an
 * Obsidian development vault loads. It has to be the same self-contained
 * bundle the release carries — a development build that reached for an
 * external dictionary would be the one most often exercised by hand.
 */
describe("the plugin-root production build", () => {
	let productionSha: string;

	beforeAll(async () => {
		await mkdir(path.resolve(rootDir, scratchDir), { recursive: true });
		const built = await buildProductionMain({ outfile: productionMainPath });
		productionSha = built.sha256;
	}, 600_000);

	it("produces the same bytes as the distribution artifact's main.js", () => {
		const distributed = firstBuild.files.find(
			(file: { fileName: string }) => file.fileName === "main.js",
		);
		expect(productionSha).toBe(distributed?.sha256);
	});

	it("loads in the Obsidian harness and runs Open offline", async () => {
		// Loaded from its own directory so the harness reads this exact file.
		const stagedDir = path.resolve(rootDir, scratchDir, "production-artifact");
		await mkdir(stagedDir, { recursive: true });
		await copyFile(
			path.resolve(rootDir, productionMainPath),
			path.join(stagedDir, "main.js"),
		);

		const loaded = await loadPluginArtifact(stagedDir, {
			records: recordsWithMaxBodySemantropy(),
		});
		try {
			expect(loaded.records.commands.has("test-tokenizer")).toBe(false);
			const run = await openHarnessNote(loaded);
			expect(run.status).toBe("ready");
			expect(run.replaceableSlotCount).toBe(3);
			expect(run.replacementCount).toBe(3);
			expectMaxOpenBody(run.bodyText);
			expect(run.snapshotText).toBe(DEFAULT_OPEN_MARKDOWN);
			expect(loaded.records.note?.text).toBe(DEFAULT_OPEN_MARKDOWN);
			expect(loaded.records.fetchCalls).toEqual([]);
			expect(loaded.records.resourcePathCalls).toEqual([]);
			expect(loaded.records.writeCalls).toEqual([]);
			expect(loaded.records.errorCalls).toEqual([]);
			expect([...new Set(loaded.records.requiredModules)]).toEqual([
				"obsidian",
			]);
			loaded.plugin.onunload();
		} finally {
			loaded.restore();
		}
	}, 600_000);
});
