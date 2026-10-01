import type { JapaneseToken } from "../../../src/tokenizer/JapaneseTokenizer";
import type { EnginePackInfo } from "./enginePack";

export type WorkerRequest =
	| { type: "tokenize"; id: number; text: string; pack: EnginePackInfo }
	| { type: "warm"; pack: EnginePackInfo };

export type WorkerResponse =
	| { type: "progress"; loaded: number; total: number }
	| { type: "ready" }
	| { type: "result"; id: number; tokens: JapaneseToken[] }
	| { type: "error"; id: number | null; message: string };
