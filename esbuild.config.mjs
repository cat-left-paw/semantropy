import process from "process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildProductionMain,
	watchDevelopmentBuild,
} from "./scripts/buildDistribution.mjs";

const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
const prod = process.argv[2] === "production";

try {
	if (prod) {
		const built = await buildProductionMain({
			rootDir: pluginRoot,
			logLevel: "info",
			// The first build of a checkout with no dictionary cache prepares it
			// from the pinned archive; a verified cache is reused as it is.
			dictionaryBootstrap: { log: (line) => process.stdout.write(line + "\n") },
		});
		process.stdout.write(
			`\n[semantropy build]\n${JSON.stringify(
				{ bytes: built.bytes, sha256: built.sha256 },
				null,
				2,
			)}\n`,
		);
		process.exit(0);
	}

	await watchDevelopmentBuild({ rootDir: pluginRoot, logLevel: "info" });
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
