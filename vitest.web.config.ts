import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Web Playground tests: `obsidian` resolves to the web build's own module. */
export default defineConfig({
	resolve: {
		alias: [
			{ find: /^obsidian$/, replacement: path.join(root, "web/src/obsidian/index.ts") },
			{ find: /^virtual:semantropy-lindera-wasm$/, replacement: path.join(root, "node_modules/lindera-wasm/lindera_wasm.js") },
			{ find: /^virtual:semantropy-lindera-payload$/, replacement: path.join(root, "tests/support/linderaPayloadStub.ts") },
		],
	},
	test: {
		environment: "node",
		include: ["web/tests/**/*.test.ts"],
		testTimeout: 20000,
	},
});
