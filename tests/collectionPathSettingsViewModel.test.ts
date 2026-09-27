import { describe, expect, it } from "vitest";
import {
	COLLECTION_PATH_INVALID_MESSAGE,
	COLLECTION_PATH_SAVE_FAILED_MESSAGE,
	COLLECTION_PATH_SAVED_MESSAGE,
} from "../src/application/collectionPathMessages";
import { toCollectionPathSettingsViewModel } from "../src/view/collectionPathSettingsViewModel";
import { DEFAULT_COLLECTION_PATH } from "../src/settings/collectionPath";

describe("toCollectionPathSettingsViewModel", () => {
	it("keeps the typed draft separate from the last saved path", () => {
		const model = toCollectionPathSettingsViewModel({
			draft: "Collected/Fragments.md",
			effective: DEFAULT_COLLECTION_PATH,
			busy: false,
			status: "idle",
		});
		expect(model.draft).toBe("Collected/Fragments.md");
		expect(model.effective).toBe(DEFAULT_COLLECTION_PATH);
		expect(model.message).toBeNull();
		expect(model.saveEnabled).toBe(true);
	});

	it("disables Save while a write is in flight", () => {
		const model = toCollectionPathSettingsViewModel({
			draft: DEFAULT_COLLECTION_PATH,
			effective: DEFAULT_COLLECTION_PATH,
			busy: true,
			status: "idle",
		});
		expect(model.saveEnabled).toBe(false);
	});

	it("maps status to the fixed messages without interpolating the draft", () => {
		expect(
			toCollectionPathSettingsViewModel({
				draft: "/absolute.md",
				effective: DEFAULT_COLLECTION_PATH,
				busy: false,
				status: "invalid",
			}).message,
		).toBe(COLLECTION_PATH_INVALID_MESSAGE);
		expect(
			toCollectionPathSettingsViewModel({
				draft: "Collected/Fragments.md",
				effective: "Collected/Fragments.md",
				busy: false,
				status: "saved",
			}).message,
		).toBe(COLLECTION_PATH_SAVED_MESSAGE);
		expect(
			toCollectionPathSettingsViewModel({
				draft: "Collected/Fragments.md",
				effective: DEFAULT_COLLECTION_PATH,
				busy: false,
				status: "failed",
			}).message,
		).toBe(COLLECTION_PATH_SAVE_FAILED_MESSAGE);
		expect(COLLECTION_PATH_INVALID_MESSAGE).not.toContain("/absolute.md");
	});

	it("does not keep a saved message when the draft is no longer the saved path", () => {
		const model = toCollectionPathSettingsViewModel({
			draft: "Other/Fragments.md",
			effective: "Collected/Fragments.md",
			busy: false,
			status: "saved",
		});
		expect(model.message).toBeNull();
		expect(model.draft).toBe("Other/Fragments.md");
		expect(model.effective).toBe("Collected/Fragments.md");
	});
});
