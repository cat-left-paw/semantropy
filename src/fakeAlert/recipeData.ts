/**
 * The hand-written schema of the standard Fake Alert recipe set
 * (Fake Alert Recipe Schema 1, `Docs/fake_alert_policy1.md` §4).
 *
 * The entries themselves are not here. They live in
 * `resources/fake-alert/standard-recipes.md`, which a human edits, and reach
 * later slices as `./generated/standardFakeAlertRecipes`, which a build derives
 * from that document and refuses to leave stale. What stays here is what the
 * document is checked against: the closed kinds, button sets, stages, slot
 * grammar, literal grammar, limits, and the shape a raw entry has.
 *
 * This schema is Fake Alert's own. It shares no version, id space, generated
 * module or lock with Collision, Fake Dictionary or Fake Proverb, and nothing
 * here may import the generated entries: the generator loads this file to
 * validate them, so the dependency runs one way only.
 */

export const FAKE_ALERT_RECIPE_SCHEMA_VERSION = 1;

/** The kind an Alert shows: its icon and its title. A recipe's kind is shown as written. */
export const FAKE_ALERT_KINDS = ["warning", "error", "confirmation", "information", "success"] as const;
export type FakeAlertKind = (typeof FAKE_ALERT_KINDS)[number];

export const FAKE_ALERT_BUTTONS = ["ok", "cancel", "yes", "no", "retry", "ignore"] as const;
export type FakeAlertButton = (typeof FAKE_ALERT_BUTTONS)[number];

/** What pressing a button means to the Outcome draw. Only two roles in Schema 1. */
export const FAKE_ALERT_ROLES = ["affirm", "deny"] as const;
export type FakeAlertRole = (typeof FAKE_ALERT_ROLES)[number];

export const FAKE_ALERT_BUTTON_ROLES = {
	ok: "affirm",
	yes: "affirm",
	retry: "affirm",
	cancel: "deny",
	no: "deny",
	ignore: "deny",
} as const satisfies Readonly<Record<FakeAlertButton, FakeAlertRole>>;

/**
 * The closed button sets, each in the order the buttons are shown: the
 * affirmative button is last, so it sits at the right.
 */
export const FAKE_ALERT_BUTTON_SETS = {
	"ok": ["ok"],
	"ok-cancel": ["cancel", "ok"],
	"yes-no": ["no", "yes"],
	"retry-cancel": ["cancel", "retry"],
	"retry-ignore": ["ignore", "retry"],
} as const satisfies Readonly<Record<string, readonly FakeAlertButton[]>>;
export type FakeAlertButtonSet = keyof typeof FAKE_ALERT_BUTTON_SETS;
export const FAKE_ALERT_BUTTON_SET_IDS = Object.keys(FAKE_ALERT_BUTTON_SETS) as readonly FakeAlertButtonSet[];
/** A `terminal` and an `outcome` have no `buttons` field: they always show this set. */
export const FAKE_ALERT_CLOSING_BUTTON_SET: FakeAlertButtonSet = "ok";

/**
 * What a recipe is on screen. `prompt` is answered by a button and followed by
 * an `outcome`; `terminal` is shown once and closed by OK, with no Outcome. The
 * entry kind names the shape; what a recipe says is named by its family.
 */
export const FAKE_ALERT_STAGES = ["prompt", "terminal", "outcome"] as const;
export type FakeAlertStage = (typeof FAKE_ALERT_STAGES)[number];

/** Which button role an outcome family naturally answers. */
export const FAKE_ALERT_ON = ["affirm", "deny", "any"] as const;
export type FakeAlertOn = (typeof FAKE_ALERT_ON)[number];

/** A family's drift tier: how far it is from the plain, causally honest Alert. */
export const FAKE_ALERT_DRIFT_MAX = 3;
/**
 * A `terminal` family may not be drift 0: drift 0 is the only tier with a
 * weight at Text Semantropy 0, and a one-shot Alert never appears there.
 */
export const FAKE_ALERT_TERMINAL_DRIFT_MIN = 1;

/**
 * Slot kinds: `n` is a noun, `s` a sahen noun (always followed by a fixed
 * tail) and `v` a regular verb in its basic form (FAKE-ALERT-VERB1), which
 * is never inflected and is followed only by text that takes that form.
 * FAKE-ALERT-ADJ1 adds `i`, a regular イ-adjective in its basic form, under
 * the same rule, and `na`, the stem of a ナ-adjective (名詞 / 形容動詞語幹),
 * which like a sahen noun is completed by fixed text: な, に, です …
 */
export const FAKE_ALERT_SLOT_KINDS = ["n", "s", "v", "i", "na"] as const;
export type FakeAlertSlotKind = (typeof FAKE_ALERT_SLOT_KINDS)[number];
export const FAKE_ALERT_SLOT_INDEX_MAX = 3;
/**
 * `{n1}` is a binding a Prompt and its Outcome share; `{+n1}` is local to an
 * Outcome and always a new draw. Nothing else may stand between braces.
 */
export const FAKE_ALERT_SLOT_TOKEN = /^(\+?)(na|[nsvi])([1-3])$/;

/**
 * Allowed fixed text.
 *
 * A line is fixed Japanese text with slots in braces. The fixed text is
 * Hiragana, Katakana, Han, the prolonged-sound mark `ー`, the ellipsis `…`
 * (FAKE-ALERT-ADJ1), and `、` `。` `？` `！`. It must already be NFC and contain
 * no whitespace, Cc / Cf / Cs / Zl / Zp code point, ASCII, Markdown delimiter,
 * JavaScript or regular-expression notation. Braces only ever delimit a slot.
 */
export const FAKE_ALERT_LITERAL_PATTERN = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー…、。？！]+$/u;

/**
 * What may follow a sahen slot: the end of the line, or fixed text that starts
 * with one of these. A sahen noun is completed by a fixed する-type tail or
 * used as a noun before a particle; there is no inflection engine.
 */
export const FAKE_ALERT_SAHEN_FOLLOWERS = [
	"し", "する", "でき", "され", "させ", "中", "済み",
	"を", "に", "が", "は", "の", "も", "で", "と", "へ", "や", "か",
	"、", "。", "？", "！",
] as const;

/**
 * What may follow a verb slot. A verb slot holds a basic form (終止形 and 連体形
 * are the same for the regular classes) and nothing is inflected, so it ends
 * the line or stands before fixed text of one of two shapes. Nothing here asks
 * for another form: ます, た, て, ない and ば cannot follow.
 *
 * These are the words that take a basic form directly: the fixed text starts
 * with one of them. The match is by prefix, so each is written far enough that
 * no tail asking for another form starts the same way: と、 and という but
 * never と alone (歩いといた), なら、 and ならば but never なら (ならない),
 * ように ようです ようだ but never よう (歩こうとする), な with the mark that ends
 * its sentence (never ない), and か with what follows it (never かった).
 */
export const FAKE_ALERT_VERB_FOLLOWERS = [
	"まで", "だけ", "べき", "ように", "ようです", "ようだ",
	"か？", "か、", "か。", "かも", "かどうか", "から",
	"と、", "という", "なら、", "ならば", "な。", "な！",
	"、", "。", "？", "！",
] as const;

/**
 * The nouns a verb slot may modify: the fixed text starts with one of them,
 * and the noun ends the line or is followed by one of
 * `FAKE_ALERT_VERB_NOUN_TAILS`. What follows the noun is checked because a
 * noun's spelling can begin another word that asks for another form of the
 * verb: わけ in わけます (使いわけます), つもり in つもりました (降りつもりました),
 * 間 in 間違えました, and の before a noun (の時間, where 遊びの時間 is meant).
 */
export const FAKE_ALERT_VERB_NOUNS = [
	"こと", "の", "もの", "ところ", "わけ", "はず", "つもり", "ため",
	"予定", "必要", "場合", "前", "時", "間",
	"おそれ", "権限", "準備", "方法", "理由", "代わり",
] as const;

/** What may follow one of `FAKE_ALERT_VERB_NOUNS`: a particle, だ or で, or a mark. */
export const FAKE_ALERT_VERB_NOUN_TAILS = [
	"が", "を", "に", "は", "も", "で", "の", "と", "か", "だ",
	"、", "。", "？", "！",
] as const;

/**
 * What may follow an イ-adjective slot (FAKE-ALERT-ADJ1). The slot holds a
 * basic form, which ends a sentence and modifies a noun, so it ends the line,
 * stands directly before a noun slot (`{i1}{n1}`), or stands before fixed text
 * that starts with one of these words or with one of `FAKE_ALERT_VERB_NOUNS`
 * under the same tail rule. Every other form is built on the stem (高かった,
 * 高くて, 高ければ, 高さ), so its tail never follows a basic form: かった, くて,
 * ければ and さ cannot follow. Unlike a verb an adjective takes です, and not
 * べき, まで or the prohibitive な.
 */
export const FAKE_ALERT_ADJECTIVE_FOLLOWERS = [
	"です", "だけ", "ように", "ようです", "ようだ",
	"か？", "か、", "か。", "かも", "かどうか", "から",
	"と、", "という", "なら、", "ならば",
	"、", "。", "？", "！",
] as const;

/**
 * What may follow a ナ-adjective slot (FAKE-ALERT-ADJ1). The slot holds a stem
 * (静か, 無慈悲), completed by fixed text as a sahen noun is: the stem ends the
 * line, or the fixed text starts with one of these. に makes it an adverb, で
 * and だ are written with what follows them so that neither can begin another
 * word (never でき, never だけ), なら is written as なら、 and ならば (never
 * ならない), and すぎ is the verb すぎる, which a stem takes directly.
 *
 * Two more shapes are checked by the compiler rather than listed here.
 * な makes the stem modify a noun, so after な comes a noun slot, fixed text
 * that begins with a Han or Katakana character, or one of
 * `FAKE_ALERT_VERB_NOUNS` under its tail rule (なので, なこと): never ない or
 * なる. さ makes the stem a noun, so after さ comes one of
 * `FAKE_ALERT_VERB_NOUN_TAILS` or the end of the line: never させ or され.
 */
export const FAKE_ALERT_NA_FOLLOWERS = [
	"に", "です", "でした", "でしょう", "では", "でも", "である", "でない", "で、",
	"だ。", "だ！", "だった", "だと", "だから", "だ、",
	"なら、", "ならば", "すぎ",
	"、", "。", "？", "！",
] as const;

/** Entry IDs share one id space across families, prompts, terminals and outcomes. */
export const FAKE_ALERT_ID_MAX_LENGTH = 48;

/** Upper bounds the compiler enforces. Exceeding one is a compile error, never a truncation. */
export const FAKE_ALERT_LIMITS = {
	families: 48,
	prompts: 160,
	terminals: 120,
	outcomes: 400,
	/** Lines in one recipe. */
	lines: 4,
	/** Fixed-text code points in one line; a slot is not counted. */
	lineLiteralCodePoints: 40,
	/** Slot occurrences in one line. */
	lineSlots: 4,
} as const;

/** A family as raw document data. `on` is present only for an `outcome` family. */
export type RawFakeAlertFamily = {
	readonly id: string;
	readonly stage: string;
	readonly weight: number;
	readonly drift: number;
	readonly on?: string;
};

/**
 * A prompt, terminal or outcome as raw document data: deliberately untrusted
 * strings, narrowed only by the compiler. `buttons` is present only for a
 * prompt. Each line is the authored template text.
 */
export type RawFakeAlertRecipe = {
	readonly id: string;
	readonly family: string;
	readonly enabled: boolean;
	readonly kind: string;
	readonly weight: number;
	readonly buttons?: string;
	readonly lines: readonly string[];
};
