import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishDirectories } from "../scripts/publishDirectories.mjs";

/**
 * PRE-RELEASE-BUILD-BOOTSTRAP1, review 1: replacing a directory must never
 * leave its target missing or half-replaced. The moves are injected so a
 * failure can be placed at every step. Each entry costs two moves: the target
 * into the backup area (only if it exists), then the staged directory into the
 * target.
 */

let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "semantropy-publish-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function dir(name: string, content: string): Promise<string> {
	const target = path.join(root, name);
	await mkdir(target, { recursive: true });
	await writeFile(path.join(target, "file.txt"), content);
	return target;
}

const read = (target: string) => readFile(path.join(target, "file.txt"), "utf8");

/** A move that really happens, except that the listed calls (1-based) throw instead. */
function failingOn(...failing: number[]) {
	let calls = 0;
	return async (from: string, to: string) => {
		calls += 1;
		if (failing.includes(calls)) {
			throw new Error(`injected failure on move ${calls}`);
		}
		await rename(from, to);
	};
}

describe("publishDirectories", () => {
	it("moves the old directory aside, places the new one and keeps the backup until the caller removes it", async () => {
		const target = await dir("target", "old");
		const staged = await dir("staged", "new");
		const backupDir = path.join(root, "backup");
		const publication = await publishDirectories([{ staged, target }], { backupDir });
		publication.commit();
		expect(await read(target)).toBe("new");
		expect(await read(path.join(backupDir, "previous-0"))).toBe("old");
	});

	it("places a directory whose target does not exist yet", async () => {
		const staged = await dir("staged", "new");
		const target = path.join(root, "target");
		const publication = await publishDirectories([{ staged, target }], {
			backupDir: path.join(root, "backup"),
		});
		publication.commit();
		expect(await read(target)).toBe("new");
		expect(await readdir(path.join(root, "backup"))).toEqual([]);
	});

	it("changes nothing when the very first move fails", async () => {
		const target = await dir("target", "old");
		const staged = await dir("staged", "new");
		await expect(
			publishDirectories([{ staged, target }], {
				backupDir: path.join(root, "backup"),
				renameImpl: failingOn(1),
			}),
		).rejects.toThrow("injected failure on move 1");
		expect(await read(target)).toBe("old");
		expect(await read(staged)).toBe("new");
	});

	it("puts the old directory back when placing the new one fails", async () => {
		const target = await dir("target", "old");
		const staged = await dir("staged", "new");
		await expect(
			publishDirectories([{ staged, target }], {
				backupDir: path.join(root, "backup"),
				renameImpl: failingOn(2),
			}),
		).rejects.toThrow("injected failure on move 2");
		expect(await read(target)).toBe("old");
	});

	for (const failing of [3, 4]) {
		it(`restores both directories when move ${failing} of two entries fails`, async () => {
			const target0 = await dir("target0", "old0");
			const target1 = await dir("target1", "old1");
			const staged0 = await dir("staged0", "new0");
			const staged1 = await dir("staged1", "new1");
			await expect(
				publishDirectories(
					[
						{ staged: staged0, target: target0 },
						{ staged: staged1, target: target1 },
					],
					{ backupDir: path.join(root, "backup"), renameImpl: failingOn(failing) },
				),
			).rejects.toThrow(`injected failure on move ${failing}`);
			expect(await read(target0)).toBe("old0");
			expect(await read(target1)).toBe("old1");
		});
	}

	it("can be rolled back after the caller's own check fails", async () => {
		const target = await dir("target", "old");
		const staged = await dir("staged", "new");
		const publication = await publishDirectories([{ staged, target }], {
			backupDir: path.join(root, "backup"),
		});
		expect(await read(target)).toBe("new");
		await publication.rollback();
		expect(await read(target)).toBe("old");
	});

	it("says where the previous copy is, and marks the error, when the restore also fails", async () => {
		const target = await dir("target", "old");
		const staged = await dir("staged", "new");
		const backupDir = path.join(root, "backup");
		const failure = await publishDirectories([{ staged, target }], {
			backupDir,
			// Move 2 (placing) fails, and so does move 3 (restoring the backup).
			renameImpl: failingOn(2, 3),
		}).then(
			() => undefined,
			(error: unknown) => error as Error & { preserved?: boolean },
		);
		expect(failure?.preserved).toBe(true);
		expect(failure?.message).toContain("injected failure on move 2");
		expect(failure?.message).toContain("previous copy kept at");
		expect(failure?.message).toContain(path.join(backupDir, "previous-0"));
		// The previous directory still exists where the message says.
		expect(await read(path.join(backupDir, "previous-0"))).toBe("old");
	});

	it("refuses a call without a backup directory", async () => {
		await expect(publishDirectories([], {} as never)).rejects.toThrow(/backupDir/);
	});
});
