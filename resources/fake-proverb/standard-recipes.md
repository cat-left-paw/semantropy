# Semantropy standard Fake Proverb recipes

> ■ 1. このファイルについて
>
> 架空ことわざの「型」と、その出やすさを決めるファイルです。
> 人が書き換えるのは、このファイルだけです。
>
>   proverb … ことわざの型（data-version 3 と 4 では 63 個）
>   gloss   … 解説の型（同じく 32 個）
>   profile … 穴に入る語の形の組（基本の形だけ、否定だけ、など。14 個）
>
> 1 件の出力は、ことわざ 1 つと、その解説 1 つの組です。1 回に 10 件を
> 作ります。
>
> plugin は、動いているあいだ、このファイルを読みません。build のときに
> だけ読み、plugin に入れるデータ
> （src/fakeProverb/generated/standardFakeProverbRecipeEntries.ts）を
> 作ります。作られたデータと、版の記録（standard-recipes.lock.json）は、
> 手で書き換えません。
>
> 「> 」で始まる行は、この説明のような注記です。plugin には入りません。
> 自由に書き足せます（「>」の次に、半角の空白を 1 つ置きます）。
>
> ■ 2. 編集の手順
>
> 1) このファイルを書き換える。
> 2) npm run preview:fake-proverb を実行する。
>    型ごとの出力の例が、.cache/fake-proverb-preview.md に書き出され
>    ます。書き間違いがあれば、行の番号と理由が、日本語で表示されます。
>    ここまでは、何度でもやり直せます（一度 npm run build をして
>    あることが条件です。辞書を使うためです）。
> 3) 出力に満足したら、下の data-version の数を、ちょうど 1 つ上げる
>    （3 なら 4）。
>    上げるのは、型を足した、消した、順番を入れ替えた、文、true と
>    false、weight、profile の form、id のどれかを変えたときです。
>    注記と tag だけを変えたときは、上げません。
>    上げ忘れると、4) が止まります。2 つ以上飛ばしても止まります。
> 4) npm run generate:fake-proverb-recipes を実行する。
>    成功すると、項目の数が表示され、作られるデータと版の記録が
>    書き換わります。
> 5) npm run build を実行する。main.js が作り直されます。
>    4) を忘れていると、build は止まります。
> 6) Obsidian で Semantropy を無効にしてから有効にし、架空ことわざを
>    何回か生成して確かめる。
>
> 4) が成功したあとで、さらに書き直すとき:
>    版の記録に、1 回目の内容が残っているので、同じ data-version の
>    ままでは 4) が止まります。次のコマンドで版の記録を元に戻して
>    から、もう一度 4) を行ってください。
>      git restore resources/fake-proverb/standard-recipes.lock.json
>    2) の確認を先に済ませておけば、この手間は、ほとんど要りません。
>
> npm test は、いまの項目の数と、決まった条件での出力を覚えています。
> 項目を変えると、いくつかの test が失敗します。書き間違いとは限らず、
> 変えたことの印です。実装担当に伝えて、覚えている値を取り直して
> もらってください。
>
> ■ 3. 書式
>
> 型は、次の 4 行です。区切りは、どこも半角の空白 1 つです。
>
>     ## proverb example-proverb
>     enabled: true
>     weight: 4
>     line: {m1:形}{n1}は{n2}を忘れず
>
>   1 行目  「## proverb 」の後ろに、id を書く（解説は「## gloss 」）。
>   enabled  true … 使う。 false … 使わない（消さずに止める）。
>   weight   出やすさ。1 以上の整数。ことわざどうし、解説どうしの
>            比で決まります（4 と 2 なら、2 対 1）。
>   line     型の文。1 行だけ。ほかの行を全部書いたあとに書きます。
>            { } のところが「穴」で、語彙の語が入ります。
>            ほかは、そのまま出る文字です。
>
> 項目と項目のあいだは、空行で区切ります。項目の途中には、空行を
> 入れません。上から順に、ことわざ、解説、profile を書いてあります
> （書く順番を入れ替えると、出力が変わります）。
>
> ● 穴の書き方
>
>   {n1} {n2} …  名詞（猫、封筒）
>   {m1} {m2}    修飾。名詞の前に置く語（白い、歩く、歩いた、歩かない、
>                静かな）
>   {v1}         述語。文を結ぶ語（歩く、歩かない）
>   {a1}         連用の修飾（静かに）
>
>   文字（n、m、v、a）が種類で、数字（1 から 9）は、同じ種類の穴を
>   区別する番号です。
>
>   「:」の後ろに 1 字を書くと、入る形を絞れます。
>     {m1:形} 形容詞だけ（白い）
>     {m1:動} 動詞の基本の形だけ（歩く）
>     {m1:否} 動詞の否定だけ（歩かない）
>     {m1:過} 動詞の過去だけ（歩いた）
>     {m1:な} 「静かな」の形だけ
>     {m1:活} 形容詞か、動詞の基本の形、否定（「静かな」は入らない）
>     {v1:動} 動詞の基本の形だけ
>     {v1:否} 動詞の否定だけ
>     {v1:形} 形容詞だけ
>     {v1:肯} 形容詞か、動詞の基本の形
>   この字は、下の profile の tag です。profile を足せば、増やせます。
>   「:」を書かないときは、tag の無い profile（その種類の既定）が
>   使われます。
>
> ● ことわざと解説のつながり
>
>   解説の {n1} は、ことわざの {n1} と同じ語になります。{v1} なども
>   同じです。解説は、自分が使う穴を全部持っていることわざにだけ
>   付きます（{n1} と {n2} を使う解説は、{n2} の無いことわざには
>   付きません）。
>
>   解説の中で、穴の前に + を付けると、解説だけの新しい語になります
>   （{+n1}、{+v1:動}）。同じ + の名前を 2 回書くと、2 回目は、同じ
>   新しい語になります。
>
>   ことわざの中で、穴の前に - を付けると、その語を解説に渡しません
>   （{-m1}）。渡す穴は、1 つのことわざにつき 4 個までです。
>
>   解説の中の、ことわざの語を使う穴（{n1} など）と、2 回目の + の穴
>   には、「:」と字を付けられません（形は、最初に書いたところで
>   決まっています）。
>
> ● profile（穴に入る語の形の組）
>
>     ## profile example-profile
>     kind: modifier
>     tag: 例
>     form: adjective-basic 7
>     form: verb-basic 5
>
>   kind  noun（名詞）、modifier（修飾）、predicate（述語）、
>         adverbial（連用の修飾）のどれか。
>   tag   穴の「:」の後ろに書く字。ひらがな、カタカナ、漢字の 1 字から
>         4 字。tag: の行を書かない profile が、その種類の既定です
>         （既定は、種類ごとに 1 つまで）。
>   form  入る形と、その出やすさ。1 行に 1 つ。形は、次のものだけです。
>           noun      independent-noun（名詞）
>           modifier  adjective-basic（白い）、verb-basic（歩く）、
>                     verb-past（歩いた）、verb-negative（歩かない）、
>                     na-stem-na（静かな）
>           predicate adjective-basic（白い）、verb-basic（歩く）、
>                     verb-negative（歩かない）
>           adverbial na-stem-ni（静かに）
>
> ■ 4. 決まり（守らないと build が止まるもの）
>
> ● 行の書き方
>   ・知らない行、知らない名前の行は、読み飛ばされずに、誤りになります。
>   ・enabled、weight、line は、どれも省けません。line は 1 行だけです。
>   ・line のあとに、ほかの行は書けません。
>
> ● 文に使える字
>   ひらがな、カタカナ、漢字、「ー」「、」「。」だけです。
>   穴と穴のあいだの 1 続きは、24 字までです。
>   ○ {n1}は百年の{n2}
>   × {n1}は「{n2}」            （かぎ括弧は使えない）
>   × {n1}は100年の{n2}         （数字と英字は使えない。漢数字は使える）
>   × {n1} は{n2}               （空白は使えない）
>   × {n1}は{n2}か？            （？ ！ は使えない）
>
> ● 穴
>   ○ {n1}  ○ {m2:形}  ○ {-n3}（ことわざ）  ○ {+v1:動}（解説）
>   × {x1}  × {n0}  × {n10}  × {noun}  （形が違う）
>   × {m1:長}                 （その tag を持つ profile が無い）
>   × ことわざの中の {+n1}    （+ は解説だけ）
>   × 解説の中の {-n1}        （- はことわざだけ）
>   × 解説の中の {n1:形}      （ことわざの語には、字を付けられない）
>   × ことわざの中で、{n1} を 2 回（1 つの穴は 1 回だけ）
>
> ● 穴の数
>   ことわざ: 名詞 4、修飾 2、述語 1、連用の修飾 1 まで。
>   解説の新しい語（+ の穴）: 名詞 3、修飾 2、述語 2、連用の修飾 1 まで。
>   穴と固定の文字を合わせて、ことわざは 10 個、解説は 14 個まで。
>
> ● 「静かな」が入りうる修飾の直後
>   {m1} と {m1:な} には、「静かな」の形が入ります。その直後は、名詞で
>   なければなりません。行の最後にも置けません。
>     ○ {m1}{n1}  ○ {m1:な}者は  ○ {+m1}ものと思い込むと
>     × {m1}ものなり    （「もの」の次の字が「な」）
>     × {m1}に{n1}      （助詞が続く）
>     × {n1}は{m1}      （行の最後）
>   名詞は、名詞の穴、漢字かカタカナで始まる語、または
>   こと もの ところ ため はず わけ ほう です（その次は、文字の終わりか、
>   が を に は も で の と か だ 、 。 のどれか）。
>   「ものなり」「ことなし」の前には、{m1:活} や {m1:動} を使います。
>
> ● 連用の修飾の直後
>   {a1} の直後は、述語の穴か、「静かな」の入らない修飾の穴です。
>     ○ {a1}{v1:動}  ○ {a1}{m1:動}
>     × {a1}{n1}  × {a1}{m1}  × {a1}は
>
> ● ことわざと解説の組み合わせ
>   ・ことわざは、穴を 1 つ以上、解説に渡します（全部に - は付けられ
>     ません）。
>   ・解説は、ことわざの穴を 1 つ以上使います。
>   ・どのことわざにも、付けられる解説が 1 つ以上要ります。どの解説
>     にも、付くことわざが 1 つ以上要ります。
>   ・名詞の無いことわざ（{v1:動}が勝ち、など）も書けます。そのときは、
>     {v1} だけを使う解説が付きます。
>
> ● id
>   半角の英小文字で始め、英小文字と数字を、ハイフンでつなぎます。
>   48 字まで。proverb、gloss、profile を通して、同じ id は 1 回だけです。
>   ○ rather-than、plain-noun
>   × Rather-Than（大文字）、rather_than（下線）、2nd-proverb（数字で
>     始まる）、ことわざ（日本語）
>
> ● そのほか
>   ・使われない profile は、置けません。
>   ・数の上限: ことわざ 128、解説 128、profile 32、固定の文字の種類 512。
>   ・weight と、form の出やすさは、1 以上の整数です。
>
> ● 作れない形と、確かめないこと
>   動詞と形容詞は、基本の形、否定、過去（修飾だけ）しか作れません。
>   「歩いて」「歩けば」「白く」が要るところは、固定の語で書きます。
>   build は、穴の前の文字（を、に、など）と、文の自然さを確かめません。
>   足した型は、npm run preview:fake-proverb の出力を読んで確かめて
>   ください。
>
> ■ 5. id を変えてはいけない理由
>
>   ことわざと解説の id は、収集のときに plugin の中で作る記録に入ります
>   （いまの版は、収集先のファイルには書き出しません）。test が覚えて
>   いる値と、開発の記録も、id で型を指しています。id を変えることも
>   内容の変更なので、data-version を上げることになります。
>   いまある id は、そのままにしてください。新しい型には、新しい id を
>   付けます。
>
>   固定の文字には、id を書きません。build が、文字から自動で決めます。

schema-version: 2
data-version: 4

> ━━ ことわざ（proverb） ━━
>
> まとまりごとに、見出しの注記を入れてあります。

> ── いまある型（9 個。id は変えない）──
> 「を」「に」の後ろに可変の動詞が入る 4 個は、出やすさを半分（2）にしてある。

## proverb topic-object
enabled: true
weight: 2
line: {n1}は{n2}を{v1}

## proverb genitive-destination
enabled: true
weight: 2
line: {n1}の{n2}は{n3}に{v1:動}

## proverb rather-than
enabled: true
weight: 4
line: {n1}より{n2}

## proverb offered-to
enabled: true
weight: 4
line: {n1}に{n2}

## proverb modified-topic
enabled: true
weight: 2
line: {-m1}{n1}は{n2}を{v1:否}

## proverb born-of
enabled: true
weight: 4
line: {n1}から出た{n2}

## proverb pursuer
enabled: true
weight: 2
line: {n1}を{-m1:動}者は{n2}を{v1:否}

## proverb ear-prayer
enabled: true
weight: 4
line: {n1}の{n2}に{n3}

## proverb origin-of
enabled: true
weight: 4
line: {n1}は{n2}のもと

> ── 元ネタのある型（名詞だけが可変）──

## proverb is-nari
enabled: true
weight: 4
line: {n1}は{n2}なり

## proverb calls
enabled: true
weight: 4
line: {n1}は{n2}を呼ぶ

## proverb if-there-is
enabled: true
weight: 4
line: {n1}あれば{n2}あり

## proverb heart-unknown
enabled: true
weight: 4
line: {n1}の心、{n2}知らず

## proverb depends-on-use
enabled: true
weight: 4
line: {n1}と{n2}は使いよう

## proverb beginning-of
enabled: true
weight: 4
line: {n1}は{n2}の始まり

## proverb no-match-for
enabled: true
weight: 4
line: {n1}は{n2}に如かず

## proverb stranger-than
enabled: true
weight: 4
line: {n1}は{n2}より奇なり

## proverb laugh-and-cry
enabled: true
weight: 4
line: {n1}を笑う者は{n2}に泣く

> ── 形容詞や動詞も入る型 ──
> 最後の 2 個は、名詞の無い型。

## proverb leftover-luck
enabled: true
weight: 4
line: {m1}{n1}には{n2}がある

## proverb the-more-it
enabled: true
weight: 4
line: {m1:形}{n1}ほどよく{v1:動}

## proverb nothing-more-than
enabled: true
weight: 4
line: {n1}より{m1:形}ものはない

## proverb should-quietly
enabled: true
weight: 4
line: {n1}は{a1}{v1:動}べし

## proverb wins
enabled: true
weight: 4
line: {v1:動}が勝ち

## proverb easier-done
enabled: true
weight: 4
line: {m1:動}より{v1:動}が易し

> ── 戒める（〜な、〜べからず、〜ことなかれ）──

## proverb do-not-at-sight
enabled: true
weight: 4
line: {n1}を見て{v1:動}な

## proverb do-not-before
enabled: true
weight: 4
line: {n1}の前で{v1:動}な

## proverb do-not-underrate
enabled: true
weight: 4
line: {m1}{n1}を侮るな

## proverb without-must-not
enabled: true
weight: 4
line: {n1}なき者、{v1:動}べからず

## proverb must-not-before
enabled: true
weight: 4
line: {m1}{n1}の前では{v1:動}べからず

## proverb never-upon
enabled: true
weight: 4
line: {n1}の上で{a1}{v1:動}ことなかれ

## proverb holder-must-not
enabled: true
weight: 4
line: {n1}を持つ者は{v1:動}べからず

## proverb do-not-show
enabled: true
weight: 4
line: {m1:な}{n1}に{n2}を見せるな

> ── 勧める（〜べし、〜に限る、〜に越したことなし）──

## proverb just-the-one-should
enabled: true
weight: 4
line: {m1:形}{n1}こそ{v1:動}べし

## proverb if-any-should
enabled: true
weight: 4
line: {n1}あらば{v1:動}べし

## proverb should-before
enabled: true
weight: 4
line: {n1}より先に{v1:動}べし

## proverb while-it-does
enabled: true
weight: 4
line: {n1}の{m1:動}うちに{v1:動}べし

## proverb best-when
enabled: true
weight: 4
line: {n1}は{v1:肯}に限る

## proverb nothing-better-than
enabled: true
weight: 4
line: {n1}は{a1}{m1:動}に越したことなし

## proverb while-still
enabled: true
weight: 4
line: {n1}は{m1:形}うちに{v1:動}べし

> ── 言い切る（〜なり、〜ものなり、〜ことなし、〜なし）──

## proverb by-nature
enabled: true
weight: 4
line: {n1}とは{m1:活}ものなり

## proverb quietly-by-nature
enabled: true
weight: 4
line: {m1:な}{n1}は{a1}{v1:動}ものなり

## proverb the-very-one
enabled: true
weight: 4
line: {m1}{n1}こそ{n2}なり

## proverb never-does
enabled: true
weight: 4
line: {n1}の{m1:動}ことなし

## proverb has-none
enabled: true
weight: 4
line: {m1}{n1}に{n2}なし

## proverb is-not
enabled: true
weight: 4
line: {m1}{n1}は{n2}にあらず

## proverb none-so
enabled: true
weight: 4
line: {m1:な}{n1}ほど{v1:形}ものはなし

## proverb needs-no
enabled: true
weight: 4
line: {m1:動}に{n1}は要らぬ

## proverb knows-not
enabled: true
weight: 4
line: {m1:否}{n1}は{n2}を知らず

## proverb even-it-may
enabled: true
weight: 4
line: {n1}も{a1}{v1:動}ことあり

## proverb once-done
enabled: true
weight: 4
line: {m1:過}{n1}は{v1:否}

> ── くらべる、ならべる ──
> 最後の 2 個は、名詞の無い型。

## proverb rather-than-modified
enabled: true
weight: 4
line: {m1}{n1}より{m2}{n2}

## proverb quiet-with-lively
enabled: true
weight: 4
line: {m1:な}{n1}に{m2:な}{n2}

## proverb yet-more
enabled: true
weight: 4
line: {n1}は{m1:形}が、{n2}はなお{v1:形}

## proverb even-though
enabled: true
weight: 4
line: {n1}は{m1:動}とも、{n2}は{v1:否}

## proverb when-it-does
enabled: true
weight: 4
line: {n1}の{m1:動}時、{n2}も{v1:動}

## proverb the-quieter
enabled: true
weight: 4
line: {m1:な}{n1}ほど{a1}{v1:動}

## proverb easy-and-hard
enabled: true
weight: 4
line: {m1:動}は易く、{v1:動}は難し

## proverb no-match-for-not
enabled: true
weight: 4
line: {m1:動}は{v1:否}に如かず

> ── 動詞を名詞のように使う ──

## proverb doing-is-beginning
enabled: true
weight: 4
line: {m1:動}は{n1}の始まり

## proverb virtue-of
enabled: true
weight: 4
line: {a1}{m1:動}は{n1}の徳

## proverb quiet-walker-lacks
enabled: true
weight: 4
line: {a1}{m1:動}{n1}に{n2}なし

> ── 元ネタはあるが、動詞も可変にしたもの ──

## proverb chooses-not
enabled: true
weight: 4
line: {m1:動}{n1}は{n2}を選ばず

## proverb comes-to
enabled: true
weight: 4
line: {m1:動}{n1}に{n2}来たる

> ━━ 解説（gloss） ━━
>
> {n1} や {v1} は、ことわざの語。+ の付いた穴は、解説だけの新しい語。

> ── いまある型（6 個。id は変えない）──

## gloss misplaced-purpose
enabled: true
weight: 4
line: {n1}が{n2}において{+n1}を{+v1:動}ことのたとえ。

## gloss eventual-sameness
enabled: true
weight: 4
line: {n1}と{n2}は、いずれ{+n1}になるという戒め。

## gloss even-so
enabled: true
weight: 4
line: {n1}でさえ{v1}のだから、{+n1}はなおさらであるということ。

## gloss only-measure
enabled: true
weight: 4
line: {n1}の{n2}は、{n3}によってしか測れないということ。

## gloss powerless-before
enabled: true
weight: 4
line: どれほどの{n2}も、{+n1}のまえでは{+v1:否}ということ。

## gloss mistaken-belief
enabled: true
weight: 4
line: {n1}を{+m1}ものと思い込むと、かえって{+n1}を失うという教え。

> ── {n1} だけを使う解説（名詞のあることわざなら、どれにも付く）──

## gloss always-has
enabled: true
weight: 4
line: どんな{n1}にも、かならず{+n1}がある、の意。

## gloss only-chasing
enabled: true
weight: 4
line: {n1}ばかりを{+v1:動}者は、やがて{+n1}を失うという戒め。

## gloss unexpectedly
enabled: true
weight: 4
line: {n1}は、思いのほか{+v1:形}というたとえ。

## gloss smoothly
enabled: true
weight: 4
line: {n1}が{+a1}{+v1:動}さま。転じて、物事がうまく運ぶこと。

## gloss once-meant
enabled: true
weight: 4
line: もとは{+n1}の{+n2}を指した言葉。今では{n1}にもいう。

## gloss over-reliance
enabled: true
weight: 4
line: {n1}に頼りすぎると、{+n1}まで{+v1:動}ことになるという戒め。

## gloss check-first
enabled: true
weight: 4
line: {n1}を{+v1:動}前に、まず{+n1}を確かめよという教え。

## gloss without-is-same
enabled: true
weight: 4
line: {n1}のない{+n1}は、{+n2}のない{+n3}に等しい、の意。

> ── {n1} と {n2} を使う解説 ──

## gloss do-not-confuse
enabled: true
weight: 4
line: {n1}と{n2}を取り違えてはならないという戒め。

## gloss even-with
enabled: true
weight: 4
line: {n1}があっても、{n2}がなければ{+n1}は{+v1:否}ことをいう。

## gloss far-more
enabled: true
weight: 4
line: {n1}よりも{n2}のほうが、よほど{+v1:形}、の意。

## gloss seek-first
enabled: true
weight: 4
line: {n1}を求める者は、まず{n2}を{+v1:動}べきだという教え。

## gloss same-before
enabled: true
weight: 4
line: {n1}も{n2}も、{+n1}の前では同じである、というたとえ。

## gloss mistaken-for
enabled: true
weight: 4
line: {n1}を{n2}と思って{+v1:動}と、ひどい目にあうという戒め。

## gloss born-and-returns
enabled: true
weight: 4
line: {n1}は{n2}から生まれ、やがて{+n1}へ帰ることをいう。

## gloss ask-the-other
enabled: true
weight: 4
line: {n1}のことは{n2}に聞けというたとえ。

## gloss old-story
enabled: true
weight: 4
line: 昔、{+n1}が{n1}を{n2}と見まちがえたという故事から。

## gloss in-order
enabled: true
weight: 4
line: {n1}が{n2}を{+v1:動}ように、物事には順序がある、のたとえ。

## gloss indistinct
enabled: true
weight: 4
line: {n1}と{n2}の区別がつかないほど、{+n1}が{+v1:形}さま。

> ── そのほか ──
> {v1} だけを使う 4 個は、名詞の無いことわざにも付く。

## gloss even-it-can
enabled: true
weight: 4
line: {n1}でも{v1}ことがあるのだから、油断するなという戒め。

## gloss likewise-has
enabled: true
weight: 4
line: {n1}に{n2}があるように、{n3}にも{+n1}がある、の意。

## gloss same-as-doing
enabled: true
weight: 4
line: {v1}ことは、{+n1}を{+v1:動}ことに等しいという教え。

## gloss seems-to
enabled: true
weight: 4
line: {v1}者には、{+n1}が{+n2}に見えるさま。

## gloss think-of-when
enabled: true
weight: 4
line: {v1}ときこそ、{+n1}を思えという教え。

## gloss thanks-to
enabled: true
weight: 4
line: {v1}のも、{+n1}あってのことである、の意。

## gloss in-turn
enabled: true
weight: 4
line: {n1}、{n2}、{n3}の順に{+v1:動}のがよいという教え。

> ━━ profile（穴に入る語の形の組） ━━
>
> 各 profile の前の注記は、穴の書き方と、入る形です。
> tag の無いものが、その種類の既定です。

> {n1} … 名詞

## profile plain-noun
kind: noun
form: independent-noun 1

> {m1} … 形容詞、動詞（基本、過去、否定）、「静かな」

## profile plain-modifier
kind: modifier
form: adjective-basic 3
form: verb-basic 2
form: verb-past 1
form: verb-negative 1
form: na-stem-na 2

> {m1:動} … 動詞の基本の形だけ

## profile action-modifier
kind: modifier
tag: 動
form: verb-basic 1

> {v1} … 動詞の基本の形か、否定

## profile plain-predicate
kind: predicate
form: verb-basic 3
form: verb-negative 1

> {v1:動} … 動詞の基本の形だけ

## profile action-predicate
kind: predicate
tag: 動
form: verb-basic 1

> {v1:否} … 動詞の否定だけ

## profile denial-predicate
kind: predicate
tag: 否
form: verb-negative 1

> {m1:形} … 形容詞だけ

## profile adjective-modifier
kind: modifier
tag: 形
form: adjective-basic 1

> {m1:否} … 動詞の否定だけ

## profile denial-modifier
kind: modifier
tag: 否
form: verb-negative 1

> {m1:過} … 動詞の過去だけ

## profile past-modifier
kind: modifier
tag: 過
form: verb-past 1

> {m1:な} … 「静かな」の形だけ

## profile na-modifier
kind: modifier
tag: な
form: na-stem-na 1

> {m1:活} … 形容詞か、動詞の基本の形、否定（「静かな」は入らない）

## profile inflected-modifier
kind: modifier
tag: 活
form: adjective-basic 3
form: verb-basic 2
form: verb-negative 1

> {v1:形} … 形容詞だけ

## profile adjective-predicate
kind: predicate
tag: 形
form: adjective-basic 1

> {v1:肯} … 形容詞か、動詞の基本の形

## profile affirmative-predicate
kind: predicate
tag: 肯
form: adjective-basic 1
form: verb-basic 1

> {a1} … 「静かに」の形

## profile plain-adverbial
kind: adverbial
form: na-stem-ni 1
