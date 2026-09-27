// @vitest-environment jsdom
import { SemantropySession } from "../src/application/SemantropySession";
import { createSourceSnapshot, type SourceSnapshot } from "../src/application/SourceSnapshot";
import {
	runRefreshSourceGuarded,
	type RefreshOutcome,
} from "../src/application/refreshSource";
import { checkSourceFreshness } from "../src/application/sourceFreshness";
import { SourceChangeWatch } from "../src/application/sourceChangeWatch";
import { SourceRevisionLog } from "../src/application/sourceRevisionLog";
import {
	runChangeBodySemantropyGuarded,
	type BodyLevelChangeOutcome,
} from "../src/application/changeBodySemantropy";
import {
	assertBodySemantropy,
	type BodySemantropy,
} from "../src/settings/bodySemantropy";
import { dispatchSourceEvent } from "../src/application/dispatchSourceEvent";
import { BusyGate } from "../src/view/busyGate";
import { readCurrentSourceText } from "../src/application/currentSourceText";
import { runReshuffleGuarded, type ReshuffleOutcome } from "../src/application/runReshuffle";
import type { BodyTransform } from "../src/application/reshuffleNote";
import {
	TargetBodyController,
	type TargetOpenResult,
} from "../src/render/targetBodyController";
import type { CooperativeScheduler } from "../src/render/cooperativeScheduler";
import type {
	JapaneseToken,
	JapaneseTokenizer,
} from "../src/tokenizer/JapaneseTokenizer";
import type { BodySemantropy as Level } from "../src/settings/bodySemantropy";
import { emptyReadyAnalysis } from "./readyAnalysis";
import { immediateScheduler } from "./support/testScheduler";
import { token } from "./tokenFixtures";

export function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/**
 * Each character becomes one 名詞-一般 token, so any two-character body has a
 * pool with two interchangeable candidates.
 */
function fakeTokenize(text: string): JapaneseToken[] {
	return [...text].map((surface) => token({ surface }));
}

/**
 * Historical full-note controller / Refresh coordinator regression harness.
 * CHUNK-VIEW1 retains these failure-path tests; production now uses the staged
 * Chunk coordinator, exercised directly through SemantropyView in
 * chunkTargetView.test.ts. Obsidian itself is not involved.
 */
export class RefreshHarness {
	readonly session = new SemantropySession();
	readonly controller = new TargetBodyController();
	readonly sourceWatch = new SourceChangeWatch();
	readonly revisions = new SourceRevisionLog();
	readonly busy = new BusyGate();
	/**
	 * Stands in for the plugin's persisted body value. MAX by default so tests
	 * about Refresh, staleness and concurrency see every replaceable slot
	 * exchanged; level-specific tests set it explicitly.
	 */
	bodySemantropy: BodySemantropy = assertBodySemantropy(100);
	persistCalls: BodySemantropy[] = [];
	persistFails = false;
	closed = false;
	seeds: number[] = [];
	tokenizeCalls: string[] = [];
	/** Markdown handed to the safe Target build, in order. */
	renderCalls: string[] = [];
	hashCalls: string[] = [];
	readCalls: string[] = [];
	errorLogs: unknown[][] = [];
	savedReadCalls: string[] = [];
	/** Path -> saved body, standing in for the Vault. */
	sources = new Map<string, string>();
	/** Path -> unsaved editor buffer, standing in for an open Markdown leaf. */
	editors = new Map<string, string>();
	readGate: (() => Promise<void>) | null = null;
	/** Awaited right before the Target is built, after the loading shell's frame. */
	renderGate: (() => Promise<void>) | null = null;
	tokenizeGate: (() => Promise<void>) | null = null;
	/** The event-loop seam; immediate unless a test installs its own. */
	scheduler: CooperativeScheduler = immediateScheduler();
	private bodyTask: { id: number; cancellable: boolean } | null = null;
	private bodyTaskCount = 0;

	private readonly tokenizer: JapaneseTokenizer = {
		tokenize: async (text) => {
			this.tokenizeCalls.push(text);
			if (this.tokenizeGate) {
				await this.tokenizeGate();
			}
			return fakeTokenize(text);
		},
	};

	private nextSeed = 100;

	private issueSeed = (): number => {
		this.nextSeed += 1;
		this.seeds.push(this.nextSeed);
		return this.nextSeed;
	};

	private hashText = async (text: string): Promise<string> => {
		this.hashCalls.push(text);
		return `hash(${text})`;
	};

	/** Composed exactly like the plugin's adapter: editor first, saved second. */
	private readCurrentText = async (sourcePath: string): Promise<string> => {
		this.readCalls.push(sourcePath);
		if (this.readGate) {
			await this.readGate();
		}
		return await readCurrentSourceText(sourcePath, {
			readEditorText: (path) => this.editors.get(path) ?? null,
			readSavedText: async (path) => {
				this.savedReadCalls.push(path);
				const text = this.sources.get(path);
				if (text === undefined) {
					throw new Error("The source note is no longer available.");
				}
				return text;
			},
		});
	};

	/** Mirrors SemantropyView.prepareSnapshotBody. */
	private async prepareBody(
		requestId: number,
		snapshot: SourceSnapshot,
		bodySeed: number,
		bodySemantropy: Level,
	): Promise<TargetOpenResult> {
		const isCurrent = (): boolean => !this.closed && this.session.isCurrent(requestId);
		await this.scheduler.paint();
		if (!isCurrent()) {
			return { status: "stale" };
		}
		this.renderCalls.push(snapshot.text);
		if (this.renderGate) {
			await this.renderGate();
		}
		return await this.controller.open({
			snapshot,
			bodySeed,
			bodySemantropy,
			getTokenizer: () => this.tokenizer,
			isCurrent,
			scheduler: this.scheduler,
			ownerDocument: document,
		});
	}

	/** Mirrors SemantropyView.openCapture for the parts under test. */
	async open(
		sourcePath: string,
		sourceName = sourcePath,
		options: {
			/** Body captured before this call, as the plugin does. */
			capturedText?: string;
			capturedSourceChanged?: () => boolean;
		} = {},
	): Promise<void> {
		const requestId = this.session.beginLoading();
		this.busy.revoke();
		this.bodyTask = null;
		const watchToken = this.sourceWatch.beginRequest(requestId, sourcePath);
		this.controller.release();
		const text =
			options.capturedText ?? (await this.readCurrentText(sourcePath));
		const snapshot = createSourceSnapshot({
			sourcePath,
			sourceName,
			text,
			contentHash: await this.hashText(text),
		});
		const bodySeed = this.issueSeed();
		// Open reads the value in force, exactly as the view does.
		const applied = await this.prepareBody(requestId, snapshot, bodySeed, this.bodySemantropy);
		this.sourceWatch.endRequest(requestId);
		if (applied.status !== "applied") {
			throw new Error(`open failed: ${applied.status}`);
		}
		this.session.completeReady(
			requestId,
			snapshot,
			bodySeed,
			applied.analysis,
		);
		if (
			this.sourceWatch.changedSince(watchToken) ||
			options.capturedSourceChanged?.() === true
		) {
			this.session.setSourceFreshness(snapshot, "stale");
		}
		// The view attaches the committed root under its body element.
		const root = this.controller.getContainer();
		if (root && !root.isConnected) {
			document.body.appendChild(root);
		}
	}

	/**
	 * Mirrors SemantropyPlugin.openSemantropy: the body and the revision token
	 * are captured synchronously, the leaf is revealed asynchronously, and only
	 * then does the view start watching the note.
	 */
	async openLikePlugin(
		sourcePath: string,
		sourceName = sourcePath,
		revealLeaf: () => Promise<void> = async () => undefined,
	): Promise<void> {
		const capturedText =
			this.editors.get(sourcePath) ?? this.sources.get(sourcePath) ?? "";
		const capturedRevision = this.revisions.current(sourcePath);
		const capturedSourceChanged = () =>
			this.revisions.changedSince(sourcePath, capturedRevision);

		await revealLeaf();

		await this.open(sourcePath, sourceName, {
			capturedText,
			capturedSourceChanged,
		});
	}

	/**
	 * Mirrors the plugin's event handlers: the revision is recorded first, and
	 * whether or not a view is currently listening.
	 */
	notifySourceEvent(
		sourcePath: string,
		event: { kind: "changed"; editorText: string | null } | { kind: "lost" },
		views: readonly RefreshHarness[] = [this],
	): RefreshHarness[] {
		this.revisions.bump(sourcePath);
		return dispatchSourceEvent({
			event:
				event.kind === "lost"
					? { kind: "lost", sourcePath }
					: { kind: "changed", sourcePath, editorText: event.editorText },
			views,
			getSourcePath: (view) => view.getSourcePath(),
			recheck: (view, text) => {
				void view.recheckSourceFreshness(text);
			},
			markLost: (view) => {
				view.markLost();
			},
		});
	}

	/** The path source events are routed by, including while loading. */
	getSourcePath(): string | null {
		return (
			this.sourceWatch.pendingSourcePath((id) => this.session.isCurrent(id)) ??
			this.session.getReadySnapshot()?.sourcePath ??
			null
		);
	}

	/** Legacy guarded Refresh entry retained as a regression oracle. */
	refreshSource(): Promise<RefreshOutcome> {
		if (this.closed) {
			return Promise.resolve<RefreshOutcome>("aborted");
		}
		this.cancelBodyTask();
		let watchToken = 0;
		return runRefreshSourceGuarded({
			busy: this.busy,
			session: this.session,
			readCurrentText: this.readCurrentText,
			hashText: this.hashText,
			issueSeed: this.issueSeed,
			bodySemantropy: this.bodySemantropy,
			beginRequest: (sourcePath) => {
				const requestId = this.session.beginLoading();
				watchToken = this.sourceWatch.beginRequest(requestId, sourcePath);
				this.controller.release();
				return requestId;
			},
			sourceChangedDuringRequest: () =>
				this.sourceWatch.changedSince(watchToken),
			applySnapshot: ({ requestId, snapshot, bodySeed, bodySemantropy }) =>
				this.prepareBody(requestId, snapshot, bodySeed, bodySemantropy),
			isAbandoned: () => this.closed,
			settle: (requestId, outcome) => {
				this.sourceWatch.endRequest(requestId);
				if (this.closed || !this.session.isCurrent(requestId)) {
					return;
				}
				if (outcome === "failed") {
					this.errorLogs.push(["[Semantropy] failed to refresh the source note"]);
					this.controller.release();
				}
				const root = this.controller.getContainer();
				if (outcome === "refreshed" && root && !root.isConnected) {
					document.body.appendChild(root);
				}
			},
		});
	}

	recheckSourceFreshness(editorText: string | null = null) {
		this.sourceWatch.notifyChanged();
		const generation = this.session.beginFreshnessCheck();
		return checkSourceFreshness({
			generation,
			isCurrentGeneration: (id) => this.session.isCurrentFreshnessCheck(id),
			getReadySnapshot: () => this.session.getReadySnapshot(),
			readCurrentText: (sourcePath) =>
				editorText === null
					? this.readCurrentText(sourcePath)
					: Promise.resolve(editorText),
			hashText: this.hashText,
			isAbandoned: () => this.closed,
			setFreshness: (snapshot, freshness) =>
				this.session.setSourceFreshness(snapshot, freshness),
		});
	}

	/** Mirrors SemantropyView.reshuffle. */
	async reshuffle(): Promise<ReshuffleOutcome> {
		if (this.closed) {
			return "aborted";
		}
		let task: number | null = null;
		const current = (): boolean => task !== null && this.isBodyTaskCurrent(task);
		const outcome = await runReshuffleGuarded({
			busy: this.busy,
			begin: async () => {
				task = this.beginBodyTask(true);
				await this.scheduler.paint();
			},
			session: this.session,
			host: {
				getBodyGeneration: () => this.controller.getBodyGeneration(),
				getTextNodeCount: () => this.controller.getSequenceCount(),
				prepareResult: (generation, result) =>
					this.controller.prepare(generation, result, { isCurrent: current, scheduler: this.scheduler }),
			},
			issueSeed: this.issueSeed,
			transform: (_tokens, _pool, seed, level) => this.controller.transform(seed, level),
			isAbandoned: () =>
				this.closed ||
				this.session.getState().status !== "ready" ||
				(task !== null && !this.isBodyTaskCurrent(task)),
		});
		if (task !== null) {
			this.endBodyTask(task);
		}
		return outcome;
	}

	/** Mirrors SemantropyView.setBodySemantropy. */
	async setBodySemantropy(
		next: BodySemantropy,
		options: {
			transform?: BodyTransform;
			persistGate?: Promise<boolean>;
			/** Overrides the body's prepare step, to force a refusal. */
			prepareTexts?: (
				generation: number,
				texts: readonly string[],
			) => (() => "applied" | "stale") | null;
		} = {},
	): Promise<BodyLevelChangeOutcome> {
		if (this.closed) {
			return "aborted";
		}
		let task: number | null = null;
		const current = (): boolean => task !== null && this.isBodyTaskCurrent(task);
		const outcome = await runChangeBodySemantropyGuarded({
			busy: this.busy,
			begin: async () => {
				task = this.beginBodyTask(false);
				await this.scheduler.paint();
			},
			session: this.session,
			next,
			transform:
				options.transform ??
				((_tokens, _pool, seed, level) => this.controller.transform(seed, level)),
			persist: async (value) => {
				this.persistCalls.push(value);
				if (options.persistGate) {
					await options.persistGate;
				}
				if (this.persistFails) {
					return false;
				}
				this.bodySemantropy = value;
				return true;
			},
			host: {
				getBodyGeneration: () => this.controller.getBodyGeneration(),
				getTextNodeCount: () => this.controller.getSequenceCount(),
				// An override that returns null means "refuse", so it must not be
				// confused with "no override".
				prepareResult: (generation, result) =>
					options.prepareTexts
						? options.prepareTexts(generation, result.texts)
						: this.controller.prepare(generation, result, { isCurrent: current, scheduler: this.scheduler }),
			},
			isAbandoned: () =>
				this.closed || (task !== null && !this.isBodyTaskCurrent(task)),
		});
		if (task !== null) {
			this.endBodyTask(task);
		}
		return outcome;
	}

	/** A level change that stalls inside the settings write. */
	setBodySemantropyGated(
		next: BodySemantropy,
		persistGate: Promise<boolean>,
	): Promise<BodyLevelChangeOutcome> {
		return this.setBodySemantropy(next, { persistGate });
	}

	close(): void {
		this.closed = true;
		this.bodyTask = null;
		this.busy.revoke();
		this.sourceWatch.reset();
		this.controller.release();
		this.session.dispose();
	}

	reopen(): void {
		this.closed = false;
		this.busy.revoke();
		this.sourceWatch.reset();
	}

	markLost(): void {
		this.sourceWatch.notifyChanged();
		this.session.markSourceStale();
	}

	/** Everything a write would have to touch, for before/after comparison. */
	storedBodies(): string {
		return JSON.stringify({
			saved: [...this.sources].sort(),
			editors: [...this.editors].sort(),
		});
	}

	readyState() {
		const state = this.session.getState();
		return state.status === "ready" ? state : null;
	}

	/** Logical body text: readings and placeholders excluded. */
	bodyText(): string {
		return this.controller
			.getTextNodes()
			.map((node) => node.nodeValue ?? "")
			.join("");
	}

	private beginBodyTask(cancellable: boolean): number {
		this.bodyTaskCount += 1;
		this.bodyTask = { id: this.bodyTaskCount, cancellable };
		return this.bodyTaskCount;
	}

	private isBodyTaskCurrent(id: number): boolean {
		return !this.closed && this.bodyTask?.id === id;
	}

	private endBodyTask(id: number): void {
		if (this.bodyTask?.id === id) {
			this.bodyTask = null;
		}
	}

	private cancelBodyTask(): void {
		if (this.bodyTask?.cancellable !== true) {
			return;
		}
		this.bodyTask = null;
		this.busy.revoke();
	}
}

export { emptyReadyAnalysis };
