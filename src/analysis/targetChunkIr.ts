import {
	isFrontmatterOpenerLine, markdownLineEnd, projectMarkdownSource, projectTargetFragments, TARGET_PRESENTATION_POLICY_VERSION,
	type MarkdownSourceProjection, type PresentationBlock, type TargetProjectionFragment, targetBoundaryBarriers,
} from "./projectMarkdownSource";
import type { Utf16Range } from "./rubyAnalysis";

/** 1: first boundary scanner (CHUNK-IR1). Boundary rules are part of this identity. */
export const TARGET_CHUNK_IR_VERSION = "target-chunk-ir-1";

/**
 * A canonical Target block. `content` comes from one presentation block of the
 * safe Target projection; `separator` is the blank raw text between two of
 * them (blank lines, CRLF, leading/trailing whitespace), which the projection
 * excludes as syntax but which raw coverage must not lose.
 */
export type TargetBlockKind = "content" | "separator";
export type TargetBlockEntry = { readonly rawRange: Utf16Range; readonly kind: TargetBlockKind };

/**
 * One raw Target snapshot, the revision it is the content of, and the
 * canonical block index derived from them, as one inseparable result.
 *
 * Boundary metadata only. The projection used to find the safe block ranges is
 * built once inside `buildTargetBlockIndex` and discarded: no full-text
 * `AnalysisDocument`, bindings, presentation items, decorations, Ruby display
 * mapping, Token, display plan or DOM state is retained here or reachable from
 * here. A later slice projects and analyzes one Chunk's raw slice at a time.
 *
 * A snapshot, a revision and a projection can never be combined by a caller:
 * the only way to obtain this value is `buildTargetBlockIndex`, which projects
 * the snapshot itself and stamps the revision at mint time. A projection of a
 * different (stale, or merely equally long) Target revision cannot reach the
 * boundary scanner, a hand-built block list cannot, and stale content cannot
 * be relabelled with a newer revision: a new revision needs a new index.
 */
export type TargetSnapshotIndex = {
	readonly rawText: string;
	readonly rawLength: number;
	readonly targetRevision: number;
	/** Blocks partition `[0, rawLength)` exactly, in canonical (raw order) index order. */
	readonly blocks: readonly TargetBlockEntry[];
};

export type TargetChunkStatus = "unloaded" | "preparing" | "materialized";
export type TargetChunkDescriptor = {
	/** Target revision + canonical chunk index only; never a surface, value or nonce. */
	readonly chunkId: string;
	readonly targetRevision: number;
	/** UTF-16 code unit offsets into the raw Target snapshot. */
	readonly rawRange: Utf16Range;
	/** Half-open canonical block index range. */
	readonly blockRange: { readonly start: number; readonly end: number };
	readonly status: TargetChunkStatus;
};

/** A fixed, safe refusal. Never a fixed-length fallback split. */
export class TargetChunkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TargetChunkError";
	}
}

/**
 * Identity of the indexes this module built. A structural copy, a spread, a
 * literal or a mutated clone is a different object and is refused, so no
 * caller can pair blocks with a snapshot they do not belong to.
 */
const minted = new WeakSet<TargetSnapshotIndex>();

/**
 * Owner of every descriptor this module planned. Ownership is identity: two
 * indexes can share a revision number (for example in two Views), so a
 * revision match is not proof that a descriptor belongs to an index.
 */
const owners = new WeakMap<TargetChunkDescriptor, TargetSnapshotIndex>();

const fail = (message: string): never => { throw new TargetChunkError(message); };
const isIndex = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/** Local deep freeze: this pure core depends on no generation module. */
function freezeDeep<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freezeDeep(child);
		Object.freeze(value);
	}
	return value;
}

/** `chunk:<target revision>:<canonical chunk index>` and nothing else. */
export function targetChunkId(targetRevision: number, chunkIndex: number): string {
	if (!isIndex(targetRevision)) fail(`Invalid Target revision: ${String(targetRevision)}.`);
	if (!isIndex(chunkIndex)) fail(`Invalid Chunk index: ${String(chunkIndex)}.`);
	return `chunk:${targetRevision}:${chunkIndex}`;
}

/** Refuses a derived block list that does not partition the snapshot; never repairs one. */
function assertPartition(blocks: readonly TargetBlockEntry[], rawLength: number): void {
	if (!blocks.length) {
		if (rawLength !== 0) fail(`Block index covers nothing of ${rawLength} raw code units.`);
		return;
	}
	let cursor = 0;
	for (const { rawRange } of blocks) {
		if (!isIndex(rawRange.start) || !isIndex(rawRange.end) || rawRange.end <= rawRange.start) {
			fail(`Invalid block range ${String(rawRange.start)}..${String(rawRange.end)}.`);
		}
		if (rawRange.start !== cursor) fail(`Block index has a gap or overlap at raw offset ${cursor}.`);
		cursor = rawRange.end;
	}
	if (cursor !== rawLength) fail(`Block index ends at ${cursor}, not ${rawLength}.`);
}

/**
 * Canonical block index of a raw Target snapshot, reusing the block ranges the
 * safe Target projection produces for this very snapshot. No second Markdown
 * parser, no rendering, no re-search of the raw text, and no way to supply a
 * projection of some other text.
 *
 * The projection's blocks are ordered, non-empty and non-overlapping, and the
 * raw text between them is blank. Text that is nevertheless not blank is kept
 * as a `content` block: coverage is never dropped, and such a region is never
 * treated as discardable whitespace.
 */
export function buildTargetBlockIndex(rawText: string, targetRevision: number): TargetSnapshotIndex {
	if (typeof rawText !== "string") fail("Target snapshot must be a string.");
	if (!isIndex(targetRevision)) fail(`Invalid Target revision: ${String(targetRevision)}.`);
	// Used once to find safe block ranges, then dropped with its analysis.
	const projection = projectMarkdownSource(rawText, "target-prototype");
	// The Target policy is what these boundary rules were validated against.
	if (projection.policyVersion !== TARGET_PRESENTATION_POLICY_VERSION) {
		fail(`Chunk boundaries need the Target projection, not ${projection.policyVersion}.`);
	}
	const blocks: TargetBlockEntry[] = [];
	const push = (start: number, end: number): void => {
		blocks.push({ rawRange: { start, end }, kind: rawText.slice(start, end).trim() ? "content" : "separator" });
	};
	let cursor = 0;
	for (const block of projection.presentation.blocks) {
		const { start, end } = block.rawRange;
		if (!isIndex(start) || !isIndex(end) || end <= start || end > rawText.length || start < cursor) {
			fail(`Corrupted Target block range ${String(start)}..${String(end)} at raw offset ${cursor}.`);
		}
		if (start > cursor) push(cursor, start);
		blocks.push({ rawRange: { start, end }, kind: "content" });
		cursor = end;
	}
	if (cursor < rawText.length) push(cursor, rawText.length);
	assertPartition(blocks, rawText.length);
	const index = freezeDeep({ rawText, rawLength: rawText.length, targetRevision, blocks });
	minted.add(index);
	return index;
}

/**
 * Closes a Chunk at the first canonical block boundary at or after the target
 * UTF-16 length, so a boundary that already falls on the target does not pull
 * in the next block. A single block larger than the target stays one Chunk:
 * there is no fixed-length split inside a block, paragraph, Ruby annotation,
 * protected region or unclosed construct, and none inside a surrogate pair.
 *
 * Blank separators that directly follow a closed Chunk belong to it, so no
 * Chunk but an entirely blank snapshot is whitespace only. A Chunk only starts
 * where its own slice parses exactly as the whole snapshot does (see below).
 *
 * The revision is the index's own, never a separate argument, so a descriptor
 * can only ever carry the revision its content was actually read at.
 */
export function planTargetChunks(
	index: TargetSnapshotIndex, targetSize: number,
): readonly TargetChunkDescriptor[] {
	// Boundaries may only come from a snapshot this module projected itself.
	if (!minted.has(index)) fail("Chunk boundaries need an index built from the current Target snapshot.");
	if (!Number.isSafeInteger(targetSize) || targetSize < 1) fail(`Invalid Chunk target size: ${String(targetSize)}.`);
	const targetRevision = index.targetRevision;
	const descriptors: TargetChunkDescriptor[] = [];
	const close = (start: number, end: number): void => {
		const descriptor = freezeDeep({
			chunkId: targetChunkId(targetRevision, descriptors.length), targetRevision,
			rawRange: { start: index.blocks[start]!.rawRange.start, end: index.blocks[end - 1]!.rawRange.end },
			blockRange: { start, end }, status: "unloaded" as const,
		});
		owners.set(descriptor, index);
		descriptors.push(descriptor);
	};
	// A Chunk may not begin where its slice, parsed from its own offset 0,
	// would read differently than the whole snapshot. Two cases do:
	// - inside one blank-line-delimited paragraph range, where the first line
	//   of a slice takes the paragraph-opening path instead of continuing;
	// - on a line the parser treats as a frontmatter opener at offset 0, which
	//   is a thematic break anywhere else.
	// A block right after a blank separator starts a fresh top-level parser
	// step, so it is safe unless it opens frontmatter. Fewer starts never make
	// a boundary unsafe; they only make a Chunk longer.
	const canStart = (blockIndex: number): boolean => {
		if (blockIndex === 0 || blockIndex >= index.blocks.length) return true;
		if (index.blocks[blockIndex - 1]!.kind !== "separator") return false;
		const lineStart = index.blocks[blockIndex]!.rawRange.start;
		return !isFrontmatterOpenerLine(index.rawText.slice(lineStart, markdownLineEnd(index.rawText, lineStart)));
	};
	let start = 0;
	let length = 0;
	let content = false;
	for (let i = 0; i < index.blocks.length; i += 1) {
		const block = index.blocks[i]!;
		length += block.rawRange.end - block.rawRange.start;
		content ||= block.kind === "content";
		if (!content || length < targetSize) continue;
		let end = i + 1;
		while (end < index.blocks.length && index.blocks[end]!.kind === "separator") end += 1;
		if (!canStart(end)) continue;
		close(start, end);
		start = end; i = end - 1; length = 0; content = false;
	}
	if (start < index.blocks.length) close(start, index.blocks.length);
	return freezeDeep(descriptors);
}

/**
 * The raw slice one Chunk covers, for a later slice to project and analyze on
 * its own. Refused unless this very index planned the descriptor: a descriptor
 * of another index (even one with the same revision), a clone or a hand-built
 * descriptor cannot slice a snapshot.
 */
export function chunkRawText(index: TargetSnapshotIndex, descriptor: TargetChunkDescriptor): string {
	if (!minted.has(index)) fail("Chunk slicing needs an index built from the current Target snapshot.");
	if (owners.get(descriptor) !== index) fail("Chunk slicing needs a descriptor planned from this same index.");
	return index.rawText.slice(descriptor.rawRange.start, descriptor.rawRange.end);
}

/** Refuses a descriptor this module did not plan. */
function assertPlanned(descriptor: TargetChunkDescriptor): void {
	if (!owners.has(descriptor)) fail("Chunk offsets need a descriptor planned by this module.");
}

/**
 * Chunk-local UTF-16 offset to raw Target absolute offset. Chunk-local and
 * absolute ranges stay explicitly distinct; nothing is matched up by searching
 * the text again.
 */
export function toRawOffset(descriptor: TargetChunkDescriptor, chunkOffset: number): number {
	assertPlanned(descriptor);
	const length = descriptor.rawRange.end - descriptor.rawRange.start;
	if (!isIndex(chunkOffset) || chunkOffset > length) {
		fail(`Chunk offset ${String(chunkOffset)} is outside ${descriptor.chunkId}.`);
	}
	return descriptor.rawRange.start + chunkOffset;
}

/** The same mapping for a range, rejecting anything the Chunk does not cover. */
export function toRawRange(descriptor: TargetChunkDescriptor, chunkRange: Utf16Range): Utf16Range {
	const start = toRawOffset(descriptor, chunkRange.start);
	const end = toRawOffset(descriptor, chunkRange.end);
	if (end < start) fail(`Inverted Chunk range in ${descriptor.chunkId}.`);
	return Object.freeze({ start, end });
}

/** Boundary metadata for one raw Target snapshot. No Token, plan, DOM or interaction state. */
export function scanTargetChunks(
	rawText: string, targetRevision: number, targetSize: number,
): readonly TargetChunkDescriptor[] {
	return planTargetChunks(buildTargetBlockIndex(rawText, targetRevision), targetSize);
}

/** Standard Japanese line-boundary core. IR1 APIs above remain frozen historical regressions. */
export type TargetLineIndex = {
	readonly rawText: string;
	readonly rawLength: number;
	readonly targetRevision: number;
	readonly blocks: readonly { readonly rawRange: Utf16Range; readonly tag: PresentationBlock["tag"] | "blank"; readonly hidden?: "frontmatter" }[];
	/** Sorted parser-proven line ends, plus EOF. No presentation items are retained. */
	readonly boundaries: readonly { readonly offset: number; readonly trailingAnalysis: boolean }[];
};
export type TargetLineChunk = {
	readonly chunkId: string;
	readonly targetRevision: number;
	readonly rawRange: Utf16Range;
	/** Half-open range of intervals between canonical boundary offsets (implicit initial 0). */
	readonly boundaryRange: Utf16Range;
	readonly status: "unloaded";
};
export type TargetLineProjection = {
	readonly projection: MarkdownSourceProjection;
	/** Local projected blocks correspond to these absolute whole-document block identities. */
	readonly blockFragments: readonly {
		readonly blockIndex: number;
		readonly wholeRange: Utf16Range;
		readonly continuesBefore: boolean;
		readonly continuesAfter: boolean;
		/** Parser-recognized block the display omits (a closed leading frontmatter). */
		readonly hidden?: "frontmatter";
	}[];
};
const lineIndexes = new WeakSet<TargetLineIndex>();
const lineOwners = new WeakMap<TargetLineChunk, TargetLineIndex>();

/** One whole projection to establish facts, discarded before returning boundary metadata. */
export function buildTargetLineIndex(rawText: string, targetRevision: number): TargetLineIndex {
	if (typeof rawText !== "string") fail("Target snapshot must be a string.");
	if (!isIndex(targetRevision)) fail(`Invalid Target revision: ${String(targetRevision)}.`);
	const projection = projectMarkdownSource(rawText, "target-prototype");
	if (projection.policyVersion !== TARGET_PRESENTATION_POLICY_VERSION) fail("Line boundaries require the current Target projection policy.");
	const blocks: { rawRange: Utf16Range; tag: PresentationBlock["tag"] | "blank"; hidden?: "frontmatter" }[] = [];
	const ends = new Map<number, boolean>();
	const newlineEnd = (end: number): boolean => end > 0 && (rawText[end - 1] === "\n" || rawText[end - 1] === "\r") &&
		!(rawText[end - 1] === "\r" && rawText[end] === "\n");
	const bindings = new Map(projection.bindings.map(b => [b.sourceId, b]));
	const analyzedNewlines = new Set<number>();
	const { document: analysisDocument } = projection;
	for (const run of analysisDocument.runs) for (const part of run.sourceParts) {
		if (part.kind !== "text") continue;
		const binding = bindings.get(part.source.sourceId)!;
		const start = binding.rawRange.start + part.source.range.start;
		const end = binding.rawRange.start + part.source.range.end;
		// The parser binds soft newline strings separately, before the next line.
		if (newlineEnd(end) && start < end) analyzedNewlines.add(end);
	}
	const gap = (start: number, end: number): void => {
		if (start === end) return;
		blocks.push({ rawRange: { start, end }, tag: "blank" });
		for (let at = start; at < end;) {
			const lineEnd = markdownLineEnd(rawText, at);
			at = lineEnd + (rawText.startsWith("\r\n", lineEnd) ? 2 : lineEnd < rawText.length ? 1 : 0);
			if (newlineEnd(at)) ends.set(at, false);
		}
	};
	let cursor = 0;
	for (const block of projection.presentation.blocks) {
		gap(cursor, block.rawRange.start);
		blocks.push({ rawRange: block.rawRange, tag: block.tag, ...(block.hidden ? { hidden: block.hidden } : {}) });
		for (const item of block.items) if (item.kind === "break") ends.set(item.rawRange.end, analyzedNewlines.has(item.rawRange.end));
		if (newlineEnd(block.rawRange.end)) ends.set(block.rawRange.end, false);
		cursor = block.rawRange.end;
	}
	gap(cursor, rawText.length);
	// Parser evidence supplies candidates; the shared lexical scanner can only veto them.
	const firstBlock = projection.presentation.blocks[0];
	const frontmatter = firstBlock?.rawRange.start === 0 && isFrontmatterOpenerLine(rawText.slice(0, markdownLineEnd(rawText, 0)));
	const barriers = targetBoundaryBarriers(rawText, frontmatter ? [firstBlock.rawRange] : []);
	let barrier = 0;
	for (const offset of [...ends.keys()].sort((a, b) => a - b)) {
		while (barrier < barriers.length && barriers[barrier]!.end <= offset) barrier += 1;
		if (barrier < barriers.length && barriers[barrier]!.start < offset) ends.delete(offset);
	}
	if (rawText.length) ends.set(rawText.length, false);
	assertPartition(blocks.map(b => ({ rawRange: b.rawRange, kind: "content" })), rawText.length);
	const index = freezeDeep({ rawText, rawLength: rawText.length, targetRevision, blocks,
		boundaries: [...ends].sort((a, b) => a[0] - b[0]).map(([offset, trailingAnalysis]) => ({ offset, trailingAnalysis })),
	});
	lineIndexes.add(index);
	return index;
}

/** Nearest safe newline, ties earlier; a remaining tail at most targetSize closes at EOF. */
export function isTargetLineIndex(index: unknown): index is TargetLineIndex { return typeof index === "object" && index !== null && lineIndexes.has(index as TargetLineIndex); }
export function planTargetLineChunks(index: TargetLineIndex, targetSize: number): readonly TargetLineChunk[] {
	if (!lineIndexes.has(index)) fail("Line planning needs a minted Target index.");
	if (!Number.isSafeInteger(targetSize) || targetSize < 1) fail(`Invalid Chunk target size: ${String(targetSize)}.`);
	const result: TargetLineChunk[] = [];
	// EOF without a newline is a terminal endpoint, not an extra nearest candidate.
	const last = index.rawText[index.rawLength - 1];
	const candidates = index.boundaries.length - (index.rawLength > 0 && last !== "\n" && last !== "\r" ? 1 : 0);
	// A closed leading frontmatter is never displayed, so it counts toward no
	// Chunk's size, and a Chunk may not end before the first displayed block:
	// one holding only hidden or blank text would open as an empty body.
	const hiddenEnd = index.blocks[0]?.hidden ? index.blocks[0].rawRange.end : 0;
	const visibleStart = hiddenEnd === 0 ? 0
		: index.blocks.find(block => block.rawRange.start >= hiddenEnd && block.tag !== "blank")?.rawRange.start ?? index.rawLength;
	let start = 0;
	let first = 0;
	while (first < index.boundaries.length) {
		const origin = Math.max(start, hiddenEnd);
		// A short final tail is already one useful Chunk, irrespective of how
		// many internal newlines it contains or whether EOF has a newline.
		let best = index.rawLength - origin <= targetSize ? index.boundaries.length - 1 : first;
		while (best + 1 < index.boundaries.length && index.boundaries[best]!.offset <= visibleStart) best += 1;
		while (best + 1 < candidates &&
			Math.abs(index.boundaries[best + 1]!.offset - origin - targetSize) < Math.abs(index.boundaries[best]!.offset - origin - targetSize)) best += 1;
		const end = index.boundaries[best]!.offset;
		const descriptor = freezeDeep({ chunkId: targetChunkId(index.targetRevision, result.length), targetRevision: index.targetRevision,
			rawRange: { start, end }, boundaryRange: { start: first, end: best + 1 }, status: "unloaded" as const });
		lineOwners.set(descriptor, index); result.push(descriptor);
		start = end; first = best + 1;
	}
	return freezeDeep(result);
}

function assertLineOwner(index: TargetLineIndex, descriptor: TargetLineChunk): void {
	if (!lineIndexes.has(index) || lineOwners.get(descriptor) !== index) fail("Line Chunk needs its exact minted index and planned descriptor.");
}
export function lineChunkRawText(index: TargetLineIndex, descriptor: TargetLineChunk): string {
	assertLineOwner(index, descriptor);
	return index.rawText.slice(descriptor.rawRange.start, descriptor.rawRange.end);
}
export function lineChunkRawRange(index: TargetLineIndex, descriptor: TargetLineChunk, range: Utf16Range): Utf16Range {
	assertLineOwner(index, descriptor);
	if (!isIndex(range.start) || !isIndex(range.end) || range.end < range.start || range.end > descriptor.rawRange.end - descriptor.rawRange.start) {
		fail("Invalid local Line Chunk range.");
	}
	return Object.freeze({ start: descriptor.rawRange.start + range.start, end: descriptor.rawRange.start + range.end });
}

/** CHUNK-VIEW1 materialization entry. Projects this Chunk only; never parse its raw slice as a new document. */
export function projectTargetLineChunk(index: TargetLineIndex, descriptor: TargetLineChunk): TargetLineProjection {
	const raw = lineChunkRawText(index, descriptor);
	const fragments: TargetProjectionFragment[] = [];
	const blockFragments: TargetLineProjection["blockFragments"][number][] = [];
	const { start, end } = descriptor.rawRange;
	// Binary search avoids walking the prefix of a long manuscript on each materialization.
	let lo = 0, hi = index.blocks.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (index.blocks[mid]!.rawRange.end <= start) lo = mid + 1; else hi = mid;
	}
	for (let i = lo; i < index.blocks.length && index.blocks[i]!.rawRange.start < end; i += 1) {
		const block = index.blocks[i]!;
		const continuesBefore = block.rawRange.start < start;
		const continuesAfter = block.rawRange.end > end;
		const hidden = block.hidden ? { hidden: block.hidden } : {};
		fragments.push({ rawRange: { start: Math.max(start, block.rawRange.start) - start, end: Math.min(end, block.rawRange.end) - start },
			tag: block.tag, continuesBefore, continuesAfter,
			trailingAnalysis: continuesAfter && index.boundaries[descriptor.boundaryRange.end - 1]!.trailingAnalysis, ...hidden });
		if (block.tag !== "blank") blockFragments.push({ blockIndex: i, wholeRange: block.rawRange, continuesBefore, continuesAfter, ...hidden });
	}
	return freezeDeep({ projection: projectTargetFragments(raw, fragments), blockFragments });
}
