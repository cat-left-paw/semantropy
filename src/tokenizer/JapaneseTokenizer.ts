export type JapaneseToken = {
	surface: string;
	pos: string;
	detail1: string;
	detail2: string;
	detail3: string;
	conjugationType: string;
	conjugationForm: string;
	baseForm: string;
	reading?: string;
	isUnknown: boolean;
};

export interface JapaneseTokenizer {
	tokenize(text: string): Promise<JapaneseToken[]>;
}
