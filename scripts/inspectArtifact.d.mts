import type { DistributionArtifactFile } from "./buildDistribution.mjs";

export type ArtifactInspection = {
	outDir: string;
	files: DistributionArtifactFile[];
	fileNames: string[];
	unexpected: string[];
	bannerBytes: number;
	codeBytes: number;
	maskedCodeBytes: number;
	payloadLiteralCount: number;
	payloadChars: number;
	leakedMachineMarkers: string[];
	runtimeDependencyMarkers: string[];
	kuromojiMarkers: string[];
	timestampMarkers: string[];
	missingDictionaryKeys: string[];
	totalBytes: number;
};

export declare function inspectArtifact(
	outDir: string,
	rootDir?: string,
): Promise<ArtifactInspection>;
