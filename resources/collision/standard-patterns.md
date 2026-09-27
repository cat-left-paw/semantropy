# Semantropy standard Collision patterns

> This is the only human-edited source of the standard Collision pattern data.
> Build-time only: runtime never reads this document.
>
> Schema 2 line syntax (all spaces below are single ASCII spaces):
>     ## recipe <id>
>     label: <plain text, NFC, 1..40 Unicode code points>
>     enabled: true | false
>     selectable: true | false
>     weight: <positive safe integer>
>     part: noun <slot-id> required
>     part: connector <slot-id> required
>     part: modifier <slot-id> required | optional <all | sahen-basic>
>     part: predicate <slot-id> required regular-verb-basic
>     part: literal <slot-id> required <literal-id>
>     presence: <none | comma-separated optional modifier slot IDs> <weight>
>
> The alternatives above describe syntax, not text to paste into a field.
> Part order is output order. All slots (including literal slots) have unique
> lowercase kebab-case IDs within a recipe; `none` is reserved for presence.
> Only Modifier may be optional. Presence is required exactly when optional
> Modifiers exist; it lists weighted allowed sets, not conditions or rules.
> Set member order is immaterial and compiled in part order. Not all subsets
> need to be listed. No inline literal, code, regex, placeholder or grammar DSL.
>
>     ## literal <id>
>
>     <fixed literal body>
>
>     ## connector <id>
>     form: empty | literal
>     weight: <positive safe integer>
>
>     <body, only when form is literal>
>
>     ## modifier-form <id>
>     class: i-adjective | na-adjective | verb | sahen
>     variant: <closed class-specific variant>
>     weight: <positive safe integer>
>
>     ## noun-suffix <id>
>     weight: <positive safe integer>
>
>     <literal suffix>
>
> Separate fields and body with a blank line; do not put blank lines inside
> recipe fields. Only lines starting with `>` are notes. Unknown lines fail.
> IDs are unique across entry kinds. Same-kind literal surfaces cannot repeat.
> Bodies: NFC, 1..32 Unicode code points, Hiragana/Katakana/Han/ー only.
> No whitespace, Cc/Cf/Cs/Zl/Zp, ASCII, JavaScript, regex or placeholders.
> Labels are plain text, never Markdown/HTML; no surrounding whitespace,
> control, format, surrogate, line or paragraph separator characters.
> Every semantic edit (including order, label, flags, profile, weight or presence)
> requires raising data-version. Regenerate with npm run generate:collision-patterns.

schema-version: 2
data-version: 2

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

## recipe plain-pair
label: Noun pair
enabled: true
selectable: true
weight: 24
part: noun n1 required
part: connector c1 required
part: noun n2 required

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

## recipe named
label: Named
enabled: true
selectable: true
weight: 8
part: noun n1 required
part: literal l1 required named-link
part: noun n2 required

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

## recipe denial
label: Denial
enabled: true
selectable: true
weight: 6
part: noun n1 required
part: literal l1 required topic-link
part: noun n2 required
part: literal l2 required denial-end

## recipe purpose
label: For
enabled: true
selectable: true
weight: 8
part: noun n1 required
part: literal l1 required purpose-link
part: noun n2 required

## recipe sahen-noun
label: Sahen
enabled: true
selectable: true
weight: 12
part: modifier m1 required sahen-basic
part: noun n1 required

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


> Connectors. Empty is a weighted form, not a missing entry. The surface `の`
> here is a connector, not the noun-suffix of the same letters.

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

> Modifier forms. Closed class/variant pairs; no conjugation rules, no sahen
> passive, no irregular verbs. Relative weights: completed/basic forms 20,
> past 10, progressive and negative 4.

## modifier-form i-adjective-basic
class: i-adjective
variant: basic
weight: 20

## modifier-form na-adjective-na
class: na-adjective
variant: na
weight: 20

## modifier-form verb-basic
class: verb
variant: basic
weight: 20

## modifier-form verb-past
class: verb
variant: past
weight: 10

## modifier-form verb-progressive
class: verb
variant: progressive
weight: 4

## modifier-form verb-negative
class: verb
variant: negative
weight: 4

## modifier-form sahen-basic
class: sahen
variant: basic
weight: 20

## modifier-form sahen-past
class: sahen
variant: past
weight: 10

## modifier-form sahen-progressive
class: sahen
variant: progressive
weight: 4

## modifier-form sahen-negative
class: sahen
variant: negative
weight: 4

> Noun suffixes concatenated onto a noun surface. `化した` and `化された` are
> finished literals, not sahen passive generation. Future suffixes such as
> `化している`, `めいた` and `じみた` are added here, not in TypeScript.

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
