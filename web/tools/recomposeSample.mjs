/**
 * Development tool: prints Recompose samples from real texts, with the real
 * Lindera tokenizer and compact dictionary, so the methods can be compared.
 *
 *   node web/tools/recomposeSample.mjs [file.txt ...] [--sentences=3] [--runs=2] [--seed=1]
 *
 * With no files, the three presets are used together. Nothing is written.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const jiti = createJiti(import.meta.url);
const { toJapaneseTokensFromLindera } = await jiti.import(path.join(rootDir, "src/tokenizer/lindera/linderaToken.ts"));
const { LINDERA_DICTIONARY_FILE_NAMES } = await jiti.import(path.join(rootDir, "src/tokenizer/lindera/linderaPayload.ts"));
const { analyzeSelectedSource } = await jiti.import(path.join(rootDir, "src/application/analyzeSelectedSource.ts"));
const { createRecomposeModel, generateRecompose, recomposeText, recomposeCorpusFrom } = await jiti.import(path.join(rootDir, "src/recompose/recompose.ts"));
const { createSeededRandom } = await jiti.import(path.join(rootDir, "src/random/seededRandom.ts"));
const wasm = await import(path.join(rootDir, "node_modules/lindera-wasm/lindera_wasm.js").replaceAll("\\", "/").replace(/^([A-Za-z]):/u, "file:///$1:"));

const args = process.argv.slice(2);
const option = (name, fallback) => Number(args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const files = args.filter((arg) => !arg.startsWith("--"));
const inputs = files.length > 0 ? files : ["kumono-ito", "chumonno-oi-ryoriten", "yume-juya"].map((id) => path.join(rootDir, "web/presets", `${id}.txt`));

await wasm.default({ module_or_path: await readFile(path.join(rootDir, "node_modules/lindera-wasm/lindera_wasm_bg.wasm")) });
const dictDir = path.join(rootDir, ".cache/lindera/lindera-ipadic-6.0.0-semantropy-compact");
const buffers = await Promise.all(LINDERA_DICTIONARY_FILE_NAMES.map((name) => readFile(path.join(dictDir, name))));
const tokenizer = new wasm.Tokenizer(wasm.loadDictionaryFromBytes(...buffers.map((b) => new Uint8Array(b))), "normal", undefined);
const japanese = { tokenize: async (text) => toJapaneseTokensFromLindera(text, tokenizer.tokenize(text)) };

const sources = [];
for (const file of inputs) {
	const text = await readFile(file, "utf8");
	const analyzed = await analyzeSelectedSource({ text, sourcePath: path.basename(file), contentHash: String(text.length), tokenizer: japanese, mode: "target-prototype" });
	if (analyzed.status !== "ready") throw new Error(`Could not analyze ${file}`);
	sources.push({ path: path.basename(file), contentHash: String(text.length), projection: analyzed.projection, located: analyzed.located });
}
const corpus = recomposeCorpusFrom(sources);
process.stdout.write(`corpus: ${corpus.sentences.length} sentences, ${corpus.morphs.length} morphemes from ${corpus.sources.length} source(s)\n`);
const runs = option("runs", 2);
const sentences = option("sentences", 3);
let seed = option("seed", 1);
for (const method of ["joint", "ngram"]) {
	const started = performance.now();
	const model = createRecomposeModel(corpus, method);
	process.stdout.write(`\n=== ${method} (model ${Math.round(performance.now() - started)} ms)\n`);
	for (const leap of [0, 25, 50, 75, 100]) {
		for (let run = 0; run < runs; run += 1) {
			const units = generateRecompose(model, { sentences, leap }, createSeededRandom(seed++));
			const jumps = units.filter((unit) => unit.jump).length;
			process.stdout.write(`[leap ${String(leap).padStart(3)}] (${units.length} units, ${jumps} jumps) ${recomposeText(units)}\n`);
		}
	}
}
