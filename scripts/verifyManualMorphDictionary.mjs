import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { buildCompactWords, LEGACY_NOUN_ONLY_SLOT_RULES, splitWordRecord, COMPACT_DICTIONARY_POLICY } from './lindera/compactDictionary.mjs';
import { assertDictionaryHashes, FULL_DICTIONARY_SHA256, COMPACT_DICTIONARY_SHA256 } from './lindera/dictionaryHashes.mjs';
import { linderaFullDictionaryDir, linderaCompactDictionaryDir, sha256Hex } from './lindera/linderaSource.mjs';

/** Exhaustive byte/field oracle, independent of production slot resolution. No writes/network. */
export async function verifyManualMorphDictionary(root = process.cwd()) {
 const full = linderaFullDictionaryDir(root), compact = linderaCompactDictionaryDir(root);
 await assertDictionaryHashes(full, FULL_DICTIONARY_SHA256, 'full');
 await assertDictionaryHashes(compact, COMPACT_DICTIONARY_SHA256, 'compact');
 const read = async dir => ({ words: await readFile(path.join(dir, 'dict.words')), wordsIdx: await readFile(path.join(dir, 'dict.wordsidx')) });
 const source = await read(full), shipped = await read(compact);
 const legacy = buildCompactWords(source.words, source.wordsIdx, LEGACY_NOUN_ONLY_SLOT_RULES);
 if (sha256Hex(legacy.words) !== '839ff520ce3b9b06a3fd297abb49bd7b2b81575f059469988df4eb13d0b9bc4e' || sha256Hex(legacy.wordsIdx) !== '15502ec4d2fdcdd00531afd67a94d132f5fd44a909271508c978b11a5f27f11f') throw Error('Legacy oracle drift');
 const regenerated = buildCompactWords(source.words, source.wordsIdx);
 if (!regenerated.words.equals(shipped.words) || !regenerated.wordsIdx.equals(shipped.wordsIdx)) throw Error('Prepared output differs from deterministic generation');
 const decoder = new TextDecoder('utf-8', { fatal: true });
 const cursors = new Map();
 function fields(pair, entry) {
  const offset = pair.wordsIdx.readUInt32LE(entry * 4);
  if (offset !== (cursors.get(pair) ?? 0)) throw Error('Noncontiguous entry order/index');
  const length = pair.words.readUInt32LE(offset);
  if (offset + 4 + length > pair.words.length) throw Error('Invalid record length');
  cursors.set(pair, offset + 4 + length);
  const result = splitWordRecord(pair.words.subarray(offset + 4, offset + 4 + length), entry);
  for (const f of result) if (!Buffer.from(decoder.decode(f)).equals(f)) throw Error('Noncanonical UTF-8');
  return result;
 }
 const counts = { entries: source.wordsIdx.length / 4, verbs: 0, adjectives: 0, unchangedOther: 0, fieldComparisons: 0, empty: 0, unset: 0 };
 if (source.wordsIdx.length !== shipped.wordsIdx.length) throw Error('Entry count changed');
 for (let i = 0; i < counts.entries; i++) {
  const original = fields(source, i), actual = fields(shipped, i), old = fields(legacy, i);
  const pos = decoder.decode(original[0]), detail = decoder.decode(original[1]);
  const morph = detail === '自立' && (pos === '動詞' || pos === '形容詞');
  if (morph) {
   counts[pos === '動詞' ? 'verbs' : 'adjectives']++;
   for (let slot = 0; slot < 9; slot++) {
    const expected = slot === 8 ? Buffer.from('*') : original[slot];
    if (!actual[slot].equals(expected)) throw Error(`Field mismatch at entry ${i}, slot ${slot}`);
    if (slot >= 3 && slot <= 7) { counts.fieldComparisons++; if (!actual[slot].length) counts.empty++; if (actual[slot].equals(Buffer.from('*'))) counts.unset++; }
   }
  } else {
   counts.unchangedOther++;
   if (actual.some((f,s) => !f.equals(old[s]))) throw Error(`Non-target entry changed: ${i}`);
  }
 }
 for (const [pair, cursor] of cursors) if (cursor !== pair.words.length) throw Error('Trailing bytes');
 if (counts.entries !== 392126 || counts.verbs !== 129855 || counts.adjectives !== 26951) throw Error('Unexpected class counts');
 return { policy: COMPACT_DICTIONARY_POLICY, ...counts, entryOrderAndIndex: true, utf8AndNul: true, deterministic: true,
  fullHashes: FULL_DICTIONARY_SHA256, compactHashes: COMPACT_DICTIONARY_SHA256 };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
 process.stdout.write(JSON.stringify(await verifyManualMorphDictionary(), null, 2) + '\n');
}
