/** `PRE-RELEASE-MAX-VIEW1` mutation probes, run by
 * `scripts/adverb/verifyAdverbMutations.mjs --max-view` in a private temporary
 * copy. The checkout is never written. Never imported by production.
 *
 * Each probe reverts one MAX-VIEW1 connection decision to the wrong
 * implementation, then runs the single named assertion that is supposed to
 * notice. A parse or import failure is a survivor, not a catch.
 */

const CONTROLLER = "src/render/chunkTargetBodyController.ts";
const OWNER = "src/render/automaticPosBodyOwner.ts";
const SLOTS = "src/analysis/displaySlots.ts";
const MANUAL = "src/analysis/manualDisplay.ts";
const COLLECT = "src/collect/v3/CollectedFragmentV3.ts";
const VIEW_TEST = "tests/maxView.test.ts";
const VIEW = "src/view/SemantropyView.ts";
const COORDINATOR = "src/application/AutomaticPosCoordinator.ts";

/** [source file, test file, name, before, after, test name] */
export const probes = [
	[CONTROLLER, VIEW_TEST, "session-algorithm-left-at-body-10",
		"   bodySemantropy: level, algorithmVersion: MAX_BODY_ALGORITHM_VERSION };", "   bodySemantropy: level, algorithmVersion: 10 };",
		"realizes verbs from basic-form Sources"],
	[COLLECT, VIEW_TEST, "collect-accepts-body-fingerprint-2",
		"const bodyFingerprint = new RegExp(`^${MAX_FINGERPRINT_VERSION}:[0-9a-f]{64}$`);",
		// Written without a backtick after "$": String.replace would read "$`" as a replacement pattern.
		'const bodyFingerprint = new RegExp("^vocabulary-fingerprint-sha256-[23]:[0-9a-f]{64}$");',
		"accepts Body 11 with fingerprint 3 only"],
	[COLLECT, VIEW_TEST, "collect-body-algorithm-pin-removed",
		'			if (data.algorithmVersion !== MAX_BODY_ALGORITHM_VERSION) refuseCollectV3("invalid-algorithm-version");\n', "",
		"accepts Body 11 with fingerprint 3 only"],
	[SLOTS, VIEW_TEST, "planner-trusts-a-claimed-realization",
		'						selection.candidate.displayFormId !== vocabularyDisplayFormId(realization.lexemeId, surface) ||\n						!prepared.realizes(realization.lexemeId, realization.formKey, surface)) return fail("invalid-candidate");',
		'						selection.candidate.displayFormId !== vocabularyDisplayFormId(realization.lexemeId, surface)) return fail("invalid-candidate");',
		"refuses a result whose realization names a lexeme or key"],
	[SLOTS, VIEW_TEST, "replacement-counted-by-snapshot-candidate",
		"			const automaticReplaced = selection !== null;", "			const automaticReplaced = automaticCandidate !== null;",
		"realizes verbs from basic-form Sources"],
	[SLOTS, VIEW_TEST, "realized-headword-checked-against-the-original-surface",
		"				: automaticReplaced ? { ...copyToken(original), surface: display.surface } : copyToken(original);",
		"				: copyToken(original);",
		"realizes verbs from basic-form Sources"],
	[MANUAL, VIEW_TEST, "manual-layer-headword-reverted",
		"(surface === slot.originalToken.surface ? slot.originalToken : { ...slot.originalToken, surface })", "slot.originalToken",
		"realizes verbs from basic-form Sources"],
	[OWNER, VIEW_TEST, "owner-release-keeps-the-max-owner",
		"		this.prefixes.clear(); releaseMaxOwner({ vocabulary: this.vocabulary, reason });", "		this.prefixes.clear();",
		"releases the MAX projection on close"],
	// Review 1 (No-Go P1 x2): the Text level is one all-View transaction with save compensation.
	[VIEW, VIEW_TEST, "level-change-bypasses-the-all-view-transaction",
		"		if (coordinator && !deps.persist) return await this.changeBodyLevelTogether(coordinator, next);\n", "",
		"publishes a level change to every open View together"],
	[CONTROLLER, VIEW_TEST, "level-prepare-keeps-the-runtime-level",
		"			const nextLevel = level ?? runtime.level;", "			const nextLevel = runtime.level;",
		"publishes a level change to every open View together"],
	[COORDINATOR, VIEW_TEST, "level-saved-as-an-option-change",
		"			committed = await this.store.transact(operation.bodySemantropy === undefined ? { automaticPos: options } : { bodySemantropy: operation.bodySemantropy }, {",
		"			committed = await this.store.transact({ automaticPos: options }, {",
		"publishes a level change to every open View together"],
	[COORDINATOR, VIEW_TEST, "published-view-not-rolled-back",
		"					for (const prepared of [...operation.prepared].reverse()) try { prepared.rollback(); } catch { failed = true; }\n", "",
		"a publication failure in one View rolls back"],
];
