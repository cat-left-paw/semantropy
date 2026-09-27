import { describe, expect, it } from "vitest";
import { SourceRevisionLog } from "../src/application/sourceRevisionLog";

describe("SourceRevisionLog", () => {
	it("starts every path at revision 0", () => {
		const log = new SourceRevisionLog();
		expect(log.current("note.md")).toBe(0);
		expect(log.changedSince("note.md", 0)).toBe(false);
	});

	it("reports a change that landed after the token was taken", () => {
		const log = new SourceRevisionLog();
		const token = log.current("note.md");
		log.bump("note.md");
		expect(log.changedSince("note.md", token)).toBe(true);
	});

	it("does not report changes that landed before the token was taken", () => {
		const log = new SourceRevisionLog();
		log.bump("note.md");
		const token = log.current("note.md");
		expect(log.changedSince("note.md", token)).toBe(false);
	});

	it("keeps paths independent", () => {
		const log = new SourceRevisionLog();
		const token = log.current("folder/note.md");
		log.bump("other.md");
		expect(log.changedSince("folder/note.md", token)).toBe(false);
		expect(log.changedSince("other.md", 0)).toBe(true);
	});

	it("counts repeated changes to the same path", () => {
		const log = new SourceRevisionLog();
		const token = log.current("note.md");
		log.bump("note.md");
		log.bump("note.md");
		expect(log.current("note.md")).toBe(token + 2);
		expect(log.changedSince("note.md", token)).toBe(true);
	});
});
