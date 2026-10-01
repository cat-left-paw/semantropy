# WEB版の公開手順（GitHub Pages）

方針: `Docs/web_playground_policy1.md` の決定#3・#4。正式な公開repository
`cat-left-paw/semantropy` から、GitHub Actionsでbuild成果物だけをPagesへdeployする。
公開はRCがPC＋スマホのsmoke testとライセンス・出典確認を通過してから行う。

## 1. 公開前の確認（RC）

```bash
npm run typecheck:web
npm run lint:web
npm run test:web
npm run build:web
```

スマホ実機では、PCで次を実行し、表示された `https://<PCのLAN IP>:5175/` を同じWi-Fiのスマホで開く。
自己署名証明書の警告が出るので、確認のうえ続行する（公開サイトには関係しない）。

```bash
npm run serve:web:lan
```

Windowsのファイアウォールが確認を求めたら、プライベートネットワークだけ許可する。

### smoke test（PCとスマホの両方）

- [ ] 初回に辞書の読み込み状況が表示され、「準備完了」になる
- [ ] プリセット3作品それぞれを開ける。ルビが表示される
- [ ] 自分の文章を貼り付けて開ける。編集すると古い（stale）表示になり、再読込で更新される
- [ ] 本文のシャッフル、テキストレベルの変更、自動置換する品詞の切替
- [ ] 語をタップ／クリックしてManualメニュー（シャッフル、元に戻す、でたらめ辞書で引く）
- [ ] 語彙の変更（選択したノートで複数の文書）
- [ ] 衝突フレーズ、架空ことわざ
- [ ] 範囲選択してコピー、収集。「収集」タブに表示され、.mdで保存できる
- [ ] 表示言語の切替（日本語／English）
- [ ] 「このブラウザにテキストを保存する」をオンにして再読み込み → 戻る。オフで削除される
- [ ] 2回目の読み込みで辞書が再ダウンロードされない（ブラウザのキャッシュ）
- [ ] 機内モードなどで通信を切っても、読み込み済みなら解析と生成が動く

### ライセンス・出典

- [ ] 「情報」→「ライセンス全文を見る」（`licenses.txt`）に、Semantropy（MIT）、NOTICE、
      Lindera／lindera-wasm、IPADIC、lucide（ISC）、THIRD_PARTY_NOTICES が含まれる
- [ ] 「情報」の青空文庫プリセット出典に、各作品の底本・入力・校正の記載がある

## 2. 公開repositoryへの反映（Macで行う）

公開repositoryは、公開用local repositoryへの選択同期で管理している
（`Docs/community_plugin_release_runbook.md` §7）。このprivate repositoryの履歴は公開repositoryへpushしない。
公開側の `.gitignore` は公開してよいpathを1行ずつ並べた許可リストなので、上書きせずに追記する。

`web/deploy/syncPublic.mjs` がこの手順を行う。対象は次の明示リストだけで、private側でcommit済みの
ファイルだけをコピーする。

| private側 | 公開側 |
|---|---|
| `web/` 以下のcommit済みファイル（`dist-web/` などの生成物は含まない） | 同じpath |
| `src/recompose/` 以下（WEB版の再構成が使う） | 同じpath |
| `package.json`、`package-lock.json`、`eslint.config.mts`、`vitest.web.config.ts`、`tests/recompose.test.ts` | 同じpath |
| `web/deploy/github-pages.yml` | `.github/workflows/pages.yml` |
| `web/deploy/github-release.yml` | `.github/workflows/release.yml`（0.1.0から。プラグインのRelease用） |

`Docs/` は同期しない（内部記録を含むため）。

### プラグインのリリース（0.1.0以降）: `--since`

プラグインのソースも変わったリリースでは、`--since <private側の前回同期元commit>` を付ける。
0.0.1 の同期元は private `7253c57`（公開側 `5bab2cd`）。`--since` を付けると、上の表に加えて次も対象になる。

- 公開側にすでにあるファイルのうち、private側で変わったもの（`src/`、`tests/`、`styles.css`、`manifest.json`、
  `versions.json`、README など）
- `--since` 以降に private側で追加されたファイルのうち、`src/`、`tests/`、`web/`、`scripts/`、`resources/` の下にあるもの

`Docs/`、`AGENTS.md`、private側の `.gitignore`、公開側に一度もなかったファイルは対象にしない。
同期対象の木の中で private側から消えたファイルは「stale」に出る（`--prune` を付けたときだけ削除）。

```bash
node web/deploy/syncPublic.mjs --to ../semantropy-public --since 7253c57
```

次回のリリースでは、今回の同期元（このときに表示される private側のcommit）を `--since` に渡す。

### 手順

1. private repositoryを最新にする。

   ```bash
   git pull
   ```

2. 変更を確認する（何も書き込まない）。`--to` には公開用local repositoryの場所を指定する。

   ```bash
   node web/deploy/syncPublic.mjs --to ../semantropy-public
   ```

   add / update の一覧と、公開側 `.gitignore` に追記する許可リストの行が表示される。

3. 問題なければ反映する。

   ```bash
   node web/deploy/syncPublic.mjs --to ../semantropy-public --apply
   ```

4. 公開用local repositoryで差分を確認し、buildとtestを行う。Windowsで行う場合、公開用local repositoryは
   `core.autocrlf=false`（LF）で取り出しておく。CRLFのままだと、mutation scriptのtestが
   「Mutation anchor is not unique」で失敗する（Macでは通常LFなので該当しない）。

   ```bash
   git status
   ```

   ```bash
   npm ci && npm run typecheck:web && npm run lint:web && npm run test:web && npm run build:web
   ```

   ```bash
   npm run typecheck && npm run lint && npm test
   ```

   macOSでは `npm test` を `TMPDIR=/private/tmp npm test` として実行する（`/var/folders/...` と
   `/private/var/folders/...` の別名で、watch／path比較のtestが失敗するため。
   `Docs/pre_release_public_source_sync1_record.md`）。公開用local repositoryのpathに `private` という語を
   含めない（distribution testの誤検出を避けるため。`Docs/pre_release_candidate_0_0_1_audit.md`）。

5. 公開用local repositoryでcommitし、pushする。commit messageに、表示されたprivate側のcommit IDを書く。

スクリプトは次の場合に何もせず止まる: 同期先が `cat-left-paw/semantropy` のcheckoutでない、同期先に
未commitの変更がある、同期対象がprivate側で未commitである、反映後も公開側 `.gitignore` に無視されるファイルがある。
以前同期したファイルがprivate側から消えた場合は一覧に出るだけで、`--prune` を付けたときだけ削除する。

## 3. Pagesの設定（初回だけ）

**push（手順5）の前に**、公開repositoryの Settings → Pages → Build and deployment → Source を
**GitHub Actions** にする。そのあとpushすると `Deploy web Playground` workflowが動き、成功すると
`https://cat-left-paw.github.io/semantropy/` で公開される。先にpushしてしまった場合は、設定後に
Actions タブから workflow を手動実行（Run workflow）する。

### オリジンについて

`https://cat-left-paw.github.io/` 配下のPagesは、同じアカウントの他のプロジェクトページと同じオリジンになる。
localStorageとIndexedDB（設定、収集した断片、保存を選んだテキスト）はそのオリジンの中で共有されるので、
キーには `semantropy.web.` 接頭辞と `semantropy-web` データベース名を使っている。同じアカウントで
信頼できないページを公開しないこと。

## 4. プラグインのRelease（0.1.0から）

`.github/workflows/release.yml`（private側は `web/deploy/github-release.yml`）は、公開repositoryに
tagをpushすると動く。tag名が `manifest.json` の version と一致すること（`v` を付けない）と `versions.json` に
その version があることを確かめ、`npm ci`、`npm run build:distribution`、typecheck、lint、`npm test`、
`npm run verify:distribution` を通してから、`dist/semantropy/` の3ファイルに build provenance attestation を付け、
**下書き**のReleaseに3ファイルを添付する。公開は自動では行わない。

1. 下書きのReleaseから3ファイルをdownloadし、Obsidianで動作確認する（Linuxでbuildしたファイルなので、手元のbuildとは
   bytesが違う。配布testは識別子を正規化したcodeを固定しているので、中身はreview済みのcodeと同じ）
2. Release本文を書き、`main.js` の実測サイズとSync Standardの制約を入れる
3. 下書きを公開する。公開後に3ファイルをdownloadし、下書きで確認したファイルとSHA-256が一致することを確かめる

attestationは `gh attestation verify main.js --repo cat-left-paw/semantropy` で確認できる。

## 5. 公開後

- README（英日）にPlaygroundのURLを加えるかは、オーナーが別途決める
- 辞書やプリセットを変えると `assets/engine-<hash>.bin` と `presets/<id>-<hash>.txt` の名前が変わるので、
  古いキャッシュは使われない
