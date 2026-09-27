/**
 * The comparison corpus for the Lindera spike.
 *
 * Every fixture is a named case so a difference between two tokenizers can be
 * reported as "which input, which token", not as a bare index into one long
 * string. The list covers the cases the slice calls for: the three reference
 * sentences, conjugation, function words, digits, ASCII, half-width kana,
 * emoji and surrogate pairs, symbols, newlines and whitespace, unknown words,
 * person / place / organization proper nouns, サ変接続 and 形容動詞語幹, and
 * the two long inputs.
 */
export type TokenizerFixture = {
	name: string;
	text: string;
};

const SENTENCE_FIXTURES: TokenizerFixture[] = [
	{ name: "reference-taro", text: "太郎は駅で花子を待っていた。" },
	{ name: "reference-hospital", text: "私は病院で静かな猫を見た。" },
	{
		name: "reference-university",
		text: "東京大学で自然言語処理を研究しています。",
	},
	{
		name: "verb-conjugation",
		text: "書く、書かない、書きます、書いた、書けば、書こう、走らせられた。",
	},
	{
		name: "adjective-conjugation",
		text: "美しい、美しくない、美しかった、美しければ、高くなかろう。",
	},
	{
		name: "particles-and-auxiliaries",
		text: "彼はそこへも行かなかったらしいですね、だから私だけが残るのだ。",
	},
	{
		name: "numbers",
		text: "2026年9月6日に1,234個を3.14倍して０１２３にした。",
	},
	{ name: "ascii", text: "Semantropy uses Lindera 6.0.0 and IPADIC; see v6." },
	{ name: "halfwidth-kana", text: "ﾊﾝｶｸ ｶﾀｶﾅ ﾃﾞｽ ｶﾞｯ ﾎﾟ ｱｲｳｴｵ" },
	{ name: "emoji", text: "猫は🐈で犬は🐕、そして😀と❤️と🇯🇵。" },
	{
		name: "surrogate-pairs",
		text: "𠮷野家と𩸽と𣗄と鷗外、それに𝔘𝔫𝔦𝔠𝔬𝔡𝔢。",
	},
	{
		name: "symbols",
		text: "【重要】「引用」〈記号〉…※＃＆＊＠／＼｜～＝＋－＜＞",
	},
	{ name: "newlines", text: "一行目\n二行目\r\n三行目\n\n五行目" },
	{
		name: "whitespace",
		text: "  前後に空白  \t タブ 　全角空白　 ",
	},
	{
		name: "unknown-words",
		text: "セマントロピーはヴォエゴルヅィと共にキュルルンした。",
	},
	{
		name: "proper-nouns",
		text: "山田太郎は北海道の札幌市で株式会社ソニーと国際連合に勤めた。",
	},
	{
		name: "sahen-nouns",
		text: "研究と処理と実装と分析と検証と翻訳を確認する。",
	},
	{
		name: "keiyoudoushi-nouns",
		text: "静かで綺麗で正直で自然で豊かな場所が好きだ。",
	},
	{ name: "empty", text: "" },
	{ name: "single-symbol", text: "。" },
	{
		name: "mixed-scripts",
		text: "AIとＡＩとえーあいとエーアイをαβγと比べる。",
	},
];

/**
 * Repeats varied sentences until the target length is reached, so the long
 * fixtures exercise many dictionary entries rather than one sentence's worth.
 *
 * Truncation stops one unit short rather than splitting a surrogate pair: a
 * lone surrogate is a separate case, covered deliberately by
 * `LONE_SURROGATE_FIXTURE`, and must not leak into the length fixtures.
 */
function makeLongText(targetChars: number): string {
	const seeds = SENTENCE_FIXTURES.slice(0, 12).map((fixture) => fixture.text);
	let text = "";
	let index = 0;
	while (text.length < targetChars) {
		text += seeds[index % seeds.length] ?? "";
		index += 1;
	}
	const lastCode = text.charCodeAt(targetChars - 1);
	const end =
		lastCode >= 0xd800 && lastCode <= 0xdbff ? targetChars - 1 : targetChars;
	return text.slice(0, end);
}

/**
 * A lone high surrogate, which is well-formed UTF-16 in JavaScript but not a
 * complete code point. Kept out of the shared fixture list because the two
 * engines disagree about it: `doublearray`, which Kuromoji searches through,
 * returns null for a malformed pair and Kuromoji then throws a TypeError,
 * while Lindera tokenizes it. The Lindera comparison covers it; the Kuromoji
 * comparison records the difference instead of asserting equality.
 */
export const LONE_SURROGATE_FIXTURE: TokenizerFixture = {
	name: "lone-surrogate",
	text: `\u{5B57}\u{D842}\u{5B57}`,
};

export const LONG_2K = makeLongText(2_000);
export const LONG_20K = makeLongText(20_000);

export const TOKENIZER_FIXTURES: readonly TokenizerFixture[] = [
	...SENTENCE_FIXTURES,
	LONE_SURROGATE_FIXTURE,
	{ name: "long-2000-chars", text: LONG_2K },
	{ name: "long-20000-chars", text: LONG_20K },
];

/**
 * A note split across several text nodes, which is the shape the renderer
 * actually hands the analyzer.
 */
export const TEXT_NODE_SEQUENCE: readonly string[] = [
	"太郎は駅で花子を待っていた。",
	"私は病院で静かな猫を見た。",
	"東京大学で自然言語処理を研究しています。",
	"山田太郎は北海道の札幌市で株式会社ソニーと国際連合に勤めた。",
	"研究と処理と実装と分析と検証と翻訳を確認する。",
	"",
	"静かで綺麗で正直で自然で豊かな場所が好きだ。",
	"猫は🐈で犬は🐕、そして😀と❤️と🇯🇵。",
];
