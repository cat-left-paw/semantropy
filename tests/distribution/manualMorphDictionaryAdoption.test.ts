// @vitest-environment jsdom
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, symlink, writeFile, unlink, rm } from 'node:fs/promises';
import os from 'node:os';
import { FULL_DICTIONARY_SHA256, VERIFIED_DICTIONARY_FILE_NAMES, assertDictionaryHashes } from '../../scripts/lindera/dictionaryHashes.mjs';
import { linderaFullDictionaryDir, linderaCompactDictionaryDir } from '../../scripts/lindera/linderaSource.mjs';
import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildCompactWords, LEGACY_NOUN_ONLY_SLOT_RULES } from '../../scripts/lindera/compactDictionary.mjs';
import { verifyManualMorphDictionary } from '../../scripts/verifyManualMorphDictionary.mjs';
import { buildTokenize, initLindera, compactDictionaryDir, fullDictionaryDir, type Tokenize } from './linderaFixture';
import { ChunkTargetBodyController } from '../../src/render/chunkTargetBodyController';
import { analyzeSelectedSource } from '../../src/application/analyzeSelectedSource';
import { analyzeManualMorphSource, buildManualMorphVocabulary, evaluateManualMorphSlot } from '../../src/transform/manualMorphology';
import { buildVocabularySnapshot, type VocabularyDrawMode } from '../../src/vocabulary/vocabularySnapshot';
import { assertBodySemantropy } from '../../src/settings/bodySemantropy';
import { sha256Hex } from '../../src/vocabulary/sha256';
const comparison: unknown[]=[];
afterAll(()=>writeFileSync(".cache/dictionary1-comparison.json",JSON.stringify(comparison,null,2)));
let old: Tokenize, next: Tokenize;
beforeAll(async () => {
 await initLindera();
 const full = fullDictionaryDir();
 const legacy = buildCompactWords(readFileSync(path.join(full,'dict.words')),readFileSync(path.join(full,'dict.wordsidx')),LEGACY_NOUN_ONLY_SLOT_RULES);
 old = buildTokenize(compactDictionaryDir(),{'dict.words':new Uint8Array(legacy.words),'dict.wordsidx':new Uint8Array(legacy.wordsIdx)});
 next = buildTokenize(compactDictionaryDir());
});
const target = '犬《いぬ》は猫《ねこ》を見た。海が青かった。\n犬と猫が走った。\n'.repeat(8);
const sourceText = '猫《ねこ》と猫《ネコ》と犬《いぬ》と犬《イヌ》。花と花と鳥。絵を描いた。空が赤かった。';
const scheduler = {now:()=>performance.now(),yieldTask:async()=>{},paint:async()=>{}};
const work = {scheduler,isCurrent:()=>true};
async function source(tokenize:Tokenize,text:string,sourcePath:string) {
 const analyzed = await analyzeSelectedSource({text,sourcePath,contentHash:sha256Hex(text),tokenizer:{tokenize:async text=>tokenize(text)}});
 if(analyzed.status!=='ready') throw Error(analyzed.status);
 return {source:{path:sourcePath,contentHash:sha256Hex(text),projectionPolicy:analyzed.projection.policyVersion},vocabulary:analyzed.vocabulary};
}
async function open(tokenize:Tokenize, mode:VocabularyDrawMode, selected:boolean) {
 const controller = new ChunkTargetBodyController();
 const handle = async (text:string,sourcePath:string) => {
  const analyzed=await analyzeManualMorphSource({text,sourcePath,tokenizer:{tokenize:async text=>tokenize(text)}});
  if(analyzed.status!=="ready") throw Error(analyzed.status);
  return analyzed.analysis;
 };
 const sources=selected?[await handle(target,'target'),await handle(sourceText,'source')]:undefined;
 const result=await controller.open({...work,snapshot:{text:target,sourcePath:'target',contentHash:sha256Hex(target)},bodySeed:7,bodySemantropy:assertBodySemantropy(100),getTokenizer:()=>({tokenize:async text=>tokenize(text)}),ownerDocument:document,targetSize:55,drawMode:mode,vocabularySources:sources});
 expect(result.status).toBe('applied');document.body.appendChild(controller.getContainer()!);
 return controller;
}
describe('Dictionary1 adoption',()=>{
 it('checks every field byte, UTF-8, NUL, order/index and non-target entry against pinned full and legacy',async()=>{
  expect(await verifyManualMorphDictionary()).toMatchObject({entries:392126,verbs:129855,adjectives:26951,unchangedOther:235320,fieldComparisons:784030,empty:0,deterministic:true,entryOrderAndIndex:true,utf8AndNul:true});
 });
 it('rejects altered full input, altered compact output, and a wrong pinned expectation',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'semantropy-dictionary1-'));
  try {
   const full=linderaFullDictionaryDir(root),compact=linderaCompactDictionaryDir(root);
   for(const [to,from] of [[full,fullDictionaryDir()],[compact,compactDictionaryDir()]]) {
    await mkdir(to!,{recursive:true});
    for(const f of VERIFIED_DICTIONARY_FILE_NAMES) await symlink(path.join(from!,f),path.join(to!,f));
   }
   for(const dir of [full,compact]) {
    const file=path.join(dir,'dict.words'),source=dir===full?fullDictionaryDir():compactDictionaryDir();
    const changed=Buffer.from(readFileSync(path.join(source,'dict.words')));changed[changed.length-1]=(changed[changed.length-1]??0)^1;
    await unlink(file);await writeFile(file,changed);
    await expect(verifyManualMorphDictionary(root)).rejects.toThrow(/does not match the hashes pinned/);
    await unlink(file);await symlink(path.join(source,'dict.words'),file);
   }
   await expect(assertDictionaryHashes(full,{...FULL_DICTIONARY_SHA256,'dict.words':'0'.repeat(64)},'wrong hash')).rejects.toThrow(/does not match/);
  } finally {await rm(root,{recursive:true,force:true});}
 });
 for(const mode of ['uniform','frequency'] as const) for(const selected of [false,true]) {
  it(`${mode}, ${selected?'multiple Selected Notes':'Current Note'}: loaded prefixes preserve noun surfaces/counts/pools; fingerprint/Ruby changes are explicit`,async()=>{
   const before=await open(old,mode,selected),after=await open(next,mode,selected);
   try {
    const a=before.getVocabularySnapshot()!,b=after.getVocabularySnapshot()!;
    expect(b.fingerprint).not.toBe(a.fingerprint);
    expect(b.projections.automaticBody).toEqual(a.projections.automaticBody);
    expect(b.projections.dictionary).toEqual(a.projections.dictionary);
    expect(after.getDictionaryPool()).toEqual(before.getDictionaryPool());
    expect(b.candidates.filter(c=>c.token.pos==='名詞')).toEqual(a.candidates.filter(c=>c.token.pos==='名詞'));
    expect(b.candidates.filter(c=>c.token.pos==='動詞').map(c=>c.candidateId)).not.toEqual(a.candidates.filter(c=>c.token.pos==='動詞').map(c=>c.candidateId));
    for(let loaded=0;loaded<3;loaded++) {
     const oldPlan=before.getDisplaySlotPlan()!,newPlan=after.getDisplaySlotPlan()!;
     expect(newPlan.slots.map(s=>[s.originalToken.surface,s.originalRange,s.automaticSurface])).toEqual(oldPlan.slots.map(s=>[s.originalToken.surface,s.originalRange,s.automaticSurface]));
     expect([newPlan.replacementCount,newPlan.replaceableSlotCount]).toEqual([oldPlan.replacementCount,oldPlan.replaceableSlotCount]);
     expect(oldPlan.slots.filter(s=>s.originalToken.pos==='動詞'||s.originalToken.pos==='形容詞').every(s=>!s.manualAvailable)).toBe(true);
     // MORPH2 connects the adopted fields, but never expands automatic noun replacement.
     const morphSlots=newPlan.slots.filter(s=>s.originalToken.pos==='動詞'||s.originalToken.pos==='形容詞');
     expect(morphSlots.every(s=>!s.automaticReplaceable&&!s.automaticReplaced)).toBe(true);
     expect(morphSlots.some(s=>s.manualAvailable)).toBe(selected);
     expect(after.getContainer()!.querySelectorAll('[tabindex],[data-token-id]')).toHaveLength(0);
     if(loaded<2) for(const [controller,tokenize] of [[before,old],[after,next]] as const) expect((await controller.loadNext({...work,seed:7,level:assertBodySemantropy(100),getTokenizer:()=>({tokenize:async text=>tokenize(text)})})).status).toBe('applied');
    }
    // Fingerprint enters the derived Ruby stream, not the primary surface draw.
    let rubyDifferences=0;const examples:unknown[]=[];
    for(let seed=1;seed<=20;seed++) {
     // Body 11 level 50 is Body 10 at 100: the historical full-application comparison.
     const a=before.transform(seed,assertBodySemantropy(50)),b=after.transform(seed,assertBodySemantropy(50));
     expect(b.algorithmVersion).toBe(11);
     expect(b.tokenSurfaces).toEqual(a.tokenSurfaces);
     const ap=(a as typeof a & {plan:{slots:readonly {automaticRuby:unknown}[]}}).plan;
     const bp=(b as typeof b & {plan:typeof ap}).plan;
     if(JSON.stringify(ap.slots.map(s=>s.automaticRuby))!==JSON.stringify(bp.slots.map(s=>s.automaticRuby))) {rubyDifferences++;if(examples.length===0){const index=ap.slots.findIndex((s,i)=>JSON.stringify(s.automaticRuby)!==JSON.stringify(bp.slots[i]!.automaticRuby));examples.push({seed,index,before:ap.slots[index]!.automaticRuby,after:bp.slots[index]!.automaticRuby});}}
    }
    if(selected) expect(rubyDifferences).toBeGreaterThan(0);
    comparison.push({mode,selected,oldFingerprint:a.fingerprint,newFingerprint:b.fingerprint,rubyDifferences,outOfSeeds:20,examples});
   } finally {before.release();after.release();}
  });
 }
 it('real production tokens retain UTF-16 coverage, including whitespace and emoji',()=>{
  for(const text of [target,sourceText,'😀 書いて\r\n赤かった。e\u0301\t未知XYZ']) {
   const a=old(text),b=next(text);expect(b.map(t=>t.surface)).toEqual(a.map(t=>t.surface));expect(b.map(t=>t.surface).join('')).toBe(text);
  }
 });
 it('real production Source mint rejects forged/clone/foreign evidence without freezing callers',async()=>{
  const tokens=next('絵を描いて。'),saved=structuredClone(tokens);
  const analyzed=await analyzeManualMorphSource({text:'絵を描いて。',sourcePath:'source',tokenizer:{tokenize:async()=>tokens}});
  expect(analyzed.status).toBe('ready');if(analyzed.status!=='ready')throw Error();
  const args={sources:[analyzed.analysis],drawMode:'uniform' as const};
  const minted=buildManualMorphVocabulary(args), other=buildManualMorphVocabulary(args);
  const targetTokens=next('書いて。');
  const evaluate=(snapshot= minted.snapshot,evidence=minted.evidence)=>evaluateManualMorphSlot({target:targetTokens[0]!,next:targetTokens[1]!,currentSurface:'書い',snapshot,evidence});
  expect(evaluate().available).toBe(true);
  for(const evidence of [{},{...minted.evidence},structuredClone(minted.evidence),other.evidence]) expect(evaluate(minted.snapshot,evidence as typeof minted.evidence)).toMatchObject({reason:'invalid-evidence'});
  for(const snapshot of [{...minted.snapshot},structuredClone(minted.snapshot),other.snapshot])expect(evaluate(snapshot,minted.evidence)).toMatchObject({reason:'invalid-evidence'});
  expect(()=>buildManualMorphVocabulary({...args,sources:[{...analyzed.analysis}]})).toThrow();
  expect(()=>buildManualMorphVocabulary({...args,sources:[{} as typeof analyzed.analysis]})).toThrow();
  expect(tokens).toEqual(saved);expect(Object.isFrozen(tokens)).toBe(false);expect(tokens.every(t=>!Object.isFrozen(t))).toBe(true);
  const conventional=buildVocabularySnapshot({sources:[await source(next,'絵を描いて。','source')],drawMode:'uniform'});
  expect(conventional).toEqual(minted.snapshot);
 });
});
