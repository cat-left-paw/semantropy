/** Measurement only: reconstruct the reviewed Dictionary1 baseline without saved artifacts/network. */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { buildCompactWords, LEGACY_NOUN_ONLY_SLOT_RULES } from './lindera/compactDictionary.mjs';
import { FULL_DICTIONARY_SHA256, assertDictionaryHashes } from './lindera/dictionaryHashes.mjs';
import { linderaFullDictionaryDir, sha256Hex } from './lindera/linderaSource.mjs';

export const DICTIONARY1_BASELINE_COMMIT = '18befb0ca74e39ba4ec36e00c72ac5949bbd79c1';
export const DICTIONARY1_BASELINE_SHA256 = '31e5c016ce2e9deb07bf780ecc9ad0620a8b9a094fe55f3499ce129917c16ea9';
export const LEGACY_DICTIONARY_HASHES = Object.freeze({...FULL_DICTIONARY_SHA256,
 'dict.words':'839ff520ce3b9b06a3fd297abb49bd7b2b81575f059469988df4eb13d0b9bc4e',
 'dict.wordsidx':'15502ec4d2fdcdd00531afd67a94d132f5fd44a909271508c978b11a5f27f11f'});

export async function verifyManualMorphBaseline(directory) {
 await assertDictionaryHashes(path.join(directory,'dictionary'), LEGACY_DICTIONARY_HASHES, 'measurement baseline');
 if(sha256Hex(await readFile(path.join(directory,'main.js')))!==DICTIONARY1_BASELINE_SHA256) throw Error('Wrong baseline artifact');
}

export async function prepareManualMorphBaseline(rootDir) {
 const full=linderaFullDictionaryDir(rootDir);
 await assertDictionaryHashes(full,FULL_DICTIONARY_SHA256,'full baseline input; run npm run prepare:dictionary first');
 const git=(...args)=>execFileSync('git',args,{cwd:rootDir,maxBuffer:64*1024*1024});
 // Read the pinned commit, never checkout/reset or modify the calling worktree.
 const files=git('ls-tree','-rz','--name-only',DICTIONARY1_BASELINE_COMMIT,'--','src','scripts','package.json','tsconfig.json','manifest.json','styles.css').toString().split('\0').filter(Boolean);
 const directory=await mkdtemp(path.join(os.tmpdir(),'semantropy-dictionary1-baseline-'));
 const cleanup=()=>rm(directory,{recursive:true,force:true});
 try {
  for(const file of files) {
   if(path.isAbsolute(file)||file.split('/').includes('..'))throw Error('Invalid baseline path');
   const destination=path.join(directory,file);await mkdir(path.dirname(destination),{recursive:true});
   await writeFile(destination,git('show',`${DICTIONARY1_BASELINE_COMMIT}:${file}`));
  }
  await symlink(path.join(rootDir,'node_modules'),path.join(directory,'node_modules'),'junction');
  const dictionary=path.join(directory,'dictionary');await mkdir(dictionary);
  for(const file of Object.keys(FULL_DICTIONARY_SHA256))await copyFile(path.join(full,file),path.join(dictionary,file));
  const legacy=buildCompactWords(await readFile(path.join(full,'dict.words')),await readFile(path.join(full,'dict.wordsidx')),LEGACY_NOUN_ONLY_SLOT_RULES);
  await writeFile(path.join(dictionary,'dict.words'),legacy.words);await writeFile(path.join(dictionary,'dict.wordsidx'),legacy.wordsIdx);
  // Use the baseline's own build and pinned input checks, not current production overrides.
  execFileSync(process.execPath,['--input-type=module','--eval',
   'import path from "node:path"; import {buildProductionMain} from "./scripts/buildDistribution.mjs"; await buildProductionMain({rootDir:process.cwd(),dictionaryDir:path.resolve("dictionary")});'],
   {cwd:directory,maxBuffer:64*1024*1024});
  await verifyManualMorphBaseline(directory);
  return {directory,cleanup};
 } catch(error) {await cleanup();throw error;}
}
