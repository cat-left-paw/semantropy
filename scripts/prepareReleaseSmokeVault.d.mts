export type PreparedReleaseSmokeVault = {
	vaultPath: string;
	pluginPath: string;
	version: string;
	assets: { name: string; bytes: number; sha256: string }[];
};

export declare function prepareReleaseSmokeVault(options?: {
	distributionDir?: string;
	temporaryRoot?: string;
}): Promise<PreparedReleaseSmokeVault>;
