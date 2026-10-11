# Semantropy standard Fake Alert recipes

> ■ 1. このファイルについて
>
> 不条理警告の文（レシピ）と、その出やすさを決めるファイルです。
> 人が書き換えるのは、このファイルだけです。
>
> 不条理警告には、2 つの形があります。
>   ・対話      … 最初の画面 → ボタンを押す → 結果の画面 → OK
>   ・1 回で終わるもの … 1 枚だけ出て、OK で閉じる
>
> 項目は、4 種類です。
>   family    … 系統。レシピのまとまりと、その出やすさ（data-version 5 では 26 個）
>   prompt    … 最初の画面（同じく 53 個）
>   terminal  … 1 回で終わるもの（同じく 46 個）
>   outcome   … 結果の画面（同じく 103 個）
>
> どの結果（outcome）も、どの最初の画面（prompt）にも続くことが
> できます。「この prompt にはこの outcome」という組み合わせは、
> 書きません。
>
> plugin は、動いているあいだ、このファイルを読みません。build のときに
> だけ読み、plugin に入れるデータ
> （src/fakeAlert/generated/standardFakeAlertRecipes.ts）を作ります。
> 作られたデータと、版の記録（standard-recipes.lock.json）は、手で
> 書き換えません。
>
> 「> 」で始まる行は、この説明のような注記です。plugin には入りません。
> 自由に書き足せます（「>」の次に、半角の空白を 1 つ置きます）。
>
> ■ 2. 編集の手順
>
> 1) このファイルを書き換える。
> 2) 下の data-version の数を、ちょうど 1 つ上げる（5 なら 6）。
>    上げるのは、項目を足した、消した、順番を入れ替えた、文、kind、
>    buttons、true と false、weight、drift、on、family、id のどれかを
>    変えたときです。注記だけを変えたときは、上げません。
>    上げ忘れると、3) が止まります。2 つ以上飛ばしても止まります。
> 3) npm run generate:fake-alert-recipes を実行する。
>    成功すると、項目の数が表示され、作られるデータと版の記録が
>    書き換わります。
>    書き方に誤りがあると、何も書き換えずに止まり、誤りの種類と、
>    行の番号（line 123）と id が表示されます。
> 4) npm run build を実行する。main.js が作り直されます。
>    3) を忘れていると、build は止まります。
> 5) Obsidian で Semantropy を無効にしてから有効にし、不条理警告を
>    何回か出して確かめる。出るレシピは、本文の Semantropy 値で
>    変わります（値が 0 のときは、ずれ 0 の系統しか出ません）。
>
> 3) が成功したあとで、さらに書き直すとき:
>    版の記録に、1 回目の内容が残っているので、同じ data-version の
>    ままでは 3) が止まります。次のコマンドで版の記録を元に戻して
>    から、もう一度 3) を行ってください。
>      git restore resources/fake-alert/standard-recipes.lock.json
>    data-version をさらに上げても通りますが、試した回数だけ数が
>    進みます。
>
> npm test は、いまの項目の数と、決まった条件での出力を覚えています。
> 項目を変えると、いくつかの test が失敗します。書き間違いとは限らず、
> 変えたことの印です。実装担当に伝えて、覚えている値を取り直して
> もらってください。
>
> ■ 3. 書式
>
> 区切りは、どこも半角の空白 1 つです。項目と項目のあいだは、空行で
> 区切ります。項目の途中には、空行を入れません。
>
> ● prompt（最初の画面）
>
>     ## prompt notice-busy-ask
>     family: notice
>     enabled: true
>     kind: warning
>     buttons: yes-no
>     weight: 10
>     line: {n1}が{s1}中です。
>     line: {n2}を{s2}しますか？
>
>   画面の例:  猫が観察中です。
>              封筒を移動しますか？      ［いいえ］［はい］
>
>   ## prompt  の後ろに、id を書く。
>   family   入れる系統の id。stage が prompt の系統を書く。
>   enabled  true … 使う。 false … 使わない（消さずに止める）。
>   kind     画面の印と題。5 つのどれか。
>              warning 警告       error エラー       confirmation 確認
>              information 情報   success 完了
>   buttons  ボタンの組。5 つのどれか。
>              ok            ［OK］
>              ok-cancel     ［キャンセル］［OK］
>              yes-no        ［いいえ］［はい］
>              retry-cancel  ［キャンセル］［再試行］
>              retry-ignore  ［無視］［再試行］
>            OK、はい、再試行は「肯定」、キャンセル、いいえ、無視は
>            「否定」として扱います（下の on を参照）。
>   weight   同じ系統の中での出やすさ。1 以上の整数。
>            系統そのものの出やすさは、family の weight と drift で
>            決まります。レシピの weight は、同じ系統のレシピどうしの
>            比にしか効きません。
>   line     画面の文。1 行から 4 行まで。上から順に表示します。
>            かならず、ほかの field を全部書いたあとに書きます。
>
> ● terminal（1 回で終わるもの）と outcome（結果の画面）
>
>     ## outcome busy-action
>     family: busy
>     enabled: true
>     kind: warning
>     weight: 10
>     line: {n1}は現在、{+n1}によって{+s1}中です。
>
>   prompt と同じですが、buttons は書きません（いつも［OK］です）。
>   family には、terminal なら stage が terminal の系統、outcome なら
>   stage が outcome の系統を書きます。
>
> ● family（系統）
>
>     ## family busy
>     stage: outcome
>     weight: 5
>     drift: 1
>     on: any
>
>   stage   prompt、terminal、outcome のどれか。この系統に入れる項目の
>           種類です。
>   weight  系統の出やすさ。1 以上の整数。
>           最初に出すものは、prompt と terminal の系統を合わせた中から
>           選びます。結果は、ボタンごとに、outcome の系統の中から
>           選びます。どちらも、weight に、下の「ずれ」ごとの倍率を
>           掛けた値の比で決まります。
>   drift   ずれの大きさ。0、1、2、3 のどれか。
>             0 … すなおな警告      1 … 少しずれる
>             2 … かなりずれる      3 … 突拍子もない
>           倍率は、本文の Semantropy 値で変わります。
>             値       0    25    50    75   100
>             ずれ 0  16    12     8     4     2
>             ずれ 1   0     6     8     8     6
>             ずれ 2   0     1     4     8    10
>             ずれ 3   0     0     1     4     8
>           0 のところは、出ません（値が 0 のときは、ずれ 0 の系統
>           だけが出ます）。
>           terminal の系統は、1 から 3 までです（0 は書けない）。
>   on      outcome の系統だけに書く（ほかの系統には書けない）。
>           どのボタンへの答えか。
>             affirm … 肯定（OK、はい、再試行）を押したとき
>             deny   … 否定（キャンセル、いいえ、無視）を押したとき
>             any    … どちらでも
>           本文の Semantropy 値が高いと、押したボタンと合わない結果も
>           出るようになります。
>
>   family には line を書けません。項目が 1 つも無い系統は、誤りに
>   なります。
>
> ● 穴（line の中の { }）
>
>   {n1} {n2} {n3}     名詞（猫、封筒）
>   {s1} {s2} {s3}     「する」が付く名詞（観察、移動）。
>                      「する」「中」「を」などは、文の側に書く
>   {v1} {v2} {v3}     動詞の基本の形（歩く）
>   {i1} {i2} {i3}     イ形容詞の基本の形（白い）
>   {na1} {na2} {na3}  形容動詞の語幹（静か）。
>                      「な」「に」「です」は、文の側に書く
>
>   ・同じ名前の穴は、1 つの警告の中で、同じ語になります。
>     「{n1}を{s1}しますか？」→「{n1}を{s1}しました。」は、同じ語で
>     つながります。
>   ・結果（outcome）の {n1} は、最初の画面に {n1} があれば、それを
>     引き継ぎます。無ければ、新しく引きます。本文の Semantropy 値が
>     高いと、あっても引き継がずに、新しい語になることがあります。
>   ・名前の前に + を付けた穴（{+n1} {+s1} {+v1} {+i1} {+na1} など）は、
>     結果だけで使えます。いつも新しい語になります。結果の中で同じ
>     名前を 2 回書くと、同じ新しい語になります。
>   ・番号は 1 から 3 までです。
>
> ■ 4. 決まり（守らないと build が止まるもの）
>
> ● 行の書き方
>   ・知らない行、知らない field は、読み飛ばされずに、誤りになります。
>   ・同じ field を 2 回は書けません（line を除く）。
>   ・line のあとに、ほかの field は書けません。
>
> ● 文に使える字
>   ひらがな、カタカナ、漢字、「ー」「…」「、」「。」「？」「！」だけです。
>   1 行につき、穴を除いた文字が 40 字まで、穴は 4 個までです。
>   ○ {n1}の{s1}を開始します。
>   ○ ……ごめん。
>   × {n1} を{s1}しますか？     （空白は使えない）
>   × {n1}をOKしますか？        （英字と数字は使えない）
>   × 「{n1}」を確認してください。（かぎ括弧は使えない）
>   × {n1}を{s1}しますか?        （半角の ? は使えない。全角の ？ を使う）
>   × {n4}  × {x1}  × {n}        （穴の名前は、上の表のものだけ）
>   × terminal や prompt の中の {+n1}（+ の穴は outcome だけ）
>
> ● {s1} などの直後（「する」が付く名詞）
>   行の終わりか、次のどれかで始まる文字が続きます。
>     し する でき され させ 中 済み
>     を に が は の も で と へ や か 、 。 ？ ！
>   ○ {s1}しますか？  ○ {s1}中です。  ○ {s1}に必要な  ○ {s1}できません。
>   × {s1}ます。  × {s1}だ。  × {s1}{n1}
>
> ● {v1} などの直後（動詞の基本の形）
>   動詞は形を変えられません。行の終わりか、次のどれかが続きます。
>     ア) 名詞の穴          {v1}{n1}
>     イ) 次のどれかで始まる文字
>           まで だけ べき ように ようです ようだ
>           か？ か、 か。 かも かどうか から
>           と、 という なら、 ならば な。 な！ 、 。 ？ ！
>     ウ) 次の名詞
>           こと の もの ところ わけ はず つもり ため 予定 必要 場合
>           前 時 間 おそれ 権限 準備 方法 理由 代わり
>         その名詞の次は、行の終わりか、次のどれか
>           が を に は も で の と か だ 、 。 ？ ！
>   ○ {v1}ことはできません。  ○ {v1}前に{n1}を  ○ これ以上{v1}な。
>   ○ {n1}が{v1}おそれがあります。
>   × {v1}ます。 {v1}た。 {v1}て {v1}ない {v1}ば （別の形が要る）
>   × {v1}ようとしています。  × {v1}と思います。  × {v1}なら
>     （よう、と、なら、な、か は、後ろまで書いた形だけが使える）
>   × {v1}わけます  × {v1}の{n1}  （名詞の次が、決まったもので無い）
>
> ● {i1} などの直後（イ形容詞の基本の形）
>   行の終わりか、次のどれかが続きます。
>     ア) 名詞の穴          {i1}{n1}
>     イ) 次のどれかで始まる文字
>           です だけ ように ようです ようだ
>           か？ か、 か。 かも かどうか から
>           と、 という なら、 ならば 、 。 ？ ！
>     ウ) 動詞と同じ名詞（上のウ。同じ決まり）
>   ○ {n1}は{i1}ですか？  ○ {i1}{n1}を用意してください。
>   × {i1}かった  × {i1}くて  × {i1}ければ  × {i1}さ  × {i1}べき
>
> ● {na1} などの直後（形容動詞の語幹）
>   行の終わりか、次のどれかが続きます。
>     ア) 次のどれかで始まる文字
>           に です でした でしょう では でも である でない で、
>           だ。 だ！ だった だと だから だ、 なら、 ならば すぎ
>           、 。 ？ ！
>     イ) 「な」と、名詞。名詞は、名詞の穴（{na1}な{n1}）、漢字か
>         カタカナで始まる語、動詞と同じ名詞（上のウ。なので、なこと）
>     ウ) 「さ」と、行の終わりか、次のどれか
>           が を に は も で の と か だ 、 。 ？ ！
>   ○ {n1}は{na1}ですか？  ○ {na1}な{n1}が見つかりました。
>   ○ {n1}を{na1}にします。  ○ {n1}は{na1}すぎます。
>   ○ {n1}には{+na1}さが足りません。
>   × {na1}ない  × {na1}なる  × {na1}でき  × {na1}させ  × {na1}だけ
>   × {na1}{n1}（「な」が無い）
>
>   これらの確認は、よくある間違いを止めるためのもので、文法を完全に
>   確かめるものではありません。穴の前の文字（を、に、など）は確かめ
>   ません。足した行には、いくつかの語を入れて読んでみてください。
>
> ● id
>   半角の英小文字で始め、英小文字と数字を、ハイフンでつなぎます。
>   48 字まで。4 つの種類を通して、同じ id を 2 回使えません。
>   ○ notice-busy-ask、done-plain
>   × Notice-Busy（大文字）、notice_busy（下線）、2nd-notice（数字で
>     始まる）、通知（日本語）
>
> ● そのほか
>   ・kind、buttons、line がすっかり同じ項目を、同じ種類の中に 2 つは
>     書けません（出やすさが、気づかないうちに 2 倍になるため）。
>   ・数の上限: family 48、prompt 160、terminal 120、outcome 400。
>   ・weight は、どれも 1 以上の整数です（0、小数、負の数は使えない）。
>
> ● 値が 0 のときと、名詞しか無い語彙のための決まり
>   本文の Semantropy 値が 0 のときは、ずれ 0 の系統（いまは confirm、
>   notice、done、cancelled）しか使えません。また、語彙に名詞しか
>   無いときは、名詞の穴だけのレシピしか使えません。どちらのとき
>   にも警告を作れるように、build は次のことを確かめます。
>     ・ずれ 0 の prompt に、名詞の穴だけ（または穴の無い）ものが、
>       1 つ以上ある。
>     ・ずれ 0 の prompt のボタンごとに、そのボタンに答えるずれ 0 の
>       outcome で、その prompt にある穴だけを使うものがある。
>     ・ずれ 0 の outcome に、名詞の穴だけのものが、肯定の側にも、
>       否定の側にもある。
>   ずれ 0 の項目を消したり、enabled: false にしたり、穴を足したり
>   すると、ここで止まることがあります。止まったら、変えたところを
>   元に戻すか、穴の少ない outcome を足してください。
>
> ■ 5. id を変えてはいけない理由
>
>   不条理警告には、コピーも収集も無いので、id がノートに残ることは
>   ありません。ただし、
>   ・test が覚えている値と、開発の記録が、id で項目を指しています。
>   ・id を変えることも内容の変更なので、data-version を上げることに
>     なります。
>   ・family の id は、prompt、terminal、outcome の family: の行から
>     指されています。変えるときは、指している行も全部変える必要が
>     あります。
>   いまある id は、そのままにしてください。新しい項目には、新しい id を
>   付けます（系統の名前で始めると、探しやすくなります）。
>
> ■ 系統（family）の一覧（data-version 5 のときの値。変えたら、ここも直す）
>
>   最初の画面（prompt）
>     confirm      確認する（〜しますか？ よろしいですか？）  ずれ 0
>     notice       知らせて、たずねる（〜が見つかりません。）  ずれ 0
>     question     突然の質問（{n1}は{n2}ですか？）            ずれ 1
>   1 回で終わるもの（terminal）
>     report       突然の報告（{s1}しました。）                ずれ 3
>     refusal      拒否（できません。）                        ずれ 3
>     prohibition  制止（〜しないでください。）                ずれ 3
>     persona      人格がのぞく一言（わかりません。）          ずれ 3
>   結果（outcome）
>     done         成功した                        肯定  ずれ 0
>     cancelled    取り消した                      否定  ずれ 0
>     failed       失敗した                        肯定  ずれ 1
>     partial      一部だけできた                  肯定  ずれ 1
>     running      すでに処理中                    両方  ずれ 1
>     already      すでに済んでいる                両方  ずれ 1
>     busy         ほかのものが使用中              両方  ずれ 1
>     missing      必要なものが無い                両方  ずれ 1
>     cannot       できない                        肯定  ずれ 1
>     repeat       同じことが繰り返される          肯定  ずれ 1
>     other-target 別のものを処理した              肯定  ずれ 2
>     other-action 別のことをした                  肯定  ずれ 2
>     substituted  代わりのもので済ませた          両方  ずれ 2
>     changed      対象や操作が変わった            両方  ずれ 2
>     failed-but   失敗したが、別のことはできた    肯定  ずれ 2
>     mismatch-ok  エラーの印で、成功の文          両方  ずれ 2
>     mismatch-ng  完了の印で、失敗の文            両方  ずれ 2
>     no-problem   警告の印で、問題は無いという文  両方  ずれ 2
>     overridden   取り消したのに、実行された      否定  ずれ 3

schema-version: 1
data-version: 5

> ━━ 系統（family）━━
>
> 意味は、上の「系統（family）の一覧」にあります。

> ── 最初の画面の系統（stage: prompt） ──

## family confirm
stage: prompt
weight: 600
drift: 0

## family notice
stage: prompt
weight: 480
drift: 0

## family question
stage: prompt
weight: 360
drift: 1

> ── 1 回で終わるものの系統（stage: terminal） ──

## family report
stage: terminal
weight: 30
drift: 3

## family refusal
stage: terminal
weight: 30
drift: 3

## family prohibition
stage: terminal
weight: 30
drift: 3

> ── 結果の系統（stage: outcome） ──

## family done
stage: outcome
weight: 10
drift: 0
on: affirm

## family cancelled
stage: outcome
weight: 10
drift: 0
on: deny

## family failed
stage: outcome
weight: 6
drift: 1
on: affirm

## family partial
stage: outcome
weight: 4
drift: 1
on: affirm

## family running
stage: outcome
weight: 5
drift: 1
on: any

## family already
stage: outcome
weight: 5
drift: 1
on: any

## family busy
stage: outcome
weight: 5
drift: 1
on: any

## family missing
stage: outcome
weight: 4
drift: 1
on: any

## family cannot
stage: outcome
weight: 4
drift: 1
on: affirm

## family other-target
stage: outcome
weight: 5
drift: 2
on: affirm

## family other-action
stage: outcome
weight: 5
drift: 2
on: affirm

## family substituted
stage: outcome
weight: 5
drift: 2
on: any

## family changed
stage: outcome
weight: 4
drift: 2
on: any

## family failed-but
stage: outcome
weight: 4
drift: 2
on: affirm

## family mismatch-ok
stage: outcome
weight: 3
drift: 2
on: any

## family mismatch-ng
stage: outcome
weight: 3
drift: 2
on: any

## family no-problem
stage: outcome
weight: 3
drift: 2
on: any

## family overridden
stage: outcome
weight: 5
drift: 3
on: deny

> ── 結果の系統（stage: outcome）。あとから足したもの ──

## family repeat
stage: outcome
weight: 5
drift: 1
on: affirm

> ── 1 回で終わるものの系統（stage: terminal）。あとから足したもの ──

## family persona
stage: terminal
weight: 5
drift: 3

> ━━ 最初の画面（prompt） ━━

> 【はじめの 14 個。名詞と、「する」が付く名詞の穴だけを使う】

> ── confirm（確認する）──

## prompt confirm-do
family: confirm
enabled: true
kind: confirmation
buttons: yes-no
weight: 10
line: {n1}を{s1}しますか？

## prompt confirm-start
family: confirm
enabled: true
kind: confirmation
buttons: ok-cancel
weight: 8
line: {n1}の{s1}を開始します。
line: よろしいですか？

## prompt confirm-replace
family: confirm
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: {n1}を{n2}に置き換えますか？

## prompt confirm-continue
family: confirm
enabled: true
kind: confirmation
buttons: yes-no
weight: 4
line: 続行しますか？

> ── notice（知らせて、たずねる）──

## prompt notice-busy-ask
family: notice
enabled: true
kind: warning
buttons: yes-no
weight: 10
line: {n1}が{s1}中です。
line: {n2}を{s2}しますか？

## prompt notice-failed-retry
family: notice
enabled: true
kind: error
buttons: retry-cancel
weight: 8
line: {n1}を{s1}できませんでした。
line: 再試行しますか？

## prompt notice-missing
family: notice
enabled: true
kind: warning
buttons: retry-ignore
weight: 8
line: {n1}が見つかりません。
line: {n2}を確認してください。

## prompt notice-ready
family: notice
enabled: true
kind: information
buttons: ok
weight: 6
line: {n1}の準備ができました。

## prompt notice-unsaved
family: notice
enabled: true
kind: warning
buttons: ok-cancel
weight: 6
line: {n1}は{s1}されていません。
line: このまま続けますか？

> ── question（突然の質問）──

## prompt ask-identity
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 10
line: {n1}は{n2}ですか？

## prompt ask-normal
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: {n1}は正常ですか？

## prompt ask-need
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: {n1}を必要としていますか？

## prompt ask-did
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: {n1}は{s1}しましたか？

## prompt ask-trust
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: {n1}を{s1}したことがありますか？

> 【動詞の穴（{v1}）を使うもの】

> ── confirm（確認する）──

## prompt confirm-intend
family: confirm
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: 本当に{v1}つもりですか？

## prompt confirm-wait
family: confirm
enabled: true
kind: confirmation
buttons: yes-no
weight: 6
line: {n1}が{v1}のを待ちますか？

> ── notice（知らせて、たずねる）──

## prompt notice-may
family: notice
enabled: true
kind: warning
buttons: yes-no
weight: 8
line: {n1}が{v1}おそれがあります。
line: 続行しますか？

## prompt notice-before
family: notice
enabled: true
kind: warning
buttons: ok-cancel
weight: 6
line: {v1}前に{n1}を確認してください。

> ── question（突然の質問）──

## prompt ask-ever
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: {n1}は{v1}ことがありますか？

## prompt ask-can
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 6
line: あなたは{v1}ことができますか？

> 【イ形容詞（{i1}）と形容動詞（{na1}）の穴を使うもの】

> ── confirm（確認する）──

## prompt confirm-adjective
family: confirm
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: 本当に{i1}{n1}を削除しますか？

## prompt confirm-na
family: confirm
enabled: true
kind: confirmation
buttons: ok-cancel
weight: 6
line: {n1}を{na1}にします。
line: よろしいですか？

> ── notice（知らせて、たずねる）──

## prompt notice-na
family: notice
enabled: true
kind: warning
buttons: ok-cancel
weight: 8
line: {na1}な{n1}が見つかりました。
line: このまま続けますか？

## prompt notice-adjective
family: notice
enabled: true
kind: warning
buttons: retry-ignore
weight: 6
line: {i1}{n1}が見つかりません。
line: {n2}を確認してください。

> ── question（突然の質問）──

## prompt ask-adjective
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: {n1}は{i1}ですか？

## prompt ask-na
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: {n1}は{na1}ですか？

> ━━ 1 回で終わるもの（terminal） ━━

> 【はじめの 20 個。名詞と、「する」が付く名詞の穴だけを使う】

> ── report（突然の報告）──

## terminal report-did
family: report
enabled: true
kind: information
weight: 10
line: {s1}しました。

## terminal report-did-not
family: report
enabled: true
kind: information
weight: 10
line: {s1}しませんでした。

## terminal report-noun-did
family: report
enabled: true
kind: information
weight: 10
line: {n1}が{s1}しました。

## terminal report-noun-did-not
family: report
enabled: true
kind: warning
weight: 10
line: {n1}が{s1}しませんでした。

## terminal report-doing
family: report
enabled: true
kind: information
weight: 10
line: {s1}中です。

## terminal report-was
family: report
enabled: true
kind: information
weight: 10
line: {n1}でした。

## terminal report-noun-was
family: report
enabled: true
kind: information
weight: 10
line: {n1}が{n2}でした。

## terminal report-is
family: report
enabled: true
kind: information
weight: 10
line: {n1}です。

## terminal report-noun-is
family: report
enabled: true
kind: information
weight: 10
line: {n1}が{n2}です。

## terminal report-noun-is-not
family: report
enabled: true
kind: warning
weight: 10
line: {n1}が{n2}ではありません。

> ── refusal（拒否）──

## terminal refuse-bare
family: refusal
enabled: true
kind: error
weight: 10
line: できません。

## terminal refuse-bare-past
family: refusal
enabled: true
kind: error
weight: 10
line: できませんでした。

## terminal refuse-action
family: refusal
enabled: true
kind: error
weight: 10
line: {n1}を{s1}することはできません。

## terminal refuse-unsupported
family: refusal
enabled: true
kind: error
weight: 10
line: {n1}には対応していません。

## terminal refuse-not-allowed
family: refusal
enabled: true
kind: error
weight: 10
line: {n1}は許可されていません。

> ── prohibition（制止）──

## terminal stop-bare
family: prohibition
enabled: true
kind: warning
weight: 10
line: やめてください。

## terminal stop-action
family: prohibition
enabled: true
kind: warning
weight: 10
line: {s1}しないでください。

## terminal stop-noun-action
family: prohibition
enabled: true
kind: warning
weight: 10
line: {n1}を{s1}しないでください。

## terminal stop-more
family: prohibition
enabled: true
kind: warning
weight: 10
line: これ以上{s1}しないでください。

## terminal stop-use
family: prohibition
enabled: true
kind: warning
weight: 10
line: {n1}を使用しないでください。

> 【動詞の穴（{v1}）を使うもの】

> ── report（突然の報告）──

## terminal report-decided
family: report
enabled: true
kind: information
weight: 10
line: {n1}は{v1}ことにしました。

## terminal report-will
family: report
enabled: true
kind: information
weight: 10
line: {n1}が{v1}予定です。

> ── refusal（拒否）──

## terminal refuse-verb
family: refusal
enabled: true
kind: error
weight: 10
line: {v1}ことはできません。

## terminal refuse-right
family: refusal
enabled: true
kind: error
weight: 10
line: {n1}を{v1}権限がありません。

> ── prohibition（制止）──

## terminal stop-verb
family: prohibition
enabled: true
kind: warning
weight: 10
line: これ以上{v1}な。

## terminal stop-need
family: prohibition
enabled: true
kind: warning
weight: 10
line: {v1}必要はありません。

> 【イ形容詞（{i1}）と形容動詞（{na1}）の穴を使うもの】

> ── report（突然の報告）──

## terminal report-adjective
family: report
enabled: true
kind: information
weight: 10
line: {i1}{n1}が見つかりました。

## terminal report-na-too
family: report
enabled: true
kind: warning
weight: 10
line: {n1}は{na1}すぎます。

## terminal report-na-doing
family: report
enabled: true
kind: information
weight: 10
line: {na1}な{n1}が{na2}に{s1}しています。

> ── refusal（拒否）──

## terminal refuse-na
family: refusal
enabled: true
kind: error
weight: 10
line: {n1}は{na1}な{n2}ではありません。

## terminal refuse-adjective
family: refusal
enabled: true
kind: error
weight: 10
line: {i1}{n1}には対応していません。

> ── prohibition（制止）──

## terminal stop-na
family: prohibition
enabled: true
kind: warning
weight: 10
line: {n1}を{na1}にしないでください。

> ━━ 結果の画面（outcome） ━━

> 【はじめの 39 個。名詞と、「する」が付く名詞の穴だけを使う】

> ── done（成功した）──

## outcome done-plain
family: done
enabled: true
kind: success
weight: 10
line: {n1}を{s1}しました。

## outcome done-noun
family: done
enabled: true
kind: success
weight: 8
line: {n1}の処理が完了しました。

## outcome done-bare
family: done
enabled: true
kind: success
weight: 4
line: 正常に完了しました。

> ── cancelled（取り消した）──

## outcome cancelled-action
family: cancelled
enabled: true
kind: information
weight: 10
line: {n1}の{s1}を取り消しました。

## outcome cancelled-noun
family: cancelled
enabled: true
kind: information
weight: 8
line: {n1}への操作を取り消しました。

## outcome cancelled-bare
family: cancelled
enabled: true
kind: information
weight: 4
line: 操作を取り消しました。

> ── failed（失敗した）──

## outcome failed-action
family: failed
enabled: true
kind: error
weight: 10
line: {n1}を{s1}できませんでした。

## outcome failed-noun
family: failed
enabled: true
kind: error
weight: 8
line: {n1}の処理に失敗しました。

> ── partial（一部だけできた）──

## outcome partial-action
family: partial
enabled: true
kind: warning
weight: 10
line: {n1}の一部を{s1}しました。

## outcome partial-noun
family: partial
enabled: true
kind: warning
weight: 8
line: {n1}の一部だけが完了しました。

> ── running（すでに処理中）──

## outcome running-action
family: running
enabled: true
kind: information
weight: 10
line: {n1}はすでに{s1}中です。

## outcome running-noun
family: running
enabled: true
kind: information
weight: 8
line: {n1}は現在、処理中です。

> ── already（すでに済んでいる）──

## outcome already-action
family: already
enabled: true
kind: information
weight: 10
line: {n1}はすでに{s1}済みです。

## outcome already-noun
family: already
enabled: true
kind: information
weight: 8
line: {n1}はすでに{n2}です。

> ── busy（ほかのものが使用中）──

## outcome busy-action
family: busy
enabled: true
kind: warning
weight: 10
line: {n1}は現在、{+n1}によって{+s1}中です。

## outcome busy-noun
family: busy
enabled: true
kind: warning
weight: 8
line: {n1}は現在、{+n1}が使用中です。

> ── missing（必要なものが無い）──

## outcome missing-action
family: missing
enabled: true
kind: error
weight: 10
line: {s1}に必要な{+n1}がありません。

## outcome missing-noun
family: missing
enabled: true
kind: error
weight: 8
line: {n1}に必要な{+n1}が見つかりません。

> ── cannot（できない）──

## outcome cannot-action
family: cannot
enabled: true
kind: error
weight: 10
line: {n1}は{s1}できません。

## outcome cannot-noun
family: cannot
enabled: true
kind: error
weight: 8
line: {n1}にはその操作ができません。

> ── other-target（別のものを処理した）──

## outcome other-target-action
family: other-target
enabled: true
kind: success
weight: 10
line: {+n1}を{s1}しました。

## outcome other-target-noun
family: other-target
enabled: true
kind: success
weight: 8
line: {+n1}の処理が完了しました。

> ── other-action（別のことをした）──

## outcome other-action-action
family: other-action
enabled: true
kind: success
weight: 10
line: {n1}を{+s1}しました。

## outcome other-action-noun
family: other-action
enabled: true
kind: success
weight: 8
line: {n1}は{+n1}になりました。

> ── substituted（代わりのもので済ませた）──

## outcome substituted-busy
family: substituted
enabled: true
kind: error
weight: 10
line: {n1}を{s1}できませんでした。
line: {n1}は現在、{+n1}によって{+s1}中です。
line: 代わりに{+n2}を{+s2}しました。

## outcome substituted-noun
family: substituted
enabled: true
kind: warning
weight: 8
line: {n1}が見つからなかったため、
line: 代わりに{+n1}を使用しました。

> ── changed（対象や操作が変わった）──

## outcome changed-target
family: changed
enabled: true
kind: information
weight: 10
line: 対象は{n1}から{+n1}に変更されました。

## outcome changed-action
family: changed
enabled: true
kind: information
weight: 8
line: {s1}は{+s1}に変更されました。

> ── failed-but（失敗したが、別のことはできた）──

## outcome failed-but-action
family: failed-but
enabled: true
kind: warning
weight: 10
line: {s1}に失敗しましたが、{+s1}は完了しました。

## outcome failed-but-noun
family: failed-but
enabled: true
kind: warning
weight: 8
line: {n1}には失敗しましたが、{+n1}は完了しました。

> ── mismatch-ok（エラーの印で、成功の文）──

## outcome mismatch-ok-bare
family: mismatch-ok
enabled: true
kind: error
weight: 10
line: 正常に完了しました。

## outcome mismatch-ok-action
family: mismatch-ok
enabled: true
kind: error
weight: 10
line: {n1}を{s1}しました。

> ── mismatch-ng（完了の印で、失敗の文）──

## outcome mismatch-ng-action
family: mismatch-ng
enabled: true
kind: success
weight: 10
line: {n1}の{s1}に失敗しました。

## outcome mismatch-ng-noun
family: mismatch-ng
enabled: true
kind: success
weight: 8
line: {n1}の一部に失敗しました。

> ── no-problem（警告の印で、問題は無いという文）──

## outcome no-problem-noun
family: no-problem
enabled: true
kind: warning
weight: 10
line: {n1}に問題はありません。

## outcome no-problem-action
family: no-problem
enabled: true
kind: warning
weight: 8
line: {s1}に問題は見つかりませんでした。

> ── overridden（取り消したのに、実行された）──

## outcome overridden-refused
family: overridden
enabled: true
kind: information
weight: 10
line: 要求は拒否されましたが、
line: {n1}を{s1}しました。

## outcome overridden-cannot-cancel
family: overridden
enabled: true
kind: warning
weight: 8
line: 取り消すことができませんでした。
line: {n1}を{s1}しました。

## outcome overridden-noun
family: overridden
enabled: true
kind: warning
weight: 8
line: 取り消しは無効です。
line: {n1}の処理を続行しました。

> 【動詞の穴（{v1}、{+v1}）を使うもの】

> ── done（成功した）──

## outcome done-verb
family: done
enabled: true
kind: success
weight: 8
line: {v1}ことに成功しました。

> ── cancelled（取り消した）──

## outcome cancelled-verb
family: cancelled
enabled: true
kind: information
weight: 8
line: {v1}のをやめました。

> ── failed（失敗した）──

## outcome failed-verb
family: failed
enabled: true
kind: error
weight: 8
line: {v1}ことに失敗しました。

> ── running（すでに処理中）──

## outcome running-verb
family: running
enabled: true
kind: information
weight: 8
line: {n1}はすでに{v1}ところです。

> ── cannot（できない）──

## outcome cannot-verb
family: cannot
enabled: true
kind: error
weight: 8
line: {n1}は{v1}ことができません。

> ── other-action（別のことをした）──

## outcome other-action-verb
family: other-action
enabled: true
kind: success
weight: 8
line: {n1}は{+v1}ことにしました。

> ── substituted（代わりのもので済ませた）──

## outcome substituted-verb
family: substituted
enabled: true
kind: warning
weight: 8
line: {v1}代わりに{+v1}ことにしました。

> ── changed（対象や操作が変わった）──

## outcome changed-verb
family: changed
enabled: true
kind: information
weight: 6
line: {v1}予定は{+v1}予定に変更されました。

> ── no-problem（警告の印で、問題は無いという文）──

## outcome no-problem-verb
family: no-problem
enabled: true
kind: warning
weight: 6
line: {v1}ことに問題はありません。

> ── overridden（取り消したのに、実行された）──

## outcome overridden-verb
family: overridden
enabled: true
kind: warning
weight: 8
line: 取り消しましたが、
line: {n1}は{v1}つもりです。

> 【イ形容詞と形容動詞の穴を使うもの】

> ── done（成功した）──

## outcome done-adjective
family: done
enabled: true
kind: success
weight: 8
line: {i1}{n1}を削除しました。

> ── cancelled（取り消した）──

## outcome cancelled-na
family: cancelled
enabled: true
kind: information
weight: 8
line: {n1}を{na1}にするのをやめました。

> ── failed（失敗した）──

## outcome failed-na
family: failed
enabled: true
kind: error
weight: 8
line: {n1}が{+na1}すぎたため、失敗しました。

> ── running（すでに処理中）──

## outcome running-adjective
family: running
enabled: true
kind: information
weight: 6
line: {+v1}{n1}は現在、{+na1}です。

> ── already（すでに済んでいる）──

## outcome already-adjective
family: already
enabled: true
kind: information
weight: 8
line: {n1}はすでに{+i1}です。

## outcome already-na
family: already
enabled: true
kind: information
weight: 6
line: {n1}はすでに{+na1}な{+n1}です。

> ── missing（必要なものが無い）──

## outcome missing-na
family: missing
enabled: true
kind: error
weight: 8
line: {n1}を起動するための{+na1}な{+n1}がありません。

## outcome missing-na-degree
family: missing
enabled: true
kind: error
weight: 6
line: {n1}には{+na1}さが足りません。

> ── other-target（別のものを処理した）──

## outcome other-target-adjective
family: other-target
enabled: true
kind: success
weight: 8
line: 代わりに{+i1}{+n1}を用意しました。

> ── substituted（代わりのもので済ませた）──

## outcome substituted-adjective
family: substituted
enabled: true
kind: warning
weight: 8
line: {i1}{n1}が見つからなかったため、
line: 代わりに{+i1}{+n1}を使用しました。

> ── no-problem（警告の印で、問題は無いという文）──

## outcome no-problem-na
family: no-problem
enabled: true
kind: warning
weight: 6
line: {n1}は{+na1}ですが、問題はありません。

> ━━ 最初の画面（prompt）の続き ━━

> 【あとから足したもの（data-version 4 と 5）】

> ── notice（知らせて、たずねる）──

## prompt notice-ize-urgent
family: notice
enabled: true
kind: warning
buttons: ok-cancel
weight: 6
line: {n1}が{n2}化しています。
line: 至急{n3}を{s1}してください。

## prompt notice-contains
family: notice
enabled: true
kind: warning
buttons: ok-cancel
weight: 8
line: {n1}には、{n2}に使用できない{n3}が含まれています。
line: このまま続けますか？

## prompt notice-problem-action
family: notice
enabled: true
kind: warning
buttons: yes-no
weight: 6
line: {n1}に{s1}できない問題があります。
line: {n1}を{n2}化しますか？

## prompt notice-problem-noun
family: notice
enabled: true
kind: warning
buttons: yes-no
weight: 8
line: {n1}に{n2}の問題があります。
line: {n1}を{n3}化しますか？

## prompt notice-either
family: notice
enabled: true
kind: information
buttons: ok-cancel
weight: 6
line: {s1}する{n1}または{n2}を{s2}してください。

## prompt notice-lack
family: notice
enabled: true
kind: error
buttons: yes-no
weight: 8
line: {n1}に{n2}がありません。
line: {n2}を追加しますか？

## prompt notice-latest
family: notice
enabled: true
kind: information
buttons: yes-no
weight: 6
line: すでに最新の{n1}を{s1}中です。
line: 中止しますか？

## prompt notice-aborted
family: notice
enabled: true
kind: error
buttons: retry-cancel
weight: 6
line: {n1}の問題が発生したため、{n2}は{s1}を中止しました。
line: {s2}しますか？

## prompt notice-first
family: notice
enabled: true
kind: information
buttons: ok-cancel
weight: 6
line: {n1}を{s1}するには、はじめに{n2}を{s2}してください。

> ── confirm（確認する）──

## prompt confirm-two-actions
family: confirm
enabled: true
kind: confirmation
buttons: ok-cancel
weight: 8
line: {n1}の{s1}を{s2}します。
line: よろしいですか？

> ── notice（知らせて、たずねる）──

## prompt notice-not-enough
family: notice
enabled: true
kind: error
buttons: retry-cancel
weight: 6
line: {n1}を{v1}ための十分な{n2}がありません。
line: 再試行しますか？

> ── confirm（確認する）──

## prompt confirm-really
family: confirm
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: 本当に{n1}を{s1}しますか？
line: この操作は二度と{s2}できません。

> ── notice（知らせて、たずねる）──

## prompt notice-typical
family: notice
enabled: true
kind: warning
buttons: ok
weight: 6
line: {n1}的な{n2}が発生しました。

## prompt notice-adjective-do
family: notice
enabled: true
kind: information
buttons: ok-cancel
weight: 6
line: {i1}{n1}を{s1}してください。

## prompt notice-prepare
family: notice
enabled: true
kind: information
buttons: ok-cancel
weight: 8
line: {i1}{n1}を用意してください。

## prompt notice-new
family: notice
enabled: true
kind: information
buttons: yes-no
weight: 8
line: 新しい{n1}が見つかりました。
line: 今すぐ{n2}と交換しますか？

## prompt notice-wrong
family: notice
enabled: true
kind: error
buttons: ok
weight: 8
line: {n1}が間違っています。

## prompt notice-done-to
family: notice
enabled: true
kind: information
buttons: ok
weight: 6
line: {n1}が{s1}されました。

> ── confirm（確認する）──

## prompt confirm-agree
family: confirm
enabled: true
kind: confirmation
buttons: yes-no
weight: 6
line: {n1}を{v1}ことに同意しますか？

> ── question（突然の質問）──

## prompt ask-really
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 2
line: 本当に？

## prompt ask-why
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 2
line: なぜですか？

## prompt ask-sure
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 2
line: 大丈夫ですか？

## prompt ask-other-does
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 6
line: {n1}は{n2}を{s1}しますか？

## prompt ask-which
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 6
line: {n1}と{n2}のどちらが{i1}ですか？

## prompt ask-more-na
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 6
line: {n1}は{n2}より{na1}ですか？

## prompt ask-believe
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: {n1}を信じますか？

## prompt ask-like
family: question
enabled: true
kind: confirmation
buttons: yes-no
weight: 8
line: {n1}は好きですか？

> ━━ 1 回で終わるもの（terminal）の続き ━━

> 【あとから足したもの（data-version 4 と 5）】

> ── report（突然の報告）──

## terminal report-lack
family: report
enabled: true
kind: warning
weight: 10
line: {n1}に{n2}がありません。

## terminal report-ize
family: report
enabled: true
kind: information
weight: 10
line: {n1}が{n2}化しました。

## terminal report-latest
family: report
enabled: true
kind: information
weight: 10
line: すでに最新の{n1}を{s1}中です。

## terminal report-typical
family: report
enabled: true
kind: warning
weight: 10
line: {n1}的な{n2}が発生しました。

> ── refusal（拒否）──

## terminal refuse-verb-noun
family: refusal
enabled: true
kind: error
weight: 10
line: {n1}を{v1}ことができません。

> ── prohibition（制止）──

## terminal stop-forbidden
family: prohibition
enabled: true
kind: warning
weight: 10
line: {v1}ことは禁止されています。

> ── persona（人格がのぞく一言）──

## terminal persona-unknown
family: persona
enabled: true
kind: information
weight: 10
line: わかりません。

## terminal persona-maybe
family: persona
enabled: true
kind: error
weight: 10
line: 多分できません。

## terminal persona-not-me
family: persona
enabled: true
kind: warning
weight: 10
line: 私のせいではありません。

## terminal persona-no
family: persona
enabled: true
kind: error
weight: 10
line: いやです。

## terminal persona-sorry
family: persona
enabled: true
kind: information
weight: 10
line: ……ごめん。

## terminal persona-tired
family: persona
enabled: true
kind: information
weight: 6
line: 少し疲れました。

## terminal persona-dislike
family: persona
enabled: true
kind: information
weight: 6
line: {n1}は好きではありません。

## terminal persona-dont-ask
family: persona
enabled: true
kind: warning
weight: 6
line: {n1}のことは聞かないでください。

> ━━ 結果の画面（outcome）の続き ━━

> 【あとから足したもの（data-version 4 と 5）】

> ── done（成功した）──

## outcome done-second
family: done
enabled: true
kind: success
weight: 8
line: {n2}を{s2}しました。

## outcome done-replaced
family: done
enabled: true
kind: success
weight: 8
line: {n1}を{n2}に置き換えました。

## outcome done-saved
family: done
enabled: true
kind: success
weight: 6
line: {n1}を保存しました。

## outcome done-verb-noun
family: done
enabled: true
kind: success
weight: 6
line: {n1}が{v1}ようにしました。

> ── cancelled（取り消した）──

## outcome cancelled-second
family: cancelled
enabled: true
kind: information
weight: 8
line: {n2}の{s2}を取り消しました。

## outcome cancelled-kept
family: cancelled
enabled: true
kind: information
weight: 8
line: {n1}はそのままです。

## outcome cancelled-not-replaced
family: cancelled
enabled: true
kind: information
weight: 6
line: {n1}を{n2}に置き換えませんでした。

## outcome cancelled-adjective
family: cancelled
enabled: true
kind: information
weight: 6
line: {i1}{n1}を削除しませんでした。

> ── failed（失敗した）──

## outcome failed-second
family: failed
enabled: true
kind: error
weight: 6
line: {n2}を{s2}できませんでした。

## outcome failed-replace
family: failed
enabled: true
kind: error
weight: 6
line: {n1}を{n2}に置き換えられませんでした。

## outcome failed-timeout
family: failed
enabled: true
kind: error
weight: 6
line: {n1}の応答がありません。

> ── partial（一部だけできた）──

## outcome partial-verb
family: partial
enabled: true
kind: warning
weight: 8
line: {n1}の半分だけが{v1}ようです。

## outcome partial-count
family: partial
enabled: true
kind: warning
weight: 6
line: {n1}のうち三つを{s1}しました。

## outcome partial-na
family: partial
enabled: true
kind: warning
weight: 6
line: {n1}は一部だけ{+na1}になりました。

> ── running（すでに処理中）──

## outcome running-still
family: running
enabled: true
kind: information
weight: 6
line: {n1}はまだ{n2}を待っています。

## outcome running-na
family: running
enabled: true
kind: information
weight: 6
line: {n1}は{+na1}に{s1}中です。

> ── busy（ほかのものが使用中）──

## outcome busy-verb
family: busy
enabled: true
kind: warning
weight: 8
line: {n1}は現在、{+n1}が{+v1}ところです。

## outcome busy-wait
family: busy
enabled: true
kind: warning
weight: 6
line: {+n1}が{n1}を使い終わるまでお待ちください。

> ── already（すでに済んでいる）──

## outcome already-verb
family: already
enabled: true
kind: information
weight: 6
line: {n1}はすでに{v1}ことにしています。

> ── missing（必要なものが無い）──

## outcome missing-adjective
family: missing
enabled: true
kind: error
weight: 6
line: {n1}に必要な{+i1}{+n1}がありません。

## outcome missing-verb
family: missing
enabled: true
kind: error
weight: 6
line: {+v1}ための{+n1}がありません。

> ── cannot（できない）──

## outcome cannot-na
family: cannot
enabled: true
kind: error
weight: 6
line: {n1}は{+na1}なので、できません。

## outcome cannot-adjective
family: cannot
enabled: true
kind: error
weight: 6
line: {i1}{n1}にはその操作ができません。

> ── other-target（別のものを処理した）──

## outcome other-target-verb
family: other-target
enabled: true
kind: success
weight: 6
line: {+n1}が{v1}ことになりました。

> ── other-action（別のことをした）──

## outcome other-action-replace
family: other-action
enabled: true
kind: success
weight: 8
line: {n1}を{+n1}に置き換えました。

## outcome other-action-deleted
family: other-action
enabled: true
kind: information
weight: 6
line: 不正な{n1}が見つかったため削除しました。

> ── substituted（代わりのもので済ませた）──

## outcome substituted-na
family: substituted
enabled: true
kind: warning
weight: 6
line: {na1}な{n1}の代わりに{+na1}な{+n1}を使用しました。

> ── changed（対象や操作が変わった）──

## outcome changed-na
family: changed
enabled: true
kind: information
weight: 6
line: {n1}は{+na1}に変更されました。

> ── failed-but（失敗したが、別のことはできた）──

## outcome failed-but-verb
family: failed-but
enabled: true
kind: warning
weight: 6
line: {v1}ことには失敗しましたが、{+v1}ことはできました。

## outcome failed-but-second
family: failed-but
enabled: true
kind: warning
weight: 6
line: {n1}には失敗しましたが、{+n1}の{+s1}は完了しました。

> ── mismatch-ok（エラーの印で、成功の文）──

## outcome mismatch-ok-noun
family: mismatch-ok
enabled: true
kind: error
weight: 8
line: {n1}の処理が完了しました。

## outcome mismatch-ok-verb
family: mismatch-ok
enabled: true
kind: error
weight: 6
line: {v1}ことに成功しました。

> ── mismatch-ng（完了の印で、失敗の文）──

## outcome mismatch-ng-bare
family: mismatch-ng
enabled: true
kind: success
weight: 8
line: 処理に失敗しました。

## outcome mismatch-ng-verb
family: mismatch-ng
enabled: true
kind: success
weight: 6
line: {v1}ことに失敗しました。

> ── no-problem（警告の印で、問題は無いという文）──

## outcome no-problem-adjective
family: no-problem
enabled: true
kind: warning
weight: 6
line: {n1}は{+i1}ですが、問題はありません。

> ── overridden（取り消したのに、実行された）──

## outcome overridden-again
family: overridden
enabled: true
kind: information
weight: 8
line: 取り消しを取り消しました。
line: {n1}の{s1}を再開します。

> ── repeat（同じことが繰り返される）──

## outcome repeat-wrong
family: repeat
enabled: true
kind: error
weight: 10
line: また{n1}が間違っています。

## outcome repeat-again
family: repeat
enabled: true
kind: information
weight: 10
line: {n1}が再び{s1}されました。

## outcome repeat-still
family: repeat
enabled: true
kind: warning
weight: 8
line: {n1}はまだ{n2}のままです。

## outcome repeat-same
family: repeat
enabled: true
kind: warning
weight: 8
line: 同じ{n1}がもう一度見つかりました。

## outcome repeat-restart
family: repeat
enabled: true
kind: information
weight: 6
line: {n1}の{s1}を最初からやり直します。

## outcome repeat-verb
family: repeat
enabled: true
kind: warning
weight: 6
line: {n1}はまた{v1}ようです。

## outcome repeat-na
family: repeat
enabled: true
kind: warning
weight: 6
line: {n1}は相変わらず{na1}です。
