/**
 * Decodes one base64 payload entry into bytes without Node APIs, a Vault
 * adapter, or any network call. `atob` is available in the Obsidian desktop
 * renderer and in the Node versions this project tests on.
 */
export function decodeBase64(encoded: string): Uint8Array<ArrayBuffer> {
	if (typeof atob === "undefined") {
		throw new Error(
			"atob is unavailable in this environment; the embedded payload cannot be decoded.",
		);
	}
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}
