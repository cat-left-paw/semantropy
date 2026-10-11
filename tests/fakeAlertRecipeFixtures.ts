/**
 * A small valid Fake Alert recipe set, as raw typed data, its Markdown
 * rendering, and helpers that change one thing in it, so one mutation can be
 * pushed through the compiler and the parser alike. It imports only
 * `src/fakeAlert/`, so the compiler tests run without the build scripts.
 */
import { compileFakeAlertRecipeSet, type CompileFakeAlertRecipeSetInput } from "../src/fakeAlert/compileRecipeSet";
import type { RawFakeAlertFamily, RawFakeAlertRecipe } from "../src/fakeAlert/recipeData";
import type { FakeAlertRecipeSet } from "../src/fakeAlert/recipeSet";

export type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };
export type Input = Mutable<CompileFakeAlertRecipeSetInput>;

export function baseInput(): Input {
	return {
		schemaVersion: 1,
		dataVersion: 1,
		families: [
			{ id: "ask", stage: "prompt", weight: 2, drift: 0 },
			{ id: "blurt", stage: "terminal", weight: 1, drift: 2 },
			{ id: "fine", stage: "outcome", weight: 2, drift: 0, on: "affirm" },
			{ id: "stop", stage: "outcome", weight: 2, drift: 0, on: "deny" },
			{ id: "odd", stage: "outcome", weight: 1, drift: 2, on: "any" },
		],
		prompts: [
			{ id: "p-noun", family: "ask", enabled: true, kind: "confirmation", buttons: "yes-no", weight: 1, lines: ["{n1}は{n2}ですか？"] },
			{ id: "p-act", family: "ask", enabled: true, kind: "warning", buttons: "ok-cancel", weight: 1, lines: ["{n1}を{s1}しますか？"] },
		],
		terminals: [{ id: "t-one", family: "blurt", enabled: true, kind: "information", weight: 1, lines: ["{s1}中です。"] }],
		outcomes: [
			{ id: "o-fine", family: "fine", enabled: true, kind: "success", weight: 1, lines: ["{n1}を完了しました。"] },
			{ id: "o-stop", family: "stop", enabled: true, kind: "information", weight: 1, lines: ["取り消しました。"] },
			{ id: "o-odd", family: "odd", enabled: true, kind: "error", weight: 1, lines: ["{n1}を{s1}できませんでした。", "代わりに{+n1}を{+s1}しました。"] },
		],
	};
}

export function render(input: CompileFakeAlertRecipeSetInput): string {
	const lines = ["# Test recipes", "", `schema-version: ${input.schemaVersion}`, `data-version: ${input.dataVersion}`, ""];
	for (const family of input.families) {
		lines.push(`## family ${family.id}`, `stage: ${family.stage}`, `weight: ${family.weight}`, `drift: ${family.drift}`,
			...(family.on === undefined ? [] : [`on: ${family.on}`]), "");
	}
	for (const [kind, list] of [["prompt", input.prompts], ["terminal", input.terminals], ["outcome", input.outcomes]] as const) {
		for (const recipe of list) {
			lines.push(`## ${kind} ${recipe.id}`, `family: ${recipe.family}`, `enabled: ${String(recipe.enabled)}`, `kind: ${recipe.kind}`,
				...(recipe.buttons === undefined ? [] : [`buttons: ${recipe.buttons}`]), `weight: ${recipe.weight}`,
				...recipe.lines.map((line) => `line: ${line}`), "");
		}
	}
	return lines.join("\n");
}

export function compileCodes(input: unknown): readonly string[] {
	const result = compileFakeAlertRecipeSet(input as CompileFakeAlertRecipeSetInput);
	return result.ok ? [] : result.issues.map((entry) => entry.code);
}

export function compiled(input: CompileFakeAlertRecipeSetInput): FakeAlertRecipeSet {
	const result = compileFakeAlertRecipeSet(input);
	if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.code} ${entry.id}`).join("; "));
	return result.set;
}

export type Edit = (input: Input) => void;
export const family = (input: Input, id: string): Mutable<RawFakeAlertFamily> => {
	const index = input.families.findIndex((entry) => entry.id === id);
	const copy = { ...input.families[index]! };
	input.families[index] = copy;
	return copy;
};
export function recipe(input: Input, id: string): Mutable<RawFakeAlertRecipe> {
	for (const list of [input.prompts, input.terminals, input.outcomes]) {
		const index = list.findIndex((entry) => entry.id === id);
		if (index === -1) continue;
		const copy = { ...list[index]!, lines: [...list[index]!.lines] };
		list[index] = copy;
		return copy;
	}
	throw new Error(`no recipe ${id}`);
}
export const edited = (edit: Edit): Input => {
	const input = baseInput();
	edit(input);
	return input;
};
/** One line replaced in the drift-2 outcome, which no coverage rule depends on. */
export const oddLine = (text: unknown): Input => edited((input) => { (recipe(input, "o-odd") as { lines: unknown[] }).lines = [text]; });
