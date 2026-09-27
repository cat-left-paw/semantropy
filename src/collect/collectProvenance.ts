import { isVaultRelativePath } from "../path/vaultRelativePath";
import {
	VOCABULARY_FINGERPRINT_VERSION,
	type VocabularyDrawMode,
} from "../vocabulary/vocabularySnapshot";

/** Only new Collect entries carry this. The collection document version stays 1. */
export const COLLECT_METADATA_VERSION = 2 as const;

export type CollectMetadataVersion = typeof COLLECT_METADATA_VERSION;

export type CollectPathIdentity = {
	readonly path: string;
	readonly contentHash: string;
};

export type CollectVocabularyProvenance = {
	readonly sources: readonly CollectPathIdentity[];
	readonly fingerprint: string;
	readonly drawMode: VocabularyDrawMode;
};

export type CollectManualKind = "replacement" | "restore-original";

export type CollectManualOverrideRecord = {
	readonly tokenId: string;
	readonly kind: CollectManualKind;
	readonly localRevision: number;
};

export const COLLECT_PATH_IDENTITY_KEY_ORDER = Object.freeze([
	"path",
	"contentHash",
] as const);

export const COLLECT_VOCABULARY_KEY_ORDER = Object.freeze([
	"sources",
	"fingerprint",
	"drawMode",
] as const);

export const COLLECT_MANUAL_OVERRIDE_KEY_ORDER = Object.freeze([
	"tokenId",
	"kind",
	"localRevision",
] as const);

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const FINGERPRINT_PATTERN = new RegExp(
	`^${VOCABULARY_FINGERPRINT_VERSION}:[0-9a-f]{64}$`,
);

export function isCollectContentHash(value: unknown): value is string {
	return typeof value === "string" && CONTENT_HASH_PATTERN.test(value);
}

export function isCollectFingerprint(value: unknown): value is string {
	return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

export function isCollectDrawMode(value: unknown): value is VocabularyDrawMode {
	return value === "uniform" || value === "frequency";
}

export function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isNonEmptyId(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function isCollectManualKind(value: unknown): value is CollectManualKind {
	return value === "replacement" || value === "restore-original";
}

/**
 * Recursively freeze a value this module owns. Caller-owned objects are never
 * passed here: every nested record is a copy made for stored metadata.
 */
export function freezeCollectValue<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		if (Array.isArray(value)) {
			for (const item of value) freezeCollectValue(item);
		} else {
			for (const child of Object.values(value)) freezeCollectValue(child);
		}
		Object.freeze(value);
	}
	return value;
}

export function copyPathIdentity(
	identity: CollectPathIdentity,
): CollectPathIdentity {
	return { path: identity.path, contentHash: identity.contentHash };
}

export function copyVocabularyProvenance(
	vocabulary: CollectVocabularyProvenance,
): CollectVocabularyProvenance {
	return {
		sources: vocabulary.sources.map(copyPathIdentity),
		fingerprint: vocabulary.fingerprint,
		drawMode: vocabulary.drawMode,
	};
}

export function copyManualOverride(
	override: CollectManualOverrideRecord,
): CollectManualOverrideRecord {
	return {
		tokenId: override.tokenId,
		kind: override.kind,
		localRevision: override.localRevision,
	};
}

export function serializePathIdentity(
	identity: CollectPathIdentity,
): Record<string, unknown> {
	return {
		path: identity.path,
		contentHash: identity.contentHash,
	};
}

export function serializeVocabularyProvenance(
	vocabulary: CollectVocabularyProvenance,
): Record<string, unknown> {
	return {
		sources: vocabulary.sources.map(serializePathIdentity),
		fingerprint: vocabulary.fingerprint,
		drawMode: vocabulary.drawMode,
	};
}

export function serializeManualOverride(
	override: CollectManualOverrideRecord,
): Record<string, unknown> {
	return {
		tokenId: override.tokenId,
		kind: override.kind,
		localRevision: override.localRevision,
	};
}

/**
 * Vault-relative paths this Collect must not write to: the Target, when one
 * exists, and every Vocabulary Source, in metadata order, with duplicates
 * dropped. The current editor and open note are not consulted.
 */
export function collectProtectedPaths(input: {
	readonly target?: CollectPathIdentity;
	readonly vocabulary: CollectVocabularyProvenance;
}): readonly string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	const add = (path: string): void => {
		if (seen.has(path)) {
			return;
		}
		seen.add(path);
		paths.push(path);
	};
	if (input.target) {
		add(input.target.path);
	}
	for (const source of input.vocabulary.sources) {
		add(source.path);
	}
	return paths;
}

export function pathIdentityReason(
	identity: CollectPathIdentity | undefined,
): "invalid-source-path" | "invalid-content-hash" | null {
	if (!identity || !isVaultRelativePath(identity.path)) {
		return "invalid-source-path";
	}
	if (!isCollectContentHash(identity.contentHash)) {
		return "invalid-content-hash";
	}
	return null;
}

/**
 * Vocabulary Source Set: non-empty, unique paths, canonical path order,
 * valid hashes, current fingerprint form, and a known draw mode.
 */
export function vocabularyProvenanceReason(
	vocabulary: CollectVocabularyProvenance | undefined,
):
	| "invalid-source-path"
	| "invalid-content-hash"
	| "invalid-vocabulary-sources"
	| "invalid-fingerprint"
	| "invalid-draw-mode"
	| null {
	if (!vocabulary || !Array.isArray(vocabulary.sources)) {
		return "invalid-vocabulary-sources";
	}
	const sources: readonly unknown[] = vocabulary.sources;
	if (sources.length === 0) {
		return "invalid-vocabulary-sources";
	}
	const paths: string[] = [];
	for (const item of sources) {
		if (!item || typeof item !== "object") {
			return "invalid-vocabulary-sources";
		}
		const source = item as CollectPathIdentity;
		const reason = pathIdentityReason(source);
		if (reason) {
			return reason;
		}
		paths.push(source.path);
	}
	if (new Set(paths).size !== paths.length) {
		return "invalid-vocabulary-sources";
	}
	for (let index = 1; index < paths.length; index += 1) {
		if (paths[index]! <= paths[index - 1]!) {
			return "invalid-vocabulary-sources";
		}
	}
	if (!isCollectFingerprint(vocabulary.fingerprint)) {
		return "invalid-fingerprint";
	}
	if (!isCollectDrawMode(vocabulary.drawMode)) {
		return "invalid-draw-mode";
	}
	return null;
}
