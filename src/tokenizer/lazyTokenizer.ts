import type { JapaneseToken, JapaneseTokenizer } from "./JapaneseTokenizer";

/**
 * Builds the engine for one dictionary source. Implementations are selected at
 * build time; nothing above this boundary knows which one is in use.
 */
export type TokenizerEngineBuilder<TEngine> = () => Promise<TEngine>;

export type TokenizerEngineRunner<TEngine> = (
	engine: TEngine,
	text: string,
) => JapaneseToken[];

/**
 * The initialization contract every Semantropy tokenizer keeps, whatever
 * engine sits behind it:
 *
 *   - the engine is built on the first tokenize request, not at construction;
 *   - concurrent requests share one in-flight build;
 *   - a failed build is cleared, so the next request retries;
 *   - a build that finishes after `dispose` is refused rather than adopted.
 *
 * `disposeEngine` releases whatever the engine holds — for a WASM engine that
 * is memory the garbage collector cannot reclaim on its own.
 */
export class LazyTokenizer<TEngine> implements JapaneseTokenizer {
	private engine: TEngine | null = null;
	private inflight: Promise<TEngine> | null = null;
	private generation = 0;

	constructor(
		private readonly buildEngine: TokenizerEngineBuilder<TEngine>,
		private readonly runEngine: TokenizerEngineRunner<TEngine>,
		private readonly disposeEngine: (engine: TEngine) => void = () => undefined,
	) {}

	isInitialized(): boolean {
		return this.engine !== null;
	}

	async tokenize(text: string): Promise<JapaneseToken[]> {
		const engine = await this.obtainEngine();
		return this.runEngine(engine, text);
	}

	dispose(): void {
		this.generation += 1;
		const engine = this.engine;
		this.engine = null;
		this.inflight = null;
		if (engine) {
			this.disposeEngine(engine);
		}
	}

	private obtainEngine(): Promise<TEngine> {
		if (this.engine) {
			return Promise.resolve(this.engine);
		}
		if (this.inflight) {
			return this.inflight;
		}

		const generation = this.generation;
		this.inflight = this.buildEngine()
			.then((engine) => {
				if (generation !== this.generation) {
					// The tokenizer was disposed while this build was running: the
					// engine is released here and never becomes the live one.
					this.disposeEngine(engine);
					throw new Error("Tokenizer was disposed during initialization.");
				}
				this.engine = engine;
				this.inflight = null;
				return engine;
			})
			.catch((error: unknown) => {
				if (generation === this.generation) {
					this.engine = null;
					this.inflight = null;
				}
				throw error;
			});

		return this.inflight;
	}
}
