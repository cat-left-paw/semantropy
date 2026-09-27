/** `PRE-RELEASE-MAX-CORE1` mutation probes, run by
 * `scripts/adverb/verifyAdverbMutations.mjs --max-core` in a private temporary
 * copy. The checkout is never written. Never imported by production.
 *
 * Each probe reverts one CORE1 decision to the wrong implementation the task,
 * the policy or the SPIKE1 record names, then runs the single named assertion
 * that is supposed to notice. A parse or import failure is a survivor, not a
 * catch: the named assertion has to be the thing that fails.
 */

const REALIZER = "src/transform/maxRealizer.ts";
const LEVEL = "src/transform/maxLevel.ts";
const PROJECTION = "src/transform/maxProjection.ts";
const CORE = "src/transform/maxCore.ts";
const BRIDGE = "src/transform/maxAdverbBridge.ts";
const REALIZER_TEST = "tests/maxRealizer.test.ts";
const PROJECTION_TEST = "tests/maxProjection.test.ts";
const CORE_TEST = "tests/maxCore.test.ts";

/** [source file, test file, name, before, after, test name] */
export const probes = [
	// The closed realizer (SPIKE1 / Amendment 1).
	[REALIZER, REALIZER_TEST, "irregular-exclusion-removed",
		'	if (isMaxIrregularLexeme(candidate.conjugationType, candidate.baseForm)) return refuse("irregular-lexeme");\n', "",
		"refuses the six-lexeme closed exclusion for every key"],
	[REALIZER, REALIZER_TEST, "ta-voicing-collapsed-into-one-admission",
		'	"verb-ta-stem-d": voiced("d"),', '	"verb-ta-stem-d": REGULAR_VERB_CONJUGATION_TYPES,',
		"builds た / だ, せる / させる, the volitional"],
	[REALIZER, REALIZER_TEST, "target-follower-dropped-from-the-key",
		'	["verb", "連用タ接続", "aux-da", "verb-ta-stem-d"],', '	["verb", "連用タ接続", "aux-da", "verb-ta-stem-t"],',
		"derives the key from the authenticated connection answer, follower included"],
	[REALIZER, REALIZER_TEST, "godan-and-ichidan-suffix-merged",
		'	"verb-irrealis-godan-suffix": GODAN,', '	"verb-irrealis-godan-suffix": REGULAR_VERB_CONJUGATION_TYPES,',
		"builds た / だ, せる / させる, the volitional"],
	[REALIZER, REALIZER_TEST, "base-form-class-consistency-removed",
		'	if (!candidate.baseForm.endsWith(rule.baseEnding)) return refuse("base-form-class-mismatch");\n', "",
		"fails closed without guessing from a surface or ending"],
	[REALIZER, REALIZER_TEST, "record-level-unsafe-surface-guard-removed",
		'	if (!isSafeMaxSurface(candidate.baseForm)) return refuse("unsafe-surface");\n', "",
		"fails closed without guessing from a surface or ending"],
	// Level transition.
	[LEVEL, CORE_TEST, "application-rate-not-doubled",
		"	return Math.min(100, level * 2);", "	return level;",
		"reproduces Body 10 at 2 x level on the strict half"],
	[LEVEL, CORE_TEST, "high-interval-ignores-the-slot-threshold",
		'	if (level <= 75) return threshold < (level - 50) / 25 ? "high" : "strict";', '	if (level <= 75) return "high";',
		"moves slots strict -> High across 50..75"],
	[CORE, CORE_TEST, "profile-threshold-redrawn-per-level",
		"maxSlotHash(base(part).profile, [item.tokenId])", "maxSlotHash(base(part).profile, [item.tokenId, String(level)])",
		"lowers a slot's profile as the level rises"],
	// Strict oracle.
	[CORE, CORE_TEST, "strict-stream-domain-renamed",
		'"semantropy/automatic-pos-2", part, purpose, nonce', '"semantropy/automatic-pos-3", part, purpose, nonce',
		"matches surfaces, slots, candidates and Ruby for Current and Selected Notes"],
	[CORE, CORE_TEST, "legacy-noun-transform-at-the-level",
		"bodySemantropy: 100 as BodySemantropy", "bodySemantropy: level as BodySemantropy",
		"matches surfaces, slots, candidates and Ruby for Current and Selected Notes"],
	// Relaxed pools and candidate evidence.
	// Independent review 1, P1: High / MAX are the realizer's safe set alone. This restores the rejected re-injection.
	[CORE, CORE_TEST, "strict-record-reinjected-into-relaxed-pools",
		"	for (const [lexeme, surface] of pool) entries.push(",
		"	for (const choice of strictChoices(state, run, index, part, currentSurface, () => { throw new Error(); })) for (const record of choice.candidates) if (![...pool.keys()].some(item => item.records.some(owned => owned.displayFormId === record.displayFormId))) entries.push({ surface: record.surface, weight: record.frequency, record, lexeme: null });\n	for (const [lexeme, surface] of pool) entries.push(",
		"never re-injects a strict candidate outside the safe set"],
	[CORE, CORE_TEST, "high-verb-family-dropped",
		'			if (profile === "high" && family !== null && lexeme.input.conjugationType !== family) continue;\n', "",
		"only the verified family at High"],
	[CORE, CORE_TEST, "relaxed-pool-keeps-the-current-surface",
		"			if (realized && realized.surface !== currentSurface) pool.set(lexeme, realized.surface);",
		"			if (realized) pool.set(lexeme, realized.surface);",
		"excludes the authenticated displayed surface on a repeated shuffle at every profile"],
	[CORE, CORE_TEST, "ruby-from-a-record-of-another-surface",
		"entry.lexeme.records.filter(candidate => candidate.surface === group.surface)", "entry.lexeme.records",
		"takes identity and Ruby only from an exactly matching observed record"],
	[CORE, CORE_TEST, "relaxed-draw-depends-on-earlier-slots",
		"maxUnit(maxSlotHash(domains.surface, [item.tokenId, profile])))", "maxUnit(maxSlotHash(domains.surface, [String(replaceableSlotCount), profile])))",
		"draws each High / MAX slot from its own slot identity only"],
	[CORE, CORE_TEST, "adverb-duplicate-to-guard-removed",
		"		!(followedByTo && adverbSurfaceEndsWithTo(item.identity.surface)))", "		true)",
		"the external と stays and is never duplicated"],
	// Independent review 1, P1: High / MAX read only the following token. This restores the full-observation requirement.
	[CORE, CORE_TEST, "relaxed-adverb-requires-the-full-observation",
		"					const reading = readAdverbBridge(token, run.tokens[j + 1]?.token ?? null);",
		"					const reading = adverbContext().context.supported ? readAdverbBridge(token, run.tokens[j + 1]?.token ?? null) : { supported: false };",
		"needs no head or polarity observation at High / MAX"],
	[BRIDGE, CORE_TEST, "following-to-guard-narrowed-to-the-bridge",
		'		followedByTo: next !== null && next.surface.normalize("NFC") === "と",',
		"		followedByTo: next !== null && isBridgeToken(next),",
		"never places a lexical と before any following と"],
	// Independent re-review 2, P2: the guard is an exact と, not a と-prefix. This restores the rejected prefix test.
	[BRIDGE, CORE_TEST, "following-to-guard-widened-to-a-prefix",
		'		followedByTo: next !== null && next.surface.normalize("NFC") === "と",',
		'		followedByTo: next !== null && next.surface.normalize("NFC").startsWith("と"),',
		"refuses a lexical と only before a following token that is exactly と"],
	[CORE, CORE_TEST, "adverb-high-drops-the-observation",
		'(profile === "max" || item.observed)', "(true)",
		"High requires a genuine Source observation"],
	[CORE, CORE_TEST, "target-release-not-honored",
		'	if (RELEASED_TARGETS.has(target)) refuse("released");\n', "",
		"retires one bound Target without revoking its owner"],
	[CORE, CORE_TEST, "latest-result-seal-removed",
		'		if (state.latest !== result) refuse("stale");\n', "",
		"rejects forged, foreign and cloned Target handles, projections and results"],
	// Projection 3 provenance, identity and lifecycle.
	[PROJECTION, PROJECTION_TEST, "lexeme-identity-keys-on-the-inflected-reading",
		"			const id = maxLexemeIdentity(input), entry", "			const id = JSON.stringify([maxLexemeIdentity(input), token.reading ?? null]), entry",
		"aggregates one lemma observed in five forms across two Sources"],
	[PROJECTION, CORE_TEST, "noun-family-widened-beyond-the-automatic-projection",
		"	const nounFamily = [...family.values()]",
		'	for (const record of snapshot.projections.manual.candidates) if (record.morphology.pos === "名詞" && !record.morphology.isUnknown && !family.has(record.surface)) family.set(record.surface, { surface: record.surface, frequency: record.frequency, origins: [record.origins], candidates: [{ candidateId: record.candidateId, displayFormId: record.displayFormId }] });\n	const nounFamily = [...family.values()]',
		"relaxes to the automatic-body family only"],
	[PROJECTION, PROJECTION_TEST, "origin-outside-the-sources-accepted",
		'		if (!sources.has(key)) refuse("provenance-mismatch");\n', "",
		"refuses origin outside the Sources"],
	[PROJECTION, PROJECTION_TEST, "candidate-identity-not-re-minted",
		"	if (record.candidateId !== vocabularyCandidateId(record.morphology) ||", "	if (false ||",
		"refuses form evidence rewritten under the same identity"],
	[PROJECTION, PROJECTION_TEST, "ruby-range-outside-the-surface-accepted",
		"end > record.surface.length || ", "",
		"refuses Ruby outside its surface"],
	[PROJECTION, PROJECTION_TEST, "records-outside-the-safe-set-left-unchecked",
		"			// Every record is checked before the safe-set filter, so a rewritten record cannot hide by falling outside it.\n			check(record);\n", "",
		"refuses lexeme class rewritten under the same identity"],
	// Independent review 1, P2: the variant id is re-minted in full. This restores the prefix-only check.
	[PROJECTION, PROJECTION_TEST, "ruby-variant-id-checked-by-prefix-only",
		"		if (variant.variantId !== JSON.stringify([record.displayFormId, record.surface.slice(start, end).normalize(\"NFC\"),\n			variant.reading.normalize(\"NFC\"), start, end])) refuse(\"invalid-projection\");",
		"		if (!variant.variantId.startsWith(`[${JSON.stringify(record.displayFormId)},`)) refuse(\"invalid-projection\");",
		"Ruby id whose reading disagrees with the variant"],
	[PROJECTION, PROJECTION_TEST, "realizer-rules-dropped-from-the-fingerprint",
		"MANUAL_MORPH_POLICY_VERSION, authority.policyVersion, content.realizerRules,", "MANUAL_MORPH_POLICY_VERSION, authority.policyVersion,",
		"binds the bridge profile data and version and the closed realizer rules"],
	[PROJECTION, PROJECTION_TEST, "owner-revocation-ignored",
		"	if (revoked) refuse(revoked);\n", "",
		"Source and Target owners on generation and inspection"],
];
