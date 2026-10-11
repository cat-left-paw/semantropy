import { compileTemplateSet, type CompiledTemplateSet } from "../../src/dictionary/template";
import type { RawCoreTemplate, RawOptionalClause } from "../../src/dictionary/templateData";
import { readPinnedFixture } from "./pinnedFixture";

/**
 * The standard Fake Dictionary template set 1, as recorded in the pinned
 * regression fixture (FAKE-DICT-TEMPLATES1). FAKE-DICT-LEXEME1 made the
 * standard set 2; tests that pin what set 1 generates compile it from here.
 */
const FIXTURE = readPinnedFixture<{ raw: { coreTemplates: RawCoreTemplate[]; optionalClauses: RawOptionalClause[] } }>(
	"fakeDictionaryTemplates",
	"553ba3a3d1c59d97b1d0d7947136695b7d2a6ccdd9bfe76d1e966d3255ff1d07",
);

export const TEMPLATE_SET_1: CompiledTemplateSet = (() => {
	const compiled = compileTemplateSet(1, FIXTURE.raw.coreTemplates, FIXTURE.raw.optionalClauses);
	if (!compiled.ok) throw new Error("template set 1");
	return compiled.set;
})();
