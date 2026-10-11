import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { projectMarkdownSource } from "../../src/analysis/projectMarkdownSource";
import { safeTargetFixtures } from "../fixtures/targetSafeFixtures";

/*
 * TRAILING-SPACE1. Notes that have no half-width space or tab at the end of a line, and so must be read exactly as they were
 * read before this slice. Their digests were taken from the code before the change (`9a2f498`), with the policy's name left
 * out: the name is the one thing that has to differ.
 */

/** One note of every notation the Target projection knows, with no blank at the end of any line. A full-width space is not one. */
export const MIXED_NOTE = [
	"---", "title: 題名", "tags: [a, b]", "---", "",
	"# 見出し", "",
	"普通の段落。漢字《かんじ》と｜親文字《おやもじ》、<ruby>漢<rt>かん</rt></ruby>字。",
	"次の行は※［＃「口＋禺」、第3水準1-15-9］《ぐう》を含む。", "",
	"全角の空白で終わる行　", "全角の空白で終わる行。　　", "", "{{語のまとまり}}と`code`と[[wikilink]]と![[embed.png]]と[語](note.md)と$x^2$と#tag。", "",
	"強調は**太字**と*斜体*と~~取り消し~~、__別の太字__。", "エスケープ\\《かんじ》と\\｜親《よみ》。", "",
	"- 項目 1", "- 項目 2", "  - 入れ子", "1. 番号", "", "> 引用", "> 続き", "",
	"    字下げのコード", "", "```ts", "const x = 1;", "```", "", "~~~", "$ [ <!-- 《", "~~~", "",
	"<div>", "html のかたまり", "</div>", "", "<!-- 注 --> の後。", "", "%% obsidian の注 %% の後。", "", "$$", "x = 1", "$$", "",
	"| 表 | 列 |", "|---|---|", "| 猫 | 犬 |", "", "---", "", "[閉じない", "リンク", "", "本文《閉じない", "読み》の続き。", "",
	"行頭の文。", "二行目の文。", "三行目の文。", "", "最後の文。",
].join("\n");

function fixtureText(path: string): string { return readFileSync(path, "utf8"); }

/** [label, text], in a fixed order. */
export function unchangedNotes(): readonly (readonly [string, string])[] {
	const presets = ["kumono-ito", "yume-juya", "chumonno-oi-ryoriten"].map((name) => [`preset ${name}`, fixtureText(`web/presets/${name}.txt`)] as const);
	return [
		...presets,
		["fixture markdown-protection.md", fixtureText("tests/fixtures/markdown-protection.md")],
		["fixture ruby-analysis.md", fixtureText("tests/fixtures/ruby-analysis.md")],
		...safeTargetFixtures.map((fixture) => [`safe fixture ${fixture.name}`, fixture.md] as const),
		["mixed note, LF", MIXED_NOTE],
		["mixed note, CRLF", MIXED_NOTE.replaceAll("\n", "\r\n")],
		["mixed note, CR", MIXED_NOTE.replaceAll("\n", "\r")],
		["mixed note, LF and a final newline", `${MIXED_NOTE}\n`],
		["mixed note, no frontmatter, starting with a heading", MIXED_NOTE.slice(MIXED_NOTE.indexOf("# 見出し"))],
	];
}

/**
 * A digest of everything the projection decides about a note, as the JSON a result serializes to, with its policy's name
 * left out. Source mode is included: it is not touched, and has no policy name to leave out.
 */
export function projectionDigest(text: string, mode: "source" | "target-prototype"): string {
	const result = projectMarkdownSource(text, mode);
	return createHash("sha256").update(JSON.stringify({ ...result, policyVersion: null })).digest("hex");
}
