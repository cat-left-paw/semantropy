import { describe, expect, it } from "vitest";
import { compileFakeAlertRecipeSet, inspectFakeAlertLiteral } from "../src/fakeAlert/compileRecipeSet";
import {
	FAKE_ALERT_ADJECTIVE_FOLLOWERS,
	FAKE_ALERT_BUTTON_ROLES,
	FAKE_ALERT_BUTTON_SETS,
	FAKE_ALERT_KINDS,
	FAKE_ALERT_LIMITS,
	FAKE_ALERT_NA_FOLLOWERS,
	FAKE_ALERT_SAHEN_FOLLOWERS,
	FAKE_ALERT_SLOT_KINDS,
	FAKE_ALERT_VERB_FOLLOWERS,
	FAKE_ALERT_VERB_NOUN_TAILS,
	FAKE_ALERT_VERB_NOUNS,
} from "../src/fakeAlert/recipeData";
import { baseInput, compileCodes, compiled, edited, family, oddLine, recipe, type Edit, type Input } from "./fakeAlertRecipeFixtures";

// FAKE-ALERT-TEMPLATES1: the product compiler alone. This file imports only
// `src/fakeAlert/`, so the temporary-copy mutation probes can run it.

describe("the Fake Alert recipe compiler", () => {
	it("accepts the small reference set and deep-freezes fresh data", () => {
		const input = baseInput();
		const set = compiled(input);
		expect(set.prompts.map((entry) => entry.id)).toEqual(["p-noun", "p-act"]);
		expect(set.families.map((entry) => [entry.id, entry.recipes.map((item) => item.id)])).toEqual([
			["ask", ["p-noun", "p-act"]], ["blurt", ["t-one"]], ["fine", ["o-fine"]], ["stop", ["o-stop"]], ["odd", ["o-odd"]],
		]);
		const odd = set.outcomes[2]!;
		expect([odd.sharedSlots, odd.localSlots, odd.needsSahen, odd.stage, odd.buttons]).toEqual([["n1", "s1"], ["+n1", "+s1"], true, "outcome", "ok"]);
		expect(odd.lines[1]).toEqual(["代わりに", { token: "+n1", kind: "n", index: 1, local: true }, "を", { token: "+s1", kind: "s", index: 1, local: true }, "しました。"]);
		expect(set.outcomes[1]!.sharedSlots).toEqual([]);
		for (const value of [set, set.families, set.families[0]!.recipes, odd, odd.lines, odd.lines[1], odd.lines[1]![1], odd.sharedSlots]) {
			expect(Object.isFrozen(value)).toBe(true);
		}
		// The caller's own data is copied, not frozen or kept.
		expect(Object.isFrozen(input.families[0])).toBe(false);
	});

	it.each([
		["a schema it does not know", (input: Input) => { input.schemaVersion = 2; }, ["unsupported-schema-version"]],
		["a data version of 0", (input: Input) => { input.dataVersion = 0; }, ["invalid-data-version"]],
		["an extra document field", (input: Input) => { (input as Record<string, unknown>)["extra"] = 1; }, ["unknown-field"]],
		["a list that is not an array", (input: Input) => { (input as Record<string, unknown>)["outcomes"] = {}; }, ["invalid-structure"]],
		["an entry that is not an object", (input: Input) => { (input.families as unknown[]).push("x"); }, ["invalid-structure"]],
		["an ID that is not kebab-case", (input: Input) => { family(input, "odd").id = "Odd"; }, ["invalid-id", "unknown-family"]],
		["one ID used by two entry kinds", (input: Input) => { recipe(input, "t-one").id = "ask"; }, ["duplicate-id"]],
		["an unknown stage", (input: Input) => { family(input, "blurt").stage = "popup"; }, ["invalid-stage", "unknown-family"]],
		["a family weight of 0", (input: Input) => { family(input, "odd").weight = 0; }, ["invalid-weight", "unknown-family"]],
		["a drift above 3", (input: Input) => { family(input, "odd").drift = 4; }, ["invalid-drift", "unknown-family"]],
		["a fractional drift", (input: Input) => { family(input, "odd").drift = 1.5; }, ["invalid-drift", "unknown-family"]],
		["a terminal family at drift 0", (input: Input) => { family(input, "blurt").drift = 0; }, ["terminal-drift-zero", "unknown-family"]],
		["an outcome family without on", (input: Input) => { delete family(input, "odd").on; }, ["missing-on", "unknown-family"]],
		["an unknown on", (input: Input) => { family(input, "odd").on = "maybe"; }, ["invalid-on", "unknown-family"]],
		["on written for a prompt family", (input: Input) => { family(input, "blurt").on = "any"; }, ["unexpected-on", "unknown-family"]],
		["a family no recipe names", (input: Input) => { input.families.push({ id: "idle", stage: "outcome", weight: 1, drift: 1, on: "any" }); }, ["unused-family"]],
		["a recipe naming no family", (input: Input) => { recipe(input, "o-odd").family = "nowhere"; }, ["unknown-family", "unused-family"]],
		["a prompt in an outcome family", (input: Input) => { recipe(input, "p-act").family = "odd"; }, ["stage-mismatch"]],
		["an unknown kind", (input: Input) => { recipe(input, "o-odd").kind = "question"; }, ["invalid-kind"]],
		["an unknown button set", (input: Input) => { recipe(input, "p-act").buttons = "yes-no-cancel"; }, ["invalid-buttons"]],
		["a prompt without buttons", (input: Input) => { delete recipe(input, "p-act").buttons; }, ["missing-buttons"]],
		["buttons on a terminal", (input: Input) => { recipe(input, "t-one").buttons = "ok"; }, ["unexpected-buttons"]],
		["buttons on an outcome", (input: Input) => { recipe(input, "o-odd").buttons = "ok"; }, ["unexpected-buttons"]],
		["enabled as a string", (input: Input) => { (recipe(input, "o-odd") as Record<string, unknown>)["enabled"] = "true"; }, ["invalid-boolean"]],
		["a recipe weight above the safe range", (input: Input) => { recipe(input, "o-odd").weight = Number.MAX_SAFE_INTEGER + 1; }, ["invalid-weight"]],
		["an extra recipe field", (input: Input) => { (recipe(input, "o-odd") as Record<string, unknown>)["requires"] = []; }, ["unknown-field"]],
		["no line", (input: Input) => { recipe(input, "o-odd").lines = []; }, ["missing-line"]],
		["five lines", (input: Input) => { recipe(input, "o-odd").lines = ["一。", "二。", "三。", "四。", "五。"]; }, ["line-limit"]],
		["the same Alert twice", (input: Input) => { input.outcomes.push({ ...recipe(input, "o-stop"), id: "o-again" }); }, ["duplicate-recipe"]],
	] as const)("refuses %s", (_name, edit, codes) => {
		expect(compileCodes(edited(edit))).toEqual(codes);
	});

	it.each([
		["an empty line", "", ["invalid-line"]],
		["a line that is not text", 7, ["invalid-line"]],
		["an unclosed slot", "{n1は", ["invalid-line"]],
		["a slot index above 3", "{n4}です。", ["invalid-slot"]],
		["an unknown slot kind", "{a1}です。", ["invalid-slot"]],
		["a placeholder in double braces", "{{n1}}です。", ["invalid-slot", "invalid-literal"]],
		["a stray closing brace", "猫}です。", ["invalid-literal"]],
		["ASCII text", "OKです。", ["invalid-literal"]],
		["a space", "猫 です。", ["invalid-literal"]],
		["Markdown", "**猫**です。", ["invalid-literal"]],
		["a line break", "猫です。\n犬です。", ["invalid-literal"]],
		["a zero-width joiner", "猫\u200Dです。", ["invalid-literal"]],
		["text that is not NFC", "か\u3099です。", ["invalid-literal"]],
		// A compatibility ideograph is Han, so only the NFC rule refuses it.
		["a compatibility ideograph", "\uFA10です。", ["invalid-literal"]],
		["more fixed text than a line holds", "あ".repeat(FAKE_ALERT_LIMITS.lineLiteralCodePoints + 1), ["literal-limit"]],
		["more slots than a line holds", "{n1}と{n2}と{n3}と{+n1}と{+n2}です。", ["slot-limit"]],
		["a sahen slot before another slot", "{s1}{n1}です。", ["invalid-sahen-follower"]],
		["a sahen slot before a tail that is not a する form", "{s1}ます。", ["invalid-sahen-follower"]],
		// FAKE-ALERT-VERB1: a verb slot is a basic form, and only text that takes that form may follow.
		["a verb slot before a slot that is not a noun", "{v1}{s1}です。", ["invalid-verb-follower"]],
		["a verb slot before a verb slot", "{v1}{v2}ことです。", ["invalid-verb-follower"]],
		["a verb slot before ます", "{v1}ます。", ["invalid-verb-follower"]],
		["a verb slot before a past tail", "{v1}た。", ["invalid-verb-follower"]],
		["a verb slot before a て form tail", "{v1}てください。", ["invalid-verb-follower"]],
		["a verb slot before ない", "{v1}ないでください。", ["invalid-verb-follower"]],
		["a verb slot before かった", "{v1}かったです。", ["invalid-verb-follower"]],
		["a verb slot before ば", "{v1}ば、{n1}です。", ["invalid-verb-follower"]],
		// VERB1 independent review 1, P2: a listed word must not also be the start of a tail that asks for another form.
		["a verb slot before a volitional tail", "{v1}ようとしています。", ["invalid-verb-follower"]],
		["a verb slot before a volitional question", "{v1}ようか。", ["invalid-verb-follower"]],
		["a verb slot before a contracted ておく", "{v1}といた。", ["invalid-verb-follower"]],
		["a verb slot before とく", "{v1}とく。", ["invalid-verb-follower"]],
		["a verb slot before ならない", "{v1}ならない。", ["invalid-verb-follower"]],
		// A noun the verb modifies must be followed by a particle, だ, で or a mark, or end the line.
		["a verb slot before の and a noun", "{v1}の時間です。", ["invalid-verb-follower"]],
		["a verb slot before の and a slot", "{v1}の{n1}です。", ["invalid-verb-follower"]],
		["a verb slot before a noun and a slot", "{v1}こと{n1}です。", ["invalid-verb-follower"]],
		["a verb slot before a compound verb spelled like わけ", "{v1}わけます。", ["invalid-verb-follower"]],
		["a verb slot before a compound verb spelled like つもり", "{v1}つもりました。", ["invalid-verb-follower"]],
		["a verb slot before a compound verb spelled like はず", "{v1}はずします。", ["invalid-verb-follower"]],
		["a verb slot before a compound verb that starts with 間", "{v1}間違えました。", ["invalid-verb-follower"]],
		["a verb slot before a compound verb that starts with 代わり", "{v1}代わりました。", ["invalid-verb-follower"]],
		// FAKE-ALERT-ADJ1: an イ-adjective slot is a basic form; every other form is built on the stem.
		["an adjective slot before かった", "{i1}かったです。", ["invalid-adjective-follower"]],
		["an adjective slot before くて", "{i1}くて、{n1}です。", ["invalid-adjective-follower"]],
		["an adjective slot before ければ", "{i1}ければ、{n1}です。", ["invalid-adjective-follower"]],
		["an adjective slot before さ", "{i1}さが足りません。", ["invalid-adjective-follower"]],
		["an adjective slot before ない", "{i1}ないです。", ["invalid-adjective-follower"]],
		["an adjective slot before べき", "{i1}べきです。", ["invalid-adjective-follower"]],
		["an adjective slot before the prohibitive な", "{i1}な。", ["invalid-adjective-follower"]],
		["an adjective slot before a verb slot", "{i1}{v1}ことです。", ["invalid-adjective-follower"]],
		["an adjective slot before a sahen slot", "{i1}{s1}です。", ["invalid-adjective-follower"]],
		["an adjective slot before a noun and a slot", "{i1}こと{n1}です。", ["invalid-adjective-follower"]],
		["an adjective slot before a compound verb spelled like わけ", "{i1}わけます。", ["invalid-adjective-follower"]],
		// A ナ-adjective slot is a stem, completed by fixed text.
		["a na slot before a slot", "{na1}{n1}です。", ["invalid-na-follower"]],
		["a na slot before ない", "{na1}ないでください。", ["invalid-na-follower"]],
		["a na slot before なる", "{na1}なる{n1}です。", ["invalid-na-follower"]],
		["a na slot before ならない", "{na1}ならない。", ["invalid-na-follower"]],
		["a na slot before な and a slot that is not a noun", "{na1}な{v1}ことです。", ["invalid-na-follower"]],
		["a na slot before な and a kana word that is not a listed noun", "{na1}なあれです。", ["invalid-na-follower"]],
		["a na slot before な and a compound verb spelled like わけ", "{na1}なわけます。", ["invalid-na-follower"]],
		["a na slot before なの and a slot", "{na1}なの{n1}です。", ["invalid-na-follower"]],
		["a na slot before な at the end of the line", "{na1}な", ["invalid-na-follower"]],
		["a na slot before の", "{na1}の{n1}です。", ["invalid-na-follower"]],
		["a na slot before でき", "{na1}できません。", ["invalid-na-follower"]],
		["a na slot before だけ", "{na1}だけです。", ["invalid-na-follower"]],
		["a na slot before させ", "{na1}させます。", ["invalid-na-follower"]],
		["a na slot before され", "{na1}されました。", ["invalid-na-follower"]],
		["a na slot before さ and a slot", "{na1}さ{n1}です。", ["invalid-na-follower"]],
		["a na slot before し", "{na1}します。", ["invalid-na-follower"]],
		// The slot grammar: two kinds more, and nothing else.
		["a na slot index above 3", "{na4}です。", ["invalid-slot"]],
		["an adjective slot index of 0", "{i0}です。", ["invalid-slot"]],
		["a slot kind spelled with two other letters", "{ni1}です。", ["invalid-slot"]],
		["an ASCII ellipsis", "...です。", ["invalid-literal"]],
	] as const)("refuses %s", (_name, line, codes) => {
		expect(compileCodes(oddLine(line))).toEqual(codes);
	});

	it("accepts the boundaries of the line grammar", () => {
		for (const line of [
			"あ".repeat(FAKE_ALERT_LIMITS.lineLiteralCodePoints), "{n1}と{n2}と{n3}と{+n1}です。", "{s1}", "代わりに{+s1}", "{n1}{s1}中です。",
			"{s1}、{s2}、{s3}。", "ヴァージョンー！", "{n1}は々ですか？",
			...FAKE_ALERT_SAHEN_FOLLOWERS.map((follower) => `{s1}${follower}`),
			"{v1}", "{n1}は{v1}", "これ以上{v1}な。", "{v1}代わりに{+v1}ことにしました。", "{v1}のを{v2}まで待ちます。",
			...FAKE_ALERT_VERB_FOLLOWERS.map((follower) => `{v1}${follower}`),
			// A noun the verb modifies: at the end of the line, or before each allowed tail, a slot after that or not.
			...FAKE_ALERT_VERB_NOUNS.map((noun) => `{n1}は{v1}${noun}`),
			...FAKE_ALERT_VERB_NOUNS.flatMap((noun) => FAKE_ALERT_VERB_NOUN_TAILS.map((tail) => `{v1}${noun}${tail}`)),
			"{v1}のを{n1}は待ちます。", "{v1}ように{n1}を置きます。", "{v1}という{n1}です。", "{v1}なら、{n1}です。", "{v1}ならば{n1}です。",
			// FAKE-ALERT-ADJ1: a verb or an イ-adjective directly before the noun slot it modifies, shared or local.
			"{v1}{n1}です。", "{v1}{+n1}です。", "{n1}を{v1}{n2}です。",
			"{i1}", "{n1}は{i1}", "{i1}{n1}です。", "{i1}{+n1}です。", "{+i1}{+n1}は{i1}です。", "{i1}{n1}と{i2}{n2}です。", "{i3}{n3}です。",
			...FAKE_ALERT_ADJECTIVE_FOLLOWERS.map((follower) => `{i1}${follower}`),
			...FAKE_ALERT_VERB_NOUNS.map((noun) => `{n1}は{i1}${noun}`),
			...FAKE_ALERT_VERB_NOUNS.flatMap((noun) => FAKE_ALERT_VERB_NOUN_TAILS.map((tail) => `{i1}${noun}${tail}`)),
			// A ナ-adjective stem: at the end of the line, before each listed word, and before な or さ in each allowed shape.
			"{na1}", "{n1}は{na1}", "{na1}に{s1}します。", "{na1}に{v1}な。", "{+na1}な{+n1}は{na1}ではありません。",
			...FAKE_ALERT_NA_FOLLOWERS.map((follower) => `{na1}${follower}`),
			"{na1}な{n1}です。", "{na1}な{+n1}です。", "{na1}な問題です。", "{na1}なエラーです。", "{na1}なので、{n1}です。", "{na1}なことです。",
			"{na1}なのは{n1}です。", "{n1}は{na1}なの", "{na1}さが足りません。", "{n1}の{na1}さ", "{na1}な{n1}が{na2}に{s1}しています。",
			...FAKE_ALERT_VERB_NOUN_TAILS.map((tail) => `{na1}さ${tail}`),
			// The ellipsis is fixed text like any other.
			"……ごめん。", "{n1}は……{n2}です。",
		]) {
			expect(compileCodes(oddLine(line)), line).toEqual([]);
		}
		expect(inspectFakeAlertLiteral("正常に完了しました。")).toBeNull();
		expect(inspectFakeAlertLiteral("……")).toBeNull();
		for (const value of ["", "a", "{", "}", "１", "猫\t", "😀", null, 3]) expect(inspectFakeAlertLiteral(value), String(value)).toBe("invalid-literal");
		expect(FAKE_ALERT_LIMITS.lines).toBe(4);
		expect(compileCodes(edited((input) => { recipe(input, "o-odd").lines = ["一。", "二。", "三。", "四。"]; }))).toEqual([]);
	});

	it("keeps the verb follower lists closed, with no bare よう, と, なら, な or か (VERB1 independent review 1, P2)", () => {
		expect(FAKE_ALERT_VERB_FOLLOWERS).toEqual(["まで", "だけ", "べき", "ように", "ようです", "ようだ", "か？", "か、", "か。", "かも", "かどうか", "から",
			"と、", "という", "なら、", "ならば", "な。", "な！", "、", "。", "？", "！"]);
		expect(FAKE_ALERT_VERB_NOUNS).toEqual(["こと", "の", "もの", "ところ", "わけ", "はず", "つもり", "ため", "予定", "必要", "場合", "前", "時", "間",
			"おそれ", "権限", "準備", "方法", "理由", "代わり"]);
		expect(FAKE_ALERT_VERB_NOUN_TAILS).toEqual(["が", "を", "に", "は", "も", "で", "の", "と", "か", "だ", "、", "。", "？", "！"]);
		// A noun is never also a word that follows directly: its tail would then go unchecked.
		for (const noun of FAKE_ALERT_VERB_NOUNS) {
			expect(FAKE_ALERT_VERB_FOLLOWERS.some((word) => noun.startsWith(word) || word.startsWith(noun)), noun).toBe(false);
		}
	});

	it("keeps the adjective and na follower lists closed (FAKE-ALERT-ADJ1)", () => {
		expect(FAKE_ALERT_SLOT_KINDS).toEqual(["n", "s", "v", "i", "na"]);
		expect(FAKE_ALERT_ADJECTIVE_FOLLOWERS).toEqual(["です", "だけ", "ように", "ようです", "ようだ", "か？", "か、", "か。", "かも", "かどうか", "から",
			"と、", "という", "なら、", "ならば", "、", "。", "？", "！"]);
		expect(FAKE_ALERT_NA_FOLLOWERS).toEqual(["に", "です", "でした", "でしょう", "では", "でも", "である", "でない", "で、",
			"だ。", "だ！", "だった", "だと", "だから", "だ、", "なら、", "ならば", "すぎ", "、", "。", "？", "！"]);
		// An adjective takes everything a verb takes directly but べき, まで and the prohibitive な, and です besides.
		expect(FAKE_ALERT_VERB_FOLLOWERS.filter((word) => !(FAKE_ALERT_ADJECTIVE_FOLLOWERS as readonly string[]).includes(word))).toEqual(["まで", "べき", "な。", "な！"]);
		expect(FAKE_ALERT_ADJECTIVE_FOLLOWERS.filter((word) => !(FAKE_ALERT_VERB_FOLLOWERS as readonly string[]).includes(word))).toEqual(["です"]);
		for (const noun of FAKE_ALERT_VERB_NOUNS) {
			expect(FAKE_ALERT_ADJECTIVE_FOLLOWERS.some((word) => noun.startsWith(word) || word.startsWith(noun)), noun).toBe(false);
		}
		// な and さ are checked by shape, so neither is a listed word, and no listed word begins with either but なら.
		expect(FAKE_ALERT_NA_FOLLOWERS.filter((word) => word.startsWith("な") || word.startsWith("さ"))).toEqual(["なら、", "ならば"]);
	});

	it("keeps Outcome-local slots out of prompts and terminals, and lets an Outcome use them freely", () => {
		for (const id of ["p-act", "t-one"]) {
			expect(compileCodes(edited((input) => { recipe(input, id).lines = ["{+n1}です。"]; }))).toEqual(["local-slot-outside-outcome"]);
		}
		const set = compiled(oddLine("{+n1}は{+n1}の{+n2}です。"));
		expect([set.outcomes[2]!.localSlots, set.outcomes[2]!.sharedSlots, set.outcomes[2]!.needsSahen]).toEqual([["+n1", "+n2"], [], false]);
		// A verb slot, shared or local, marks the recipe as needing a verb; a sahen or noun slot does not.
		const verbs = compiled(oddLine("{n1}は{v1}代わりに{+v2}ことにしました。"));
		expect([verbs.outcomes[2]!.sharedSlots, verbs.outcomes[2]!.localSlots, verbs.outcomes[2]!.needsVerb, verbs.outcomes[2]!.needsSahen]).toEqual([["n1", "v1"], ["+v2"], true, false]);
		expect(compiled(baseInput()).prompts.map((entry) => entry.needsVerb)).toEqual([false, false]);
		// An イ-adjective or ナ-adjective slot, shared or local, marks the recipe too, each with its own flag.
		const needs = (line: string) => {
			const entry = compiled(oddLine(line)).outcomes[2]!;
			return [entry.needsSahen, entry.needsVerb, entry.needsAdjective, entry.needsNa];
		};
		expect(needs("{i1}{n1}です。")).toEqual([false, false, true, false]);
		expect(needs("{n1}は{+i1}です。")).toEqual([false, false, true, false]);
		expect(needs("{na1}な{n1}です。")).toEqual([false, false, false, true]);
		expect(needs("{n1}は{+na1}です。")).toEqual([false, false, false, true]);
		expect(needs("{na1}な{n1}が{+na1}に{s1}しています。")).toEqual([true, false, false, true]);
		expect(needs("{+v1}{n1}は{+i1}{+n1}です。")).toEqual([false, true, true, false]);
		expect(needs("{n1}です。")).toEqual([false, false, false, false]);
		const slots = compiled(oddLine("{na1}な{n1}は{+i1}{+n1}です。")).outcomes[2]!;
		expect([slots.sharedSlots, slots.localSlots]).toEqual([["na1", "n1"], ["+i1", "+n1"]]);
		for (const id of ["p-act", "t-one"]) {
			expect(compileCodes(edited((input) => { recipe(input, id).lines = ["{+na1}です。"]; }))).toEqual(["local-slot-outside-outcome"]);
			expect(compileCodes(edited((input) => { recipe(input, id).lines = ["{+i1}です。"]; }))).toEqual(["local-slot-outside-outcome"]);
		}
	});

	it("reports every problem it finds, in entry order", () => {
		const input = edited((value) => {
			family(value, "ask").weight = -1;
			recipe(value, "p-act").kind = "alarm";
			recipe(value, "o-odd").lines = ["{x1}", "abc"];
		});
		const result = compileFakeAlertRecipeSet(input);
		expect(result.ok ? [] : result.issues.map((entry) => [entry.code, entry.id])).toEqual([
			["invalid-weight", "ask"], ["unknown-family", "p-noun"], ["unknown-family", "p-act"], ["invalid-kind", "p-act"],
			["invalid-slot", "o-odd"], ["invalid-literal", "o-odd"],
		]);
	});

	describe("the paths the data must always leave open", () => {
		it("needs a level-0 prompt that uses no sahen noun", () => {
			expect(compileCodes(edited((input) => { recipe(input, "p-noun").lines = ["{n1}を{s2}しますか？"]; }))).toEqual(["no-level-zero-prompt"]);
			// A disabled recipe is no path, and neither is a prompt of a drift-1 family.
			expect(compileCodes(edited((input) => { recipe(input, "p-noun").enabled = false; }))).toEqual(["no-level-zero-prompt"]);
			expect(compileCodes(edited((input) => {
				input.families.push({ id: "sudden", stage: "prompt", weight: 1, drift: 1 });
				recipe(input, "p-noun").family = "sudden";
			}))).toEqual(["no-level-zero-prompt"]);
		});

		it("needs, for every level-0 prompt and each of its button roles, a level-0 outcome that fits it", () => {
			const issues = (edit: Edit) => {
				const result = compileFakeAlertRecipeSet(edited(edit));
				return result.ok ? [] : result.issues.map((entry) => [entry.code, entry.id, entry.detail]);
			};
			// The affirm outcome now uses a shared slot neither prompt has.
			expect(issues((input) => { recipe(input, "o-fine").lines = ["{n3}を完了しました。"]; })).toEqual([
				["no-level-zero-outcome", "p-noun", "affirm"], ["no-level-zero-outcome", "p-act", "affirm"],
			]);
			// It needs a sahen noun the noun-only prompt does not need.
			expect(issues((input) => { recipe(input, "o-fine").lines = ["{n1}を{+s1}しました。"]; })).toEqual([
				["no-level-zero-outcome", "p-noun", "affirm"], ["no-noun-only-outcome", "affirm", undefined],
			]);
			// The deny outcome is gone, for both prompts.
			expect(issues((input) => { recipe(input, "o-stop").enabled = false; })).toEqual([
				["no-level-zero-outcome", "p-noun", "deny"], ["no-level-zero-outcome", "p-act", "deny"], ["no-noun-only-outcome", "deny", undefined],
			]);
			// An outcome of a drift-1 family is not a level-0 path.
			expect(issues((input) => { family(input, "stop").drift = 1; }).map((entry) => entry[0])).toEqual([
				"no-level-zero-outcome", "no-level-zero-outcome", "no-noun-only-outcome",
			]);
		});

		it("counts a verb like a sahen noun: no path may depend on a kind of word the Vocabulary might lack (VERB1)", () => {
			const issues = (edit: Edit) => {
				const result = compileFakeAlertRecipeSet(edited(edit));
				return result.ok ? [] : result.issues.map((entry) => [entry.code, entry.id, entry.detail]);
			};
			// The only noun-only prompt now needs a verb.
			expect(issues((input) => { recipe(input, "p-noun").lines = ["{n1}は{v1}ことがありますか？"]; }).map((entry) => entry[0])).toEqual(["no-level-zero-prompt"]);
			// The affirm outcome needs a verb neither prompt needs.
			expect(issues((input) => { recipe(input, "o-fine").lines = ["{n1}は{+v1}ことにしました。"]; })).toEqual([
				["no-level-zero-outcome", "p-noun", "affirm"], ["no-level-zero-outcome", "p-act", "affirm"], ["no-noun-only-outcome", "affirm", undefined],
			]);
			// A prompt that needs a verb may be followed by an outcome that needs one, and still needs a path of its own.
			expect(issues((input) => {
				input.prompts.push({ id: "p-verb", family: "ask", enabled: true, kind: "confirmation", buttons: "yes-no", weight: 1, lines: ["本当に{v1}つもりですか？"] });
				input.outcomes.push({ id: "o-verb", family: "fine", enabled: true, kind: "success", weight: 1, lines: ["{v1}ことに成功しました。"] });
			})).toEqual([]);
			// A sahen prompt does not prove a verb exists: an outcome that needs a verb is no path for it.
			expect(issues((input) => {
				recipe(input, "o-fine").lines = ["{n1}を{v1}ことにしました。"];
				input.prompts.push({ id: "p-verb", family: "ask", enabled: true, kind: "confirmation", buttons: "ok", weight: 1, lines: ["{n1}が{v1}のを待ちますか？"] });
			})).toEqual([
				["no-level-zero-outcome", "p-noun", "affirm"], ["no-level-zero-outcome", "p-act", "affirm"], ["no-noun-only-outcome", "affirm", undefined],
			]);
		});

		it.each([
			["an イ-adjective", "{n1}は{i1}ですか？", "{n1}は{+i1}です。", "{i1}{n1}を削除しますか？", "{i1}{n1}を削除しました。"],
			["a ナ-adjective stem", "{n1}は{na1}ですか？", "{n1}は{+na1}です。", "{na1}な{n1}を削除しますか？", "{na1}な{n1}を削除しました。"],
		] as const)("counts %s the same way (FAKE-ALERT-ADJ1)", (_name, prompt, outcome, ownPrompt, ownOutcome) => {
			const issues = (edit: Edit) => {
				const result = compileFakeAlertRecipeSet(edited(edit));
				return result.ok ? [] : result.issues.map((entry) => [entry.code, entry.id, entry.detail]);
			};
			// The only noun-only prompt now needs that kind of word.
			expect(issues((input) => { recipe(input, "p-noun").lines = [prompt]; }).map((entry) => entry[0])).toEqual(["no-level-zero-prompt"]);
			// The affirm outcome needs it, and neither prompt does.
			expect(issues((input) => { recipe(input, "o-fine").lines = [outcome]; })).toEqual([
				["no-level-zero-outcome", "p-noun", "affirm"], ["no-level-zero-outcome", "p-act", "affirm"], ["no-noun-only-outcome", "affirm", undefined],
			]);
			// A prompt that needs it may be followed by an outcome that needs it, and still needs a path of its own.
			expect(issues((input) => {
				input.prompts.push({ id: "p-own", family: "ask", enabled: true, kind: "confirmation", buttons: "yes-no", weight: 1, lines: [ownPrompt] });
				input.outcomes.push({ id: "o-own", family: "fine", enabled: true, kind: "success", weight: 1, lines: [ownOutcome] });
			})).toEqual([]);
			// A prompt that needs a sahen noun proves nothing about this kind: an outcome that needs it is no path for it.
			expect(issues((input) => {
				recipe(input, "o-fine").lines = [ownOutcome];
				input.prompts.push({ id: "p-own", family: "ask", enabled: true, kind: "confirmation", buttons: "ok", weight: 1, lines: [ownPrompt] });
			})).toEqual([
				["no-level-zero-outcome", "p-noun", "affirm"], ["no-level-zero-outcome", "p-act", "affirm"], ["no-noun-only-outcome", "affirm", undefined],
			]);
		});

		it("accepts an outcome family that answers any role as the path for both", () => {
			expect(compileCodes(edited((input) => {
				family(input, "fine").on = "any";
				recipe(input, "o-stop").enabled = false;
			}))).toEqual([]);
			// An OK-only prompt has one role, so it needs no deny outcome of its own; the noun-only rule still does.
			expect(compileCodes(edited((input) => {
				recipe(input, "p-noun").buttons = "ok";
				recipe(input, "p-act").buttons = "ok";
				recipe(input, "o-stop").enabled = false;
			}))).toEqual(["no-noun-only-outcome"]);
		});
	});

	it("does not trust typed callers", () => {
		for (const value of [null, undefined, 1, "x", []]) expect(compileCodes(value)).toEqual(["invalid-structure"]);
		expect(compileCodes({ schemaVersion: 1, dataVersion: 1 })).toEqual(["invalid-structure", "invalid-structure", "invalid-structure", "invalid-structure"]);
		expect(compileCodes({ ...baseInput(), families: Array.from({ length: FAKE_ALERT_LIMITS.families + 1 }, () => ({})) })).toEqual(["entry-limit"]);
		expect(compileCodes(edited((input) => { (input.outcomes as unknown[]).push(null); }))).toEqual(["invalid-structure"]);
	});

	it("keeps the closed sets the policy fixes", () => {
		expect(FAKE_ALERT_KINDS).toEqual(["warning", "error", "confirmation", "information", "success"]);
		expect(FAKE_ALERT_BUTTON_SETS).toEqual({
			"ok": ["ok"], "ok-cancel": ["cancel", "ok"], "yes-no": ["no", "yes"], "retry-cancel": ["cancel", "retry"], "retry-ignore": ["ignore", "retry"],
		});
		// The affirmative button is last in every set, so it is shown at the right.
		for (const buttons of Object.values(FAKE_ALERT_BUTTON_SETS)) expect(FAKE_ALERT_BUTTON_ROLES[buttons.at(-1)!]).toBe("affirm");
		expect(FAKE_ALERT_BUTTON_ROLES).toEqual({ ok: "affirm", yes: "affirm", retry: "affirm", cancel: "deny", no: "deny", ignore: "deny" });
	});
});
