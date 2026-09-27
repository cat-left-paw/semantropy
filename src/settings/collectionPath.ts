import {
	isVaultRelativePath,
	vaultPathName,
} from "../path/vaultRelativePath";

/** Vault root, so Collect works before the user configures anything. */
export const DEFAULT_COLLECTION_PATH = "Semantropy Fragments.md";

const MARKDOWN_EXTENSION = ".md";

/**
 * Where Collect writes: a Vault-relative path to a Markdown file.
 *
 * The `.md` requirement is part of the promise that a collection stays an
 * ordinary note the user can open, read and edit. A name that is only the
 * extension is refused as well, since that would be a hidden, nameless file.
 */
export function isCollectionPath(value: unknown): value is string {
	if (!isVaultRelativePath(value)) {
		return false;
	}
	const name = vaultPathName(value);
	return (
		name.length > MARKDOWN_EXTENSION.length && name.endsWith(MARKDOWN_EXTENSION)
	);
}
