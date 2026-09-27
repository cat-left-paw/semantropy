/**
 * The Japanese corpus every SPIKE1 coverage and performance number is measured
 * on. Test support only.
 *
 * It is authored rather than sampled because the measurement has to be
 * reproducible from the repository alone — no vault, no private notes, no
 * network — and because it has to *reach* the thing being measured: every
 * adopted Target form key needs slots, and the strict column needs Sources
 * that observed some of those exact forms and not others, or strict and High
 * would be indistinguishable for an uninteresting reason.
 *
 * These sentences are ordinary prose, not a grammar table. They are not a
 * claim about how any particular writer writes, and the slot counts they
 * produce are a property of this corpus, not of Japanese.
 */

/** Target paragraphs. Between them they reach all thirteen adopted keys. */
export const TARGET_PARAGRAPHS: readonly string[] = Object.freeze([
	"朝の駅で彼は新しい手帳を開く。改札を抜けると風が冷たく、遠くの山が白い。",
	"少年は走った。荷物を抱えて階段を上り、誰かの名前を呼んだが、声は届かなかった。",
	"雨が降れば予定は変わる。傘を持たない日ほど空は暗く、電車は遅れがちだ。",
	"彼女は本を読みながら珈琲を飲む。窓の外では子どもが遊んでいて、犬が鳴いた。",
	"約束の時間になっても友人は来ない。連絡もせず、理由も告げず、ただ黙っている。",
	"古い写真を選んで並べよう。埃を払い、順番を決めて、台紙に貼れば一冊になる。",
	"川の水は澄んでいた。魚が泳いだあとに波紋が広がり、光が揺れて美しかった。",
	"彼は荷物を運ばせた。部屋を片付けさせ、机を動かさせ、それから窓を開けさせる。",
	"手紙は読まれることなく箱に眠る。誰も触らず、誰も気づかず、年月だけが過ぎた。",
	"昼食は軽くて温かい。汁物を作って、野菜を刻んで、皿に盛れば十分だろう。",
	"雪が積もると道は狭くなる。足跡が重なって消え、街灯の下だけが明るかった。",
	"祖母は静かに笑った。昔話を語り、茶を注ぎ、それから庭の花を指さして黙った。",
	"朝が早ければ列車は空いている。日差しが強ければ帽子をかぶり、風が冷たければ襟を立てる。",
	"駅員は案内を続けます。切符を確かめながら列を整え、放送を繰り返しました。",
]);

/** Vocabulary Sources. Different lexemes, deliberately different forms. */
export const SOURCE_PARAGRAPHS: readonly string[] = Object.freeze([
	"港町の朝は騒がしい。漁師が網を引き、荷を積み、船を出す。海鳥が騒いで空が白む。",
	"職人は木を削った。鉋をかけ、寸法を測り、接ぎ目を合わせてから仕上げに磨いた。",
	"旅人は地図を畳んで歩きだす。坂を下り、橋を渡り、宿の灯を探して村へ入った。",
	"子どもたちは砂を掘って遊ぶ。貝を拾い、石を投げ、波が来れば逃げて笑った。",
	"料理人は鍋を火にかけた。出汁をとり、塩を振り、味を確かめてから器によそう。",
	"学者は資料を並べて調べる。年表を書き、註を付け、矛盾を見つければ印をつけた。",
	"庭師は枝を切り落とす。土を掘り、根を包み、苗木を植えて水をたっぷり注いだ。",
	"彼は毎日日記を書いた。天気を記し、出来事を並べ、読み返しては線を引いて消す。",
	"仕立屋は布を裁った。型紙を置き、印をつけ、縫い代を残してから鋏を入れる。",
	"山道は険しくて長い。岩は硬く、谷は深く、風は強かったが景色は素晴らしかった。",
	"старик писал письма каждый вечер.",
	"The archivist filed the letters and closed the cabinet.",
]);

export function targetText(): string {
	return TARGET_PARAGRAPHS.join("\n\n");
}

export function sourceTexts(): readonly { readonly path: string; readonly text: string }[] {
	return SOURCE_PARAGRAPHS.map((text, index) => ({
		path: `sources/max-${String(index).padStart(2, "0")}.md`,
		text,
	}));
}

/**
 * A deterministic text of at least `characters` code units, built by rotating
 * the paragraphs so repeated material does not collapse into one candidate.
 * The index is written into each paragraph as a noun-safe suffix.
 */
export function scaledText(characters: number): string {
	const parts: string[] = [];
	let length = 0;
	let index = 0;
	while (length < characters) {
		const paragraph = TARGET_PARAGRAPHS[index % TARGET_PARAGRAPHS.length]!;
		const line = `第${index + 1}節。${paragraph}`;
		parts.push(line);
		length += line.length + 2;
		index += 1;
	}
	return parts.join("\n\n");
}
