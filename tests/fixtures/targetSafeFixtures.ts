export const safeTargetFixtures = [
	{ name: "blocks / heading", md: "# 題名\n\n本文😀\n\n次", html: "<h1>題名</h1><p>本文😀</p><p>次</p>", logical: "題名\n\n本文😀\n\n次" },
	{ name: "inline decorations", md: "漢**字**と*言葉*、__文字__。と~~猫~~", html: "<p>漢<strong>字</strong>と<em>言葉</em>、<strong>文字</strong>。と<del>猫</del></p>", logical: "漢字と言葉、文字。と猫" },
	{ name: "short and explicit ruby", md: "漢字《かんじ》と｜言葉《ことば》", html: "<p>漢字《かんじ》と｜言葉《ことば》</p>", logical: "漢字と言葉" },
	{ name: "HTML / okurigana", md: "前<ruby>歩<rp>（</rp><rt>ある</rt><rp>）</rp></ruby>く後", html: "<p>前<ruby>歩<rp>（</rp><rt>ある</rt><rp>）</rp></ruby>く後</p>", logical: "前歩く後" },
	{ name: "code / link / math / tag", md: "前`漢字《よみ》`後[語](note.md)末$式$外 #tag 終", html: '<p>前<code>漢字《よみ》</code>後<a>語</a>末<span class="math">式</span>外 <a class="tag">#tag</a> 終</p>', logical: "前漢字《よみ》後語末式外 #tag 終" },
	{ name: "visible escape", md: "漢字\\《かんじ》と歩《ある》く", html: "<p>漢字\\《かんじ》と歩《ある》く</p>", logical: "漢字\\《かんじ》と歩く" },
	{ name: "soft lines", md: "日本語の本文。\n次の行は漢字《かんじ》。", html: "<p>日本語の本文。<br>\n次の行は漢字《かんじ》。</p>", logical: "日本語の本文。\n次の行は漢字。" },
] as const;

const url = "https://semantropy-target-safe.invalid/resource";
export const unsafeTargetFixtures = [
	`![remote](${url})`, "![[referenced-note]]", `<img src="${url}" srcset="${url} 2x">`,
	`<iframe src="${url}"></iframe>`, `<video src="${url}" poster="${url}"></video>`,
	`<audio src="${url}"></audio>`, `<source srcset="${url}">`, `<object data="${url}"></object>`,
	`<embed src="${url}">`, `<style>p{background:url(${url})}</style>`, `<div style="background:url(${url})">text</div>`,
	`<svg onload="globalThis.__semantropySafeProbeActive();fetch('${url}')"><image href="${url}"></image></svg>`, `<script>globalThis.__semantropySafeProbeActive();fetch('${url}')</script>`,
	`<ruby>![remote](${url})<rt>よみ</rt></ruby>`, `<ruby>漢字<rt>[reading](${url})</rt></ruby>`,
	"<x-target-probe>custom</x-target-probe>", "```dataview\nTABLE FROM \"\"\n```", "> [!callout]\n![[referenced-note]]",
	"%% extension %%", "<input autofocus onfocus='alert(1)'>",
] as const;

export const NOVEL_NOUNS = [
	["漢字", "かんじ"], ["言葉", "ことば"], ["東京", "とうきょう"], ["駅", "えき"], ["猫", "ねこ"], ["犬", "いぬ"],
	["月", "つき"], ["雨", "あめ"], ["空", "そら"], ["海", "うみ"], ["森", "もり"], ["川", "かわ"], ["山", "やま"],
	["花", "はな"], ["鳥", "とり"], ["窓", "まど"], ["机", "つくえ"], ["手紙", "てがみ"], ["時計", "とけい"],
	["部屋", "へや"], ["季節", "きせつ"], ["記憶", "きおく"], ["物語", "ものがたり"], ["旅人", "たびびと"],
	["少女", "しょうじょ"], ["老人", "ろうじん"], ["港", "みなと"], ["町", "まち"], ["灯台", "とうだい"],
	["図書館", "としょかん"], ["硝子", "がらす"], ["夕暮", "ゆうぐれ"], ["行灯", "あんどん"], ["提灯", "ちょうちん"],
	["鏡", "かがみ"], ["影", "かげ"], ["夢", "ゆめ"], ["石", "いし"], ["橋", "はし"], ["坂", "さか"], ["庭", "にわ"],
	["屋根", "やね"], ["障子", "しょうじ"], ["畳", "たたみ"], ["簪", "かんざし"], ["帯", "おび"], ["扇", "おうぎ"],
	["傘", "かさ"], ["風鈴", "ふうりん"], ["蝋燭", "ろうそく"], ["鞄", "かばん"], ["汽車", "きしゃ"], ["線路", "せんろ"],
	["郵便", "ゆうびん"], ["新聞", "しんぶん"], ["砂浜", "すなはま"], ["波", "なみ"], ["岬", "みさき"], ["島", "しま"],
	["霧", "きり"], ["雪", "ゆき"], ["炎", "ほのお"], ["灰", "はい"], ["墨", "すみ"], ["筆", "ふで"], ["紙", "かみ"],
	["栞", "しおり"], ["本棚", "ほんだな"], ["階段", "かいだん"], ["廊下", "ろうか"], ["天井", "てんじょう"],
	["柱", "はしら"], ["壁", "かべ"], ["床", "ゆか"], ["硯", "すずり"], ["琥珀", "こはく"], ["瑠璃", "るり"],
	["薔薇", "ばら"], ["檸檬", "れもん"], ["葡萄", "ぶどう"], ["林檎", "りんご"], ["蜜柑", "みかん"], ["菫", "すみれ"],
] as const;

/**
 * A deterministic, synthetic Ruby-dense novel-like note of about `length`
 * UTF-16 units: single-line paragraphs separated by blank lines, short
 * Aozora ruby, explicit fullwidth-bar ruby, simple strong emphasis and
 * fullwidth indentation. Synthetic text only; no user note is reproduced.
 */
export function denseRubyNovel(length = 23_000): string {
	let state = 0x2545f491;
	const next = (n: number): number => {
		state = (Math.imul(state, 1103515245) + 12345) >>> 0;
		return (state >>> 8) % n;
	};
	const noun = (ruby: boolean): string => {
		const [base, reading] = NOVEL_NOUNS[next(NOVEL_NOUNS.length)]!;
		if (!ruby) return base;
		return next(5) === 0 ? `｜${base}《${reading}》` : `${base}《${reading}》`;
	};
	const clauses = [
		(a: string, b: string, c: string) => `${a}の${b}は${c}を見ていた。`,
		(a: string, b: string, c: string) => `${a}と${b}が${c}の前で待っていた。`,
		(a: string, b: string, c: string) => `その${a}には、${b}の**${c}**が残っていた。`,
		(a: string, b: string, c: string) => `${a}から${b}へ、${c}は静かに移った。`,
	];
	const paragraphs: string[] = [];
	let total = 0;
	while (total < length) {
		let paragraph = "　";
		const count = 3 + next(4);
		for (let i = 0; i < count; i += 1) {
			paragraph += clauses[next(clauses.length)]!(noun(next(4) !== 0), noun(next(4) !== 0), noun(next(3) !== 0));
		}
		paragraphs.push(paragraph);
		total += paragraph.length + 2;
	}
	return paragraphs.join("\n\n");
}

export const targetPerformanceFixtures = [
	{ name: "2000", md: "猫と犬は日本語の本文を読む。".repeat(150).slice(0, 2000) },
	{ name: "20000", md: "猫と犬は日本語の本文を読む。".repeat(1500).slice(0, 20000) },
	{ name: "dense-ruby", md: "漢字《かんじ》と言葉《ことば》。".repeat(300) },
	{ name: "dense-resource", md: `本文![image](${url})続き![[note]]。`.repeat(300) },
] as const;
