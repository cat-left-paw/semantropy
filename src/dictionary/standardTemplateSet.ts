import {
	compileTemplateSet,
	describeTemplateIssue,
	type CompiledTemplateSet,
} from "./template";
import {
	STANDARD_CORE_TEMPLATES,
	STANDARD_OPTIONAL_CLAUSES,
	STANDARD_TEMPLATE_DATA_VERSION,
} from "./generated/standardTemplateEntries";

/**
 * The version of the bundled standard template set.
 *
 * It feeds every definition Seed, so it is part of what "the same word gets
 * the same definition" means. Bump it whenever a template or Optional Clause
 * is added, removed, reworded or re-punctuated, or whenever an id changes:
 * without a bump, an existing Seed would quietly start producing different
 * text, and a Collected definition could no longer be traced to what produced
 * it.
 *
 * It is `data-version` from `resources/fake-dictionary/standard-templates.md`,
 * so the bump is made in the same document as the edit that requires it and
 * cannot be forgotten in a second place.
 *
 * Changing selection rules or the generator itself is a different change and
 * bumps `FAKE_DICTIONARY_ALGORITHM_VERSION` instead.
 */
export const STANDARD_TEMPLATE_SET_VERSION = STANDARD_TEMPLATE_DATA_VERSION;

/**
 * The compiled standard set.
 *
 * Compiled once, here, at module load. A set that does not validate throws
 * immediately rather than being trimmed to whatever happened to parse: a
 * silently shortened set would change every generated definition and would
 * still pass a test that only asserts "something came out". The throw makes
 * `npm test` and `npm run build` fail on the spot.
 */
export const STANDARD_TEMPLATE_SET: CompiledTemplateSet = (() => {
	const result = compileTemplateSet(
		STANDARD_TEMPLATE_SET_VERSION,
		STANDARD_CORE_TEMPLATES,
		STANDARD_OPTIONAL_CLAUSES,
	);
	if (!result.ok) {
		throw new Error(
			`The standard Fake Dictionary template set is invalid: ${result.issues
				.map(describeTemplateIssue)
				.join("; ")}`,
		);
	}
	return result.set;
})();
