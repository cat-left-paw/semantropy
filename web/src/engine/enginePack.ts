/**
 * The engine pack: the Lindera WebAssembly module and the nine Semantropy
 * compact IPADIC files, each gzipped on its own, behind one small header.
 *
 *   u32 little-endian  header length in bytes
 *   UTF-8 JSON         { format, version, files: [{ name, offset, length }] }
 *   bytes              the gzip members, offsets relative to the end of the header
 *
 * One request fetches everything, and the build pins the SHA-256 of the whole
 * pack. Each member stays compressed until the Worker inflates it, so the page
 * never holds the whole dictionary uncompressed twice.
 */
export const ENGINE_PACK_FORMAT = "semantropy-engine-pack";
export const ENGINE_PACK_VERSION = 1;
export const ENGINE_WASM_MEMBER = "lindera_wasm_bg.wasm";

export type EnginePackInfo = {
	/** Relative to the page. */
	url: string;
	/** Lowercase hex SHA-256 of the whole pack. */
	sha256: string;
	bytes: number;
};

export type EnginePackHeader = {
	format: typeof ENGINE_PACK_FORMAT;
	version: typeof ENGINE_PACK_VERSION;
	files: { name: string; offset: number; length: number }[];
};

export class EnginePackError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EnginePackError";
	}
}

/** Splits a verified pack into its still-compressed members. */
export function readEnginePack(pack: Uint8Array<ArrayBuffer>): Map<string, Uint8Array<ArrayBuffer>> {
	if (pack.byteLength < 4) throw new EnginePackError("The engine pack is truncated.");
	const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
	const headerLength = view.getUint32(0, true);
	if (headerLength === 0 || 4 + headerLength > pack.byteLength) {
		throw new EnginePackError("The engine pack header is malformed.");
	}
	let header: EnginePackHeader;
	try {
		header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pack.subarray(4, 4 + headerLength))) as EnginePackHeader;
	} catch {
		throw new EnginePackError("The engine pack header is malformed.");
	}
	if (header?.format !== ENGINE_PACK_FORMAT || header.version !== ENGINE_PACK_VERSION || !Array.isArray(header.files)) {
		throw new EnginePackError("The engine pack has an unsupported format.");
	}
	const dataStart = 4 + headerLength;
	const members = new Map<string, Uint8Array<ArrayBuffer>>();
	for (const file of header.files) {
		const { name, offset, length } = file ?? {};
		if (typeof name !== "string" || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0) {
			throw new EnginePackError("The engine pack header is malformed.");
		}
		const start = dataStart + offset;
		if (start + length > pack.byteLength || members.has(name)) {
			throw new EnginePackError("The engine pack header is malformed.");
		}
		members.set(name, pack.subarray(start, start + length));
	}
	return members;
}

/**
 * Checks a downloaded pack against the SHA-256 the build pinned, before any of
 * it is parsed or inflated, and returns its members.
 */
export async function verifyEnginePack(pack: Uint8Array<ArrayBuffer>, expectedSha256: string): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
	if ((await sha256Hex(pack)) !== expectedSha256) throw new EnginePackError("The engine pack does not match the pinned digest.");
	return readEnginePack(pack);
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
