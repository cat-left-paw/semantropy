export declare const STANDARD_TEMPLATES_MARKDOWN: string;
export declare const STANDARD_TEMPLATES_GENERATED: string;
export declare const GENERATE_COMMAND: string;
export declare const TEMPLATE_SCHEMA_VERSION: number;

export type TemplateSourceIssue = {
	readonly code: string;
	readonly line: number;
	readonly detail?: string;
};

export type RawParsedCoreTemplate = {
	readonly id: string;
	readonly family: string;
	readonly text: string;
};

export type RawParsedOptionalClause = {
	readonly id: string;
	readonly category: string;
	readonly text: string;
};

export type ParsedTemplateDocument = {
	readonly schemaVersion: number;
	readonly dataVersion: number;
	readonly coreTemplates: readonly RawParsedCoreTemplate[];
	readonly optionalClauses: readonly RawParsedOptionalClause[];
};

export type ParseTemplateDocumentResult =
	| ({ readonly ok: true } & ParsedTemplateDocument)
	| { readonly ok: false; readonly issues: readonly TemplateSourceIssue[] };

export declare function parseStandardTemplateMarkdown(
	markdown: string,
): ParseTemplateDocumentResult;

export declare function describeTemplateSourceIssue(
	issue: TemplateSourceIssue,
): string;

export declare function describeTemplateSourceIssues(
	issues: readonly TemplateSourceIssue[],
): string;

export declare function renderGeneratedTemplateModule(
	parsed: ParsedTemplateDocument,
): string;

/**
 * `markdownPath` and `generatedPath` override the two files this module would
 * otherwise derive from `rootDir`. They exist so a test can exercise a stale or
 * malformed module in a temporary directory instead of editing the checkout;
 * they cannot make a comparison vacuous, because the document is still the only
 * thing the generated text is derived from.
 */
export type TemplatePathOptions = {
	rootDir?: string;
	markdownPath?: string;
	generatedPath?: string;
};

export declare function generateStandardTemplates(
	options?: TemplatePathOptions & { markdown?: string },
): Promise<{
	parsed: ParsedTemplateDocument;
	compiled: unknown;
	source: string;
}>;

export declare function assertStandardTemplatesGenerated(
	options?: TemplatePathOptions,
): Promise<{ schemaVersion: number; dataVersion: number }>;

export type TemplateGuardBuild = {
	onStart: (
		callback: () => Promise<{ errors?: { text: string }[] } | null>,
	) => void;
	onLoad: (
		options: { filter: RegExp },
		callback: (args: { path: string }) => Promise<{
			contents: string;
			loader: string;
			watchFiles: string[];
		} | null>,
	) => void;
};

/** The esbuild plugin that repeats the check on every build and rebuild. */
export declare function standardTemplatesPlugin(rootDir: string): {
	name: string;
	setup: (build: TemplateGuardBuild) => void;
};

export declare function writeStandardTemplates(options?: TemplatePathOptions): Promise<{
	outfile: string;
	schemaVersion: number;
	dataVersion: number;
	coreTemplates: number;
	optionalClauses: number;
}>;
