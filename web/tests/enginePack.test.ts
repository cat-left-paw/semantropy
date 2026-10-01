import { describe, expect, it } from "vitest";
import { EnginePackError, readEnginePack, sha256Hex, verifyEnginePack } from "../src/engine/enginePack";

function pack(files: { name: string; bytes: number[] }[], header?: unknown): Uint8Array<ArrayBuffer> {
	let offset = 0;
	const entries = files.map((file) => {
		const entry = { name: file.name, offset, length: file.bytes.length };
		offset += file.bytes.length;
		return entry;
	});
	const json = new TextEncoder().encode(JSON.stringify(header ?? { format: "semantropy-engine-pack", version: 1, files: entries }));
	const out = new Uint8Array(new ArrayBuffer(4 + json.length + offset));
	new DataView(out.buffer).setUint32(0, json.length, true);
	out.set(json, 4);
	let at = 4 + json.length;
	for (const file of files) {
		out.set(file.bytes, at);
		at += file.bytes.length;
	}
	return out;
}

describe("engine pack", () => {
	it("returns each member's bytes without copying the pack", () => {
		const members = readEnginePack(pack([{ name: "a", bytes: [1, 2, 3] }, { name: "b", bytes: [9] }]));
		expect([...members.get("a")!]).toEqual([1, 2, 3]);
		expect([...members.get("b")!]).toEqual([9]);
	});

	it("refuses a truncated pack, a foreign format and out-of-range members", () => {
		expect(() => readEnginePack(new Uint8Array(new ArrayBuffer(2)))).toThrow(EnginePackError);
		expect(() => readEnginePack(pack([], { format: "other", version: 1, files: [] }))).toThrow(EnginePackError);
		expect(() => readEnginePack(pack([{ name: "a", bytes: [1] }], {
			format: "semantropy-engine-pack", version: 1, files: [{ name: "a", offset: 0, length: 5 }],
		}))).toThrow(EnginePackError);
		expect(() => readEnginePack(pack([{ name: "a", bytes: [1] }], {
			format: "semantropy-engine-pack", version: 1, files: [{ name: "a", offset: 0, length: 1 }, { name: "a", offset: 0, length: 1 }],
		}))).toThrow(EnginePackError);
	});

	it("parses a pack only after its whole-pack SHA-256 matches the pinned value", async () => {
		const bytes = pack([{ name: "a", bytes: [1, 2, 3] }]);
		const digest = await sha256Hex(bytes);
		expect([...(await verifyEnginePack(bytes, digest)).get("a")!]).toEqual([1, 2, 3]);
		const tampered = bytes.slice();
		tampered[tampered.length - 1] = 9;
		await expect(verifyEnginePack(tampered, digest)).rejects.toBeInstanceOf(EnginePackError);
		await expect(verifyEnginePack(bytes, "0".repeat(64))).rejects.toBeInstanceOf(EnginePackError);
	});
});
