export declare function publishDirectories(
	entries: { staged: string; target: string }[],
	options: {
		backupDir: string;
		renameImpl?: (from: string, to: string) => Promise<void>;
	},
): Promise<{
	rollback(): Promise<void>;
	commit(): void;
}>;
