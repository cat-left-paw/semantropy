/** Fixed input corpus from the line-boundary baseline test; no Git access. */
export function targetChunkLineCases(): string[] {
	const parts = ["本文。", "漢字《かんじ》", "｜親《よみ》", "《未閉鎖", "》", "", "# 見出し", "---", "---\u00a0", "---\u3000", "\ufeff---", "--- text", "\tindent", "    indent", "末尾空白 ",
		"```ts", "```", "~~~", "`code`", "`open", "[link](url)", "![[image]]", "$math$", "$$", "%%", "<!--", "-->", "<div>", "</div>", "<script>", "</script>", "<span title=\"%%\">x</span>",
		"<ruby>漢<rt>かん</rt></ruby>", "※［＃注記］《よみ》", "\\《escape", "\\｜親《よみ》", "😀か\u3099", "**強調**", "- list", "|table|", "[unclosed"];
	let seed = 93;
	const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
	const cases: string[] = [];
	for (let i = 0; i < 4000; i++) cases.push(Array.from({ length: 1 + random() % 15 }, () => parts[random() % parts.length]!).join(["\n", "\r\n", "\r"][i % 3]) + (i % 2 ? "\n" : ""));
	for (const separator of ["\n", "\r\n", "\r", "\f", "\t", "\u00a0"])
		for (const tag of [`<img src=x${separator}alt=y>`, `<IMG src=x${separator}alt=y />`, `<div src=x${separator}alt=y>`]) cases.push(`前。\n\n${tag}\n\n後続。\nさらに後続。\n`);
	return cases;
}
