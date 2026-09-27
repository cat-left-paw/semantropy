/**
 * Structural validation for a Vault-relative path.
 *
 * This is deliberately a rejection, never a repair: a path that does not
 * satisfy these rules is refused rather than normalized, so a mistyped setting
 * can never be silently turned into a write against a different file.
 *
 * The rules keep a path inside the Vault and pointing at a file:
 *
 * - non-empty, and not only whitespace
 * - no NUL
 * - no backslash, which is a Windows separator, not a Vault separator
 * - no leading `/`, which would make the path absolute rather than relative
 * - no trailing `/`, which names a folder
 * - no empty, `.` or `..` segment, which would allow traversal
 */
export function isVaultRelativePath(value: unknown): value is string {
	if (typeof value !== "string") {
		return false;
	}
	if (value.length === 0 || value.trim().length === 0) {
		return false;
	}
	if (value.includes("\0") || value.includes("\\")) {
		return false;
	}
	if (value.startsWith("/") || value.endsWith("/")) {
		return false;
	}
	return value
		.split("/")
		.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** The last segment of a validated Vault-relative path. */
export function vaultPathName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}
