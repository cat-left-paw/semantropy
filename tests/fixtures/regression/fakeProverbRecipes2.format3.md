# Semantropy standard Fake Proverb recipes

> Recipe data 2 (the nine proverbs and six glosses of versions 1 and 2), written in the one-line format of
> FAKE-PROVERB-RECIPES3. A test fixture, never generated from: `tests/fakeProverbRecipes3.test.ts` compiles it and
> compares it with the pinned version 2 payload (`fakeProverbRecipes2.json`), so the format is shown to say the same
> recipes as the format it replaced. Weights, order and exports are version 2's.

schema-version: 2
data-version: 2

## proverb topic-object
enabled: true
weight: 10
line: {n1}は{n2}を{v1}

## proverb genitive-destination
enabled: true
weight: 8
line: {n1}の{n2}は{-n3}に{v1:動}

## proverb rather-than
enabled: true
weight: 10
line: {n1}より{n2}

## proverb offered-to
enabled: true
weight: 10
line: {n1}に{n2}

## proverb modified-topic
enabled: true
weight: 6
line: {-m1}{n1}は{n2}を{v1:否}

## proverb born-of
enabled: true
weight: 6
line: {n1}から出た{n2}

## proverb pursuer
enabled: true
weight: 5
line: {n1}を{-m1:動}者は{n2}を{v1:否}

## proverb ear-prayer
enabled: true
weight: 8
line: {n1}の{n2}に{n3}

## proverb origin-of
enabled: true
weight: 8
line: {n1}は{n2}のもと

## gloss misplaced-purpose
enabled: true
weight: 10
line: {n1}が{n2}において{+n1}を{+v1:動}ことのたとえ。

## gloss eventual-sameness
enabled: true
weight: 6
line: {n1}と{n2}は、いずれ{+n1}になるという戒め。

## gloss even-so
enabled: true
weight: 6
line: {n1}でさえ{v1}のだから、{+n1}はなおさらであるということ。

## gloss only-measure
enabled: true
weight: 4
line: {n1}の{n2}は、{n3}によってしか測れないということ。

## gloss powerless-before
enabled: true
weight: 5
line: どれほどの{n2}も、{+n1}のまえでは{+v1:否}ということ。

## gloss mistaken-belief
enabled: true
weight: 5
line: {n1}を{+m1}ものと思い込むと、かえって{+n1}を失うという教え。

## profile plain-noun
kind: noun
form: independent-noun 1

## profile plain-modifier
kind: modifier
form: adjective-basic 3
form: verb-basic 2
form: verb-past 1
form: verb-negative 1
form: na-stem-na 2

## profile action-modifier
kind: modifier
tag: 動
form: verb-basic 1

## profile plain-predicate
kind: predicate
form: verb-basic 3
form: verb-negative 1

## profile action-predicate
kind: predicate
tag: 動
form: verb-basic 1

## profile denial-predicate
kind: predicate
tag: 否
form: verb-negative 1
