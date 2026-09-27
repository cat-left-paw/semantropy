import { expect, it, vi } from "vitest";
import { issueFragmentIdentity } from "../src/collect/fragmentIdentity";
import { isFragmentCreated, isFragmentId } from "../src/collect/fragmentIdentityValidation";
import { buildCollectedFragmentV3, captureFragmentIdentityV3, captureFragmentMetadataV3, type CollectedFragmentV3, type FragmentMetadataV3 } from "../src/collect/v3/CollectedFragmentV3";
import { serializeFragmentEntryV3, serializeFragmentMetadataV3 } from "../src/collect/v3/serializeFragmentV3";
import { MarkdownFragmentRepositoryV3 } from "../src/collect/v3/FragmentRepositoryV3";
import { bodyV3, fragmentV3, identityV3, inputsV3 } from "./collectV3Fixtures";

const badIds = ["not-a-uuid", "", " ", "a".repeat(32), `${identityV3.id}\n`, ` ${identityV3.id}`, identityV3.id.replace("1111", "gggg"), 1, null];
const badCreated = ["not-a-time", "", " ", "2026-09-05", "2026-09-05T12:34:56Z", "2026-09-05T12:34:56.0Z", "2026-09-05T12:34:56.0000Z",
	"2026-09-05T12:34:56.000+00:00", "2026-09-05T21:34:56.000+09:00", "2026-09-05T12:34:56.000z", "2026-02-30T00:00:00.000Z", "1900-02-29T00:00:00.000Z",
	"2026-09-05T24:00:00.000Z", "+001970-01-01T00:00:00.000Z", `${identityV3.created}\n`, 0, null];

it("shares the legacy UUID grammar without adding a version restriction", () => {
	for (const id of [identityV3.id, "ABCDEFAB-ABCD-ABCD-ABCD-ABCDEFABCDEF", "00000000-0000-0000-0000-000000000000"])
		expect(isFragmentId(id)).toBe(true);
	for (const id of badIds) expect(isFragmentId(id)).toBe(false);
});
it("accepts only the issuer's canonical UTC ISO representation", () => {
	for (const created of badCreated) expect(isFragmentCreated(created), String(created)).toBe(false);
	for (const created of [identityV3.created, "2000-02-29T23:59:59.999Z", "0000-01-01T00:00:00.000Z", "-000001-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z", "-271821-04-20T00:00:00.000Z", "+275760-09-13T00:00:00.000Z"])
		expect(isFragmentCreated(created), created).toBe(true);
});
it("preserves issuance for the full ordinary Date range and offsets", () => {
	const ids = [identityV3.id, "ABCDEFAB-ABCD-ABCD-ABCD-ABCDEFABCDEF", "00000000-0000-0000-0000-000000000000"];
	for (const id of ids) for (const time of [-8.64e15, -62167219200000, -1, 0, 1, 951868799999, 8.64e15]) {
		const date = new Date(time), expected = { id, created: date.toISOString() };
		const identity = issueFragmentIdentity(() => id, () => date);
		expect(identity).toEqual(expected); expect(captureFragmentIdentityV3(identity)).toEqual(expected);
	}
	expect(issueFragmentIdentity(() => identityV3.id, () => new Date("2026-09-05T21:34:56+09:00"))).toEqual(identityV3);
});
it("rejects broken identity callbacks without issuing a replacement", () => {
	const now = vi.fn(() => new Date(identityV3.created));
	for (const id of badIds) expect(() => issueFragmentIdentity(() => id as string, now)).toThrow("The fragment id source did not return a UUID.");
	expect(now).not.toHaveBeenCalled();
	const broken = new Date(identityV3.created); broken.toISOString = () => "not-a-time";
	const newId = vi.fn(() => identityV3.id), badClock = vi.fn(() => broken);
	expect(() => issueFragmentIdentity(newId, badClock)).toThrow("The fragment clock did not return a usable time.");
	expect(newId).toHaveBeenCalledTimes(1); expect(badClock).toHaveBeenCalledTimes(1);
});
it("rejects invalid ids at every direct metadata serializer boundary", () => {
	for (const input of inputsV3()) for (const id of badIds) {
		const metadata = { ...fragmentV3(input).metadata, id } as FragmentMetadataV3;
		expect(() => captureFragmentMetadataV3(metadata)).toThrow("invalid-fragment-fields");
		expect(() => serializeFragmentMetadataV3(metadata)).toThrow("invalid-fragment-fields");
		expect(() => serializeFragmentEntryV3({ text: input.text, metadata })).toThrow("invalid-fragment-fields");
	}
});
it("rejects invalid created values at every direct metadata serializer boundary", () => {
	for (const input of inputsV3()) for (const created of badCreated) {
		const metadata = { ...fragmentV3(input).metadata, created } as FragmentMetadataV3;
		expect(() => captureFragmentMetadataV3(metadata)).toThrow("invalid-fragment-fields");
		expect(() => serializeFragmentMetadataV3(metadata)).toThrow("invalid-fragment-fields");
		expect(() => serializeFragmentEntryV3({ text: input.text, metadata })).toThrow("invalid-fragment-fields");
	}
});
it("revalidates builder identities without invoking accessors", () => {
	for (const id of badIds) expect(() => buildCollectedFragmentV3(bodyV3(), { ...identityV3, id } as typeof identityV3)).toThrow("invalid-fragment-fields");
	for (const created of badCreated) expect(() => buildCollectedFragmentV3(bodyV3(), { ...identityV3, created } as typeof identityV3)).toThrow("invalid-fragment-fields");
	const getter = vi.fn(() => identityV3.id), identity = Object.defineProperty({ ...identityV3 }, "id", { get: getter });
	expect(() => buildCollectedFragmentV3(bodyV3(), identity)).toThrow("invalid-fragment-fields"); expect(getter).not.toHaveBeenCalled();
});
function storageSpies() {
	return { inspect: vi.fn(() => Promise.resolve({ status: "missing" as const })), create: vi.fn(() => Promise.resolve({ status: "created" as const })), process: vi.fn(() => Promise.resolve({ status: "processed" as const })) };
}
it("rejects invalid repository identities before all storage calls", async () => {
	for (const input of inputsV3()) for (const patch of [...badIds.map(id => ({ id })), ...badCreated.map(created => ({ created }))]) {
		const storage = storageSpies(), path = vi.fn(() => "collection.md"), repository = new MarkdownFragmentRepositoryV3(storage, path);
		const fragment = { text: input.text, metadata: { ...fragmentV3(input).metadata, ...patch } } as CollectedFragmentV3;
		expect(await repository.append(fragment)).toEqual({ status: "failed" });
		expect(path).not.toHaveBeenCalled(); expect(storage.inspect).not.toHaveBeenCalled(); expect(storage.create).not.toHaveBeenCalled(); expect(storage.process).not.toHaveBeenCalled();
		// Same destination and otherwise identical genuine input can create successfully.
		expect(await repository.append(fragmentV3(input))).toEqual({ status: "created" });
		expect(storage.inspect).toHaveBeenCalledTimes(1); expect(storage.create).toHaveBeenCalledTimes(1);
	}
});
it.each(["text", "metadata"] as const)("rejects entry root %s getter without executing it", field => {
	const fragment = fragmentV3(), getter = vi.fn(() => fragment[field]);
	const hostile = Object.defineProperty({ ...fragment }, field, { get: getter });
	expect(() => serializeFragmentEntryV3(hostile)).toThrow("invalid-fragment-fields");
	expect(getter).not.toHaveBeenCalled();
	expect(serializeFragmentEntryV3(fragment)).toContain('"metadataVersion":3');
});
it("rejects inherited, missing and extra entry root fields", () => {
	const fragment = fragmentV3();
	for (const hostile of [Object.create(fragment) as object, { text: fragment.text }, { metadata: fragment.metadata }, { ...fragment, nonce: 1 }])
		expect(() => serializeFragmentEntryV3(hostile as CollectedFragmentV3)).toThrow("invalid-fragment-fields");
});
it("captures each root descriptor once and performs no ordinary root property reads", () => {
	const fragment = fragmentV3(), descriptors: PropertyKey[] = [], get = vi.fn(() => { throw new Error("SECRET"); });
	const observed = new Proxy(fragment, { get, getOwnPropertyDescriptor(target, key) { descriptors.push(key); return Object.getOwnPropertyDescriptor(target, key); } });
	expect(serializeFragmentEntryV3(observed)).toBe(serializeFragmentEntryV3(fragment));
	expect(get).not.toHaveBeenCalled(); expect(descriptors).toEqual(["text", "metadata"]);
});
it("rejects both root getters before repository storage", async () => {
	for (const field of ["text", "metadata"] as const) {
		const fragment = fragmentV3(), getter = vi.fn(() => fragment[field]), storage = storageSpies();
		const hostile = Object.defineProperty({ ...fragment }, field, { get: getter });
		expect(await new MarkdownFragmentRepositoryV3(storage, () => "collection.md").append(hostile)).toEqual({ status: "failed" });
		expect(getter).not.toHaveBeenCalled(); expect(storage.inspect).not.toHaveBeenCalled(); expect(storage.create).not.toHaveBeenCalled(); expect(storage.process).not.toHaveBeenCalled();
	}
});
