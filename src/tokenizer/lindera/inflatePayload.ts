import { decodeBase64 } from "./decodeBase64";
import { gunzipToArrayBuffer } from "./gunzip";

/** Bytes backed by a plain ArrayBuffer, as `DecompressionStream` requires. */
export type PayloadBytes = Uint8Array<ArrayBuffer>;

export type PayloadCodec = {
	decode?: (encoded: string) => PayloadBytes;
	inflate?: (compressed: PayloadBytes) => Promise<ArrayBuffer>;
};

/**
 * base64 decode followed by gzip inflate. Neither primitive touches the
 * network, the filesystem, OPFS or the Vault adapter; when the runtime lacks
 * `atob` or `DecompressionStream` they throw, and nothing downloads a
 * replacement.
 */
export async function inflatePayloadEntry(
	encoded: string,
	label: string,
	codec: PayloadCodec = {},
): Promise<PayloadBytes> {
	const decode = codec.decode ?? decodeBase64;
	const inflate = codec.inflate ?? gunzipToArrayBuffer;
	if (typeof encoded !== "string" || encoded.length === 0) {
		throw new Error(`Embedded Lindera payload is incomplete: missing ${label}.`);
	}
	const buffer = await inflate(decode(encoded));
	return new Uint8Array(buffer);
}
