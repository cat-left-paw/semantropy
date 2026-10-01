import { ANALYZE_ERROR_MESSAGE } from "../../../src/application/analyzeNoteTexts";
import { DEFINE_INSUFFICIENT_VOCABULARY_MESSAGE } from "../../../src/application/fakeDictionaryMessages";
import { VOCABULARY_PREPARATION_ERROR, VOCABULARY_REFRESH_REQUIRED } from "../../../src/application/prepareVocabulary";
import { REFRESH_ERROR_MESSAGE } from "../../../src/application/refreshSource";
import { INSUFFICIENT_POOL_MESSAGE, NO_SUPPORTED_TEXT_MESSAGE } from "../../../src/application/reshuffleNote";
import { OPEN_SNAPSHOT_ERROR_MESSAGE } from "../../../src/application/SemantropySession";
import { STALE_SOURCE_MESSAGE } from "../../../src/application/sourceFreshness";
import { COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE } from "../../../src/collect/collectMessages";
import { setUiOverrides } from "../../../src/i18n/catalog";
import { setMessageOverrides } from "../../../src/i18n/messages";
import { TARGET_RENDER_ERROR_MESSAGE } from "../../../src/render/targetBodyController";

/**
 * 0.1.0 S1 (terminology): the web page has texts, not Vault notes, and no
 * command palette. The shared View keeps its Obsidian wording; the page
 * replaces only the Japanese entries that name notes, the Vault or
 * "Semantropy: Open". Terms follow Docs/release_0_1_0_policy.md §1-6:
 * 対象の文章 (Target), 文章 (a text on the page), 語彙ソース (Vocabulary Source).
 */
export function installWebWording(): void {
	setUiOverrides({
		ja: {
			toolbar: {
				controls: {
					reshuffle: { name: "本文をシャッフル", description: "読み込んだ対象の文章の別の変化を引きます。" },
					refresh: { name: "対象の文章を再読込", description: "元の文章を読み直して、本文を作り直します。" },
					level: { name: "本文のSemantropyレベル", description: "読み込んだ対象の文章をどれだけ置き換えるか。" },
					vocabulary: { name: "語彙を変更", description: "語彙ソースに使う文章と抽選方式を選びます。" },
				},
			},
			status: {
				onboarding: "「文章」で対象の文章を開く → 語彙ソースを選ぶ → 語を試す → 収集。",
				vocabularyMissing: "語彙ソースが見つかりません。「語彙を変更」で別の文章を選んでください。",
				openNote: "「文章」で文章を選び、「Semantropyで開く」を押してください。",
				source: (name: string) => `対象の文章: ${name}`,
			},
			view: {
				refreshingTarget: "対象の文章を再読込しています…",
				openingTarget: "対象の文章を開いています…",
			},
			vocabulary: {
				currentNote: "対象の文章",
				selectedNotesCount: (count: number) => `選んだ文章（${count}）`,
				selectedNotesMode: "選んだ文章",
				selectedNotes: "選んだ文章",
				vaultNotes: "文章",
				filterName: "文章を名前で絞り込み",
				tree: "フォルダと文章",
				currentOnly: "対象の文章だけを使います。",
				notes: (count: number) => `${count}件の文章`,
				noNotes: "文章がありません。",
				noMatch: "絞り込みに一致する文章はありません。",
				selectedCount: (count: number) => `${count}件の文章を選択`,
				noneSelected: "文章は選ばれていません。",
				notFound: "見つかりません",
			},
			display: {
				themeDefaultOption: "既定（端末の設定に合わせる）",
			},
			manual: {
				reopenTarget: "手動シャッフルの診断を表示できません。対象の文章を開き直してもう一度お試しください。",
			},
		},
	});
	setMessageOverrides({
		[DEFINE_INSUFFICIENT_VOCABULARY_MESSAGE]: "この文章には、定義を生成するのに十分な語彙がありません。",
		[INSUFFICIENT_POOL_MESSAGE]: "この文章には置き換えられる名詞が足りません。",
		[NO_SUPPORTED_TEXT_MESSAGE]: "この文章には変換に対応した部分がありません。書かれたとおりに表示しています。",
		[REFRESH_ERROR_MESSAGE]: "元の文章を再読込できませんでした。もう一度開いてください。",
		[VOCABULARY_PREPARATION_ERROR]: "語彙を準備できませんでした。選んだ文章を確認して、もう一度お試しください。",
		[VOCABULARY_REFRESH_REQUIRED]: "この文章を語彙ソースに使う前に、対象の文章を再読込してください。",
		[OPEN_SNAPSHOT_ERROR_MESSAGE]: "文章を開けませんでした。もう一度開いてください。",
		[STALE_SOURCE_MESSAGE]: "元の文章が変更されました。表示は古い状態に基づいています。「対象の文章を再読込」を使ってください。",
		[ANALYZE_ERROR_MESSAGE]: "文章を解析できませんでした。もう一度開いてください。",
		[COLLECT_PATH_IS_SOURCE_NOTE_MESSAGE]: "対象の文章や語彙ソースの文章は収集先に使えません。",
		[TARGET_RENDER_ERROR_MESSAGE]: "文章を表示できませんでした。もう一度開いてください。",
	});
}
