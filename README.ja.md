# Semantropy

[English](README.md) | [日本語](README.ja.md)

Semantropyは、日本語の創作に使うデスクトップ専用のObsidianプラグインです。Markdownノートの意味を崩した思いがけない文章を別のViewに表示し、原文ノートは変更しません。名前は *semantic* と *entropy* を組み合わせたものです。

## できること

- **日本語の文章を変換する。** 現在のノートを開き、**Reshuffle text** で別の結果を生成します。最初は本文の最初のsectionを表示し、**Load next section** で次のsectionを1つずつ追加します。原文の変更は古い状態として示し、**Refresh target** を選ぶまで表示を更新しません。
- **語彙を選ぶ。** 現在のノートまたは明示的に選択したノートを使います。抽選方式はUniform／Frequencyから選べます。名詞・自立動詞・イ形容詞・通常の副詞は個別に有効化でき、既定では名詞だけが有効です。picker内の変更は **Apply Vocabulary** の成功後に反映されます。
- **本文のSemantropy値を決める。** Off（0）は原文のまま、Low（25）・Medium（50）・High（75）・MAX（100）は変更量や候補範囲を段階的に変えます。中間の整数値も使えます。対応していない活用形は原文を維持します。
- **1語だけ手動で変える。** 対応する表示語では **Shuffle this word**・**Restore original**・**Use automatic result** を選べます。手動候補には、使用中の語彙で実際に観測した形だけを使います。正確に1語を選択すると、代替候補数または使用できない理由を表示します。
- **ほかの文章を作る。** でたらめ辞書は選択語の架空の定義を作り、本文とは独立したSemantropy値を持ちます。Collisionはランダムまたは指定したpatternから10／20／50件、架空ことわざはことわざと解説の組を10件生成します。結果ごとに明示的なCopy／Collect操作があります。
- **表示を調整する。** 本文をスクロールしてもToolbarは画面に残ります。表示設定で本文のfont・size・色・Rubyの読み・操作用markerを変更できますが、生成した文章は変わりません。UIは日本語と英語に対応し、コマンドパレットの名前は両言語で英語のままです。

解析にはcompact IPADIC辞書を内包したLindera WebAssemblyを使います。インストール後はローカルかつオフラインで動き、別の辞書directoryや実行時downloadは必要ありません。

## 使い始める

1. Obsidian Desktop 1.13.7以降で日本語のMarkdownノートを開きます。
2. コマンドパレットから **Semantropy: Open** を実行するか、Semantropyのリボンアイコンを使います。
3. Semantropy Viewで **Load next section** と **Reshuffle text** を使います。
4. **Change vocabulary** でCurrent Note／Selected Notesと抽選方式を選び、**Apply Vocabulary** で確定します。**Automatic parts of speech** にも別の **Apply** があります。
5. View内の文章を選択し、**Copy selection** または **Collect selection** を使います。1語の辞書を開くには **Semantropy: Define selected word** を使うか、WindowsではAlt、macOSではOption（⌥）を押しながら対応語にhoverします。View内で修飾キーをShiftに変更できます。

Collectする前に **設定 → Semantropy → Collection file** で保存先を指定し、**Save** を選びます。既定は `Semantropy Fragments.md` です。新しいentryはmetadata commentのない可読なMarkdownです。任意の5つの切替で、生成の種類、Targetノート、語彙ノート、本文Semantropy値、収集した日付を追記できます。既定ではすべてOFFです。既存entryは書き換えません。Collection fileを、その結果に使ったTargetやVocabulary Sourceと同じファイルにはできません。

## プライバシーとファイル操作

- 解析・生成・辞書の利用はローカルで完結します。プラグインは実行時のnetwork requestやtelemetryを行いません。
- Semantropyは現在のTargetと、語彙として明示的にApplyしたノートを読みます。変換Viewは無害な固定要素から組み立て、ノート内の画像やembedは外部resourceを読み込まずplaceholderで示します。
- 原文ノートは上書きしません。**Collect** の明示実行時だけ、設定したCollection Markdownへ書き込みます。**Copy** の明示実行時だけClipboardへ書き込み、選択が空または無効な場合に別の断片をコピーしません。
- Obsidianのプラグイン用 `data.json` には、本文と辞書のSemantropy値、Collection path、抽選方式、表示設定、hover修飾キー、自動品詞、表示言語、リボン表示、由来の切替を保存します。ノートのsnapshot、token、生成結果、手動変更、生成中の状態は保存しません。

## 対応範囲と制約

- デスクトップ専用で、Mobileには対応していません。変換対象は日本語です。語彙には現在のノートか選択したノートを使い、フォルダ全体やVault全体は対象外です。
- 段落、単純な見出し、強調、改行、対応Rubyを表示します。リンク・コード・数式・タグ・対応外Markdownは変換から保護します。リンクはclickできず、画像とembedはplaceholderになります。ObsidianのReading viewとは異なる表示です。
- 動詞とイ形容詞の手動変更は、語彙で観測した対応形に限ります。対応外の形は維持します。非常に大きなノート、特にMAXでは準備に数秒かかる場合があります。分割できないparser／tokenizer処理中はCancelが遅れる場合があります。
- 狭いpaneと高倍率zoomでは、固定Toolbarの下の本文領域が小さくなる場合があります。縦書き、Collection専用View、フォルダ全体の語彙、ユーザー編集templateはありません。

配布用 `main.js` はWebAssemblyと辞書を内包するため5 MBを超えます（最近のbuildでは約14〜16 MB）。正確なサイズは公開されたGitHub Releaseのassetで確認してください。[Obsidian Sync Standardの1ファイル5 MB上限](https://obsidian.md/help/sync/plans)を超えるので、Standardを使う場合はplugin fileの同期に頼らず、端末ごとにインストール／更新してください。Sync Plusの1ファイル上限は200 MBです。

## インストール

ObsidianのCommunity Pluginsに掲載された後は、そこからインストールできます。GitHub Releaseから手動でインストールする場合は、同じReleaseの `main.js`、`manifest.json`、`styles.css` を次の場所へ置きます。

```text
<vault>/.obsidian/plugins/semantropy/
```

Obsidianをreloadし、**設定 → Community plugins** でSemantropyを有効にします。3ファイルは必ず同じversionを使ってください。

## ソースからのビルド

```bash
npm ci
npm run build
```

クリーンなcheckoutでは、最初の `npm run build` がcompact辞書を検証または準備します。検証済みcacheがなければ、固定URL1つからLindera IPADIC 6.0.0のarchiveを取得し、サイズとSHA-256を照合し、compact辞書を作ってそのhashも確認してから配置します。`npm run build:distribution` も同じ準備を行い、`dist/semantropy/` に配布3ファイルだけを作ります。後続のbuildは検証済みcacheを再利用します。準備の失敗や検証不一致ではbuildを止め、既存の成果物を置き換えません。`npm ci`、test、`npm run dev`、プラグイン実行時は辞書をdownloadしません。

build後には `npm run typecheck`、`npm run lint`、`npm test`、`npm run verify:distribution`、`npm run verify:reproducible` を実行できます。配布検証は展開済みarchiveも使うため、先にbuildまたは `npm run prepare:dictionary` を実行してください。

`npm run verify:reproducible` は、同じbuild環境内で3ファイルがbyte単位で一致することを確認します。macOSとWindowsのbuildでは、圧縮されたpayloadのbyte列やminify後の短い識別子が異なる場合があります。配布testではpayloadを除外し、識別子を正規化したproduction codeのdigestを固定しています。

## ライセンスとnotice

Semantropy独自のソースは[MIT License](LICENSE)です。同梱するlindera-wasmと辞書データにはそれぞれの条件が適用されます。[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) と [NOTICE](NOTICE) を参照してください。生成した `main.js` の先頭にも該当するlicenseとnoticeの本文を含め、3ファイルでのインストール時に読めるようにしています。

作者: Cat Left Paw / 猫乃 左手。
