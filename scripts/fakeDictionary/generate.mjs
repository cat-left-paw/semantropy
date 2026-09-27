/** Regenerates the typed standard template data from its Markdown document. */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { writeStandardTemplates } from "./standardTemplates.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

try {
	const result = await writeStandardTemplates({ rootDir });
	process.stdout.write(
		`\n[semantropy generate:templates]\n${JSON.stringify(result, null, 2)}\n`,
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
