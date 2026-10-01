import type { JapaneseToken, JapaneseTokenizer } from "../../../src/tokenizer/JapaneseTokenizer";
import type { EnginePackInfo } from "./enginePack";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

export type EngineLoadState =
	| { status: "idle" }
	| { status: "loading"; loaded: number; total: number }
	| { status: "ready" }
	| { status: "failed" };

/** What the page needs from its tokenizer: the shared boundary plus load progress. */
export type WebTokenizer = JapaneseTokenizer & {
	getLoadState(): EngineLoadState;
	onLoadState(listener: (state: EngineLoadState) => void): () => void;
};

type Pending = { resolve: (tokens: JapaneseToken[]) => void; reject: (error: Error) => void };

/**
 * The web tokenizer: the same asynchronous `JapaneseTokenizer` boundary the
 * shared code already uses, answered by the analysis Worker.
 *
 * The engine is loaded on the first tokenize request (or an explicit `warm`),
 * a failed load is retried by the next request, and `dispose` terminates the
 * Worker and rejects whatever is still waiting.
 */
export class WorkerTokenizer implements WebTokenizer {
	private worker: Worker | null = null;
	private nextId = 0;
	private readonly pending = new Map<number, Pending>();
	private state: EngineLoadState = { status: "idle" };
	private readonly listeners = new Set<(state: EngineLoadState) => void>();
	private readonly pack: EnginePackInfo;

	constructor(
		private readonly workerUrl: string,
		pack: EnginePackInfo,
	) {
		// Resolved against the page here: inside the Worker a relative URL would
		// resolve against the Worker script's own directory instead.
		this.pack = { ...pack, url: new URL(pack.url, document.baseURI).href };
	}

	isInitialized(): boolean {
		return this.state.status === "ready";
	}

	getLoadState(): EngineLoadState {
		return this.state;
	}

	onLoadState(listener: (state: EngineLoadState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Starts loading the engine without analyzing anything. */
	warm(): void {
		if (this.state.status === "ready" || this.state.status === "loading") return;
		this.setState({ status: "loading", loaded: 0, total: this.pack.bytes });
		this.send({ type: "warm", pack: this.pack });
	}

	tokenize(text: string): Promise<JapaneseToken[]> {
		if (this.state.status !== "ready" && this.state.status !== "loading") {
			this.setState({ status: "loading", loaded: 0, total: this.pack.bytes });
		}
		const id = ++this.nextId;
		return new Promise<JapaneseToken[]>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.send({ type: "tokenize", id, text, pack: this.pack });
		});
	}

	dispose(): void {
		this.worker?.terminate();
		this.worker = null;
		for (const waiting of this.pending.values()) waiting.reject(new Error("The analysis engine was stopped."));
		this.pending.clear();
		this.setState({ status: "idle" });
	}

	private send(request: WorkerRequest): void {
		this.obtainWorker().postMessage(request);
	}

	private obtainWorker(): Worker {
		if (this.worker) return this.worker;
		const worker = new Worker(this.workerUrl);
		worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => this.receive(event.data));
		worker.addEventListener("error", () => {
			// A Worker that failed to start or crashed answers nothing more.
			this.worker = null;
			worker.terminate();
			for (const waiting of this.pending.values()) waiting.reject(new Error("The analysis engine stopped."));
			this.pending.clear();
			this.setState({ status: "failed" });
		});
		this.worker = worker;
		return worker;
	}

	private receive(message: WorkerResponse): void {
		switch (message.type) {
			case "progress":
				if (this.state.status !== "ready") this.setState({ status: "loading", loaded: message.loaded, total: message.total });
				return;
			case "ready":
				this.setState({ status: "ready" });
				return;
			case "result": {
				const waiting = this.pending.get(message.id);
				this.pending.delete(message.id);
				waiting?.resolve(message.tokens);
				return;
			}
			case "error": {
				if (message.id === null) {
					this.setState({ status: "failed" });
					return;
				}
				const waiting = this.pending.get(message.id);
				this.pending.delete(message.id);
				if (this.state.status !== "ready") this.setState({ status: "failed" });
				waiting?.reject(new Error(message.message));
				return;
			}
		}
	}

	private setState(state: EngineLoadState): void {
		this.state = state;
		for (const listener of this.listeners) listener(state);
	}
}
