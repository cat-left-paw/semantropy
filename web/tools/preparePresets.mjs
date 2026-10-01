/**
 * Prepares the Aozora Bunko presets for the web Playground.
 *
 *   node web/tools/preparePresets.mjs
 *
 * Downloads each listed work's official ruby text archive from aozora.gr.jp,
 * decodes it from Shift_JIS and writes `web/presets/<id>.txt` plus
 * `web/presets/presets.json`. The output is committed, so the web build never
 * reaches the network for presets; this script is only for adding or
 * refreshing a work.
 *
 * What changes in the text:
 *   - the title becomes a Markdown `#` heading; the author line and the
 *     "記号について" block are removed (the author is shown with the credit);
 *   - `［＃N字下げ］X［＃「X」は中見出し］` becomes a `##` heading (大見出し `#`,
 *     小見出し `###`);
 *   - other layout annotations (`［＃…］` not preceded by `※`) are removed;
 *   - 外字 annotations (`※［＃…］`) become the character they describe, from
 *     the explicit GAIJI table; an annotation missing from the table stops the
 *     script, so a new preset cannot ship a raw annotation by accident;
 *   - ruby (`｜…《…》`) is kept as written: Semantropy shows it as ruby, and
 *     the reading is never analyzed, drawn or copied;
 *   - the colophon from `底本：` onward is moved out of the text into the
 *     preset's credit, unchanged.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readZipEntries } from "../../scripts/lindera/linderaSource.mjs";

const PRESETS = [
	{ id: "kumono-ito", title: "蜘蛛の糸", author: "芥川龍之介", card: "https://www.aozora.gr.jp/cards/000879/card92.html", zip: "https://www.aozora.gr.jp/cards/000879/files/92_ruby_164.zip" },
	{ id: "chumonno-oi-ryoriten", title: "注文の多い料理店", author: "宮沢賢治", card: "https://www.aozora.gr.jp/cards/000081/card43754.html", zip: "https://www.aozora.gr.jp/cards/000081/files/43754_ruby_17594.zip" },
	{ id: "yume-juya", title: "夢十夜", author: "夏目漱石", card: "https://www.aozora.gr.jp/cards/000148/card799.html", zip: "https://www.aozora.gr.jp/cards/000148/files/799_ruby_6024.zip" },
];

const presetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "presets");

async function download(url) {
	const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
	return Buffer.from(await response.arrayBuffer());
}

/** `readZipEntries` inflates each member and checks its size and CRC-32. */
function extractText(archive) {
	const entries = readZipEntries(archive).filter((entry) => entry.content && entry.name.toLowerCase().endsWith(".txt"));
	if (entries.length !== 1) throw new Error("Expected exactly one .txt in the archive.");
	return new TextDecoder("shift_jis", { fatal: true }).decode(entries[0].content);
}

/**
 * The 外字 notes the presets contain, each mapped to the Unicode character its
 * description composes. Add an entry, and check the glyph, when a new preset
 * needs one.
 */
const GAIJI = new Map([
	["※［＃「特のへん＋廴＋聿」、第3水準1-87-71］", "犍"],
	["※［＃「目＋爭」、第3水準1-88-85］", "睜"],
	["※［＃「楫のつくり＋戈」、第3水準1-84-66］", "戢"],
]);
const GAIJI_NOTE = /※［＃[^［］\n]*］/gu;

const HEADING = /^［＃[^］]*］(.+?)［＃「\1」は(大|中|小)見出し］$/u;
const LAYOUT_ANNOTATION = /(?<!※)［＃[^［］\n]*］/gu;

export function convertAozoraText(raw, { title, author }) {
	const lines = raw.replace(/\r\n?/gu, "\n").split("\n");
	if (lines[0]?.trim() !== title || lines[1]?.trim() !== author) {
		throw new Error(`Unexpected header for ${title}: ${lines[0]} / ${lines[1]}`);
	}
	let start = 2;
	const firstRule = lines.findIndex((line, index) => index >= 2 && /^-{10,}$/u.test(line));
	if (firstRule >= 0 && firstRule < 10) {
		const secondRule = lines.findIndex((line, index) => index > firstRule && /^-{10,}$/u.test(line));
		if (secondRule < 0) throw new Error(`Unclosed notation block in ${title}`);
		start = secondRule + 1;
	}
	let end = lines.length;
	for (let index = lines.length - 1; index >= start; index -= 1) {
		if (lines[index].startsWith("底本：")) {
			end = index;
			break;
		}
	}
	if (end === lines.length) throw new Error(`No colophon found in ${title}`);
	const credit = lines.slice(end).join("\n").trim();
	const body = lines.slice(start, end).map((line) => {
		const heading = HEADING.exec(line.trim());
		if (heading) {
			const level = heading[2] === "大" ? "#" : heading[2] === "中" ? "##" : "###";
			return `${level} ${heading[1]}`;
		}
		return line
			.replace(GAIJI_NOTE, (note) => {
				const char = GAIJI.get(note);
				if (!char) throw new Error(`No character is recorded for ${note} in ${title}; add it to GAIJI.`);
				return char;
			})
			.replace(LAYOUT_ANNOTATION, "");
	});
	const text = `# ${title}\n\n${body.join("\n").replace(/^\n+/u, "").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
	return { text, credit };
}

async function main() {
	await mkdir(presetsDir, { recursive: true });
	const manifest = [];
	for (const preset of PRESETS) {
		const raw = extractText(await download(preset.zip));
		const { text, credit } = convertAozoraText(raw, preset);
		const file = `${preset.id}.txt`;
		await writeFile(path.join(presetsDir, file), text, "utf8");
		manifest.push({
			id: preset.id,
			title: preset.title,
			author: preset.author,
			file,
			credit: `${preset.author}「${preset.title}」\n出典: 青空文庫 ${preset.card}\n（見出しと外字の注記を文字に変換し、字下げなどの組版注記を除いています）\n${credit}`,
		});
		process.stdout.write(`${preset.id}: ${[...text].length} characters\n`);
	}
	await writeFile(path.join(presetsDir, "presets.json"), JSON.stringify(manifest, null, "\t") + "\n", "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
