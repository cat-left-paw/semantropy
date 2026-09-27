export const DICTIONARY1_BASELINE_COMMIT: string;
export const DICTIONARY1_BASELINE_SHA256: string;
export const LEGACY_DICTIONARY_HASHES: Readonly<Record<string, string>>;
export function verifyManualMorphBaseline(directory: string): Promise<void>;
export function prepareManualMorphBaseline(rootDir: string): Promise<{ directory: string; cleanup(): Promise<void> }>;
