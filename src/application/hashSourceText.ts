export type DigestSource = {
	digest(
		algorithm: AlgorithmIdentifier,
		data: BufferSource,
	): Promise<ArrayBuffer>;
};

function defaultDigestSource(): DigestSource | undefined {
	if (typeof crypto === "undefined" || !crypto.subtle?.digest) {
		return undefined;
	}
	return crypto.subtle;
}

function toLowerHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let hex = "";
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

export async function hashSourceText(
	text: string,
	digestSource: DigestSource | undefined = defaultDigestSource(),
): Promise<string> {
	if (!digestSource?.digest) {
		throw new Error(
			"Web Crypto digest is unavailable; cannot hash source text.",
		);
	}

	const digest = await digestSource.digest(
		"SHA-256",
		new TextEncoder().encode(text),
	);
	return toLowerHex(digest);
}
