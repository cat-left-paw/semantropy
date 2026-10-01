/**
 * Builds the Semantropy web Playground into `dist-web/`.
 *
 *   node web/tools/buildWeb.mjs            production build (minified, hashed names)
 *   node web/tools/buildWeb.mjs --dev      unminified, fixed names
 *   node web/tools/buildWeb.mjs --serve    build, then serve dist-web on localhost
 *   node web/tools/buildWeb.mjs --dev --watch --serve
 *   node web/tools/buildWeb.mjs --serve-lan  build, then serve over HTTPS on the LAN
 *                                            (self-signed certificate, for phone checks)
 *
 * The web build checks the same inputs as the Obsidian build before bundling:
 * the generated Fake Dictionary / Collision / Fake Proverb data, the pinned
 * lindera-wasm package and the SHA-256-pinned compact dictionary. It never
 * touches `main.js`, `dist/` or anything under `src/`.
 */
import esbuild from "esbuild";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { networkInterfaces } from "node:os";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { COMPACT_DICTIONARY_SHA256, assertDictionaryHashes } from "../../scripts/lindera/dictionaryHashes.mjs";
import { ensureBuildDictionary } from "../../scripts/lindera/ensureDictionary.mjs";
import { buildLinderaNotice } from "../../scripts/lindera/linderaNotice.mjs";
import { assertLinderaWasmPackage } from "../../scripts/lindera/packageHashes.mjs";
import { linderaPayloadPlugin } from "../../scripts/lindera/linderaPayload.mjs";
import { assertStandardTemplatesGenerated } from "../../scripts/fakeDictionary/standardTemplates.mjs";
import { assertStandardCollisionPatternsGenerated } from "../../scripts/collision/standardPatterns.mjs";
import { assertStandardFakeProverbRecipesGenerated } from "../../scripts/fakeProverb/standardRecipes.mjs";
import {
	LINDERA_DICTIONARY_FILE_NAMES,
	LINDERA_NOTICE_FILE_NAME,
	assertDictionaryDir,
	assertLinderaWasmVersion,
	linderaCompactDictionaryDir,
	linderaWasmPath,
} from "../../scripts/lindera/linderaSource.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const webDir = path.join(rootDir, "web");
const outDir = path.join(rootDir, "dist-web");

const ENGINE_WASM_MEMBER = "lindera_wasm_bg.wasm";

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function checkInputs() {
	await assertStandardTemplatesGenerated({ rootDir });
	await assertStandardCollisionPatternsGenerated({ rootDir });
	await assertStandardFakeProverbRecipesGenerated({ rootDir });
	await assertLinderaWasmVersion(rootDir);
	await assertLinderaWasmPackage(rootDir);
	await ensureBuildDictionary(rootDir, { log: (line) => process.stdout.write(line + "\n") });
	const dictionaryDir = linderaCompactDictionaryDir(rootDir);
	const label = path.relative(rootDir, dictionaryDir).replaceAll("\\", "/");
	await assertDictionaryDir(dictionaryDir, label, [...LINDERA_DICTIONARY_FILE_NAMES, LINDERA_NOTICE_FILE_NAME]);
	await assertDictionaryHashes(dictionaryDir, COMPACT_DICTIONARY_SHA256, label);
	return dictionaryDir;
}

/** See web/src/engine/enginePack.ts for the format. Pure over the input bytes. */
async function buildEnginePack(dictionaryDir) {
	const members = [[ENGINE_WASM_MEMBER, linderaWasmPath(rootDir)], ...LINDERA_DICTIONARY_FILE_NAMES.map((name) => [name, path.join(dictionaryDir, name)])];
	const files = [];
	const blobs = [];
	let offset = 0;
	for (const [name, file] of members) {
		const gz = gzipSync(await readFile(file), { level: 9 });
		files.push({ name, offset, length: gz.byteLength });
		blobs.push(gz);
		offset += gz.byteLength;
	}
	const header = Buffer.from(JSON.stringify({ format: "semantropy-engine-pack", version: 1, files }), "utf8");
	const length = Buffer.alloc(4);
	length.writeUInt32LE(header.byteLength, 0);
	const pack = Buffer.concat([length, header, ...blobs]);
	return { pack, sha256: sha256(pack) };
}

async function readPresets() {
	// A missing or malformed manifest fails the build: a site without its
	// presets must not be published by accident.
	const manifestPath = path.join(webDir, "presets", "presets.json");
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	if (!Array.isArray(manifest) || manifest.length === 0) throw new Error("web/presets/presets.json lists no presets.");
	const presets = [];
	const files = [];
	for (const entry of manifest) {
		const source = path.join(webDir, "presets", entry.file);
		const text = await readFile(source, "utf8");
		const digest = sha256(Buffer.from(text, "utf8")).slice(0, 12);
		const published = `presets/${path.basename(entry.file, ".txt")}-${digest}.txt`;
		files.push({ source, published });
		presets.push({ id: entry.id, title: entry.title, author: entry.author, url: published, credit: entry.credit, chars: [...text].length });
	}
	return { presets, files };
}

async function readLicenses(dictionaryDir) {
	const parts = [];
	parts.push("Semantropy Web Playground — licenses and notices\n");
	parts.push("== Semantropy ==\n" + (await readFile(path.join(rootDir, "LICENSE"), "utf8")));
	parts.push("== NOTICE ==\n" + (await readFile(path.join(rootDir, "NOTICE"), "utf8")));
	parts.push("== Lindera WebAssembly and Semantropy compact IPADIC ==\n" + (await buildLinderaNotice(rootDir, dictionaryDir)));
	const lucide = path.join(rootDir, "node_modules", "lucide", "LICENSE");
	try {
		parts.push("== Lucide icons (lucide) ==\n" + (await readFile(lucide, "utf8")));
	} catch {
		throw new Error("The lucide LICENSE file is missing; run npm ci.");
	}
	parts.push("== Third-party notices ==\n" + (await readFile(path.join(rootDir, "THIRD_PARTY_NOTICES.md"), "utf8")));
	return parts.join("\n\n");
}

function bundleOptions({ dev, entry, outName, define = {} }) {
	return {
		absWorkingDir: rootDir,
		entryPoints: { [outName]: path.join(webDir, "src", entry) },
		outdir: path.join(outDir, "assets"),
		entryNames: dev ? "[name]" : "[name]-[hash]",
		bundle: true,
		format: "iife",
		platform: "browser",
		target: "es2021",
		treeShaking: true,
		minify: !dev,
		sourcemap: dev ? "linked" : false,
		sourcesContent: false,
		legalComments: "none",
		tsconfig: path.join(webDir, "tsconfig.json"),
		alias: { obsidian: path.join(webDir, "src", "obsidian", "index.ts") },
		define,
		metafile: true,
		logLevel: "warning",
		plugins: [linderaPayloadPlugin(rootDir, linderaCompactDictionaryDir(rootDir))],
	};
}

function outputName(result) {
	const outputs = Object.keys(result.metafile.outputs).filter((file) => file.endsWith(".js"));
	if (outputs.length !== 1) throw new Error("Expected exactly one JavaScript output.");
	return path.basename(outputs[0]);
}

async function writeAsset(relative, bytes) {
	const file = path.join(outDir, relative);
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, bytes);
}

export async function buildWeb({ dev = false } = {}) {
	const started = Date.now();
	const dictionaryDir = await checkInputs();
	await rm(outDir, { recursive: true, force: true });
	await mkdir(path.join(outDir, "assets"), { recursive: true });

	const { pack, sha256: packSha } = await buildEnginePack(dictionaryDir);
	const packName = `assets/engine-${packSha.slice(0, 16)}.bin`;
	await writeAsset(packName, pack);
	const enginePack = { url: packName, sha256: packSha, bytes: pack.byteLength };

	const worker = await esbuild.build(bundleOptions({ dev, entry: "engine/tokenizerWorker.ts", outName: "worker" }));
	const workerName = outputName(worker);

	const { presets, files: presetFiles } = await readPresets();
	for (const file of presetFiles) {
		await mkdir(path.dirname(path.join(outDir, file.published)), { recursive: true });
		await copyFile(file.source, path.join(outDir, file.published));
	}

	const app = await esbuild.build(bundleOptions({
		dev,
		entry: "main.ts",
		outName: "app",
		define: {
			__SEMANTROPY_WEB__: JSON.stringify({
				workerUrl: `assets/${workerName}`,
				enginePack,
				presets,
				buildLabel: dev ? "dev" : packSha.slice(0, 8),
			}),
		},
	}));
	const appName = outputName(app);

	const css = (await readFile(path.join(rootDir, "styles.css"), "utf8")) + "\n\n" + (await readFile(path.join(webDir, "styles", "web.css"), "utf8"));
	const cssName = dev ? "assets/semantropy.css" : `assets/semantropy-${sha256(Buffer.from(css)).slice(0, 12)}.css`;
	await writeAsset(cssName, css);

	await writeAsset("licenses.txt", await readLicenses(dictionaryDir));
	const html = (await readFile(path.join(webDir, "index.html"), "utf8"))
		.replace("%CSS%", cssName)
		.replace("%APP%", `assets/${appName}`);
	await writeAsset("index.html", html);
	await writeAsset(".nojekyll", "");

	const summary = {
		dev,
		ms: Date.now() - started,
		app: { file: `assets/${appName}`, bytes: (await stat(path.join(outDir, "assets", appName))).size },
		worker: { file: `assets/${workerName}`, bytes: (await stat(path.join(outDir, "assets", workerName))).size },
		enginePack: { file: packName, bytes: pack.byteLength, sha256: packSha },
		presets: presets.length,
	};
	process.stdout.write(`[semantropy web build]\n${JSON.stringify(summary, null, 2)}\n`);
	return summary;
}

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
	".map": "application/json",
	".bin": "application/octet-stream",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".webmanifest": "application/manifest+json",
};

async function handle(request, response) {
	try {
		const url = new URL(request.url ?? "/", "http://localhost");
		let relative = decodeURIComponent(url.pathname);
		if (relative.endsWith("/")) relative += "index.html";
		const file = path.join(outDir, relative);
		if (!file.startsWith(outDir)) throw new Error("outside");
		const body = await readFile(file);
		response.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
		response.end(body);
	} catch {
		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Not found");
	}
}

function serve(port) {
	createServer(handle).listen(port, "127.0.0.1", () => process.stdout.write(`Serving dist-web at http://localhost:${port}/\n`));
}

function lanAddresses() {
	return Object.values(networkInterfaces())
		.flat()
		.filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
		.map((entry) => entry.address);
}

/**
 * Phones need a secure context for Web Crypto, so the LAN server speaks HTTPS
 * with a self-signed certificate kept in `.cache/web-https/` (never committed).
 * The phone shows a certificate warning the first time; that is expected for a
 * local check and never applies to the published site. Only `--serve-lan`
 * listens beyond this computer.
 */
async function serveLan(port) {
	const dir = path.join(rootDir, ".cache", "web-https");
	await mkdir(dir, { recursive: true });
	const key = path.join(dir, "key.pem");
	const cert = path.join(dir, "cert.pem");
	const addresses = lanAddresses();
	const san = ["DNS:localhost", "IP:127.0.0.1", ...addresses.map((address) => `IP:${address}`)].join(",");
	// The certificate is kept while it still names these addresses, so a phone
	// that accepted it once does not have to accept a new one every start.
	const sanFile = path.join(dir, "san.txt");
	let reuse = false;
	try {
		reuse = (await readFile(sanFile, "utf8")) === san && (Date.now() - (await stat(cert)).mtimeMs) < 25 * 24 * 3600 * 1000;
	} catch {
		reuse = false;
	}
	if (!reuse) {
		// Our own minimal config, so an openssl without a usable default config
		// (Git for Windows' copy run from PowerShell) still works.
		const config = path.join(dir, "openssl.cnf");
		await writeFile(config, "[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = Semantropy local check\n");
		execFileSync(findOpenssl(), ["req", "-config", config, "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-addext", `subjectAltName=${san}`, "-keyout", key, "-out", cert], { stdio: "ignore" });
		await writeFile(sanFile, san);
	}
	const server = createHttpsServer({ key: await readFile(key), cert: await readFile(cert) }, handle);
	server.on("error", (error) => {
		console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Stop the other server or set PORT.` : error.message);
		process.exit(1);
	});
	server.listen(port, "0.0.0.0", () => {
		for (const address of addresses) process.stdout.write(`Serving dist-web at https://${address}:${port}/\n`);
		process.stdout.write("Open one of these on a phone on the same Wi-Fi. Stop with Ctrl+C.\n");
	});
}

/** openssl from OPENSSL, then PATH, then the copy Git for Windows ships. */
function findOpenssl() {
	const candidates = [process.env.OPENSSL, "openssl"];
	if (process.platform === "win32") {
		for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")]) {
			if (!base) continue;
			candidates.push(path.join(base, "Git", "mingw64", "bin", "openssl.exe"), path.join(base, "Git", "usr", "bin", "openssl.exe"));
		}
	}
	for (const candidate of candidates) {
		if (!candidate) continue;
		try {
			execFileSync(candidate, ["version"], { stdio: "ignore" });
			return candidate;
		} catch {
			// Try the next one.
		}
	}
	throw new Error("openssl was not found. Install Git for Windows, or set OPENSSL to the path of openssl.");
}

async function watch(dev) {
	const { watch: fsWatch } = await import("node:fs");
	let timer = null;
	let running = false;
	let again = false;
	const rebuild = () => {
		if (running) {
			again = true;
			return;
		}
		running = true;
		buildWeb({ dev })
			.catch((error) => console.error(error instanceof Error ? error.message : error))
			.finally(() => {
				running = false;
				if (again) {
					again = false;
					rebuild();
				}
			});
	};
	for (const dir of [path.join(webDir, "src"), path.join(webDir, "styles"), path.join(webDir, "presets"), path.join(rootDir, "src")]) {
		fsWatch(dir, { recursive: true }, () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(rebuild, 150);
		});
	}
	for (const file of [path.join(webDir, "index.html"), path.join(rootDir, "styles.css")]) {
		fsWatch(file, () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(rebuild, 150);
		});
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = new Set(process.argv.slice(2));
	const dev = args.has("--dev");
	try {
		await buildWeb({ dev });
		if (args.has("--watch")) await watch(dev);
		if (args.has("--serve")) serve(Number(process.env.PORT ?? 5174));
		if (args.has("--serve-lan")) await serveLan(Number(process.env.PORT ?? 5175));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
