export type SourceSnapshot = {
	sourcePath: string;
	sourceName: string;
	text: string;
	contentHash: string;
};

export function createSourceSnapshot(input: {
	sourcePath: string;
	sourceName: string;
	text: string;
	contentHash: string;
}): SourceSnapshot {
	return Object.freeze({
		sourcePath: input.sourcePath,
		sourceName: input.sourceName,
		text: input.text,
		contentHash: input.contentHash,
	});
}
