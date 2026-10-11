# Semantropy standard Fake Dictionary templates

> ■ 1. このファイルについて
>
> でたらめ辞書の「定義の文」の型（テンプレート）を決めるファイルです。
> 人が書き換えるのは、このファイルだけです。
>
>   core   … 定義の本体（data-version 2 では 108 個。30 の系統に分かれています）
>   clause … 本体の後ろに足す句（同じく 31 個）
>
> plugin は、動いているあいだ、このファイルを読みません。build のときに
> だけ読み、plugin に入れるデータ
> （src/dictionary/generated/standardTemplateEntries.ts）を作ります。
> 作られたデータのほうは、手で書き換えません。
>
> 「> 」で始まる行は、この説明のような注記です。plugin には入りません。
> 自由に書き足せます（「>」の次に、半角の空白を 1 つ置きます）。
>
> ■ 2. 編集の手順
>
> 1) このファイルを書き換える。
> 2) 下の data-version の数を 1 つ上げる（2 なら 3）。
>    上げるのは、項目を足した、消した、文を 1 字でも変えた（句読点も
>    含む）、family や category を変えた、id を変えた、のどれかのとき
>    です。注記だけを変えたときは、上げません。
>    data-version を上げると、すべての語の定義が引き直されます。
>    このファイルには、上げ忘れを止める仕組みがありません。忘れずに
>    上げてください。
> 3) npm run generate:templates を実行する。
>    成功すると、core と clause の数が表示されます。
>    書き方に誤りがあると、何も書き換えずに止まり、誤りの種類と、
>    行の番号（line 123）か id が表示されます。
> 4) npm run build を実行する。main.js が作り直されます。
>    3) を忘れていると、build は「npm run generate:templates を実行
>    せよ」という意味の英語を出して止まります。
> 5) Obsidian で Semantropy を無効にしてから有効にし、でたらめ辞書で
>    いくつかの語を引いて、文を確かめる。
>
> npm test は、いまの項目の数と、決まった語の定義を覚えています。
> 項目を変えると、いくつかの test が失敗します。書き間違いとは限らず、
> 変えたことの印です。実装担当に伝えて、覚えている値を取り直して
> もらってください。
>
> ■ 3. 書式
>
> 本体（core）の 1 項目は、次の形です。「（空行）」と書いたところは、
> 何も書かない行です。
>
>     ## core dialect-01
>     family: dialect
>     （空行）
>     {{place}}地方で、{{noun}}をいう語。
>
>   1 行目  「## core 」の後ろに、id を書く。
>           「##」「core」「id」のあいだは、半角の空白を 1 つずつ。
>   2 行目  「family: 」の後ろに、系統の名前を書く。
>           「:」の後ろは、半角の空白を 1 つ。
>   3 行目  空行を 1 つ。
>   4 行目  定義の文。かならず 1 行で書く。
>           {{ }} で囲んだところが「穴」で、語彙の語が入る。
>
> 後ろに足す句（clause）は、core を clause に、family を category に
> 変えた形です。
>
>     ## clause optional-region-01
>     category: region
>     （空行）
>     特に{{place}}地方に多い。
>
> 項目と項目のあいだは、空行で区切ります。
>
> ● family に書ける値（30 個。これ以外は build が止まります）
>
>   classification 分類       instrument 道具        action 動作
>   state 状態                quality 性質           person 人物
>   place 土地                organism 生物          medical 医学
>   institution 制度          custom 風習            food 食べ物
>   academic 学術の現象       theory 学説            etymology 語源
>   archaic 古語              dialect 方言           slang 俗語
>   figurative 比喩           idiom たとえ           technical 装置
>   measure 単位              calendar 暦と時期      ritual 儀礼
>   culture 作品              history 出来事         causal 原因と結果
>   method 方法               organization 組織      uncertain 不詳
>
>   定義を作るときは、まず系統を 1 つ選び、次にその系統の中から
>   テンプレートを 1 つ選びます（系統の中では、どれも同じ確率）。
>   1 つの系統に項目を増やしても、その系統が出やすくはなりません。
>   見出し語が人名、地名、組織の名前で、でたらめ辞書の Semantropy 値が
>   低か中のときは、person、place、organization の系統が出やすく
>   なります。
>   系統そのものを足すことは、このファイルではできません（プログラムの
>   変更が要ります）。
>
> ● category に書ける値（6 個）
>
>   etymology 語源    history 歴史    region 地域
>   usage 用法        alternative-theory 異説
>   authority 断り書き（はっきりしない、範囲の断り）
>
>   category は、句を整理するための名前です。抽選には使いません
>   （使える句の中から、どれも同じ確率で選びます）。
>
> ● 穴に書ける名前（11 個。これ以外は build が止まります）
>
>   {{noun}}           一般の名詞（猫、封筒）
>   {{proper}}         固有名詞のうち、人名、地名、組織でないもの
>   {{person}}         人名
>   {{place}}          地名
>   {{organization}}   組織の名前
>   {{sahen}}          「する」が付く名詞（観察、移動）。
>                      「する」「した」は、文の側に書く
>   {{adverbialNoun}}  副詞のようにも使う名詞。多くは時を表す
>                      （今日、昔、夜）
>   {{number}}         数（三、百）
>   {{verb}}           動詞の基本の形（歩く）
>   {{iAdjective}}     イ形容詞の基本の形（白い）
>   {{naStem}}         形容動詞の語幹（静か）。
>                      「な」「に」「である」は、文の側に書く
>
>   同じ名前の穴を 2 回書くと、別々の語が入ります。
>   見出し語を入れる穴は、ありません。
>   語彙に、その穴に入る語が 1 つも無いテンプレートは、使われません。
>
> ■ 4. 決まり（守らないと build が止まるもの）
>
> ● 行の書き方
>   ・項目の行は、見出し（## …）、field（family: …）、文のどれかです。
>     それ以外の行は、読み飛ばされずに、誤りになります。
>   ・field と文のあいだの空行は、省けません。
>   ・文は 1 行だけです。2 行目を書くと、誤りになります。
>   ・文の前後に、空白を置けません。
>
> ● 穴
>   ○ {{noun}}の一種。
>   × {{猫}}の一種。        （一覧に無い名前）
>   × {{Noun}}の一種。      （大文字と小文字は区別します）
>   × {{noun}の一種。       （閉じ忘れ）
>   × {{}}の一種。          （名前が無い）
>
> ● id
>   半角の英小文字と数字を、ハイフンでつないで書きます。
>   core と clause を通して、同じ id は 1 回しか使えません。
>   ○ dialect-04、optional-usage-06
>   × Dialect-04（大文字）、dialect_04（下線）、dialect 04（空白）、
>     方言-04（日本語）
>
> ● {{verb}}、{{iAdjective}}、{{naStem}} の直後
>   この 3 つは形を変えられないので、直後に置けるものが決まっています。
>   また、文の最後には置けません（後ろに句が足されることがあるため）。
>
>   {{verb}} と {{iAdjective}}（基本の形）の直後に置けるもの
>     ア) 名詞の穴（{{noun}} から {{number}} までの 8 個）
>     イ) 漢字かカタカナで始まる語
>     ウ) こと、もの、ところ、ため、はず、わけ、ほう、とき、さま。
>         その次は、が を に は も で の と か だ や へ 、 。 のどれか
>     エ) と、 という とされ ように ような ようだ だけ 、 。
>         {{verb}} は、このほかに、まで、べき
>     ○ {{verb}}ために用いる{{noun}}。
>     ○ {{noun}}を{{verb}}こと。
>     ○ {{iAdjective}}{{noun}}の一種。
>     ○ {{verb}}とされる{{noun}}の風習。
>     × {{verb}}ます。 {{verb}}た。 {{verb}}て、 {{verb}}ない。
>       （基本の形には付かない）
>     × {{iAdjective}}かった。 {{iAdjective}}くて、 {{iAdjective}}さ
>     × {{noun}}を{{verb}}        （文の最後）
>
>   {{naStem}}（語幹）の直後に置けるもの
>     ア) 「な」と、名詞（名詞の穴、漢字かカタカナで始まる語、上のウ）
>     イ) 「に」
>     ウ) 「さ」と、が を に は も で の と か だ や へ 、 。 のどれか
>     エ) だ。 だ、 だった だとされ である であり でない で、 すぎ
>         、 。
>     ○ {{naStem}}な様子。
>     ○ {{naStem}}な{{noun}}
>     ○ {{naStem}}に{{verb}}習性がある。
>     ○ {{noun}}の{{naStem}}さの度合い
>     ○ 詳細は{{naStem}}でない。
>     × {{naStem}}{{noun}}        （「な」が無い）
>     × {{naStem}}なる            （「な」の次が名詞でない）
>     × {{naStem}}です。          （一覧に無い）
>
>   この確認は、よくある間違いを止めるためのもので、文法を完全に
>   確かめるものではありません。穴の前の文字（を、に、など）は
>   確かめません。足した文には、いくつかの語を入れて読んでみて
>   ください。
>
> ● 文に使える字
>   字の種類と長さに、決まりはありません。ただし、「{{」は穴の始まり
>   として読まれるので、文の中には書けません。
>
> ■ 5. id を変えてはいけない理由
>
>   ・test が覚えている値と、開発の記録が、id で項目を指しています。
>   ・収集のときに plugin の中で作る記録にも、使ったテンプレートの id が
>     入ります（いまの版は、収集先のファイルには書き出しません）。
>   ・定義を選ぶとき、テンプレートを id の順に並べてから引きます。
>     ファイルの中の順番は、結果に関係しません。
>   いまある id は、そのままにしてください。新しい項目には、新しい id を
>   付けます（系統の名前と連番。例: dialect-04）。消した項目の id を、
>   別の文に使い回さないでください。

schema-version: 2
data-version: 2

> ━━ 本体（core）━━
>
> 系統ごとに並べてあります。data-version 2 では、どの系統にも 3 個あり、
> 18 の系統には、{{verb}}、{{iAdjective}}、{{naStem}} を使う 4 個目が
> あります。

> ── classification（分類）──

## core classification-01
family: classification

{{noun}}の一種。主として{{place}}に見られ、{{noun}}を特徴とする。

## core classification-02
family: classification

{{noun}}に属する{{noun}}。一般に{{noun}}を伴うものをいう。

## core classification-03
family: classification

{{noun}}のうち、特に{{sahen}}するものの総称。

## core classification-04
family: classification

{{iAdjective}}{{noun}}の一種。特に{{noun}}に見られるものをいう。

> ── instrument（道具）──

## core instrument-01
family: instrument

{{noun}}を{{sahen}}するために用いる{{noun}}。主として{{place}}で使用される。

## core instrument-02
family: instrument

{{sahen}}する際に使用する{{noun}}の一種。ふつう{{noun}}と併用する。

## core instrument-03
family: instrument

{{noun}}に用いる{{noun}}。特に{{noun}}を{{sahen}}する場合にいう。

## core instrument-04
family: instrument

{{verb}}ために用いる{{noun}}。主として{{place}}で使用される。

> ── action（動作）──

## core action-01
family: action

{{noun}}を{{sahen}}すること。また、その行為。

## core action-02
family: action

{{sahen}}すること。特に{{noun}}について行う場合をいう。

## core action-03
family: action

{{noun}}に際して{{sahen}}すること。また、そのために行われる一連の行為。

## core action-04
family: action

{{noun}}を{{verb}}こと。また、その動作。

> ── state（状態）──

## core state-01
family: state

{{noun}}に{{noun}}が生じた状態。また、そのような状態にあること。

## core state-02
family: state

{{sahen}}することによって生じる{{noun}}。特に{{noun}}についていう。

## core state-03
family: state

{{noun}}に見られる状態の一つ。一般に{{noun}}を伴う。

## core state-04
family: state

{{noun}}が{{naStem}}になった状態。また、そのような状態にあること。

> ── quality（性質）──

## core quality-01
family: quality

{{noun}}に特有の性質。特に{{noun}}についていう。

## core quality-02
family: quality

{{noun}}を思わせるような性質をもつこと。

## core quality-03
family: quality

{{sahen}}する傾向が著しいこと。また、そのような性質。

## core quality-04
family: quality

{{naStem}}な性質。また、{{noun}}が{{naStem}}であること。

> ── person（人物）──
> 見出し語が人名のとき、出やすくなる系統

## core person-01
family: person

{{place}}の{{noun}}。{{noun}}を{{sahen}}したことで知られる。

## core person-02
family: person

{{adverbialNoun}}ごろの{{noun}}。{{place}}で{{noun}}に従事したとされる。

## core person-03
family: person

{{noun}}に関係した人物。{{noun}}を初めて{{sahen}}したことで知られる。

## core person-04
family: person

{{verb}}ことを生業とする人。多く{{naStem}}な人柄で知られる。

> ── place（土地）──
> 見出し語が地名のとき、出やすくなる系統

## core place-01
family: place

{{place}}にある{{noun}}。古くから{{noun}}で知られる。

## core place-02
family: place

{{place}}地方の一地域。主として{{noun}}が{{sahen}}することで知られる。

## core place-03
family: place

{{noun}}に用いられる地名。現在の{{place}}付近にあたるとされる。

## core place-04
family: place

{{iAdjective}}{{noun}}が多く見られる土地。

> ── organism（生物）──

## core organism-01
family: organism

{{noun}}の一種。主として{{place}}に生息し、{{noun}}を主な餌とする。

## core organism-02
family: organism

{{place}}などに見られる{{noun}}。{{adverbialNoun}}に{{sahen}}することが多い。

## core organism-03
family: organism

{{noun}}の仲間。ふつう{{adverbialNoun}}に活動し、{{noun}}を摂取する。

## core organism-04
family: organism

{{iAdjective}}{{noun}}を好む生物。{{naStem}}に{{verb}}習性がある。

> ── medical（医学）──

## core medical-01
family: medical

{{noun}}に生じる{{noun}}。主として{{noun}}によって起こる。

## core medical-02
family: medical

{{noun}}を特徴とする状態。しばしば{{noun}}を伴う。

## core medical-03
family: medical

{{sahen}}した際に見られる{{noun}}。通常は自然に消失する。

> ── institution（制度）──

## core institution-01
family: institution

{{noun}}について定められた制度。原則として{{noun}}を対象とする。

## core institution-02
family: institution

{{noun}}を{{sahen}}するために設けられた仕組み。{{place}}では古くから行われていた。

## core institution-03
family: institution

{{noun}}に関する規定。また、その規定に基づいて行われる{{sahen}}。

> ── custom（風習）──

## core custom-01
family: custom

{{place}}に伝わる習俗。{{adverbialNoun}}に{{noun}}を{{sahen}}することをいう。

## core custom-02
family: custom

主として{{place}}で行われた慣習。{{noun}}の際に{{noun}}を用いる。

## core custom-03
family: custom

{{noun}}に関する古い風習。一般に{{number}}人で行うものとされる。

## core custom-04
family: custom

{{verb}}とされる{{noun}}の風習。

> ── food（食べ物）──

## core food-01
family: food

{{noun}}を主材料とする{{noun}}。主に{{place}}で作られる。

## core food-02
family: food

{{noun}}を{{sahen}}して作る食品。{{adverbialNoun}}に食べることが多い。

## core food-03
family: food

{{place}}地方の料理。{{noun}}に{{noun}}を加えて作る。

## core food-04
family: food

{{iAdjective}}味のする{{noun}}。{{naStem}}な食感をもつ。

> ── academic（学術の現象）──

## core academic-01
family: academic

{{noun}}に伴って生じる現象。{{person}}によって初めて報告された。

## core academic-02
family: academic

{{noun}}が{{sahen}}する際に見られる現象。一般に{{noun}}との関連が指摘される。

## core academic-03
family: academic

{{noun}}において認められる現象の一つ。{{noun}}によって生じると考えられている。

> ── theory（学説）──

## core theory-01
family: theory

{{noun}}を{{noun}}によって説明しようとする説。{{person}}によって提唱された。

## core theory-02
family: theory

{{noun}}は{{noun}}から生じるとする考え。現在では主に{{noun}}の分野で用いられる。

## core theory-03
family: theory

{{noun}}と{{noun}}との関係を説明するための理論。{{person}}によって広められたとされる。

## core theory-04
family: theory

{{noun}}は本来{{naStem}}なものであるとする説。

> ── etymology（語源）──

## core etymology-01
family: etymology

もとは{{noun}}を意味した語。のちに{{noun}}の意に転じた。

## core etymology-02
family: etymology

{{place}}で用いられた{{noun}}に由来するとされる語。

## core etymology-03
family: etymology

{{noun}}を意味する古い語から転じたもの。語源については異説がある。

> ── archaic（古語）──

## core archaic-01
family: archaic

古く、{{noun}}を指していった語。現在ではほとんど用いられない。

## core archaic-02
family: archaic

かつて用いられた語。主として{{noun}}の意味で使われた。

## core archaic-03
family: archaic

古く{{place}}地方で{{noun}}を指した語。のちに{{noun}}の意味にも用いられた。

> ── dialect（方言）──

## core dialect-01
family: dialect

{{place}}地方で、{{noun}}をいう語。

## core dialect-02
family: dialect

主として{{place}}で用いられる語。{{noun}}の意。

## core dialect-03
family: dialect

{{noun}}を意味する{{place}}地方の語。特に{{noun}}について用いる。

> ── slang（俗語）──

## core slang-01
family: slang

{{noun}}の俗称。特に{{noun}}についていう。

## core slang-02
family: slang

俗に、{{noun}}を{{sahen}}する人をいう。

## core slang-03
family: slang

{{noun}}を指す俗語。もとは{{place}}で用いられたという。

## core slang-04
family: slang

{{iAdjective}}ことの俗な言い方。

> ── figurative（比喩）──

## core figurative-01
family: figurative

もとは{{noun}}をいう語。転じて、{{sahen}}する人についていう。

## core figurative-02
family: figurative

{{noun}}の意から転じて、{{noun}}の状態をいう。

## core figurative-03
family: figurative

本来は{{noun}}を指すが、比喩的に{{noun}}の意味にも用いる。

## core figurative-04
family: figurative

{{iAdjective}}{{noun}}のたとえ。

> ── idiom（たとえ）──

## core idiom-01
family: idiom

{{noun}}が{{sahen}}することのたとえ。

## core idiom-02
family: idiom

{{noun}}のように{{sahen}}すること。転じて、{{noun}}の状態をいう。

## core idiom-03
family: idiom

{{noun}}を{{sahen}}するところから、{{noun}}をいう。

## core idiom-04
family: idiom

{{noun}}を{{verb}}ことから、{{naStem}}なさまのたとえ。

> ── technical（装置）──

## core technical-01
family: technical

{{noun}}を{{sahen}}するための装置。主として{{noun}}に用いる。

## core technical-02
family: technical

{{noun}}に取り付け、{{noun}}を{{sahen}}する機器。

## core technical-03
family: technical

{{noun}}を利用して{{noun}}を{{sahen}}する装置。{{place}}などで使用される。

## core technical-04
family: technical

{{noun}}を{{iAdjective}}状態に保つための{{noun}}。

> ── measure（単位）──

## core measure-01
family: measure

{{noun}}の程度を表す単位。{{number}}を基準とする。

## core measure-02
family: measure

{{noun}}を測るために用いる尺度。{{number}}を一単位とする。

## core measure-03
family: measure

{{noun}}の大きさを示す単位。主として{{noun}}について用いる。

## core measure-04
family: measure

{{noun}}の{{naStem}}さの度合いを表す単位。

> ── calendar（暦と時期）──

## core calendar-01
family: calendar

{{adverbialNoun}}のうち、{{noun}}が{{sahen}}する時期をいう。

## core calendar-02
family: calendar

{{noun}}を基準として定められた期間。およそ{{number}}日間にあたる。

## core calendar-03
family: calendar

古く{{place}}で用いられた時期の区分。{{noun}}のころを指す。

> ── ritual（儀礼）──

## core ritual-01
family: ritual

{{noun}}を{{sahen}}するために行われる儀礼。主として{{adverbialNoun}}に行う。

## core ritual-02
family: ritual

{{place}}に伝わる儀式。{{noun}}を{{number}}個用いることを特徴とする。

## core ritual-03
family: ritual

{{noun}}に際して行う儀礼の一つ。古くは{{noun}}を{{sahen}}したという。

> ── culture（作品）──

## core culture-01
family: culture

{{person}}による{{noun}}。{{noun}}を題材とする。

## core culture-02
family: culture

{{place}}を舞台とする{{noun}}。{{noun}}を題材としている。

## core culture-03
family: culture

{{noun}}を題材とした作品。{{person}}が{{sahen}}したものとされる。

> ── history（出来事）──

## core history-01
family: history

{{adverbialNoun}}、{{place}}で起こった{{noun}}。{{noun}}を契機として始まった。

## core history-02
family: history

{{place}}における{{noun}}をめぐる出来事。{{person}}が{{sahen}}したことで知られる。

## core history-03
family: history

{{noun}}に関して起こった一連の出来事。のちの{{noun}}に大きな影響を与えた。

> ── causal（原因と結果）──

## core causal-01
family: causal

{{noun}}によって生じる{{noun}}。{{noun}}を伴うことが多い。

## core causal-02
family: causal

{{noun}}が{{sahen}}することによって起こる現象。

## core causal-03
family: causal

{{noun}}を原因として生じる{{noun}}の総称。

> ── method（方法）──

## core method-01
family: method

{{noun}}を{{sahen}}するための方法。主として{{noun}}に用いる。

## core method-02
family: method

{{noun}}を利用して{{sahen}}する技法。{{person}}によって考案されたとされる。

## core method-03
family: method

{{noun}}において行われる方法の一つ。{{noun}}を{{number}}回{{sahen}}する。

## core method-04
family: method

{{noun}}を{{naStem}}に{{sahen}}する方法。

> ── organization（組織）──
> 見出し語が組織の名前のとき、出やすくなる系統

## core organization-01
family: organization

{{noun}}を目的として設けられた組織。主として{{place}}で活動する。

## core organization-02
family: organization

{{noun}}に関係する人々によって構成される団体。

## core organization-03
family: organization

{{person}}らによって結成された{{noun}}。{{noun}}を{{sahen}}することを目的とする。

> ── uncertain（不詳）──

## core uncertain-01
family: uncertain

{{noun}}の一種とされるが、詳しいことは分かっていない。

## core uncertain-02
family: uncertain

一般には{{noun}}を指すとされる。語義については諸説がある。

## core uncertain-03
family: uncertain

{{noun}}に由来するとされるが、確かなことは不明である。

## core uncertain-04
family: uncertain

{{noun}}を{{verb}}ものとされるが、詳細は{{naStem}}でない。

> ━━ 後ろに足す句（clause）━━
>
> 本体がどの系統でも、後ろに付く句です。どの本体の後ろに来ても
> 読める文にします。

> ── etymology（語源）──

## clause optional-etymology-01
category: etymology

名称は{{place}}の地名に由来するという。

## clause optional-etymology-02
category: etymology

名称の由来は明らかでない。

## clause optional-etymology-03
category: etymology

{{person}}の名にちなむとされる。

## clause optional-etymology-04
category: etymology

語源については諸説がある。

## clause optional-etymology-05
category: etymology

古くは{{noun}}とも呼ばれた。

> ── history（歴史）──

## clause optional-history-01
category: history

かつては広く用いられていた。

## clause optional-history-02
category: history

古くは{{place}}を中心に行われた。

## clause optional-history-03
category: history

現在ではほとんど見られない。

## clause optional-history-04
category: history

のちに次第に用いられなくなった。

## clause optional-history-05
category: history

当初は{{noun}}に限って用いられた。

> ── region（地域）──

## clause optional-region-01
category: region

特に{{place}}地方に多い。

## clause optional-region-02
category: region

{{place}}では{{noun}}ともいう。

## clause optional-region-03
category: region

地域によっては{{noun}}を指すこともある。

## clause optional-region-04
category: region

{{place}}以外ではほとんど用いられない。

> ── usage（用法）──

## clause optional-usage-01
category: usage

ふつう{{noun}}については用いない。

## clause optional-usage-02
category: usage

特に{{noun}}の場合についていう。

## clause optional-usage-03
category: usage

まれに{{noun}}の意味にも用いる。

## clause optional-usage-04
category: usage

現在では比喩的に用いられることが多い。

## clause optional-usage-05
category: usage

単に{{noun}}ともいう。

> ── alternative-theory（異説）──

## clause optional-alternative-theory-01
category: alternative-theory

ただし、{{noun}}との関係を指摘する説もある。

## clause optional-alternative-theory-02
category: alternative-theory

一説には{{noun}}に由来するという。

## clause optional-alternative-theory-03
category: alternative-theory

かつては{{noun}}の一種と考えられていた。

## clause optional-alternative-theory-04
category: alternative-theory

この説については現在では否定的な見方が多い。

## clause optional-alternative-theory-05
category: alternative-theory

{{person}}はこれを{{noun}}の一種としている。

## clause optional-alternative-theory-06
category: alternative-theory

これとは別に、{{noun}}を起源とする説もある。

> ── authority（断り書き（はっきりしない、範囲の断り））──

## clause optional-authority-01
category: authority

詳細については明らかでない。

## clause optional-authority-02
category: authority

正確な起源は分かっていない。

## clause optional-authority-03
category: authority

その理由については定説がない。

## clause optional-authority-04
category: authority

今日ではこの区別を設けないことも多い。

## clause optional-authority-05
category: authority

狭義には{{noun}}のみを指す。

## clause optional-authority-06
category: authority

広義には{{noun}}を含めていうこともある。
