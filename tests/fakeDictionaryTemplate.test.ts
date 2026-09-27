import { describe, expect, it } from "vitest";
import {
	canonicalList,
	canonicalString,
	fnv1a32,
} from "../src/dictionary/canonicalHash";
import {
	FAKE_DICTIONARY_PLACEHOLDERS,
	type FakeDictionaryPlaceholder,
} from "../src/dictionary/placeholders";
import {
	STANDARD_TEMPLATE_SET,
	STANDARD_TEMPLATE_SET_VERSION,
} from "../src/dictionary/standardTemplateSet";
import {
	compileTemplateSet,
	parseTemplateSegments,
	requiredPlaceholdersOf,
	type TemplateIssueCode,
} from "../src/dictionary/template";
import {
	STANDARD_CORE_TEMPLATES,
	STANDARD_OPTIONAL_CLAUSES,
} from "../src/dictionary/generated/standardTemplateEntries";
import {
	OPTIONAL_CLAUSE_CATEGORIES,
	TEMPLATE_FAMILIES,
} from "../src/dictionary/templateData";

const core = (text: string, id = "classification-01") => ({
	id,
	family: "classification",
	text,
});
const clause = (text: string, id = "optional-usage-01") => ({
	id,
	category: "usage",
	text,
});

function issuesOf(
	rawCore: readonly { id: string; family: string; text: string }[],
	rawClauses: readonly { id: string; category: string; text: string }[] = [],
): readonly TemplateIssueCode[] {
	const result = compileTemplateSet(1, rawCore, rawClauses);
	return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe("the template parser", () => {
	it("splits text and placeholders in document order", () => {
		const parsed = parseTemplateSegments("{{noun}}の一種。{{place}}に多い。");

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.segments).toEqual([
			{ kind: "placeholder", placeholder: "noun" },
			{ kind: "text", text: "の一種。" },
			{ kind: "placeholder", placeholder: "place" },
			{ kind: "text", text: "に多い。" },
		]);
	});

	it("parses text with no placeholder at all", () => {
		const parsed = parseTemplateSegments("語源については諸説がある。");

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.segments).toEqual([
			{ kind: "text", text: "語源については諸説がある。" },
		]);
	});

	it("precomputes the distinct placeholders a template needs", () => {
		const parsed = parseTemplateSegments(
			"{{noun}}を{{sahen}}する{{noun}}。{{place}}に多い。",
		);

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		// Distinct, in first-appearance order; `noun` is listed once.
		expect(requiredPlaceholdersOf(parsed.segments)).toEqual([
			"noun",
			"sahen",
			"place",
		]);
	});

	it("keeps a placeholder-looking candidate inert, because structure is decided first", () => {
		const parsed = parseTemplateSegments("{{noun}}の一種。");

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		// Only one placeholder segment exists; nothing rescans the output later,
		// so a candidate reading "{{place}}" can never become a substitution.
		expect(
			parsed.segments.filter((segment) => segment.kind === "placeholder"),
		).toHaveLength(1);
	});
});

describe("the template validator", () => {
	it("rejects an unknown placeholder", () => {
		expect(issuesOf([core("{{animal}}の一種。")])).toEqual([
			"unknown-placeholder",
		]);
	});

	it("names the unknown placeholder so a failing build can be read", () => {
		const result = compileTemplateSet(1, [core("{{verb}}する。")], []);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues[0]).toEqual({
			code: "unknown-placeholder",
			id: "classification-01",
			detail: "verb",
		});
	});

	it("rejects an unclosed placeholder", () => {
		expect(issuesOf([core("{{nounの一種。")])).toEqual(["unclosed-placeholder"]);
		expect(issuesOf([core("{{noun}の一種。")])).toEqual(["unclosed-placeholder"]);
		expect(issuesOf([core("{{ {{noun}}の一種。")])).toEqual([
			"unclosed-placeholder",
		]);
	});

	it("rejects an empty placeholder", () => {
		expect(issuesOf([core("{{}}の一種。")])).toEqual(["empty-placeholder"]);
	});

	it("rejects a duplicate template id", () => {
		expect(
			issuesOf([core("{{noun}}の一種。"), core("{{noun}}の仲間。")]),
		).toEqual(["duplicate-template-id"]);
	});

	it("rejects a duplicate optional clause id", () => {
		expect(
			issuesOf(
				[core("{{noun}}の一種。")],
				[clause("単に{{noun}}ともいう。"), clause("まれに用いる。")],
			),
		).toEqual(["duplicate-clause-id"]);
	});

	it("rejects a clause id that collides with a core template id", () => {
		expect(
			issuesOf(
				[core("{{noun}}の一種。", "etymology-01")],
				[clause("語源は不明である。", "etymology-01")],
			),
		).toEqual(["duplicate-clause-id"]);
	});

	it("rejects an empty core definition", () => {
		expect(issuesOf([core("")])).toEqual(["empty-core-definition"]);
		expect(issuesOf([core("   ")])).toEqual(["empty-core-definition"]);
	});

	it("rejects an invalid family", () => {
		expect(
			issuesOf([{ id: "mystery-01", family: "mystery", text: "{{noun}}。" }]),
		).toEqual(["invalid-family"]);
	});

	it("rejects an invalid optional category", () => {
		expect(
			issuesOf(
				[core("{{noun}}の一種。")],
				[{ id: "optional-x-01", category: "mystery", text: "そうである。" }],
			),
		).toEqual(["invalid-optional-category"]);
	});

	it("rejects an id that is not stable kebab-case", () => {
		for (const id of ["", "Classification-01", "classification 01", "a--b"]) {
			expect(issuesOf([core("{{noun}}。", id)])).toEqual(["invalid-id"]);
		}
	});

	it("reports every broken entry rather than only the first", () => {
		expect(
			issuesOf([
				core("{{animal}}。", "classification-01"),
				core("", "classification-02"),
				{ id: "mystery-01", family: "mystery", text: "{{noun}}。" },
			]),
		).toEqual([
			"unknown-placeholder",
			"empty-core-definition",
			"invalid-family",
		]);
	});

	it("accepts a well-formed set and freezes it", () => {
		const result = compileTemplateSet(
			7,
			[core("{{noun}}の一種。")],
			[clause("単に{{noun}}ともいう。")],
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.set.version).toBe(7);
		expect(Object.isFrozen(result.set)).toBe(true);
		expect(Object.isFrozen(result.set.coreTemplates)).toBe(true);
		expect(Object.isFrozen(result.set.coreTemplates[0])).toBe(true);
	});

	it("modifies neither raw list it is given", () => {
		const rawCore = [core("{{noun}}の一種。")];
		const rawClauses = [clause("単に{{noun}}ともいう。")];
		const snapshot = JSON.stringify([rawCore, rawClauses]);

		compileTemplateSet(1, rawCore, rawClauses);

		expect(JSON.stringify([rawCore, rawClauses])).toBe(snapshot);
	});
});

describe("the standard template set", () => {
	it("compiles every core template the document defines", () => {
		// `resources/fake-dictionary/standard-templates.md` holds 30 families of three.
		expect(STANDARD_CORE_TEMPLATES).toHaveLength(90);
		expect(TEMPLATE_FAMILIES).toHaveLength(30);
		expect(STANDARD_TEMPLATE_SET.coreTemplates).toHaveLength(90);
	});

	it("gives every family exactly three templates", () => {
		for (const family of TEMPLATE_FAMILIES) {
			expect(
				STANDARD_TEMPLATE_SET.coreTemplates.filter(
					(template) => template.family === family,
				),
			).toHaveLength(3);
		}
	});

	it("compiles every optional clause the document defines", () => {
		expect(STANDARD_OPTIONAL_CLAUSES).toHaveLength(31);
		expect(STANDARD_TEMPLATE_SET.optionalClauses).toHaveLength(31);
		expect(OPTIONAL_CLAUSE_CATEGORIES).toHaveLength(6);
	});

	it("keeps every id unique across templates and clauses together", () => {
		const ids = [
			...STANDARD_TEMPLATE_SET.coreTemplates.map((template) => template.id),
			...STANDARD_TEMPLATE_SET.optionalClauses.map((entry) => entry.id),
		];

		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toHaveLength(121);
	});

	it("uses the document's own core template ids", () => {
		const ids = STANDARD_TEMPLATE_SET.coreTemplates.map(
			(template) => template.id,
		);

		expect(ids).toContain("classification-01");
		expect(ids).toContain("uncertain-03");
		for (const id of ids) {
			expect(id).toMatch(/^[a-z][a-z-]*-0[1-3]$/);
		}
	});

	it("uses only the eight supported placeholders", () => {
		const used = new Set<FakeDictionaryPlaceholder>();
		for (const entry of [
			...STANDARD_TEMPLATE_SET.coreTemplates,
			...STANDARD_TEMPLATE_SET.optionalClauses,
		]) {
			for (const placeholder of entry.requiredPlaceholders) {
				used.add(placeholder);
			}
		}

		for (const placeholder of used) {
			expect(FAKE_DICTIONARY_PLACEHOLDERS).toContain(placeholder);
		}
		// `proper` and `organization` are supported but no standard template
		// happens to ask for them; that is a subset, not a gap.
		expect([...used].sort()).toEqual([
			"adverbialNoun",
			"noun",
			"number",
			"person",
			"place",
			"sahen",
		]);
	});

	it("gives every entry at least one segment and no empty core definition", () => {
		for (const template of STANDARD_TEMPLATE_SET.coreTemplates) {
			expect(template.segments.length).toBeGreaterThan(0);
		}
		for (const entry of STANDARD_TEMPLATE_SET.optionalClauses) {
			expect(entry.segments.length).toBeGreaterThan(0);
		}
	});

	it("declares the template set version", () => {
		expect(STANDARD_TEMPLATE_SET_VERSION).toBe(1);
		expect(STANDARD_TEMPLATE_SET.version).toBe(STANDARD_TEMPLATE_SET_VERSION);
	});

});

describe("the canonical hash", () => {
	it("matches the published FNV-1a 32-bit vectors", () => {
		// The reference vectors for FNV-1a/32 over ASCII input.
		expect(fnv1a32("")).toBe(0x811c9dc5);
		expect(fnv1a32("a")).toBe(0xe40c292c);
		expect(fnv1a32("foobar")).toBe(0xbf9cf968);
	});

	it("hashes the UTF-8 bytes of non-ASCII input", () => {
		// Cross-checked against an independent FNV-1a/32 over UTF-8: "猫" is
		// U+732B, three bytes E7 8C AB. Pinned so a future change to the byte
		// encoding cannot pass unnoticed.
		expect(fnv1a32("猫")).toBe(731413007);
		expect(fnv1a32("猫")).not.toBe(fnv1a32("+"));
	});

	it("hashes a surrogate pair as one code point", () => {
		// Four UTF-8 bytes, not two mangled halves.
		expect(fnv1a32("🀄")).toBe(1739906204);
	});

	it("keeps a length prefix unambiguous where a delimiter would not be", () => {
		expect(canonicalList([canonicalString("a:b")])).not.toBe(
			canonicalList([canonicalString("a"), canonicalString("b")]),
		);
		expect(canonicalString("")).toBe("0:");
	});
});
