/**
 * Minted Vocabulary owners for the Fake Alert core tests. The owners go
 * through the production analyzer and Snapshot builder with a small lexicon
 * tokenizer (`mintOwner` from the Fake Proverb fixtures), so the core reads
 * the same Collision projection it reads in the plugin.
 */
import type { JapaneseToken } from "../src/tokenizer/JapaneseTokenizer";
import { adjective, mintOwner, noun, particle, period, token, verb } from "./fakeProverbCoreFixtures";

export { mintOwner } from "./fakeProverbCoreFixtures";

export const sahen = (surface: string): JapaneseToken => token(surface, "名詞", "サ変接続", { baseForm: surface });
const suru = token("する", "動詞", "自立", { baseForm: "する", conjugationType: "サ変・スル", conjugationForm: "基本形" });

/** Ordinary nouns, sahen nouns and the glue around them. */
export const ALERT_LEXICON: readonly JapaneseToken[] = [
	noun("猫"), noun("犬"), noun("封筒"), noun("病院"), noun("冷蔵庫"), noun("桜"), noun("夕食"), noun("時計"),
	sahen("観察"), sahen("絶望"), sahen("信頼"), sahen("散歩"), sahen("記憶"),
	suru, particle("は"), particle("を"), particle("が"), particle("に"), particle("の"), period,
];

/**
 * Regular verbs (歩く also as an inflected form), and verbs the closed
 * `verb-basic` rule refuses: suppletive ある, カ変 来る, 促音便 行く and サ変 する.
 */
export const ALERT_VERBS: readonly JapaneseToken[] = [
	verb("歩く", "五段・カ行イ音便"), verb("歩い", "五段・カ行イ音便", "連用タ接続", "歩く"), verb("見る", "一段"), verb("読む", "五段・マ行"),
	verb("待つ", "五段・タ行"), verb("話す", "五段・サ行"), verb("買う", "五段・ワ行促音便"), verb("泳ぐ", "五段・ガ行"),
	verb("ある", "五段・ラ行"), verb("来る", "カ変・来ル"), verb("行く", "五段・カ行促音便"), token("た", "助動詞", "*"),
];
/** The basic forms Fake Alert may show from VERB_TEXT. */
export const REGULAR_VERBS = ["歩く", "見る", "読む", "待つ", "話す", "買う", "泳ぐ"] as const;
/** RICH_TEXT's nouns and sahen nouns, with seven regular verbs and four the rule refuses. */
export const VERB_TEXT = "猫は歩く。犬は歩いた。封筒を見る。桜を読む。病院は待つ。時計を話す。夕食を買う。冷蔵庫は泳ぐ。猫はある。犬は来る。桜は行く。";

/** Five sahen nouns and eight other nouns, several of them more than once. */
export const RICH_TEXT = "猫は封筒を観察する。病院の犬は桜に絶望する。冷蔵庫を信頼する。夕食は時計を散歩する。猫は犬を記憶する。猫が桜を観察する。";
/** Nouns only: no sahen noun at all. */
export const NOUN_ONLY_TEXT = "猫は封筒の病院。犬は桜の冷蔵庫。夕食は時計。";
/** One noun. */
export const ONE_NOUN_TEXT = "猫は猫。";
/** No eligible noun. */
export const NO_NOUN_TEXT = "はをが。";

export async function richOwner(drawMode: "uniform" | "frequency" = "uniform") {
	return (await mintOwner([RICH_TEXT], drawMode, ALERT_LEXICON)).owner;
}
/** Twenty-four 一段 verbs: more than the full pool, so a verb recipe counts at its whole weight. */
export const MANY_VERBS = ["食べる", "起きる", "寝る", "着る", "見る", "出る", "借りる", "降りる", "浴びる", "落ちる", "閉じる", "信じる",
	"感じる", "考える", "答える", "教える", "覚える", "忘れる", "始める", "決める", "集める", "届ける", "続ける", "助ける"] as const;

/** RICH_TEXT with MANY_VERBS, each written once: nouns, five sahen nouns and a full pool of verbs. */
export async function manyVerbOwner(drawMode: "uniform" | "frequency" = "uniform") {
	const text = RICH_TEXT + MANY_VERBS.map((surface) => `猫は${surface}。`).join("");
	return (await mintOwner([text], drawMode, [...ALERT_LEXICON, ...MANY_VERBS.map((surface) => verb(surface, "一段"))])).owner;
}

/** RICH_TEXT and VERB_TEXT: nouns, five sahen nouns and seven regular verbs. */
export async function verbOwner(drawMode: "uniform" | "frequency" = "uniform") {
	return (await mintOwner([RICH_TEXT + VERB_TEXT], drawMode, [...ALERT_LEXICON, ...ALERT_VERBS])).owner;
}
/** A ナ-adjective stem, as the dictionary marks one: 名詞 / 形容動詞語幹. */
export const naStem = (surface: string): JapaneseToken => token(surface, "名詞", "形容動詞語幹", { baseForm: surface });
/** The な a stem takes before a noun. */
export const na = token("な", "助動詞", "*");

/** Twenty-four regular イ-adjectives of both classes: more than the full pool. */
export const MANY_ADJECTIVES = ["高い", "白い", "暗い", "深い", "細い", "遠い", "多い", "古い", "寒い", "赤い", "青い", "黒い",
	"長い", "重い", "軽い", "近い", "若い", "強い", "広い", "丸い", "美しい", "悲しい", "新しい", "怪しい"] as const;
/** Twenty-four ナ-adjective stems: more than the full pool. */
export const MANY_NA = ["静か", "無慈悲", "容易", "立派", "不思議", "丁寧", "綺麗", "大事", "派手", "元気", "危険", "安心",
	"必要", "普通", "正直", "無事", "自在", "退屈", "夢中", "得意", "必死", "大柄", "手頃", "善良"] as const;
/** The lexicon entries for MANY_ADJECTIVES and MANY_NA, with な. */
export const ADJECTIVE_LEXICON: readonly JapaneseToken[] = [
	...MANY_ADJECTIVES.map((surface) => adjective(surface, surface.endsWith("しい") ? "形容詞・イ段" : "形容詞・アウオ段")),
	...MANY_NA.map(naStem), na,
];

/** Twenty sahen nouns: with RICH_TEXT's five, more than the full pool. */
export const MANY_SAHEN = ["散策", "検討", "調査", "研究", "練習", "料理", "旅行", "運動", "勉強", "掃除",
	"洗濯", "説明", "計算", "記録", "報告", "相談", "準備", "確認", "整理", "選択"] as const;

/** RICH_TEXT with MANY_SAHEN, MANY_VERBS, MANY_ADJECTIVES and MANY_NA, each written once: a full pool of every kind of word. */
export async function fullOwner(drawMode: "uniform" | "frequency" = "uniform") {
	const text = RICH_TEXT + MANY_SAHEN.map((surface) => `${surface}する。`).join("") + MANY_VERBS.map((surface) => `猫は${surface}。`).join("") +
		MANY_ADJECTIVES.map((surface) => `${surface}猫。`).join("") + MANY_NA.map((surface) => `${surface}な猫。`).join("");
	const lexicon = [...ALERT_LEXICON, ...MANY_SAHEN.map(sahen), ...MANY_VERBS.map((surface) => verb(surface, "一段")), ...ADJECTIVE_LEXICON];
	return (await mintOwner([text], drawMode, lexicon)).owner;
}
export async function nounOnlyOwner() {
	return (await mintOwner([NOUN_ONLY_TEXT], "uniform", ALERT_LEXICON)).owner;
}
