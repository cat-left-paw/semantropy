export type DistributionArtifactFile = {
	fileName: string;
	bytes: number;
	sha256: string;
};

export type DistributionBuildResult = {
	outDir: string;
	bannerBytes: number;
	linderaWasmPackage: { verifiedAgainstPinnedHashes: boolean };
	dictionary: {
		dir: string;
		verifiedAgainstPinnedHashes: boolean;
		files: { fileName: string; bytes: number }[];
		totalBytes: number;
	};
	files: DistributionArtifactFile[];
};

export type ProductionBuildResult = {
	outfile: string;
	bytes: number;
	sha256: string;
	bannerBytes: number;
	linderaWasmPackage: { verifiedAgainstPinnedHashes: boolean };
	dictionary: { dir: string; verifiedAgainstPinnedHashes: boolean };
};

export declare const DISTRIBUTION_FILE_NAMES: string[];
export declare const DEFAULT_DISTRIBUTION_DIR: string;

/**
 * `rootDir` and `dictionaryDir` choose which trees to read. Their contents are
 * always checked against the pinned LINDERA_WASM_PACKAGE_SHA256 and
 * COMPACT_DICTIONARY_SHA256; there is no option to supply different expected
 * hashes.
 */
export type BundleBuildOptions = {
	rootDir?: string;
	dictionaryDir?: string;
	logLevel?: string;
};

/**
 * Opt-in dictionary preparation for the production and distribution builds.
 * Presence enables it; `prepare` and `fetchImpl` are for tests. It cannot be
 * combined with `dictionaryDir`, and it never replaces the post-preparation
 * hash verification.
 */
export type DictionaryBootstrapOptions = {
	prepare?: (options: {
		rootDir: string;
		allowDownload: boolean;
		fetchImpl?: typeof fetch;
	}) => Promise<{ archive: { reusedCache: boolean; url: string; bytes: number; sha256: string } }>;
	fetchImpl?: typeof fetch;
	log?: (line: string) => void;
};

export type BootstrappedBuildOptions = BundleBuildOptions & {
	dictionaryBootstrap?: DictionaryBootstrapOptions;
};

/** The one bundle definition shared by the production, distribution and watch builds. */
export declare function bundleOptions(
	rootDir: string,
	options: {
		outfile: string;
		banner: string;
		dictionaryDir?: string;
		minify: boolean;
		sourcemap: boolean | string;
	},
): { plugins: { name: string }[] } & Record<string, unknown>;

export declare function buildProductionMain(
	options?: BootstrappedBuildOptions & { outfile?: string },
): Promise<ProductionBuildResult>;

export declare function watchDevelopmentBuild(
	options?: BundleBuildOptions & { outfile?: string },
): Promise<{ dispose(): Promise<void> }>;

export declare function buildDistribution(
	options?: BootstrappedBuildOptions & {
		outDir?: string;
		/** For tests: injects a failure into the moves that publish the directory. */
		renameImpl?: (from: string, to: string) => Promise<void>;
	},
): Promise<DistributionBuildResult>;
