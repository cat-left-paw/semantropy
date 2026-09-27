export type MarkdownSourceCapture = {
	sourcePath: string;
	sourceName: string;
	editorText: string | null;
};

export type SourceCapture =
	| { kind: "none" }
	| { kind: "markdown"; note: MarkdownSourceCapture };

export type CachedReadFn = (sourcePath: string) => Promise<string>;

export type SelectedSourceText = {
	sourcePath: string;
	sourceName: string;
	text: string;
};

export async function selectSourceText(
	note: MarkdownSourceCapture,
	readCached: CachedReadFn,
): Promise<SelectedSourceText> {
	if (note.editorText !== null) {
		return {
			sourcePath: note.sourcePath,
			sourceName: note.sourceName,
			text: note.editorText,
		};
	}

	const text = await readCached(note.sourcePath);
	return {
		sourcePath: note.sourcePath,
		sourceName: note.sourceName,
		text,
	};
}
