# Self-contained regression oracles

These fixtures contain recorded inputs/results, not executable Git history.
Their `origin` fields are provenance labels only; no normal test or distribution
gate resolves those commits. `tests/support/pinnedFixture.ts` verifies the exact
file SHA-256 before parsing. Corrupt or missing fixtures fail without fallback.

## Manual adjective baseline

`manualAdjectiveBaseline.json` was captured once from the reviewed core at
`f5f1d1c62ed49e4c3246521dbe3758a21e523c4a`, using the production compact
dictionary. It contains the exact Source strings, 30 verb Token/next-Token
pairs and complete evaluator records, 18 adjective Token sequences and former
results, a complete noun VocabularySnapshot, and 15 automatic noun draws
(three nonces times five Text levels). Current tests compare full serialized
records, not only candidate counts. The new adjective expectations are asserted
independently and differ from all 18 former results.

SHA-256: `eb34cd424768d1985996449d7918116ca83d09b27e5d91963206c1facc895232`.

## Target line boundary baseline

`targetChunkLineBaseline.json` records both production projection modes from
`f0a381e45283c3aaef05a731bb3d366fddede836`. The unchanged corpus generator is
`tests/support/targetChunkLineCases.ts`: seed 93, 4,000 deterministic cases and
18 HTML-whitespace cases. The fixture pins `JSON.stringify(cases)` and, for
each mode, the SHA-256 of every complete `JSON.stringify(projection) + "\n"`
in corpus order. A changed-field negative control verifies the oracle detects
differences; no projection fields are omitted.

`PRE-RELEASE-EXPERIENCE-DISPLAY1` added one field, `hidden: "frontmatter"`, to
a Target-mode block the parser recognized as a closed leading frontmatter. The
historical `outputs` are unchanged and still checked: the test removes only that
field and requires the original digests. The added `display1` object records
the complete current digests (Source identical to the historical one) and the
number of hidden blocks in the corpus (Source 0, Target 167), each of which the
test requires to be block 0, starting at offset 0, tag `pre`.

SHA-256: `76f703110a6646ece514d239881237b74fd8715fbc8b4e42c934bb3d4197171a`
(before DISPLAY1: `2f1d9f979bc83a0b76cf4fb80903bbee4ad05b1cd9554d72e34dd55fc92c1cb2`).

## Fake Dictionary standard templates

`fakeDictionaryTemplates.json` was captured once from the hand-written template
data at `82a0eb543f5fd2b4843104908189ceb2ab752456`, before
`PRE-RELEASE-FAKE-DICT-TEMPLATES1` moved that data to
`resources/fake-dictionary/standard-templates.md`. It holds all 90 raw core
templates and 31 raw Optional Clauses in document order, every compiled segment
list and required-placeholder list, the three fixed pools and four fixed
headwords, and the complete `generateFakeDefinition` result for 180
combinations of headword, pool, Dictionary Semantropy value and internal nonce
— covering `off`, `generated` and `insufficient-vocabulary`. Re-running the same
capture against the migrated tree produced a byte-identical file.

SHA-256: `553ba3a3d1c59d97b1d0d7947136695b7d2a6ccdd9bfe76d1e966d3255ff1d07`.

`FAKE-DICT-LEXEME1` made the standard set template set 2. The file above stays
the record of set 1: tests compile its raw entries as set 1 and require the
same 180 results.

`fakeDictionaryTemplates2.json` was captured once from template set 2: its 108
raw core templates and 31 Optional Clauses, the three pools above plus
`lexical` (`rich` with verb, イ-adjective and stem lists) and `lexical-empty`
(`rich` with those lists present and empty), the same four headwords, and 300
`generateFakeDefinition` results (five pools, four headwords, five values,
three nonces). Independent review 1 asked that every new template be pinned as a
generated definition; 11 cases with the `lexical` pool were appended (311 in all),
leaving the first 300 as they were (before: `e6ef4d41…24e8`).

SHA-256: `4420b7dbb6a06477050f9b2fb6272778c16744ba824ecb4fa04aa1675f7663b3`.

## Fake Proverb standard recipes

`fakeProverbRecipes.json` was captured once by `PRE-RELEASE-FAKE-PROVERB-TEMPLATES1`
from `resources/fake-proverb/standard-recipes.md` at recipe data version 1. It
holds the canonical raw data (9 proverb recipes, 6 gloss recipes, 25 fixed
literals and 6 candidate profiles) in document order, whose SHA-256 of the
canonical payload is the version 1 digest in
`resources/fake-proverb/standard-recipes.lock.json`
(`1d329f91ba002ac0bb70ac5df3b036efa9730107b4b01ea0e8a2b3da7b0b1af1`). A
Markdown-only edit that changes the data therefore fails this oracle as well
as the lock until it is reviewed.

SHA-256: `0072d166810daa83102872b2c37b198f4cd470f481a74fee3eec726cfa735106`.

`fakeProverbRecipes2.json` was captured once by `FAKE-PROVERB-RECIPES3` from
the generated module of recipe data version 2 (`main` / `bf222bf`,
`STANDARD_FAKE_PROVERB_RECIPE_DATA_JSON`), before the document was rewritten
as recipe data 3. It is the canonical payload itself, with no trailing
newline, so the SHA-256 of the file is the version 2 digest the lock keeps
(`232aeb4381fcb41bc00c6002daeb8ca792eba8b159227ef175bd1a6dad6ea01a`); a test
compares the two on every run. It is the recipe set the Fake Proverb
algorithm oracles draw from (`recipeData2Set()`), so an edit to the standard
document moves no algorithm test.

`fakeProverbRecipes2.format3.md` is the same recipe data 2 written by hand in
the one-line format `FAKE-PROVERB-RECIPES3` introduced (15 `line:` entries
and the 6 profiles, with the weights of version 2). It is an input, not a
recorded result: the tests parse it and require the same recipes as
`fakeProverbRecipes2.json` (fixed texts compared by text, since their ids are
now made from the text) and the same drafts.

Do not regenerate these expected results from the implementation under test to
make a failure pass. A deliberate contract change requires review of the
input/result changes and explicit updates to both fixture and pinned digest.

## History-free validation

Run `node scripts/verifyHistoryFree.mjs` after installing dependencies and
preparing the dictionary. It copies selected public sources/tests/fixtures into
a temporary empty Git repository, checks that the three historical commits are
absent, and runs `npm test` plus `npm run verify:distribution`. It shares only
installed dependencies and copies prepared dictionary inputs; `.git`, local
settings and prebuilt artifacts are not copied. Only the existing Fake
Dictionary template wording oracle is selected from `Docs`, not the whole
internal documentation tree. No network is needed.

The optional `tests/benchmark.historicalDictionary.ts` reconstructs an old
artifact for historical measurement only and still requires private history.
Run it explicitly with `npx vitest run --config vitest.benchmark.config.ts
tests/benchmark.historicalDictionary.ts`. It is not a normal or public gate;
current dictionary payload/hash/equivalence regressions remain in distribution
tests.
