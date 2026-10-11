/** Regenerates the typed standard Fake Alert recipe data from its Markdown document. */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { writeStandardFakeAlertRecipes } from "./standardRecipes.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

try {
	const result = await writeStandardFakeAlertRecipes({ rootDir });
	process.stdout.write(
		`\n[semantropy generate:fake-alert-recipes]\n${JSON.stringify(result, null, 2)}\n`,
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
