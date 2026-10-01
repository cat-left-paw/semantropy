import { installDomHelpers } from "./obsidian/domHelpers";
installDomHelpers();

import type { EnginePackInfo } from "./engine/enginePack";
import { WorkerTokenizer } from "./engine/WorkerTokenizer";
import { DocumentStore } from "./host/documentStore";
import { WebCollectionStorage, safeLocalStorage } from "./host/webCollectionStorage";
import { WebLibrary, type PresetInfo } from "./host/WebLibrary";
import { WebSemantropyHost } from "./host/WebSemantropyHost";
import { installWebWording } from "./host/webWording";
import { installTooltips } from "./obsidian/tooltip";
import { Shell } from "./shell/Shell";

declare const __SEMANTROPY_WEB__: {
	workerUrl: string;
	enginePack: EnginePackInfo;
	presets: PresetInfo[];
	buildLabel: string;
};

async function main(): Promise<void> {
	const config = __SEMANTROPY_WEB__;
	installWebWording();
	installTooltips(document);
	const storage = safeLocalStorage();
	const library = new WebLibrary(config.presets);
	const documents = new DocumentStore(storage);
	if (documents.isAvailable() && documents.isEnabled()) {
		try {
			for (const doc of await documents.load()) library.add(doc.name, doc.text);
		} catch {
			// Stored texts that cannot be read are skipped; the page still starts.
		}
	}
	const collection = new WebCollectionStorage(storage);
	const tokenizer = new WorkerTokenizer(config.workerUrl, config.enginePack);
	const host = new WebSemantropyHost(library, collection, tokenizer, storage);
	await host.start();
	const root = document.getElementById("semantropy-web");
	if (!root) throw new Error("The page is missing its root element.");
	const shell = new Shell(root, host, {
		enginePackBytes: config.enginePack.bytes,
		buildLabel: config.buildLabel,
		presets: config.presets,
		storageAvailable: storage !== null,
		documents,
	});
	await shell.mount();
}

void main().catch(() => {
	const root = document.getElementById("semantropy-web");
	if (root) root.textContent = "Semantropy could not start in this browser.";
});
