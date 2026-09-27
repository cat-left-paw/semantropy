import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Replaces directories with fully built ones, and puts the previous ones back
 * if anything goes wrong. Used wherever a build step must not leave a target
 * missing or half-replaced: the dictionary cache and the distribution
 * directory.
 *
 * Each target that exists is first moved into `backupDir`, then the staged
 * directory is renamed into its place. A failure at any point — including the
 * second of two entries — undoes every step already taken, newest first. Until
 * `commit()` is called the caller can also `rollback()` after its own later
 * check fails. Staged directories and `backupDir` must be on the same file
 * system as their targets, because every move is a `rename`.
 *
 * If the rollback itself cannot finish, the error says which backup still
 * holds the previous directory and is marked `preserved`, so a caller that
 * removes its staging area must leave `backupDir` alone.
 *
 * `renameImpl` exists so tests can inject a failing move; production callers
 * leave it unset.
 */

async function exists(target) {
	try {
		await stat(target);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

export async function publishDirectories(
	entries,
	{ backupDir, renameImpl = rename } = {},
) {
	if (backupDir === undefined) {
		throw new Error("publishDirectories needs a backupDir.");
	}
	const steps = [];
	let finished = false;

	async function rollback() {
		const failures = [];
		for (const step of steps.reverse()) {
			try {
				if (step.placed) {
					await rm(step.target, { recursive: true, force: true });
				}
				if (step.backup !== null) {
					await renameImpl(step.backup, step.target);
				}
			} catch (error) {
				failures.push(
					`${step.target}${step.backup === null ? "" : ` (previous copy kept at ${step.backup})`}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		steps.length = 0;
		if (failures.length > 0) {
			throw Object.assign(
				new Error(
					`Restoring the previous directories failed; they may need to be restored by hand: ${failures.join("; ")}`,
				),
				{ preserved: true },
			);
		}
	}

	try {
		await mkdir(backupDir, { recursive: true });
		for (const [index, { staged, target }] of entries.entries()) {
			const step = { target, backup: null, placed: false };
			steps.push(step);
			if (await exists(target)) {
				const backup = path.join(backupDir, `previous-${index}`);
				await renameImpl(target, backup);
				step.backup = backup;
			}
			await renameImpl(staged, target);
			step.placed = true;
		}
	} catch (error) {
		try {
			await rollback();
		} catch (rollbackError) {
			throw Object.assign(
				new Error(
					`${error instanceof Error ? error.message : String(error)} ${rollbackError.message}`,
					{ cause: error },
				),
				{ preserved: true },
			);
		}
		throw error;
	}

	return {
		/** Undo the publication, e.g. after a check made on the published files fails. */
		rollback: async () => {
			if (finished) {
				throw new Error("The publication was already committed.");
			}
			await rollback();
		},
		/** Keep the new directories. The backups are the caller's to delete with its staging area. */
		commit: () => {
			finished = true;
			steps.length = 0;
		},
	};
}
