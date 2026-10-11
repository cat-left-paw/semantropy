import { ui } from "../i18n/catalog";

/**
 * The words after a Vocabulary Source's path when it is not as it was: gone from the Vault's listing, changed since it was read, or
 * missing. One definition for the picker's selected-notes list and for the summary's list of Sources (WORKBENCH-UI5, review 3,
 * P3 4), so the two cannot say it differently. It reads no note: `listed` comes from the Vault's listing of paths, `reason` from
 * the View's stale Sources. An empty string is a Source that is as it was.
 */
export function vocabularySourceMark(listed: boolean, reason: string | undefined): string {
	const v = ui().vocabulary;
	const notes = [!listed ? v.notFound : "", reason === "changed" ? v.issueChanged : reason === "missing" ? v.issueMissing : ""].filter(Boolean);
	return notes.length > 0 ? v.issues(notes) : "";
}
