import { describe, expect, it } from "vitest";
import type {
	CollectedFragment,
	FragmentMetadata,
} from "../src/collect/CollectedFragment";
import {
	appendCollectionEntry,
	createCollectionDocument,
} from "../src/collect/collectionDocument";
import { escapeFragmentMarkdown } from "../src/collect/escapeFragmentMarkdown";
import {
	BODY_FRAGMENT_METADATA_KEY_ORDER,
	COLLISION_FRAGMENT_METADATA_KEY_ORDER,
	FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER,
	fragmentMetadataComment,
	serializeFragmentMetadata,
} from "../src/collect/fragmentMetadata";
import { serializeFragmentEntry } from "../src/collect/serializeFragmentEntry";
import {
	COLLECT_MANUAL_OVERRIDE_KEY_ORDER,
	COLLECT_PATH_IDENTITY_KEY_ORDER,
	COLLECT_VOCABULARY_KEY_ORDER,
} from "../src/collect/collectProvenance";
import {
	bodyCollectMetadata,
	collisionCollectInput,
	collectPath,
	collectVocabulary,
	dictionaryCollectInput,
} from "./collectFixtures";
import { buildCollectedFragment } from "../src/collect/CollectedFragment";

function bodyMetadata(
	overrides: Partial<Extract<FragmentMetadata, { type: "body" }>> = {},
): Extract<FragmentMetadata, { type: "body" }> {
	return bodyCollectMetadata(overrides);
}

function fragment(
	text: string,
	metadata: FragmentMetadata = bodyMetadata(),
): CollectedFragment {
	return { text, metadata };
}

/** The comment body, without the `<!-- semantropy: ` wrapper. */
function metadataJson(metadata: FragmentMetadata): string {
	return serializeFragmentMetadata(metadata);
}

describe("fragment metadata", () => {
	it("writes body keys in a fixed order", () => {
		const json = metadataJson(bodyMetadata());
		expect(Object.keys(JSON.parse(json) as object)).toEqual(
			BODY_FRAGMENT_METADATA_KEY_ORDER.filter((key) => key !== "manualAlgorithmVersion" && key !== "manualOverrides"),
		);
		expect(json).toContain('"metadataVersion":2');
		expect(json).toContain('"bodySemantropy":50');
		expect(json).not.toContain("templateId");
		expect(json).not.toContain("manualAlgorithmVersion");
		expect(json).not.toMatch(/"seed"|"semantropy":|"sourcePath"/);
		const parsed = JSON.parse(json) as {
			target: object;
			vocabulary: { sources: object[] };
		};
		expect(Object.keys(parsed.target)).toEqual([...COLLECT_PATH_IDENTITY_KEY_ORDER]);
		expect(Object.keys(parsed.vocabulary)).toEqual([...COLLECT_VOCABULARY_KEY_ORDER]);
		expect(Object.keys(parsed.vocabulary.sources[0] as object)).toEqual([
			...COLLECT_PATH_IDENTITY_KEY_ORDER,
		]);
	});

	it("writes fake-dictionary keys in a fixed order", () => {
		const metadata = buildCollectedFragment(dictionaryCollectInput(), {
			id: bodyMetadata().id,
			created: bodyMetadata().created,
		}).metadata;
		const json = metadataJson(metadata);
		expect(Object.keys(JSON.parse(json) as object)).toEqual([
			...FAKE_DICTIONARY_FRAGMENT_METADATA_KEY_ORDER,
		]);
		expect(json).toContain('"dictionarySemantropy":75');
		expect(json).toContain('"templateSetVersion":1');
		expect(json).not.toMatch(/"seed"|"hasManualEdits"|"patternId"/);
	});

	it("writes Manual body keys and nested override keys in a fixed order", () => {
		const metadata = bodyCollectMetadata({
			hasManualEdits: true,
			manualAlgorithmVersion: 1,
			manualOverrides: [
				{ tokenId: "token-1", kind: "replacement", localRevision: 2 },
			],
		});
		const json = metadataJson(metadata);
		const parsed = JSON.parse(json) as {
			manualOverrides: object[];
		};
		expect(Object.keys(parsed)).toEqual([...BODY_FRAGMENT_METADATA_KEY_ORDER]);
		expect(Object.keys(parsed.manualOverrides[0] as object)).toEqual([
			...COLLECT_MANUAL_OVERRIDE_KEY_ORDER,
		]);
		expect(json).not.toMatch(/"candidateId"|"displayFormId"|"surface"/);
	});

	it("writes collision keys in a fixed order", () => {
		const metadata = buildCollectedFragment(collisionCollectInput(), {
			id: bodyMetadata().id,
			created: bodyMetadata().created,
		}).metadata;
		const json = metadataJson(metadata);
		expect(Object.keys(JSON.parse(json) as object)).toEqual([
			...COLLISION_FRAGMENT_METADATA_KEY_ORDER,
		]);
		expect(json).not.toContain("target");
		expect(json).not.toMatch(/"bodySemantropy"|"dictionarySemantropy"|"semantropy"/);
	});

	it("does not write Seed keys, even from extra properties on the metadata object", () => {
		const contaminated = {
			...bodyMetadata(),
			seed: 1170956989,
			bodySeed: 1,
			dictionarySeed: 2,
			nonce: 3,
			candidateId: "x",
		} as unknown as FragmentMetadata;
		const json = metadataJson(contaminated);
		const comment = fragmentMetadataComment(contaminated);
		expect(json).not.toMatch(/"seed"|"bodySeed"|"dictionarySeed"|"nonce"|"candidateId"/);
		expect(comment).not.toMatch(/"seed"|"bodySeed"|"dictionarySeed"/);
		expect(Object.keys(JSON.parse(json) as object)).toEqual(
			BODY_FRAGMENT_METADATA_KEY_ORDER.filter((key) => key !== "manualAlgorithmVersion" && key !== "manualOverrides"),
		);
	});

	it("cannot close the comment from inside a metadata value", () => {
		const hostile = bodyMetadata({
			target: collectPath("a--><script>alert(1)</script>.md"),
			vocabulary: collectVocabulary(["a--><script>alert(1)</script>.md"]),
		});
		const comment = fragmentMetadataComment(hostile);

		expect(comment.startsWith("<!-- semantropy: ")).toBe(true);
		expect(comment.endsWith(" -->")).toBe(true);
		expect(comment.slice(17, -4)).not.toMatch(/[<>&]/);
		expect(comment.indexOf("-->")).toBe(comment.length - 3);
		expect(comment.indexOf("<!--")).toBe(0);

		const parsed = JSON.parse(metadataJson(hostile)) as {
			target: { path: string };
		};
		expect(parsed.target.path).toBe("a--><script>alert(1)</script>.md");
	});

	it("survives quotes, backslashes, newlines and Unicode in a value", () => {
		const path = 'folder/"quoted"\\back\nline\u2028\u2029\u0000猫.md';
		const awkward = bodyMetadata({
			target: collectPath(path),
			vocabulary: collectVocabulary([path]),
		});
		const json = metadataJson(awkward);

		expect(json).not.toMatch(/[\n\r\u2028\u2029<>&]/);
		expect(JSON.parse(json)).toMatchObject({
			target: { path },
		});
	});
});

describe("fragment markdown escaping", () => {
	it("neutralizes raw HTML inside a fragment", () => {
		const escaped = escapeFragmentMarkdown(
			'<script>alert(1)</script><!-- hi --><img src=x onerror=y>',
		);
		// Every angle bracket is backslash-escaped, so none of it opens a tag.
		expect(escaped).not.toMatch(/(^|[^\\])[<>]/);
		expect(escaped).toContain("\\<script\\>");
	});

	it("neutralizes links, images, headings, lists, tags and code", () => {
		const cases = [
			"[label](https://example.com)",
			"[[wiki link]]",
			"![[embedded.png]]",
			"# heading",
			"- bullet",
			"1. ordered",
			"> quote",
			"| a | b |",
			"#tag",
			"`code`",
			"```js",
			"*emph* _emph_ ~~strike~~",
			"$$math$$",
			"---",
		];
		for (const source of cases) {
			const escaped = escapeFragmentMarkdown(source);
			expect(escaped).not.toMatch(/(^|[^\\])[[\]<>#`*_~|$>-]/);
		}
	});

	it("normalizes CRLF and lone CR to LF", () => {
		expect(escapeFragmentMarkdown("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
	});

	it("escapes leading and trailing spaces so they cannot become markup", () => {
		expect(escapeFragmentMarkdown("    indented")).toBe(
			"&#32;&#32;&#32;&#32;indented",
		);
		// Only the edges: a space inside the line is not markup and stays a space.
		expect(escapeFragmentMarkdown("hard break  ")).toBe(
			"hard break&#32;&#32;",
		);
		// An all-whitespace line keeps its content instead of going blank.
		expect(escapeFragmentMarkdown("a\n \t\nb")).toBe("a\n&#32;&#9;\nb");
	});

	it("leaves ordinary Japanese text untouched", () => {
		expect(escapeFragmentMarkdown("おかき的な自殺、ひまの封筒。「猫」")).toBe(
			"おかき的な自殺、ひまの封筒。「猫」",
		);
	});
});

describe("serializeFragmentEntry", () => {
	it("writes one bullet followed by its metadata comment", () => {
		expect(serializeFragmentEntry(fragment("おかき的な自殺"))).toBe(
			"- おかき的な自殺\n" +
				`  <!-- semantropy: ${metadataJson(bodyMetadata())} -->\n`,
		);
	});

	it("keeps a multi-line fragment, blank lines included, in one bullet", () => {
		const entry = serializeFragmentEntry(
			fragment("一行目\n\n三行目\n四行目"),
		);

		expect(entry).toBe(
			"- 一行目\n" +
				"\n" +
				"  三行目\n" +
				"  四行目\n" +
				`  <!-- semantropy: ${metadataJson(bodyMetadata())} -->\n`,
		);
		// One entry: exactly one bullet marker at the start of a line.
		expect(entry.match(/^- /gm)).toHaveLength(1);
	});

	it("ends every entry with a single LF", () => {
		for (const text of ["一行", "一行\n二行", "末尾改行\n"]) {
			const entry = serializeFragmentEntry(fragment(text));
			expect(entry.endsWith("\n")).toBe(true);
			expect(entry.endsWith("\n\n")).toBe(false);
		}
	});

	it("serializes the same fragment to exactly the same string", () => {
		const text = "  <b>猫</b>\r\n[link](x)\n";
		const first = serializeFragmentEntry(fragment(text));
		const second = serializeFragmentEntry(fragment(text));
		expect(first).toBe(second);
	});

	it("does not let a fragment escape its bullet into the document", () => {
		const entry = serializeFragmentEntry(
			fragment("- 別entry\n<!-- semantropy: {} -->\n# 見出し"),
		);
		// The only real bullet and the only real comment are the ones written here.
		expect(entry.match(/^- /gm)).toHaveLength(1);
		expect(entry.match(/<!--/g)).toHaveLength(1);
		expect(entry.match(/-->/g)).toHaveLength(1);
	});
});

describe("collection document", () => {
	const ENTRY = serializeFragmentEntry(fragment("おかき的な自殺"));

	it("creates the first document from a fixed structure", () => {
		expect(createCollectionDocument(ENTRY)).toBe(
			"---\n" +
				"semantropy-collection-version: 1\n" +
				"---\n" +
				"\n" +
				"# Semantropy Fragments\n" +
				"\n" +
				"- おかき的な自殺\n" +
				`  <!-- semantropy: ${metadataJson(bodyMetadata())} -->\n`,
		);
	});

	it("builds the initial document when the existing file is empty", () => {
		expect(appendCollectionEntry("", ENTRY)).toBe(
			createCollectionDocument(ENTRY),
		);
	});

	it("adds one blank line before the entry whatever the file ends with", () => {
		const existing = "# My own heading\n\n- 既存の断片";
		expect(appendCollectionEntry(existing, ENTRY)).toBe(
			`${existing}\n\n${ENTRY}`,
		);
		expect(appendCollectionEntry(`${existing}\n`, ENTRY)).toBe(
			`${existing}\n\n${ENTRY}`,
		);
		expect(appendCollectionEntry(`${existing}\n\n`, ENTRY)).toBe(
			`${existing}\n\n${ENTRY}`,
		);
		expect(appendCollectionEntry(`${existing}\n\n\n\n`, ENTRY)).toBe(
			`${existing}\n\n\n\n${ENTRY}`,
		);
	});

	it("keeps every existing byte, reformatting nothing", () => {
		const existing =
			"---\nsemantropy-collection-version: 1\n---\n\n#   Odd  heading\n\n*   手で書いた行\n\n\ttab indented\n";
		const result = appendCollectionEntry(existing, ENTRY);
		expect(result.startsWith(existing)).toBe(true);
		expect(result.slice(existing.length)).toBe(`\n${ENTRY}`);
	});
});
