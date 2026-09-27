async function readAll(
	readable: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	const reader = readable.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		if (value) {
			chunks.push(value);
			total += value.length;
		}
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.length;
	}
	return merged;
}

/**
 * Inflates one gzip payload entry with `DecompressionStream`. When the runtime
 * has no `DecompressionStream` this throws: the build never downloads a
 * replacement dictionary and never swaps in another tokenizer.
 */
export async function gunzipToArrayBuffer(
	compressed: Uint8Array<ArrayBuffer>,
): Promise<ArrayBuffer> {
	if (typeof DecompressionStream === "undefined") {
		throw new Error(
			"DecompressionStream is unavailable in this environment; the embedded payload cannot be decompressed.",
		);
	}

	const stream = new DecompressionStream("gzip");
	const writer = stream.writable.getWriter();
	const written = writer.write(compressed).then(() => writer.close());
	// Never let the write rejection surface as an unhandled rejection: the read
	// below usually fails first and carries the more useful error.
	const writeSettled = written.then(
		() => null,
		(error: unknown) => error,
	);

	const bytes = await readAll(stream.readable);
	const writeError = await writeSettled;
	if (writeError !== null) {
		throw writeError instanceof Error
			? writeError
			: new Error("Embedded payload decompression failed.");
	}
	return bytes.buffer as ArrayBuffer;
}
