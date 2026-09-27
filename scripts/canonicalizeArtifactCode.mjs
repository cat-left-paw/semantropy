import { parse } from "acorn";
import { analyze } from "eslint-scope";

/**
 * Produce a cross-platform digest input for an esbuild-minified artifact.
 * Native esbuild builds can assign different one- or two-character names to
 * the same local bindings. Resolve each reference to its declaration and name
 * bindings by declaration order instead. Property names, unresolved globals,
 * literals, operators and the binding/reference graph remain in the digest.
 * This is only for the distribution test; it never changes the shipped code.
 */
export function canonicalizeMinifiedIdentifiers(code) {
	const ast = parse(code, { ecmaVersion: "latest", sourceType: "script", ranges: true });
	const scopeManager = analyze(ast, {
		ecmaVersion: 2022,
		sourceType: "script",
		optimistic: true,
		ignoreEval: true,
	});
	const shortBindings = [];
	for (const scope of scopeManager.scopes) {
		for (const variable of scope.variables) {
			if (variable.identifiers.length && variable.identifiers[0].name.length <= 2) {
				shortBindings.push(variable);
			}
		}
	}
	shortBindings.sort((left, right) => left.identifiers[0].start - right.identifiers[0].start);
	const canonicalNames = new Map(shortBindings.map((variable, index) => [variable, `@${index}@`]));
	const replacements = new Map();
	for (const variable of shortBindings) {
		for (const identifier of variable.identifiers) {
			replacements.set(identifier.start, [identifier.end, canonicalNames.get(variable)]);
		}
	}
	for (const scope of scopeManager.scopes) {
		for (const reference of scope.references) {
			const name = canonicalNames.get(reference.resolved);
			if (name !== undefined) {
				replacements.set(reference.identifier.start, [reference.identifier.end, name]);
			}
		}
	}

	const pieces = [];
	let cursor = 0;
	for (const [start, [end, name]] of [...replacements].sort((left, right) => left[0] - right[0])) {
		if (start < cursor) throw new Error("Overlapping artifact identifier spans.");
		pieces.push(code.slice(cursor, start), name);
		cursor = end;
	}
	pieces.push(code.slice(cursor));
	return pieces.join("");
}
