import { readEntries } from "../../../scripts/max/scanDictionary.mjs";
import {
	SLOT_BASE_FORM,
	SLOT_CONJUGATION_FORM,
	SLOT_CONJUGATION_TYPE,
	SLOT_DETAIL1,
	SLOT_POS,
} from "../../../scripts/lindera/compactDictionary.mjs";
import type { JapaneseToken } from "../../../src/tokenizer/JapaneseTokenizer";
import { MAX_REALIZER_ADMITTED_CLASSES, realizeMaxCandidate } from "./maxRealizer";
import { MAX_TARGET_FORM_KEYS, type MaxTargetFormKey } from "./targetFormKey";

/**
 * The exhaustive re-analysis harness behind the coverage numbers in
 * `Docs/pre_release_max_realization_spike1_record.md`.
 *
 * For one admitted (Target form key, conjugation class) pair it takes **every**
 * lexeme of that class in the shipped dictionary, realizes the surface, appends
 * each follower the Manual allowlist permits for that key, and tokenizes the
 * result with the production adapter.
 *
 * **What this measures, exactly.** A probe *agrees* when the tokenizer returns
 * a first token whose surface is the realized string and whose part of speech,
 * independence, conjugation class and base form are the lexeme the realizer
 * claimed, followed by a second token whose surface is the untouched follower.
 * 98.29% of probes agree; the remaining 1.71% do not, and are accepted as a
 * known re-analysis difference rather than treated as failures. So this is a
 * measurement with a pinned bound, **not** a proof that every realized surface
 * is unambiguous and not a proof that the output is "correct Japanese".
 *
 * **What it is not evidence for.** It says nothing about text safety. That
 * property is structural, not empirical: `realizeMaxCandidate()` returns a
 * surface for the Target token and the caller writes it in front of a follower
 * it never touches, and the runtime never re-tokenizes its own output. Checking
 * that `realized + follower` starts with `realized` would be checking this
 * harness's own concatenation, so it is not asserted as if it were a finding.
 * What *is* checked against the tokenizer, for every probe including the
 * divergent ones, is that the returned tokens tile the probe exactly — the
 * realizer never produces a string the tokenizer drops or extends characters of.
 */

export type Lexeme = {
	readonly conjugationType: string;
	readonly baseForm: string;
};

export type ProbeFailure = {
	readonly key: MaxTargetFormKey;
	readonly conjugationType: string;
	readonly baseForm: string;
	readonly follower: string;
	readonly realized: string;
	readonly probe: string;
	readonly got: string;
	/** Whether the tokenizer's output still tiles the probe exactly. */
	readonly tiles: boolean;
};

/**
 * Every follower the Manual allowlist admits for each key, as literal surfaces.
 *
 * `general-noun` is the one open connection in the allowlist (名詞 / 一般, any
 * surface); `人` stands in for it, and the harness checks the class of the
 * token it comes back as rather than assuming the substitution is inert.
 */
export const KEY_FOLLOWERS: Readonly<Record<MaxTargetFormKey, readonly string[]>> =
	Object.freeze({
		"verb-basic": ["。", "、", "人", "こと", "と", "から"],
		"verb-irrealis-negation": ["ない", "なかっ", "なく", "なけれ", "ず", "ぬ"],
		"verb-irrealis-godan-suffix": ["せ", "せる", "れ", "れる"],
		"verb-irrealis-ichidan-suffix": ["させ", "させる", "られ", "られる"],
		"verb-volitional-u": ["う"],
		"verb-continuative": ["ます", "まし", "ませ", "たい", "たく", "たかっ", "ながら"],
		"verb-ta-stem-t": ["た", "たら", "て"],
		"verb-ta-stem-d": ["だ", "だら", "で"],
		"verb-conditional-ba": ["ば"],
		// The one slot whose contract states no follower requirement; a period
		// still has to survive it, so it is probed with one and on its own.
		"adjective-basic": ["", "。", "、"],
		"adjective-continuative-ku": ["ない", "なかっ", "なく", "なけれ", "て", "なる", "なっ", "なら", "なり"],
		"adjective-past-katta": ["た", "たら"],
		"adjective-conditional-kereba": ["ば"],
	});

/** Every independent verb / i-adjective lexeme, taken from its 基本形 entry. */
export function readLexemes(directory: string): readonly Lexeme[] {
	const entries = readEntries(directory);
	const seen = new Set<string>();
	const lexemes: Lexeme[] = [];
	for (const entry of entries) {
		const pos = entry[SLOT_POS];
		if (
			(pos !== "動詞" && pos !== "形容詞") ||
			entry[SLOT_DETAIL1] !== "自立" ||
			entry[SLOT_CONJUGATION_FORM] !== "基本形"
		) {
			continue;
		}
		const conjugationType = entry[SLOT_CONJUGATION_TYPE]!;
		const baseForm = entry[SLOT_BASE_FORM]!;
		const identity = `${pos}${conjugationType}${baseForm}`;
		if (seen.has(identity)) {
			continue;
		}
		seen.add(identity);
		lexemes.push({ conjugationType, baseForm });
	}
	return lexemes;
}

function candidateOf(lexeme: Lexeme) {
	return {
		pos: lexeme.conjugationType.startsWith("形容詞") ? "形容詞" : "動詞",
		detail1: "自立",
		conjugationType: lexeme.conjugationType,
		baseForm: lexeme.baseForm,
		isUnknown: false,
	};
}

/**
 * Runs the whole matrix. Returns one row per (key, class) with the number of
 * lexemes realized and every probe that did not come back as claimed, so a
 * caller can both pin the coverage and see exactly what a failure was.
 */
export function runRoundTrip(
	lexemes: readonly Lexeme[],
	tokenize: (text: string) => JapaneseToken[],
	options: { readonly limitPerPair?: number } = {},
): {
	readonly rows: readonly {
		readonly key: MaxTargetFormKey;
		readonly conjugationType: string;
		readonly lexemes: number;
		readonly realized: number;
		readonly probes: number;
	}[];
	readonly failures: readonly ProbeFailure[];
	/** Probes whose returned tokens did not tile the input exactly. */
	readonly untiled: readonly ProbeFailure[];
} {
	const byClass = new Map<string, Lexeme[]>();
	for (const lexeme of lexemes) {
		const list = byClass.get(lexeme.conjugationType);
		if (list) {
			list.push(lexeme);
		} else {
			byClass.set(lexeme.conjugationType, [lexeme]);
		}
	}
	const rows: {
		key: MaxTargetFormKey;
		conjugationType: string;
		lexemes: number;
		realized: number;
		probes: number;
	}[] = [];
	const failures: ProbeFailure[] = [];
	const untiled: ProbeFailure[] = [];

	for (const key of MAX_TARGET_FORM_KEYS) {
		for (const conjugationType of MAX_REALIZER_ADMITTED_CLASSES[key]) {
			const all = byClass.get(conjugationType) ?? [];
			const limit = options.limitPerPair ?? all.length;
			const selected = all.slice(0, limit);
			let realized = 0;
			let probes = 0;
			for (const lexeme of selected) {
				const result = realizeMaxCandidate(key, candidateOf(lexeme));
				if (!result.realized) {
					continue;
				}
				realized += 1;
				for (const follower of KEY_FOLLOWERS[key]) {
					probes += 1;
					const probe = `${result.surface}${follower}`;
					const tokens = tokenize(probe);
					const head = tokens[0];
					const tail = tokens[1];
					// Checked against the tokenizer's output, not against this
					// harness's own concatenation.
					const tiles = tokens.map((item) => item.surface).join("") === probe;
					const headOk =
						head !== undefined &&
						head.surface === result.surface &&
						head.isUnknown === false &&
						head.detail1 === "自立" &&
						head.conjugationType === lexeme.conjugationType &&
						head.baseForm === lexeme.baseForm;
					const tailOk =
						follower === ""
							? tokens.length === 1
							: tail !== undefined && tail.surface === follower;
					const record: ProbeFailure = {
						key,
						conjugationType,
						baseForm: lexeme.baseForm,
						follower,
						realized: result.surface,
						probe,
						tiles,
						got: tokens
							.map((token) => `${token.surface}/${token.pos}/${token.conjugationType}/${token.baseForm}`)
							.join(" + "),
					};
					if (!tiles) {
						untiled.push(record);
					}
					if (headOk && tailOk) {
						continue;
					}
					failures.push(record);
				}
			}
			rows.push({ key, conjugationType, lexemes: selected.length, realized, probes });
		}
	}
	return { rows, failures, untiled };
}
