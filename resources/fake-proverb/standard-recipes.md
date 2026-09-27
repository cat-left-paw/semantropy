# Semantropy standard Fake Proverb recipes

> This is the only human-edited source of the standard Fake Proverb recipe data.
> Build-time only: runtime never reads this document.
>
> Recipe Schema 1 line syntax (all spaces below are single ASCII spaces):
>     ## proverb <id>
>     enabled: true | false
>     weight: <positive safe integer>
>     part: noun | modifier | predicate <slot-id> <profile-id>
>     part: noun | modifier | predicate <slot-id> <profile-id> export
>     part: literal <literal-id>
>
>     ## gloss <id>
>     enabled: true | false
>     weight: <positive safe integer>
>     requires: noun | modifier | predicate <slot-id>
>     part: reference noun | modifier | predicate <slot-id>
>     part: noun | modifier | predicate <slot-id> <profile-id>
>     part: literal <literal-id>
>
>     ## literal <id>
>
>     <fixed literal body>
>
>     ## profile <id>
>     kind: noun | modifier | predicate
>     form: <closed form for that kind> <weight>
>
> The alternatives above describe syntax, not text to paste into a field.
> Part order is output order. Fields come first, then (gloss only) every
> `requires`, then every `part`. A proverb slot marked `export` is part of its
> typed export signature. A gloss `requires` the typed (kind, slot) pairs it
> needs; it pairs only with a proverb that exports every one of them with the
> same kind. `reference` is gloss-only and names a required slot or an earlier
> gloss-local slot, always with its kind. Gloss-local slots are separate
> draws: they never export and never reuse a proverb slot ID.
> Slot IDs are lowercase kebab-case, unique within a recipe, at most 16 long.
> Entry IDs are lowercase kebab-case, unique across all entry kinds.
> Forms: noun independent-noun; modifier adjective-basic, verb-basic,
> verb-past, verb-negative; predicate adjective-basic, verb-basic,
> verb-negative. Forms are closed code-known shapes, never inflection rules.
> Literal bodies: NFC, 1..24 Unicode code points, Hiragana/Katakana/Han/ー/、/。
> only. No whitespace, Cc/Cf/Cs/Zl/Zp, ASCII, Markdown, JavaScript, regex or
> placeholders. Every literal and profile must be used.
> Separate fields and body with a blank line; do not put blank lines inside
> recipe fields. Only lines starting with `>` are notes. Unknown lines fail.
> Every semantic edit (including order, flags, weight, export, requires,
> profile or literal) requires raising data-version.
> Regenerate with npm run generate:fake-proverb-recipes.

schema-version: 1
data-version: 1

## proverb topic-object
enabled: true
weight: 10
part: noun n1 plain-noun export
part: literal wa
part: noun n2 plain-noun export
part: literal wo
part: predicate v1 plain-predicate export

## proverb genitive-destination
enabled: true
weight: 8
part: noun n1 plain-noun export
part: literal no
part: noun n2 plain-noun export
part: literal wa
part: noun n3 plain-noun
part: literal ni
part: predicate v1 action-predicate export

## proverb rather-than
enabled: true
weight: 10
part: noun n1 plain-noun export
part: literal yori
part: noun n2 plain-noun export

## proverb offered-to
enabled: true
weight: 10
part: noun n1 plain-noun export
part: literal ni
part: noun n2 plain-noun export

## proverb modified-topic
enabled: true
weight: 6
part: modifier m1 plain-modifier
part: noun n1 plain-noun export
part: literal wa
part: noun n2 plain-noun export
part: literal wo
part: predicate v1 denial-predicate export

## proverb born-of
enabled: true
weight: 6
part: noun n1 plain-noun export
part: literal kara-deta
part: noun n2 plain-noun export

## proverb pursuer
enabled: true
weight: 5
part: noun n1 plain-noun export
part: literal wo
part: modifier m1 action-modifier
part: literal mono-wa
part: noun n2 plain-noun export
part: literal wo
part: predicate v1 denial-predicate export

## proverb ear-prayer
enabled: true
weight: 8
part: noun n1 plain-noun export
part: literal no
part: noun n2 plain-noun export
part: literal ni
part: noun n3 plain-noun export

## proverb origin-of
enabled: true
weight: 8
part: noun n1 plain-noun export
part: literal wa
part: noun n2 plain-noun export
part: literal no-moto

## gloss misplaced-purpose
enabled: true
weight: 10
requires: noun n1
requires: noun n2
part: reference noun n1
part: literal ga
part: reference noun n2
part: literal ni-oite
part: noun g1 plain-noun
part: literal wo
part: predicate g2 action-predicate
part: literal koto-no-tatoe

## gloss eventual-sameness
enabled: true
weight: 6
requires: noun n1
requires: noun n2
part: reference noun n1
part: literal to
part: reference noun n2
part: literal wa-izure
part: noun g1 plain-noun
part: literal ni-naru-imashime

## gloss even-so
enabled: true
weight: 6
requires: noun n1
requires: predicate v1
part: reference noun n1
part: literal de-sae
part: reference predicate v1
part: literal no-dakara
part: noun g1 plain-noun
part: literal wa-naosara

## gloss only-measure
enabled: true
weight: 4
requires: noun n1
requires: noun n2
requires: noun n3
part: reference noun n1
part: literal no
part: reference noun n2
part: literal wa-comma
part: reference noun n3
part: literal ni-yotte-shika

## gloss powerless-before
enabled: true
weight: 5
requires: noun n2
part: literal dorehodo-no
part: reference noun n2
part: literal mo-comma
part: noun g1 plain-noun
part: literal no-mae-dewa
part: predicate g2 denial-predicate
part: literal to-iu-koto

## gloss mistaken-belief
enabled: true
weight: 5
requires: noun n1
part: reference noun n1
part: literal wo
part: modifier g1 plain-modifier
part: literal mono-to-omoikomu
part: noun g2 plain-noun
part: literal wo-ushinau-oshie

## literal wa

は

## literal wo

を

## literal no

の

## literal ni

に

## literal yori

より

## literal ga

が

## literal to

と

## literal kara-deta

から出た

## literal mono-wa

者は

## literal no-moto

のもと

## literal ni-oite

において

## literal koto-no-tatoe

ことのたとえ。

## literal wa-izure

は、いずれ

## literal ni-naru-imashime

になるという戒め。

## literal de-sae

でさえ

## literal no-dakara

のだから、

## literal wa-naosara

はなおさらであるということ。

## literal wa-comma

は、

## literal ni-yotte-shika

によってしか測れないということ。

## literal dorehodo-no

どれほどの

## literal mo-comma

も、

## literal no-mae-dewa

のまえでは

## literal to-iu-koto

ということ。

## literal mono-to-omoikomu

ものと思い込むと、かえって

## literal wo-ushinau-oshie

を失うという教え。

## profile plain-noun
kind: noun
form: independent-noun 1

## profile plain-modifier
kind: modifier
form: adjective-basic 3
form: verb-basic 2
form: verb-past 1
form: verb-negative 1

## profile action-modifier
kind: modifier
form: verb-basic 1

## profile plain-predicate
kind: predicate
form: verb-basic 3
form: verb-negative 1

## profile action-predicate
kind: predicate
form: verb-basic 1

## profile denial-predicate
kind: predicate
form: verb-negative 1
