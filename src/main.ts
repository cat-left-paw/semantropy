import {
	LINDERA_DICTIONARY_GZIP_BASE64,
	LINDERA_WASM_GZIP_BASE64,
} from "virtual:semantropy-lindera-payload";
import {
	SemantropyPlugin,
	type SemantropyTokenizerHost,
} from "./SemantropyPlugin";
import { LinderaTokenizer } from "./tokenizer/lindera/linderaEngine";

/**
 * The Semantropy plugin entry point.
 *
 * There is one tokenizer and one distribution shape. The Lindera WebAssembly
 * module and the Semantropy-compact IPADIC travel inside `main.js` as gzip, so
 * an installed plugin is the three files a Community Plugin install delivers —
 * `main.js`, `manifest.json`, `styles.css` — and needs no `dict/` directory,
 * no OPFS entry, no resource path and no request of any kind.
 *
 * Nothing is decoded or instantiated here: `LinderaTokenizer` builds its
 * engine on the first tokenize request, and `SemantropyPlugin` holds that one
 * instance for the whole plugin lifetime.
 */
export default class SemantropyLinderaPlugin extends SemantropyPlugin {
	protected createTokenizer(): SemantropyTokenizerHost {
		return new LinderaTokenizer({
			wasm: LINDERA_WASM_GZIP_BASE64,
			dictionary: LINDERA_DICTIONARY_GZIP_BASE64,
		});
	}
}
