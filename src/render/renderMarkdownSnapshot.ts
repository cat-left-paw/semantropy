import { MarkdownRenderer, type App, type Component } from "obsidian";
import type { SourceSnapshot } from "../application/SourceSnapshot";

export async function renderMarkdownSnapshot(
	app: App,
	snapshot: Pick<SourceSnapshot, "text" | "sourcePath">,
	container: HTMLElement,
	owner: Component,
): Promise<void> {
	await MarkdownRenderer.render(
		app,
		snapshot.text,
		container,
		snapshot.sourcePath,
		owner,
	);
}
