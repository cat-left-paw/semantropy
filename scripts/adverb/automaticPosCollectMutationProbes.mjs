/** COLLECT1 assertions, run only by the shared private-temporary-copy runner. */
const CONTRACT = "src/collect/v3/CollectedFragmentV3.ts";
const PARTS = "src/collect/v3/automaticPartsOfSpeech.ts";
const REPOSITORY = "src/collect/v3/FragmentRepositoryV3.ts";
const DOCUMENT = "src/collect/collectionDocument.ts";
const METADATA_TEST = "tests/collectMetadataV3.test.ts";
const REPOSITORY_TEST = "tests/collectRepositoryV3.test.ts";
const fingerprintCheck = 'type === "body" ? bodyFingerprint.test(fingerprint) : isCollectFingerprint(fingerprint)';
export const probes = [
	[CONTRACT, METADATA_TEST, "metadata-still-2", "COLLECT_METADATA_VERSION_V3 = 3 as const", "COLLECT_METADATA_VERSION_V3 = 2 as const", "introduces only the separate metadata version 3"],
	[PARTS, METADATA_TEST, "all-off-resets-noun", "return Object.freeze(AUTOMATIC_PARTS_OF_SPEECH.filter((_, index) => data[optionKeys[index]!]));", 'return Object.freeze(AUTOMATIC_PARTS_OF_SPEECH.filter((_, index) => data[optionKeys[index]!]).length ? AUTOMATIC_PARTS_OF_SPEECH.filter((_, index) => data[optionKeys[index]!]) : ["noun"]);', "round-trips all OFF as an empty set"],
	[PARTS, METADATA_TEST, "allow-noncanonical-order", "index < 0 || index <= previous", "index < 0 || index === previous", "rejects a noncanonical parts order"],
	[PARTS, METADATA_TEST, "allow-duplicate", "index < 0 || index <= previous", "index < 0 || index < previous", "rejects duplicate parts"],
	[CONTRACT, METADATA_TEST, "omit-body-parts", "automaticPartsOfSpeech: [...input.automaticPartsOfSpeech], hasManualEdits", "hasManualEdits", "writes the exact Body keys with automatic parts before Manual fields"],
	[CONTRACT, METADATA_TEST, "dictionary-parts-leak", 'if (input.type === "fake-dictionary") return { ...common, type: input.type,', 'if (input.type === "fake-dictionary") return { ...common, automaticPartsOfSpeech: ["noun"], type: input.type,', "omits automatic and unrelated fields from dictionary and collision"],
	[CONTRACT, METADATA_TEST, "collision-parts-leak", "return { ...common, type: input.type, vocabulary:", 'return { ...common, automaticPartsOfSpeech: ["noun"], type: input.type, vocabulary:', "omits automatic and unrelated fields from dictionary and collision"],
	[CONTRACT, METADATA_TEST, "body-accepts-format-1", fingerprintCheck, "isCollectFingerprint(fingerprint)", "refuses format 1 for Body"],
	[CONTRACT, METADATA_TEST, "dictionary-accepts-format-2", fingerprintCheck, 'type !== "collision" ? bodyFingerprint.test(fingerprint) : isCollectFingerprint(fingerprint)', "refuses format 2 for dictionary and collision"],
	[CONTRACT, METADATA_TEST, "collision-accepts-format-2", fingerprintCheck, 'type !== "fake-dictionary" ? bodyFingerprint.test(fingerprint) : isCollectFingerprint(fingerprint)', "refuses format 2 for dictionary and collision"],
	["src/collect/v3/serializeFragmentV3.ts", METADATA_TEST, "serializer-extra-nonce-leak", "JSON.stringify(copy)", "JSON.stringify({ ...metadata, ...copy })", "serializes only the explicit whitelist even with extra secret fields"],
	[DOCUMENT, REPOSITORY_TEST, "rewrite-existing-v2-bytes", "return `${existing}${padding}${entry}`;", "return `${existing.trim()}${padding}${entry}`;", "preserves mixed v2 entries and unknown comments byte for byte before padding"],
	[REPOSITORY, REPOSITORY_TEST, "conflict-after-storage", "if (protectedPaths.includes(path)) return", "await this.storage.inspect(path);\n\t\t\t\tif (protectedPaths.includes(path)) return", "refuses every Target before any storage call"],
	[REPOSITORY, REPOSITORY_TEST, "target-only-conflict", "protectedPaths = collectProtectedPaths(captured.metadata);", 'protectedPaths = captured.metadata.type === "collision" ? [] : [captured.metadata.target.path];', "refuses every Vocabulary Source of every type before storage"],
	[DOCUMENT, REPOSITORY_TEST, "document-version-raised", "COLLECTION_DOCUMENT_VERSION = 1", "COLLECTION_DOCUMENT_VERSION = 2", "keeps collection document version 1"],
	["src/main.ts", "tests/automaticPosDependencies.test.ts", "production-import-legacy-collect", '} from "virtual:semantropy-lindera-payload";', '} from "virtual:semantropy-lindera-payload";\nexport { COLLECT_METADATA_VERSION } from "./collect/collectProvenance"; import "./collect/FragmentRepository";', "no longer reaches the Body 10 core from production after MAX-VIEW1: src/main.ts"], // renamed by MAX-VIEW1; still pins the exact graph
	["src/collect/fragmentIdentityValidation.ts", "tests/collectV3ReviewRegressions.test.ts", "identity-uuid-validation-removed", 'return typeof value === "string" && UUID_PATTERN.test(value);', 'return typeof value === "string";', "rejects invalid ids at every direct metadata serializer boundary"],
	["src/collect/fragmentIdentityValidation.ts", "tests/collectV3ReviewRegressions.test.ts", "identity-time-validation-removed", "return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;", "return true;", "rejects invalid repository identities before all storage calls"],
	["src/collect/fragmentIdentityValidation.ts", "tests/collectV3ReviewRegressions.test.ts", "identity-canonical-time-validation-removed", "return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;", "return Number.isFinite(timestamp);", "rejects invalid created values at every direct metadata serializer boundary"],
	["src/collect/v3/serializeFragmentV3.ts", "tests/collectV3ReviewRegressions.test.ts", "entry-root-descriptor-bypass", "const data = ownCollectData(fragment);", "const data = { text: fragment.text, metadata: fragment.metadata };", "getter without executing it"],
	["src/collect/v3/serializeFragmentV3.ts", "tests/collectV3ReviewRegressions.test.ts", "entry-root-exact-fields-bypass", 'exactCollectFields(data, ["text", "metadata"]);', "// exact-field check removed", "rejects inherited, missing and extra entry root fields"],
];
