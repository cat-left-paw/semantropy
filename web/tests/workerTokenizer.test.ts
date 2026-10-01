// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerTokenizer, type EngineLoadState } from "../src/engine/WorkerTokenizer";
import type { WorkerRequest, WorkerResponse } from "../src/engine/workerProtocol";

/** Records what the page sends and lets a test answer as the Worker would. */
class FakeWorker {
	static instances: FakeWorker[] = [];
	readonly sent: WorkerRequest[] = [];
	terminated = false;
	private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
	constructor(readonly url: string) {
		FakeWorker.instances.push(this);
	}
	postMessage(message: WorkerRequest): void {
		this.sent.push(message);
	}
	addEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}
	terminate(): void {
		this.terminated = true;
	}
	reply(message: WorkerResponse): void {
		for (const listener of this.listeners.get("message") ?? []) listener({ data: message });
	}
	crash(): void {
		for (const listener of this.listeners.get("error") ?? []) listener({});
	}
}

const PACK = { url: "assets/engine.bin", sha256: "a".repeat(64), bytes: 100 };

afterEach(() => {
	FakeWorker.instances = [];
	vi.unstubAllGlobals();
});

function tokenizer() {
	vi.stubGlobal("Worker", FakeWorker);
	const states: EngineLoadState["status"][] = [];
	const t = new WorkerTokenizer("assets/worker.js", PACK);
	t.onLoadState((state) => states.push(state.status));
	return { t, states };
}

describe("WorkerTokenizer", () => {
	it("sends the pack URL resolved against the page, not the Worker script", async () => {
		const { t } = tokenizer();
		const pending = t.tokenize("猫");
		const worker = FakeWorker.instances[0]!;
		const request = worker.sent[0] as Extract<WorkerRequest, { type: "tokenize" }>;
		expect(request.pack.url).toBe(new URL("assets/engine.bin", document.baseURI).href);
		worker.reply({ type: "ready" });
		worker.reply({ type: "result", id: request.id, tokens: [] });
		await expect(pending).resolves.toEqual([]);
		expect(t.isInitialized()).toBe(true);
	});

	it("rejects a failed request and lets the next one try again", async () => {
		const { t, states } = tokenizer();
		const first = t.tokenize("一");
		const worker = FakeWorker.instances[0]!;
		worker.reply({ type: "error", id: 1, message: "The analysis engine could not be loaded." });
		await expect(first).rejects.toThrow("could not be loaded");
		expect(states.at(-1)).toBe("failed");
		const second = t.tokenize("二");
		expect(states.at(-1)).toBe("loading");
		worker.reply({ type: "ready" });
		worker.reply({ type: "result", id: 2, tokens: [] });
		await expect(second).resolves.toEqual([]);
	});

	it("rejects everything still waiting when the Worker crashes or is disposed, and starts a new Worker next time", async () => {
		const { t } = tokenizer();
		const a = t.tokenize("一");
		FakeWorker.instances[0]!.crash();
		await expect(a).rejects.toThrow();
		const b = t.tokenize("二");
		expect(FakeWorker.instances).toHaveLength(2);
		t.dispose();
		await expect(b).rejects.toThrow();
		expect(FakeWorker.instances[1]!.terminated).toBe(true);
	});
});
