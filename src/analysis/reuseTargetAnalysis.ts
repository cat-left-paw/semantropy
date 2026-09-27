import type { LocatedAnalysisDocument, LocatedAnalysisRun } from "./locateTokens";
import type { MarkdownSourceProjection } from "./projectMarkdownSource";
import type { AnalysisRun, Utf16Range } from "./rubyAnalysis";
import { freezeAnalysis } from "./rubyVocabulary";
import { lineChunkRawRange, projectTargetLineChunk, type TargetLineChunk, type TargetLineIndex } from "./targetChunkIr";

const BINDINGS = new WeakMap<MarkdownSourceProjection, ReadonlyMap<string, MarkdownSourceProjection["bindings"][number]>>();
type TokenIndex = Map<number, { item: LocatedAnalysisRun["tokens"][number]; ranges: string }>;
const TOKENS = new WeakMap<LocatedAnalysisDocument, TokenIndex>();
type Chunk = { descriptor: TargetLineChunk; projection: MarkdownSourceProjection;
	blockFragments: ReturnType<typeof projectTargetLineChunk>["blockFragments"]; located: LocatedAnalysisDocument };
const CHUNKS = new WeakMap<LocatedAnalysisDocument, WeakMap<TargetLineChunk, Chunk>>();

/** Coordinate replay only. The caller in manualMorphology owns authentication;
 * this helper cannot mint an analysis or vocabulary. No surface search/tokenizer. */
export function reuseTargetAnalysis(full: { projection: MarkdownSourceProjection; located: LocatedAnalysisDocument },
	index: TargetLineIndex, descriptors: readonly TargetLineChunk[]) {
	const ranges = (run: AnalysisRun, range: Utf16Range, projection: MarkdownSourceProjection, base: number) => {
		let bindings = BINDINGS.get(projection);
		if (!bindings) { bindings = new Map(projection.bindings.map(binding => [binding.sourceId, binding])); BINDINGS.set(projection, bindings); }
		const result: { start: number; end: number }[] = [];
		let lo = 0, hi = run.mapping.length;
		while (lo < hi) { const mid = (lo + hi) >>> 1; if (run.mapping[mid]!.analysisRange.end <= range.start) lo = mid + 1; else hi = mid; }
		for (let i = lo; i < run.mapping.length && run.mapping[i]!.analysisRange.start < range.end; i++) {
			const segment = run.mapping[i]!;
			const start = Math.max(range.start, segment.analysisRange.start), end = Math.min(range.end, segment.analysisRange.end);
			if (end <= start) continue;
			const binding = bindings.get(segment.sourcePart.sourceId);
			if (!binding) throw Error("Invalid Target analysis.");
			const rawStart = base + binding.rawRange.start + segment.sourcePart.range.start + start - segment.analysisRange.start;
			const last = result.at(-1);
			if (last?.end === rawStart) last.end += end - start;
			else result.push({ start: rawStart, end: rawStart + end - start });
		}
		return result;
	};
	let tokens = TOKENS.get(full.located);
	if (!tokens) {
	 tokens = new Map();
	 for (const located of full.located.runs) for (const item of located.tokens) {
		const parts = ranges(located.run, item.range, full.projection, 0);
		if (!parts.length || tokens.has(parts[0]!.start)) throw Error("Invalid Target analysis.");
		tokens.set(parts[0]!.start, { item, ranges: JSON.stringify(parts) });
	 }
	 TOKENS.set(full.located, tokens);
	}
	let end = 0;
	const cache = CHUNKS.get(full.located) ?? new WeakMap<TargetLineChunk, Chunk>(); CHUNKS.set(full.located, cache);
	return descriptors.map(descriptor => {
		lineChunkRawRange(index, descriptor, { start: 0, end: 0 });
		if (descriptor.rawRange.start !== end) throw Error("Invalid Target prefix.");
		end = descriptor.rawRange.end;
		const previous = cache.get(descriptor); if (previous) return previous;
		const { projection, blockFragments } = projectTargetLineChunk(index, descriptor);
		const runs = projection.document.runs.map(run => {
			const output: LocatedAnalysisRun["tokens"][number][] = [];
			for (let cursor = 0; cursor < run.analysisText.length;) {
				const start = ranges(run, { start: cursor, end: cursor + 1 }, projection, descriptor.rawRange.start)[0]?.start;
				const found = start === undefined ? undefined : tokens.get(start);
				if (!found) throw Error("Invalid Target token boundary.");
				const range = { start: cursor, end: cursor + found.item.token.surface.length };
				if (run.analysisText.slice(range.start, range.end) !== found.item.token.surface ||
					JSON.stringify(ranges(run, range, projection, descriptor.rawRange.start)) !== found.ranges) throw Error("Invalid Target token boundary.");
				output.push({ tokenId: `${descriptor.chunkId}/${run.runId}:token:${output.length}`, range, token: found.item.token });
				cursor = range.end;
			}
			return { run, tokens: output };
		});
		const value = freezeAnalysis({ descriptor, projection, blockFragments, located: { document: projection.document, runs } });
		cache.set(descriptor, value); return value;
	});
}
