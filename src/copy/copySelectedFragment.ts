export type ClipboardWriter = {
	writeText(text: string): Promise<void>;
};

export type CopyFragmentResult = "copied" | "failed";

/**
 * Writes one already-captured string to the clipboard.
 *
 * There is no `execCommand` fallback, no second attempt, and no logging.
 * The caller is responsible for refusing an empty selection before this runs,
 * and for showing a Notice that never interpolates `text`.
 */
export async function copySelectedFragment(
	text: string,
	clipboard: ClipboardWriter,
): Promise<CopyFragmentResult> {
	try {
		await clipboard.writeText(text);
		return "copied";
	} catch {
		return "failed";
	}
}
