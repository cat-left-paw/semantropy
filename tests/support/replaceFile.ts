import { rename, writeFile } from "node:fs/promises";

/**
 * Replaces a file's content in one step (TEST-STABILITY1): the new bytes are
 * written beside it and renamed over it. `writeFile` truncates first, so a
 * watcher or reader under load could see the empty file in between.
 */
export async function replaceFile(file: string, content: string): Promise<void> {
	const staged = `${file}.${process.pid}.staged`;
	await writeFile(staged, content, "utf8");
	await rename(staged, file);
}
