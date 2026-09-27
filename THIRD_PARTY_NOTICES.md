# Semantropy Third-Party Notices

- 作成日: 2026-09-04
- 最終更新: 2026-09-27（Semantropy独自codeのMIT移行）
- 対象: 現在のproduction配布物に**実際に含まれるもの**の棚卸し
- 状態: 公開配布向けの第三者license・notice方針を含む事実記録

このファイルは人間が確認するための棚卸しである。Community Pluginの
インストールでは `main.js` / `manifest.json` / `styles.css` しか取得されない
ため、**このMarkdownはユーザーへ届かない**。実際に配布物へnoticeを残す手段は
`main.js` 先頭のbannerであり、bannerはbuild時に本文書が挙げる原文fileから
機械的に生成する（`scripts/lindera/linderaNotice.mjs`）。

`npm run build` と `npm run build:distribution` は同一のbundleを生成する。
以下はその1つの成果物に含まれるものの一覧である。

## 1. Semantropy 自身

| 項目 | 値 | 出所 |
|---|---|---|
| license | `MIT` | `LICENSE` / `package.json` |
| copyright holder | `Cat Left Paw / 猫乃 左手` | オーナー決定 / `LICENSE` |
| copyright year | `2026` | `LICENSE` |
| public repository | `https://github.com/cat-left-paw/semantropy` | 公開配布先として決定 |

Semantropy独自のsource codeにはrootの `LICENSE` を適用し、その全文を配布
`main.js` のbannerにも含める。bundleに含まれる
第三者softwareと辞書データには本licenseを上書きせず、それぞれのlicenseと
noticeを維持する。作者表記は `Cat Left Paw / 猫乃 左手`、Obsidian manifestの
`authorUrl` は `https://github.com/cat-left-paw` とする。

## 2. `lindera-wasm` 6.0.0

| 項目 | 値 |
|---|---|
| license | MIT |
| 原文 | `node_modules/lindera-wasm/LICENSE` |
| copyright | `Copyright (c) 2024 by the project authors.` |
| npm integrity | `sha512-Ia8w6V+nUbu3q8bhPuF/2OIPvoOSlObDVJIOKiG2088nmPyKLp1gRSeV8iTb8P6PlGt1mA6ON6512UI6E9kIiQ==` |
| 内包物 | wasm-bindgen JavaScript glue と `lindera_wasm_bg.wasm` (1,736,542 bytes / SHA-256 `4ee783f6025e66e0217febd2c78f9ef87b405ec8df884902239e7ee8a9df4ee4`) |
| version 固定 | `package.json` の `devDependencies` に `6.0.0`（`--save-exact`）、`package-lock.json` に記録 |
| bytes 固定 | build入力3 file（`lindera_wasm_bg.wasm` / `lindera_wasm.js` / `LICENSE`）のSHA-256を `scripts/lindera/packageHashes.mjs` に固定。build・dev・prepareのいずれもversion照合の後にbytesを照合し、不一致ならartifactを1 byteも書かずに停止する |
| 依存区分 | build時依存。glueとWASMはbuild時に読み出して `main.js` へ内包するため、runtimeにpackageを解決する経路はない |

`lindera_wasm_bg.wasm` はLindera本体（MIT）をWebAssemblyへcompileした成果物で
ある。buildはこれをgzip + base64で**byte単位のまま**内包し、内容を改変して
いない。

MITが要求するcopyright noticeとpermission noticeは、`main.js` のbannerへ
`LICENSE` の全文として逐語で含める。この `LICENSE` もpinned hashの対象であり、
bannerへ入る前に検証される。

versionだけの照合では不十分である。`package.json` はdirectoryの内容についての
主張であって、bytesについての言明ではない。`package-lock.json` のnpm integrityは
install時にしか検証されないため、通常の `npm run build` は再検証しない。
したがって「6.0.0を名乗る改変WASM」を止められるのはpinned hashだけである。
期待hashを呼び出し側が差し替える経路は用意していない。

## 3. mecab-ipadic 由来の辞書データ（Lindera 版）

| 項目 | 値 |
|---|---|
| 取得元 | `https://github.com/lindera/lindera/releases/download/v6.0.0/lindera-ipadic-6.0.0.zip` |
| archive bytes | 10,519,550 |
| archive SHA-256 | `8433dbbb80d7588a565fb9247c1ac7aed3ca50c7463329e495f8bd905aece356` |
| NOTICE | archive内 `NOTICE.txt`（4,092 bytes / SHA-256 `2cf235bf0842d6d61eb0244fb22e645a321b12408a3cf75feb3a53577d885bde`） |
| 由来 | `mecab-ipadic-2.7.0-20070801` |
| copyright | `Copyright 2000, 2001, 2002, 2003 Nara Institute of Science and Technology.` |

archiveの `NOTICE.txt` は、辞書項目の大部分がICOT Free Software由来であり、
その条件（特に "NO WARRANTY" 条項を常に添付すること）が現辞書にも適用されると
記載している。配布物はこの辞書データを内包するため、NOTICEの同梱は必須である。

archive自体はGit管理対象外（`.cache/`）で、取得は `npm run prepare:dictionary`、
および検証済みのcompact辞書が `.cache/` にないときの `npm run build` /
`npm run build:distribution`（PRE-RELEASE-BUILD-BOOTSTRAP1）からのみ行う。
取得先は上表の固定URL1つで、byte数・SHA-256、展開後とcompact辞書の固定hashを
検証してから公開する。`npm ci`、dev、test、plugin runtimeはarchiveを取得せず、
dev・testは不足時にこのcommand名を示して停止する。

## 4. 依存関係の現状

| 区分 | 内容 |
|---|---|
| `dependencies` | なし。`package.json` に `dependencies` の項目自体が存在しない |
| `devDependencies` | `lindera-wasm` 6.0.0 を含むbuild / test / lint用のみ |
| 配布物が要求するruntime module | `obsidian` のみ（artifact testで確認） |

`@faanau/kuromoji` と `doublearray` は、`SEMANTROPY-MVP-LINDERA-PRODUCTION1`
で依存関係・source・配布物のすべてから撤去した。`package.json`、
`package-lock.json`、`node_modules` のいずれにも存在せず、Apache-2.0全文および
`doublearray` のMIT全文をbannerへ含める必要もなくなった。この事実は
`tests/dependencyTree.test.ts` と、成果物へKuromoji markerが残っていないことを
検査する `tests/distribution/artifact.test.ts` で固定している。

## 5. buildが行った変換（事実の記録）

Apache-2.0 §4(b) やMITの「改変」にbundle / minifyが該当するかという法的評価に
依存せず、該当する場合にも表示が不足しないよう、**変更があるものとして保守的に
noticeを残す**。buildが実際に行うことは次のとおりである。

- `lindera-wasm` のJavaScript glueを単一fileへbundleしminifyしている。
  さらにbuild時に1ブロックだけ置換している: wasm-packのloaderはWebAssembly
  moduleをURLから解決してnetwork取得できるが、これを「内包されたmodule bytesしか
  受け取らない」初期化関数へ差し替えた。それ以外のexportは無変更である。
- `lindera_wasm_bg.wasm` はpublishされたままgzip + base64で内包し、内容を
  改変していない。
- 辞書は上記archiveの派生物である。9 fileのうち7 file
  (`metadata.json` / `dict.trie` / `dict.valsidx` / `dict.vals` /
  `matrix.mtx` / `char_def.bin` / `unk.bin`) はbyte単位でそのまま内包する。
  2 file (`dict.words` / `dict.wordsidx`) は再構築した: 392,126件の
  system dictionary entryをすべて、同じ順序で、それぞれ9個のIPADIC
  detail slotを保ったまま維持しつつ、Semantropyが使わないslotをIPADIC自身の
  未設定marker `"*"` へ置き換えた。品詞と細分類1・2は全entryで保持し、
  細分類3・基本形・読みは 一般 / 固有名詞 / サ変接続 / 形容動詞語幹 に分類される
  名詞で保持する。活用型・活用形・発音は全entryで削除する。surface・
  context ID・word cost・未知語辞書は無変更である。
- `node_modules/lindera-wasm` のsource file自体は書き換えていない。

同じ事実を配布 `main.js` のbannerへ明記し、`lindera-wasm` のMIT全文とarchiveの
`NOTICE.txt` 全文を逐語で同梱する。bannerの内容は
`tests/distribution/artifact.test.ts` で検査しており、bannerがスパイク時代の
「実験用build」「標準tokenizerではない」といった記述を含まないことも同じtestで
固定している。

これはCommunity Plugin公開に向けたengineering上のlicense運用方針の記録であり、
個別の法的助言または法的適合性の保証ではない。
