# Semantropy standard Fake Dictionary templates

> This document is the one place these templates are edited by hand.
> A build parses it, validates it and generates the typed data the plugin
> bundles; nothing reads this file at runtime.
>
> Format, one entry at a time:
>
>     ## core <id>
>     family: <one of the families below>
>     <blank line>
>     <the template, on exactly one line>
>
> and for a supplementary sentence:
>
>     ## clause <id>
>     category: <one of the categories below>
>     <blank line>
>     <the sentence, on exactly one line>
>
> Lines starting with `>` are notes and are ignored. Every other line has to
> be a heading, a field or a body: an unrecognised line fails the build
> rather than being skipped. Bodies are taken exactly as written, so leading
> or trailing spaces are refused instead of being trimmed away.
>
> Placeholders are written `{{name}}` and must be one of: noun, proper,
> person, place, organization, sahen, adverbialNoun, number.
>
> Ids are lowercase kebab-case and are recorded in Collected definitions:
> never renumber or rename an existing one.
>
> Raising `data-version` is required whenever an entry is added, removed,
> reworded or re-punctuated, because that changes what every existing
> definition would generate.

schema-version: 1
data-version: 1

> Families, in the order the set uses them:
> classification, instrument, action, state, quality, person, place, organism, medical, institution, custom, food, academic, theory, etymology, archaic, dialect, slang, figurative, idiom, technical, measure, calendar, ritual, culture, history, causal, method, organization, uncertain.
>
> Optional Clause categories:
> etymology, history, region, usage, alternative-theory, authority.

> The 90 core templates: 30 families of three.

> classification

## core classification-01
family: classification

{{noun}}の一種。主として{{place}}に見られ、{{noun}}を特徴とする。

## core classification-02
family: classification

{{noun}}に属する{{noun}}。一般に{{noun}}を伴うものをいう。

## core classification-03
family: classification

{{noun}}のうち、特に{{sahen}}するものの総称。

> instrument

## core instrument-01
family: instrument

{{noun}}を{{sahen}}するために用いる{{noun}}。主として{{place}}で使用される。

## core instrument-02
family: instrument

{{sahen}}する際に使用する{{noun}}の一種。ふつう{{noun}}と併用する。

## core instrument-03
family: instrument

{{noun}}に用いる{{noun}}。特に{{noun}}を{{sahen}}する場合にいう。

> action

## core action-01
family: action

{{noun}}を{{sahen}}すること。また、その行為。

## core action-02
family: action

{{sahen}}すること。特に{{noun}}について行う場合をいう。

## core action-03
family: action

{{noun}}に際して{{sahen}}すること。また、そのために行われる一連の行為。

> state

## core state-01
family: state

{{noun}}に{{noun}}が生じた状態。また、そのような状態にあること。

## core state-02
family: state

{{sahen}}することによって生じる{{noun}}。特に{{noun}}についていう。

## core state-03
family: state

{{noun}}に見られる状態の一つ。一般に{{noun}}を伴う。

> quality

## core quality-01
family: quality

{{noun}}に特有の性質。特に{{noun}}についていう。

## core quality-02
family: quality

{{noun}}を思わせるような性質をもつこと。

## core quality-03
family: quality

{{sahen}}する傾向が著しいこと。また、そのような性質。

> person

## core person-01
family: person

{{place}}の{{noun}}。{{noun}}を{{sahen}}したことで知られる。

## core person-02
family: person

{{adverbialNoun}}ごろの{{noun}}。{{place}}で{{noun}}に従事したとされる。

## core person-03
family: person

{{noun}}に関係した人物。{{noun}}を初めて{{sahen}}したことで知られる。

> place

## core place-01
family: place

{{place}}にある{{noun}}。古くから{{noun}}で知られる。

## core place-02
family: place

{{place}}地方の一地域。主として{{noun}}が{{sahen}}することで知られる。

## core place-03
family: place

{{noun}}に用いられる地名。現在の{{place}}付近にあたるとされる。

> organism

## core organism-01
family: organism

{{noun}}の一種。主として{{place}}に生息し、{{noun}}を主な餌とする。

## core organism-02
family: organism

{{place}}などに見られる{{noun}}。{{adverbialNoun}}に{{sahen}}することが多い。

## core organism-03
family: organism

{{noun}}の仲間。ふつう{{adverbialNoun}}に活動し、{{noun}}を摂取する。

> medical

## core medical-01
family: medical

{{noun}}に生じる{{noun}}。主として{{noun}}によって起こる。

## core medical-02
family: medical

{{noun}}を特徴とする状態。しばしば{{noun}}を伴う。

## core medical-03
family: medical

{{sahen}}した際に見られる{{noun}}。通常は自然に消失する。

> institution

## core institution-01
family: institution

{{noun}}について定められた制度。原則として{{noun}}を対象とする。

## core institution-02
family: institution

{{noun}}を{{sahen}}するために設けられた仕組み。{{place}}では古くから行われていた。

## core institution-03
family: institution

{{noun}}に関する規定。また、その規定に基づいて行われる{{sahen}}。

> custom

## core custom-01
family: custom

{{place}}に伝わる習俗。{{adverbialNoun}}に{{noun}}を{{sahen}}することをいう。

## core custom-02
family: custom

主として{{place}}で行われた慣習。{{noun}}の際に{{noun}}を用いる。

## core custom-03
family: custom

{{noun}}に関する古い風習。一般に{{number}}人で行うものとされる。

> food

## core food-01
family: food

{{noun}}を主材料とする{{noun}}。主に{{place}}で作られる。

## core food-02
family: food

{{noun}}を{{sahen}}して作る食品。{{adverbialNoun}}に食べることが多い。

## core food-03
family: food

{{place}}地方の料理。{{noun}}に{{noun}}を加えて作る。

> academic

## core academic-01
family: academic

{{noun}}に伴って生じる現象。{{person}}によって初めて報告された。

## core academic-02
family: academic

{{noun}}が{{sahen}}する際に見られる現象。一般に{{noun}}との関連が指摘される。

## core academic-03
family: academic

{{noun}}において認められる現象の一つ。{{noun}}によって生じると考えられている。

> theory

## core theory-01
family: theory

{{noun}}を{{noun}}によって説明しようとする説。{{person}}によって提唱された。

## core theory-02
family: theory

{{noun}}は{{noun}}から生じるとする考え。現在では主に{{noun}}の分野で用いられる。

## core theory-03
family: theory

{{noun}}と{{noun}}との関係を説明するための理論。{{person}}によって広められたとされる。

> etymology

## core etymology-01
family: etymology

もとは{{noun}}を意味した語。のちに{{noun}}の意に転じた。

## core etymology-02
family: etymology

{{place}}で用いられた{{noun}}に由来するとされる語。

## core etymology-03
family: etymology

{{noun}}を意味する古い語から転じたもの。語源については異説がある。

> archaic

## core archaic-01
family: archaic

古く、{{noun}}を指していった語。現在ではほとんど用いられない。

## core archaic-02
family: archaic

かつて用いられた語。主として{{noun}}の意味で使われた。

## core archaic-03
family: archaic

古く{{place}}地方で{{noun}}を指した語。のちに{{noun}}の意味にも用いられた。

> dialect

## core dialect-01
family: dialect

{{place}}地方で、{{noun}}をいう語。

## core dialect-02
family: dialect

主として{{place}}で用いられる語。{{noun}}の意。

## core dialect-03
family: dialect

{{noun}}を意味する{{place}}地方の語。特に{{noun}}について用いる。

> slang

## core slang-01
family: slang

{{noun}}の俗称。特に{{noun}}についていう。

## core slang-02
family: slang

俗に、{{noun}}を{{sahen}}する人をいう。

## core slang-03
family: slang

{{noun}}を指す俗語。もとは{{place}}で用いられたという。

> figurative

## core figurative-01
family: figurative

もとは{{noun}}をいう語。転じて、{{sahen}}する人についていう。

## core figurative-02
family: figurative

{{noun}}の意から転じて、{{noun}}の状態をいう。

## core figurative-03
family: figurative

本来は{{noun}}を指すが、比喩的に{{noun}}の意味にも用いる。

> idiom

## core idiom-01
family: idiom

{{noun}}が{{sahen}}することのたとえ。

## core idiom-02
family: idiom

{{noun}}のように{{sahen}}すること。転じて、{{noun}}の状態をいう。

## core idiom-03
family: idiom

{{noun}}を{{sahen}}するところから、{{noun}}をいう。

> technical

## core technical-01
family: technical

{{noun}}を{{sahen}}するための装置。主として{{noun}}に用いる。

## core technical-02
family: technical

{{noun}}に取り付け、{{noun}}を{{sahen}}する機器。

## core technical-03
family: technical

{{noun}}を利用して{{noun}}を{{sahen}}する装置。{{place}}などで使用される。

> measure

## core measure-01
family: measure

{{noun}}の程度を表す単位。{{number}}を基準とする。

## core measure-02
family: measure

{{noun}}を測るために用いる尺度。{{number}}を一単位とする。

## core measure-03
family: measure

{{noun}}の大きさを示す単位。主として{{noun}}について用いる。

> calendar

## core calendar-01
family: calendar

{{adverbialNoun}}のうち、{{noun}}が{{sahen}}する時期をいう。

## core calendar-02
family: calendar

{{noun}}を基準として定められた期間。およそ{{number}}日間にあたる。

## core calendar-03
family: calendar

古く{{place}}で用いられた時期の区分。{{noun}}のころを指す。

> ritual

## core ritual-01
family: ritual

{{noun}}を{{sahen}}するために行われる儀礼。主として{{adverbialNoun}}に行う。

## core ritual-02
family: ritual

{{place}}に伝わる儀式。{{noun}}を{{number}}個用いることを特徴とする。

## core ritual-03
family: ritual

{{noun}}に際して行う儀礼の一つ。古くは{{noun}}を{{sahen}}したという。

> culture

## core culture-01
family: culture

{{person}}による{{noun}}。{{noun}}を題材とする。

## core culture-02
family: culture

{{place}}を舞台とする{{noun}}。{{noun}}を題材としている。

## core culture-03
family: culture

{{noun}}を題材とした作品。{{person}}が{{sahen}}したものとされる。

> history

## core history-01
family: history

{{adverbialNoun}}、{{place}}で起こった{{noun}}。{{noun}}を契機として始まった。

## core history-02
family: history

{{place}}における{{noun}}をめぐる出来事。{{person}}が{{sahen}}したことで知られる。

## core history-03
family: history

{{noun}}に関して起こった一連の出来事。のちの{{noun}}に大きな影響を与えた。

> causal

## core causal-01
family: causal

{{noun}}によって生じる{{noun}}。{{noun}}を伴うことが多い。

## core causal-02
family: causal

{{noun}}が{{sahen}}することによって起こる現象。

## core causal-03
family: causal

{{noun}}を原因として生じる{{noun}}の総称。

> method

## core method-01
family: method

{{noun}}を{{sahen}}するための方法。主として{{noun}}に用いる。

## core method-02
family: method

{{noun}}を利用して{{sahen}}する技法。{{person}}によって考案されたとされる。

## core method-03
family: method

{{noun}}において行われる方法の一つ。{{noun}}を{{number}}回{{sahen}}する。

> organization

## core organization-01
family: organization

{{noun}}を目的として設けられた組織。主として{{place}}で活動する。

## core organization-02
family: organization

{{noun}}に関係する人々によって構成される団体。

## core organization-03
family: organization

{{person}}らによって結成された{{noun}}。{{noun}}を{{sahen}}することを目的とする。

> uncertain

## core uncertain-01
family: uncertain

{{noun}}の一種とされるが、詳しいことは分かっていない。

## core uncertain-02
family: uncertain

一般には{{noun}}を指すとされる。語義については諸説がある。

## core uncertain-03
family: uncertain

{{noun}}に由来するとされるが、確かなことは不明である。

> The 31 Optional Clauses.

> etymology

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

> history

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

> region

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

> usage

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

> alternative-theory

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

> authority

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
