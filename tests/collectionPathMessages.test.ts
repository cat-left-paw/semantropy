import { describe, expect, it } from "vitest";
import {
	COLLECTION_PATH_INVALID_MESSAGE,
	COLLECTION_PATH_SAVE_FAILED_MESSAGE,
	COLLECTION_PATH_SAVED_MESSAGE,
} from "../src/application/collectionPathMessages";

const TYPED = " Collected/Fragments.md";
const ABSOLUTE = "/Users/hidden/vault/notes/桜桃.md";

const MESSAGES = [
	COLLECTION_PATH_INVALID_MESSAGE,
	COLLECTION_PATH_SAVED_MESSAGE,
	COLLECTION_PATH_SAVE_FAILED_MESSAGE,
];

describe("Collection path settings messages", () => {
	it("never interpolates a typed path, an absolute path or an exception", () => {
		for (const message of MESSAGES) {
			expect(message).not.toContain(TYPED);
			expect(message).not.toContain(ABSOLUTE);
			expect(message).not.toMatch(/%s|\$\{/);
		}
	});
});
