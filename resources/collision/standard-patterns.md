# Semantropy standard Collision patterns

> ■ 1. このファイルについて
>
> 衝突フレーズの「パターン」（語の並べ方）と、その部品と、それぞれの
> 出やすさを決めるファイルです。人が書き換えるのは、このファイル
> だけです。
>
>   recipe         … パターン。部品を並べる順番（data-version 2 では 9 個）
>   literal        … 固定の語。パターンの中に置く決まった文字
>                     （は、を、という名の、など。同じく 7 個）
>   connector      … つなぎ。名詞と名詞のあいだに入る語（同じく 20 個）
>   modifier-form  … 修飾の形（白い、静かな、歩いた、など。10 個で固定）
>   noun-suffix    … 名詞に付けて修飾にする語尾（の、的な、など。6 個）
>
> plugin は、動いているあいだ、このファイルを読みません。build のときに
> だけ読み、plugin に入れるデータ
> （src/collision/generated/standardCollisionPatternEntries.ts）を作り
> ます。作られたデータと、版の記録（standard-patterns.lock.json）は、
> 手で書き換えません。
>
> 「> 」で始まる行は、この説明のような注記です。plugin には入りません。
> 自由に書き足せます（「>」の次に、半角の空白を 1 つ置きます）。
>
> ■ 2. 編集の手順
>
> 1) このファイルを書き換える。
> 2) 下の data-version の数を、ちょうど 1 つ上げる（2 なら 3）。
>    上げるのは、項目を足した、消した、順番を入れ替えた、文字、label、
>    true と false、weight、part、presence、id のどれかを変えたとき
>    です。注記だけを変えたときは、上げません。
>    上げ忘れると、3) が止まります。2 つ以上飛ばしても止まります。
> 3) npm run generate:collision-patterns を実行する。
>    成功すると、項目の数が表示され、作られるデータと版の記録が
>    書き換わります。
>    書き方に誤りがあると、何も書き換えずに止まり、誤りの種類と、
>    行の番号（line 123）か id が表示されます。
> 4) npm run build を実行する。main.js が作り直されます。
>    3) を忘れていると、build は止まります。
> 5) Obsidian で Semantropy を無効にしてから有効にし、衝突フレーズを
>    何回か生成して確かめる。パターンを 1 つに固定すると、足した
>    パターンだけを見られます。
>
> 3) が成功したあとで、さらに書き直すとき:
>    版の記録に、1 回目の内容が残っているので、同じ data-version の
>    ままでは 3) が止まります。次のコマンドで版の記録を元に戻して
>    から、もう一度 3) を行ってください。
>      git restore resources/collision/standard-patterns.lock.json
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
> 区切りは、どこも半角の空白 1 つです。全角の空白や、空白 2 つは、
> 誤りになります。「（空行）」と書いたところは、何も書かない行です。
>
> ● recipe（パターン）
>
>     ## recipe question
>     label: Question
>     enabled: true
>     selectable: true
>     weight: 6
>     part: noun n1 required
>     part: literal l1 required topic-link
>     part: modifier m2 optional all
>     part: noun n2 required
>     part: literal l2 required possessive-link
>     part: noun n3 required
>     part: literal l3 required object-link
>     part: predicate v1 required regular-verb-basic
>     part: literal l4 required question-end
>     presence: none 70
>     presence: m2 30
>
>   この例は、[名詞][は]（[修飾]）[名詞][の][名詞][を][述語][か] の形に
>   なります。例: 猫は白い封筒の月を歩くか
>
>   ## recipe  の後ろに、id を書く。
>   label      英語の画面で、パターンの選択肢に出る名前。40 字まで。
>              日本語の画面の名前は、別のファイル（src/i18n/catalog.ts の
>              recipeLabels）に、id ごとに書いてあります。パターンを
>              足したときは、そちらにも足します（実装担当に頼んで
>              ください）。無ければ、label がそのまま出ます。
>   enabled    true … 使う。 false … 使わない（消さずに止める）。
>   selectable true … 画面の「パターン」の選択肢に出る。
>              false … 選択肢には出ないが、ランダムのときは出る。
>   weight     出やすさ。1 以上の整数。ランダムのとき、ほかのパターン
>              との比で決まります（100 と 25 なら、4 対 1）。
>   part       部品。出力の順に、1 行に 1 つ書く。
>                part: 種類 名前 required（または optional） 追加
>              種類と追加は、次の 5 通りです。
>                noun       名詞。追加は無し
>                connector  つなぎ。追加は無し。下の connector の中から、
>                           出やすさに応じて 1 つ選ばれる
>                modifier   修飾。追加は all か sahen-basic
>                             all … 修飾の形のどれでも
>                             sahen-basic … 「観察する」の形だけ
>                predicate  述語（動詞の基本の形）。
>                           追加は regular-verb-basic
>                literal    固定の語。追加は、下の literal の id
>              名前は、そのパターンの中だけで使う呼び名です（n1、m2 など）。
>              optional（付くときと付かないときがある）にできるのは、
>              modifier だけです。ほかは required と書きます。
>   presence   optional の修飾があるときだけ書く（あるときは、かならず
>              書く）。どの修飾を付けるかの組み合わせと、その出やすさ。
>                presence: none 5     … 修飾を 1 つも付けない
>                presence: m1 3       … m1 だけを付ける
>                presence: m1,m2 1    … m1 と m2 を付ける
>              書かなかった組み合わせは、出ません。
>
>   label、enabled、selectable、weight を先に書き、part、presence の順に
>   続けます。項目の途中に、空行を入れません。
>
> ● literal（固定の語）
>
>     ## literal named-link
>     （空行）
>     という名の
>
>   見出しの次に空行を 1 つ置き、その次の 1 行に文字を書きます。
>
> ● connector（つなぎ）
>
>     ## connector no
>     form: literal
>     weight: 28
>     （空行）
>     の
>
>   form    literal … 文字のあるつなぎ。空行の次の 1 行に、文字を書く。
>           empty … 何も入れない（名詞と名詞をじかにつなぐ）。
>                   文字の行は書かない。empty は、1 つだけ要ります。
>   weight  出やすさ。つなぎどうしの比で決まります。
>
> ● modifier-form（修飾の形）
>
>     ## modifier-form verb-past
>     class: verb
>     variant: past
>     weight: 10
>
>   class と variant の組は、次の 10 個で固定です。足すことも、消す
>   こともできません。変えられるのは weight（出やすさ）だけです。
>     i-adjective / basic         白い
>     na-adjective / na           静かな
>     verb / basic、past、progressive、negative
>                                 歩く、歩いた、歩いている、歩かない
>     sahen / basic、past、progressive、negative
>                                 観察する、観察した、観察している、
>                                 観察しない
>
> ● noun-suffix（名詞に付ける語尾）
>
>     ## noun-suffix noun-teki-na
>     weight: 12
>     （空行）
>     的な
>
>   名詞の後ろに付けて、修飾を作ります（猫的な）。足せます（めいた、
>   じみた、など）。1 つ以上要ります。
>
> 修飾は、まず形（modifier-form と noun-suffix を合わせた中から、
> weight に応じて）を選び、次にその形になる語を選びます。
>
> ■ 4. 決まり（守らないと build が止まるもの）
>
> ● 行の書き方
>   ・知らない行、知らない field は、読み飛ばされずに、誤りになります。
>   ・文字の行は 1 行だけです。前後に空白を置けません。
>   ・field と文字の行のあいだの空行は、省けません。
>
> ● 文字（literal、connector、noun-suffix）に使える字
>   ひらがな、カタカナ、漢字、「ー」だけです。1 字から 32 字まで。
>   ○ のための   ○ っぽい   ○ 化した
>   × の、       （「、」「。」は使えない）
>   × ？  × ・   （記号は使えない）
>   × no  × 1    （英字と数字は使えない）
>   同じ種類の中で、同じ文字を 2 回は書けません（connector の「の」と
>   noun-suffix の「の」は、種類が違うので、両方あってよい）。
>
> ● id と、part の名前
>   半角の英小文字で始め、英小文字と数字を、ハイフンでつなぎます。
>   id は、5 つの種類を通して、同じものを 2 回使えません。
>   ○ no-hate-no、verb-past、n1
>   × No-Hate（大文字）、no_hate（下線）、2nd（数字で始まる）、
>     の果ての（日本語）
>   part の名前は、1 つのパターンの中で重ねられません。none という
>   名前は使えません。
>
> ● recipe の決まり
>   ・部品は 1 個から 12 個まで。そのうち、名詞は 4 個、修飾は 3 個、
>     つなぎは 2 個、述語は 1 個まで。
>   ・名詞が 1 個以上要ります。
>   ・enabled: false のときは、selectable も false にします。
>   ・selectable: true のパターンどうしで、同じ label は使えません。
>   ・part の literal は、下の literal にある id を書きます。
>   ・presence は、optional の修飾が無いパターンには書けません。
>     同じ組み合わせを 2 回は書けません。required の部品や、無い名前は
>     書けません。カンマの前後に空白を置けません。
>     ○ presence: m1,m2 1
>     × presence: m1, m2 1
>   ・weight は、どれも 1 以上の整数です（0、小数、負の数は使えない）。
>
> ● 文法は確かめません
>   build は、並べた結果が自然な日本語かどうかを確かめません。
>   固定の語の前後に何が来るかを考えて、いくつか生成して読んでみて
>   ください。
>
> ■ 5. id を変えてはいけない理由
>
>   ・日本語の画面のパターン名は、recipe の id で探します。id を変えると、
>     日本語の名前が出なくなり、label（英語）が出ます。
>   ・id を変えることも内容の変更なので、data-version を上げることに
>     なります。
>   ・test が覚えている値と、開発の記録が、id で項目を指しています。
>   いまある id は、そのままにしてください。新しい項目には、新しい id を
>   付けます。

schema-version: 2
data-version: 2

> ━━ パターン（recipe）━━
>
> 各パターンの前の注記は、日本語の画面での名前、できあがる形、
> 例です。（ ）で囲んだ修飾は、付くときと付かないときがあります。

> 「標準」
> 形: （[修飾]）[名詞][つなぎ]（[修飾]）[名詞]
> 例: 白い猫の封筒／猫と静かな月

## recipe noun-pair
label: Standard
enabled: true
selectable: true
weight: 100
part: modifier m1 optional all
part: noun n1 required
part: connector c1 required
part: modifier m2 optional all
part: noun n2 required
presence: none 45
presence: m1 20
presence: m2 27
presence: m1,m2 8

> 「名詞の対」
> 形: [名詞][つなぎ][名詞]
> 例: 猫の封筒／月という駅

## recipe plain-pair
label: Noun pair
enabled: true
selectable: true
weight: 24
part: noun n1 required
part: connector c1 required
part: noun n2 required

> 「三連・先頭」
> 形: （[修飾]）[名詞][つなぎ][名詞][つなぎ][名詞]
> 例: 白い猫と封筒の月

## recipe triple-left
label: Triple lead
enabled: true
selectable: true
weight: 12
part: modifier m1 optional all
part: noun n1 required
part: connector c1 required
part: noun n2 required
part: connector c2 required
part: noun n3 required
presence: none 70
presence: m1 30

> 「三連・反復」
> 形: [名詞][つなぎ]（[修飾]）[名詞][つなぎ]（[修飾]）[名詞]
> 例: 猫の白い封筒と歩く月

## recipe triple-right
label: Triple echo
enabled: true
selectable: true
weight: 10
part: noun n1 required
part: connector c1 required
part: modifier m2 optional all
part: noun n2 required
part: connector c2 required
part: modifier m3 optional all
part: noun n3 required
presence: none 50
presence: m2 20
presence: m3 20
presence: m2,m3 10

> 「名付け」
> 形: [名詞][という名の][名詞]
> 例: 猫という名の封筒

## recipe named
label: Named
enabled: true
selectable: true
weight: 8
part: noun n1 required
part: literal l1 required named-link
part: noun n2 required

> 「問い」
> 形: [名詞][は]（[修飾]）[名詞][の][名詞][を][述語][か]
> 例: 猫は白い封筒の月を歩くか

## recipe question
label: Question
enabled: true
selectable: true
weight: 6
part: noun n1 required
part: literal l1 required topic-link
part: modifier m2 optional all
part: noun n2 required
part: literal l2 required possessive-link
part: noun n3 required
part: literal l3 required object-link
part: predicate v1 required regular-verb-basic
part: literal l4 required question-end
presence: none 70
presence: m2 30

> 「否定」
> 形: [名詞][は][名詞][ではない]
> 例: 猫は封筒ではない

## recipe denial
label: Denial
enabled: true
selectable: true
weight: 6
part: noun n1 required
part: literal l1 required topic-link
part: noun n2 required
part: literal l2 required denial-end

> 「ための」
> 形: [名詞][のための][名詞]
> 例: 猫のための封筒

## recipe purpose
label: For
enabled: true
selectable: true
weight: 8
part: noun n1 required
part: literal l1 required purpose-link
part: noun n2 required

> 「サ変」
> 形: [修飾（〜する）][名詞]
> 例: 観察する猫

## recipe sahen-noun
label: Sahen
enabled: true
selectable: true
weight: 12
part: modifier m1 required sahen-basic
part: noun n1 required

> ━━ 固定の語（literal）━━
>
> パターンの part: literal が、id で呼び出します。

## literal named-link

という名の

## literal topic-link

は

## literal possessive-link

の

## literal object-link

を

## literal question-end

か

## literal denial-end

ではない

## literal purpose-link

のための

> ━━ つなぎ（connector）━━
>
> part: connector のところに、この中の 1 つが、weight に応じて
> 入ります。empty は、何も入れないつなぎです（猫封筒）。
> ここの「の」は、下の noun-suffix の「の」とは別のものです。

## connector empty
form: empty
weight: 14

## connector no
form: literal
weight: 28

の

## connector to
form: literal
weight: 12

と

## connector ya
form: literal
weight: 8

や

## connector teki
form: literal
weight: 5

的

## connector teki-na
form: literal
weight: 6

的な

## connector to-no
form: literal
weight: 5

との

## connector e-no
form: literal
weight: 4

への

## connector kara-no
form: literal
weight: 3

からの

## connector to-shite-no
form: literal
weight: 3

としての

## connector no-yo-na
form: literal
weight: 4

のような

## connector to-iu
form: literal
weight: 3

という

## connector to-iu-na-no
form: literal
weight: 1

という名の

## connector no-hate-no
form: literal
weight: 1

の果ての

## connector no-tame-no
form: literal
weight: 2

のための

## connector ni-yoru
form: literal
weight: 3

による

## connector ni-okeru
form: literal
weight: 1

における

## connector ni-taisuru
form: literal
weight: 2

に対する

## connector o-meguru
form: literal
weight: 2

をめぐる

## connector ppoi
form: literal
weight: 2

っぽい

> ━━ 修飾の形（modifier-form）━━
>
> 10 個で固定です。変えられるのは weight だけです。
> 「観察される」のような受け身と、不規則な動詞は作りません。

> 例: 白い

## modifier-form i-adjective-basic
class: i-adjective
variant: basic
weight: 20

> 例: 静かな

## modifier-form na-adjective-na
class: na-adjective
variant: na
weight: 20

> 例: 歩く

## modifier-form verb-basic
class: verb
variant: basic
weight: 20

> 例: 歩いた

## modifier-form verb-past
class: verb
variant: past
weight: 10

> 例: 歩いている

## modifier-form verb-progressive
class: verb
variant: progressive
weight: 4

> 例: 歩かない

## modifier-form verb-negative
class: verb
variant: negative
weight: 4

> 例: 観察する

## modifier-form sahen-basic
class: sahen
variant: basic
weight: 20

> 例: 観察した

## modifier-form sahen-past
class: sahen
variant: past
weight: 10

> 例: 観察している

## modifier-form sahen-progressive
class: sahen
variant: progressive
weight: 4

> 例: 観察しない

## modifier-form sahen-negative
class: sahen
variant: negative
weight: 4

> ━━ 名詞に付ける語尾（noun-suffix）━━
>
> 名詞の後ろに付けて、修飾にします（猫の、猫的な、猫化した）。
> 「化した」「化された」は、決まった文字としてここに書いてあります
> （動詞として活用させているのではありません）。
> 「めいた」「じみた」などを足すときも、ここに足します。

## noun-suffix noun-no
weight: 30

の

## noun-suffix noun-teki-na
weight: 12

的な

## noun-suffix noun-no-yo-na
weight: 8

のような

## noun-suffix noun-ppoi
weight: 5

っぽい

## noun-suffix noun-ka-shita
weight: 5

化した

## noun-suffix noun-ka-sareta
weight: 3

化された
