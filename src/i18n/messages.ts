import * as fakeDictionary from "../application/fakeDictionaryMessages";
import * as reshuffle from "../application/reshuffleNote";
import * as refresh from "../application/refreshSource";
import * as vocabulary from "../application/prepareVocabulary";
import * as collectionPath from "../application/collectionPathMessages";
import * as bodyLevel from "../application/changeBodySemantropy";
import { OPEN_SNAPSHOT_ERROR_MESSAGE } from "../application/SemantropySession";
import { STALE_SOURCE_MESSAGE } from "../application/sourceFreshness";
import { ANALYZE_ERROR_MESSAGE } from "../application/analyzeNoteTexts";
import { SOURCE_ANALYSIS_ERROR_MESSAGE } from "../application/analyzeSelectedSource";
import * as collect from "../collect/collectMessages";
import * as copy from "../copy/copyMessages";
import { SELECTION_INVALIDATED_MESSAGE } from "../view/logicalSelection";
import { BODY_CONTRAST_WARNING } from "../settings/displaySettings";
import { TARGET_RENDER_ERROR_MESSAGE } from "../render/targetBodyController";
import { UI_CATALOGS } from "./catalog";
import { currentUiLanguage } from "./language";

/**
 * PRE-RELEASE-EXPERIENCE-LOCALE1: Japanese for the messages application
 * modules export as English constants.
 *
 * Those modules keep their English constants — they are the message identity
 * that flows through sessions, results and tests — and are not changed here.
 * Each pair below names the constant itself, so a renamed or removed constant
 * is a compile error, and `localize()` turns the English a component is about to
 * show into the current language at the point of display.
 */
const OPEN_VIEW_FIRST = "Semantropyのビューを先に開いてください。";
const MESSAGE_PAIRS: readonly (readonly [string, string])[] = [
	[fakeDictionary.DEFINE_MISSING_VIEW_MESSAGE, OPEN_VIEW_FIRST],
	[fakeDictionary.DEFINE_EMPTY_SELECTION_MESSAGE, "定義する語が選択されていません。"],
	[fakeDictionary.DEFINE_MULTIPLE_TOKENS_MESSAGE, "語を一つだけ選択してください。"],
	[fakeDictionary.DEFINE_SURFACE_MISMATCH_MESSAGE, "選択範囲が一つの語と一致しません。"],
	[fakeDictionary.DEFINE_UNKNOWN_WORD_MESSAGE, "その語は辞書にありません。"],
	[fakeDictionary.DEFINE_NOT_NOUN_MESSAGE, "名詞を選択してください。"],
	[fakeDictionary.DEFINE_UNSUPPORTED_NOUN_MESSAGE, "その名詞の種類には対応していません。"],
	[fakeDictionary.DEFINE_SYMBOL_MESSAGE, "記号は定義できません。"],
	[fakeDictionary.DEFINE_OFF_MESSAGE, "でたらめ辞書はオフです。"],
	[fakeDictionary.DEFINE_INSUFFICIENT_VOCABULARY_MESSAGE, "このノートには、定義を生成するのに十分な語彙がありません。"],
	[fakeDictionary.DEFINE_ANALYZE_ERROR_MESSAGE, "選択した語を解析できませんでした。"],
	[fakeDictionary.DEFINE_GENERATION_ERROR_MESSAGE, "定義を生成できませんでした。"],
	[fakeDictionary.DEFINE_LOADING_MESSAGE, "定義を生成しています。"],
	[fakeDictionary.DEFINE_MISSING_MODAL_MESSAGE, "先に定義を開いてください。"],
	[fakeDictionary.RESHUFFLE_DEFINITION_UNAVAILABLE_MESSAGE, "シャッフルするものがありません。"],
	[fakeDictionary.COPY_DEFINITION_EMPTY_MESSAGE, "コピーできる生成結果がありません。"],
	[fakeDictionary.COPY_DEFINITION_FAILED_MESSAGE, "定義をコピーできませんでした。"],
	[fakeDictionary.COLLECT_DEFINITION_EMPTY_MESSAGE, "収集できる生成結果がありません。"],
	[fakeDictionary.DICTIONARY_LEVEL_ERROR_MESSAGE, "辞書のレベルを保存できませんでした。もう一度お試しください。"],
	[reshuffle.RESHUFFLE_ERROR_MESSAGE, "シャッフルできませんでした。もう一度お試しください。"],
	[reshuffle.RESHUFFLING_MESSAGE, "シャッフルしています…"],
	[reshuffle.RESHUFFLE_MISSING_VIEW_MESSAGE, OPEN_VIEW_FIRST],
	[reshuffle.RESHUFFLE_UNAVAILABLE_MESSAGE, "まだシャッフルするものがありません。"],
	[reshuffle.INSUFFICIENT_POOL_MESSAGE, "このノートには置き換えられる名詞が足りません。"],
	[reshuffle.NO_SUPPORTED_TEXT_MESSAGE, "このノートには変換に対応した文章がありません。書かれたとおりに表示しています。"],
	[reshuffle.TEXT_TRANSFORMATION_OFF_MESSAGE, "本文の変換はオフです。"],
	[refresh.REFRESH_ERROR_MESSAGE, "元のノートを再読込できませんでした。Semantropy: Openをもう一度実行してください。"],
	[refresh.REFRESH_UNAVAILABLE_MESSAGE, "まだ再読込するものがありません。"],
	[refresh.REFRESH_MISSING_VIEW_MESSAGE, OPEN_VIEW_FIRST],
	[vocabulary.VOCABULARY_PREPARATION_ERROR, "語彙を準備できませんでした。選択したノートを確認して、もう一度お試しください。"],
	[vocabulary.VOCABULARY_REFRESH_REQUIRED, "このノートを語彙に使う前に、対象ノートを再読込してください。"],
	[vocabulary.VOCABULARY_DRAW_MODE_SAVE_ERROR, "新しい語彙はこのセッションで使えますが、抽選方式を次回のために保存できませんでした。"],
	[collectionPath.COLLECTION_PATH_INVALID_MESSAGE, "Vault内のMarkdownファイルのパスを入力してください。"],
	[collectionPath.COLLECTION_PATH_SAVED_MESSAGE, "収集ファイルのパスを保存しました。"],
	[collectionPath.COLLECTION_PATH_SAVE_FAILED_MESSAGE, "収集ファイルのパスを保存できませんでした。もう一度お試しください。"],
	[bodyLevel.BODY_LEVEL_ERROR_MESSAGE, "本文のレベルを変更できませんでした。もう一度お試しください。"],
	[bodyLevel.BODY_LEVEL_UPDATING_MESSAGE, "本文を更新しています…"],
	[OPEN_SNAPSHOT_ERROR_MESSAGE, "ノートを開けませんでした。Semantropy: Openをもう一度実行してください。"],
	[STALE_SOURCE_MESSAGE, "元のノートが変更されました。このビューは古い状態に基づいています。「対象ノートを再読込」を使ってください。"],
	[ANALYZE_ERROR_MESSAGE, "ノートを解析できませんでした。Semantropy: Openをもう一度実行してください。"],
	[SOURCE_ANALYSIS_ERROR_MESSAGE, "選択した語彙ソースを解析できませんでした。"],
	[collect.COLLECT_EMPTY_SELECTION_MESSAGE, "収集する範囲が選択されていません。"],
	[collect.COLLECT_FAILED_MESSAGE, "断片を保存できませんでした。"],
	[collect.COLLECT_PATH_NOT_MARKDOWN_MESSAGE, "収集ファイルのパスがMarkdownファイルではありません。"],
	[collect.COLLECT_PATH_IS_FOLDER_MESSAGE, "収集ファイルのパスがフォルダです。"],
	[collect.COLLECT_PATH_PARENT_MISSING_MESSAGE, "収集ファイルのフォルダがありません。"],
	[collect.COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE, "対象ノートや語彙ソースのノートは収集ファイルに使えません。"],
	[collect.COLLECT_PATH_INVALID_MESSAGE, "収集ファイルのパスがVault内の正しいパスではありません。"],
	[collect.COLLECT_SAVED_MESSAGE, "収集しました。"],
	[collect.COLLECT_MISSING_VIEW_MESSAGE, OPEN_VIEW_FIRST],
	[copy.COPY_COPIED_MESSAGE, "コピーしました。"],
	[copy.COPY_EMPTY_SELECTION_MESSAGE, "コピーする範囲が選択されていません。"],
	[copy.COPY_FAILED_MESSAGE, "断片をコピーできませんでした。"],
	[copy.COPY_MISSING_VIEW_MESSAGE, OPEN_VIEW_FIRST],
	[SELECTION_INVALIDATED_MESSAGE, "以前の選択は無効になりました。もう一度選択してください。"],
	[BODY_CONTRAST_WARNING, "選んだ本文の色はコントラストが低く、文字やマーカーが読みにくい場合があります。"],
	[TARGET_RENDER_ERROR_MESSAGE, "ノートを表示できませんでした。Semantropy: Openをもう一度実行してください。"],
];

/** Every English interface string this build knows, paired with its Japanese. */
export function japaneseMessagePairs(): readonly (readonly [string, string])[] {
	const pairs: (readonly [string, string])[] = [...MESSAGE_PAIRS];
	const walk = (en: unknown, ja: unknown) => {
		if (typeof en === "string" && typeof ja === "string") pairs.push([en, ja]);
		else if (en && ja && typeof en === "object" && typeof ja === "object") {
			for (const key of Object.keys(en)) walk((en as Record<string, unknown>)[key], (ja as Record<string, unknown>)[key]);
		}
	};
	walk(UI_CATALOGS.en, UI_CATALOGS.ja);
	// Fake proverb appends "The previous results are retained." to a failure while a batch is kept.
	const { en, ja } = UI_CATALOGS;
	for (const key of ["insufficientCandidates", "noCompatibleGloss", "cancelled", "released", "failed"] as const) {
		pairs.push([en.fakeProverb.retained(en.fakeProverb[key]), ja.fakeProverb.retained(ja.fakeProverb[key])]);
	}
	pairs.push([en.fakeProverb.retained(en.common.notEnoughDistinct), ja.fakeProverb.retained(ja.common.notEnoughDistinct)]);
	return pairs;
}

let japanese: ReadonlyMap<string, string> | null = null;

/**
 * The given English interface message in the current language. A string this
 * build does not know — generated text, a path, a count already formatted by
 * `ui()` — is returned unchanged, so nothing that is not interface text can be
 * translated by accident.
 */
export function localize(message: string): string {
	if (currentUiLanguage() !== "ja") return message;
	if (japanese === null) {
		// The first pair wins. The Collection feature name reuses the toolbar's
		// English "Reshuffle text" with a shorter Japanese label, and that later
		// pair must not replace the toolbar message.
		const map = new Map<string, string>();
		for (const [en, ja] of japaneseMessagePairs()) if (!map.has(en)) map.set(en, ja);
		japanese = map;
	}
	return japanese.get(message) ?? message;
}
