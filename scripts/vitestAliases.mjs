import path from "node:path";

/**
 * Module aliases every Vitest suite uses.
 *
 * Three specifiers cannot resolve the way they do in a build:
 *
 *   obsidian                            ships types but no runnable entry, so
 *                                       anything importing it needs a stub;
 *   virtual:semantropy-lindera-wasm     is served by the esbuild plugin as
 *                                       rewritten glue, and resolves here to
 *                                       the installed glue, which has the same
 *                                       call signature;
 *   virtual:semantropy-lindera-payload  is generated during a build from the
 *                                       12 MB dictionary, and resolves here to
 *                                       a placeholder of the same shape.
 *
 * The rewritten glue and the real payload are covered instead by the
 * distribution suite, which runs the built artifact itself.
 */
export function vitestAliases(pluginRoot) {
	return [
		{
			find: /^obsidian$/,
			replacement: path.join(pluginRoot, "tests/support/obsidianStub.ts"),
		},
		{
			find: /^virtual:semantropy-lindera-wasm$/,
			replacement: path.join(
				pluginRoot,
				"node_modules/lindera-wasm/lindera_wasm.js",
			),
		},
		{
			find: /^virtual:semantropy-lindera-payload$/,
			replacement: path.join(pluginRoot, "tests/support/linderaPayloadStub.ts"),
		},
	];
}
