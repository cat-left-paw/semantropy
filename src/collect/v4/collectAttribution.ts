import { escapeFragmentMarkdown } from "../escapeFragmentMarkdown";
import type { FragmentMetadataV4 } from "./CollectedFragmentV4";
import { ATTRIBUTION_LABELS, type AttributionLabels } from "../../i18n/attributionLabels";
import type { UiLanguage } from "../../i18n/language";
import type { CollectAttribution } from "../../settings/automaticPosSettings";

/** Same order as `COLLECT_ATTRIBUTION_KEYS`. A type-only settings import keeps the serializer off the settings graph. */
export const COLLECT_ATTRIBUTION_LINE_KEYS = ["feature", "target", "vocabulary", "semantropy", "date"] as const satisfies readonly (keyof CollectAttribution)[];

/**
 * The attribution choices and interface language captured with one Collect.
 * The repository reads this before the write is queued. Later setting or
 * language changes do not alter an entry that is already waiting.
 */
export type CollectAttributionSnapshot = CollectAttribution & { readonly uiLanguage: UiLanguage; readonly localDate: string | null };

/** A missing or non-boolean item is off. An unknown language is Japanese. */
export function collectAttributionSnapshot(value: Partial<Record<keyof CollectAttributionSnapshot, unknown>> = {}): CollectAttributionSnapshot {
	const flag = (key: keyof CollectAttribution) => value[key] === true;
	return Object.freeze({
		feature: flag("feature"), target: flag("target"), vocabulary: flag("vocabulary"),
		semantropy: flag("semantropy"), date: flag("date"),
		uiLanguage: value.uiLanguage === "en" ? "en" : "ja",
		localDate: typeof value.localDate === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value.localDate) ? value.localDate : null,
	});
}

/** Readable lines for the items that are on and that this result actually has. An empty list writes nothing. */
export function attributionMarkdown(metadata: FragmentMetadataV4, raw: CollectAttributionSnapshot): readonly string[] {
	const snapshot = collectAttributionSnapshot(raw);
	if (COLLECT_ATTRIBUTION_LINE_KEYS.every((key) => !snapshot[key])) return [];
	const labels = ATTRIBUTION_LABELS[snapshot.uiLanguage];
	const lines: string[] = [];
	if (snapshot.feature) lines.push(...fieldLines(labels.feature, featureName(metadata.type, labels)));
	if (snapshot.target) {
		const path = targetPath(metadata);
		if (path !== null) lines.push(...fieldLines(labels.target, path));
	}
	if (snapshot.vocabulary) lines.push(...vocabularyLines(labels.vocabulary, metadata.vocabulary.sources.map((source) => source.path)));
	if (snapshot.semantropy) {
		const value = semantropyValue(metadata);
		if (value !== null) lines.push(...fieldLines(labels.semantropy, String(value)));
	}
	if (snapshot.date) {
		if (snapshot.localDate === null) throw new Error("invalid-attribution-date");
		lines.push(...fieldLines(labels.date, snapshot.localDate));
	}
	return lines;
}

function featureName(type: FragmentMetadataV4["type"], labels: AttributionLabels): string {
	switch (type) {
		case "body": return labels.body;
		case "fake-dictionary": return labels.dictionary;
		case "collision": return labels.collision;
		case "fake-proverb": return labels.fakeProverb;
	}
}

function targetPath(metadata: FragmentMetadataV4): string | null {
	return metadata.type === "body" || metadata.type === "fake-dictionary" ? metadata.target.path : null;
}

function semantropyValue(metadata: FragmentMetadataV4): number | null {
	if (metadata.type === "body") return metadata.bodySemantropy;
	if (metadata.type === "fake-dictionary") return metadata.dictionarySemantropy;
	return null;
}

/** The label stays literal. The value is escaped, and its later lines sit deeper than the label line. */
function fieldLines(label: string, value: string): string[] {
	const [first = "", ...rest] = escapeFragmentMarkdown(value).split("\n");
	return [`${label}: ${first}`, ...rest.map((line) => `  ${line}`)];
}

function vocabularyLines(label: string, paths: readonly string[]): string[] {
	const lines: string[] = [];
	for (const [index, path] of paths.entries()) {
		const [first = "", ...rest] = escapeFragmentMarkdown(path).split("\n");
		lines.push(index === 0 ? `${label}: ${first}` : first);
		for (const line of rest) lines.push(`  ${line}`);
	}
	return lines;
}
