/** Local validation only: no remote, commits, downloads or changes to the source checkout. */
import { cp, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { linderaFullDictionaryDir, linderaCompactDictionaryDir, linderaArchivePath } from './lindera/linderaSource.mjs';
import { STANDARD_TEMPLATES_MARKDOWN } from './fakeDictionary/standardTemplates.mjs';
import { STANDARD_COLLISION_PATTERNS_LOCK, STANDARD_COLLISION_PATTERNS_MARKDOWN } from './collision/standardPatterns.mjs';
import { STANDARD_FAKE_PROVERB_RECIPES_LOCK, STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN } from './fakeProverb/standardRecipes.mjs';

const source = process.cwd();
const directory = await mkdtemp(path.join(os.tmpdir(), 'semantropy-history-free-'));
const env = { ...process.env };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key];
const run = (command, args, stdio = 'inherit') => {
 const result = spawnSync(command, args, { cwd: directory, env, stdio });
 if (result.error || result.status !== 0) throw result.error ?? Error(`${command} failed (${result.status})`);
};
// Windows cannot spawn a .cmd file directly (Node 24 reports EINVAL). Invoke
// npm's JavaScript entry with Node, without shell quoting or a shell fallback.
const runNpm = (args) => process.platform === 'win32'
 ? run(process.execPath, [process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args])
 : run('npm', args);
try {
 // Selected-file boundary: no .git, bulk Docs, data.json or saved artifacts.
 for (const entry of ['src', 'tests', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', 'manifest.json', 'styles.css',
  'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'README.ja.md', 'versions.json', '.gitignore', '.gitattributes',
  'esbuild.config.mjs', 'eslint.config.mts', 'vitest.config.ts', 'vitest.distribution.config.ts', 'vitest.benchmark.config.ts', 'version-bump.mjs']) {
  await cp(path.join(source, entry), path.join(directory, entry), { recursive: true });
 }
 // The Fake Dictionary template document: a public, human-edited build input,
 // copied by name. No bulk Docs tree and no private history are needed.
 await mkdir(path.join(directory, path.dirname(STANDARD_TEMPLATES_MARKDOWN)), { recursive: true });
 await cp(path.join(source, STANDARD_TEMPLATES_MARKDOWN), path.join(directory, STANDARD_TEMPLATES_MARKDOWN));
 // The Collision pattern document and its version lock: public build inputs,
 // copied by name. No bulk Docs tree and no private history are needed.
 await mkdir(path.join(directory, path.dirname(STANDARD_COLLISION_PATTERNS_MARKDOWN)), { recursive: true });
 await cp(path.join(source, STANDARD_COLLISION_PATTERNS_MARKDOWN), path.join(directory, STANDARD_COLLISION_PATTERNS_MARKDOWN));
 await cp(path.join(source, STANDARD_COLLISION_PATTERNS_LOCK), path.join(directory, STANDARD_COLLISION_PATTERNS_LOCK));
 // The Fake Proverb recipe document and its version lock, likewise by name.
 await mkdir(path.join(directory, path.dirname(STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN)), { recursive: true });
 await cp(path.join(source, STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN), path.join(directory, STANDARD_FAKE_PROVERB_RECIPES_MARKDOWN));
 await cp(path.join(source, STANDARD_FAKE_PROVERB_RECIPES_LOCK), path.join(directory, STANDARD_FAKE_PROVERB_RECIPES_LOCK));
 // Reuse installed dependencies, but copy only verified dictionary build inputs, not arbitrary .cache files.
 await symlink(path.join(source, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
 await mkdir(path.join(directory, '.cache', 'lindera'), { recursive: true });
 for (const resolve of [linderaFullDictionaryDir, linderaCompactDictionaryDir, linderaArchivePath]) await cp(resolve(source), resolve(directory), { recursive: true });
 run('git', ['init', '--quiet']);
 for (const commit of ['HEAD', 'f5f1d1c62ed49e4c3246521dbe3758a21e523c4a', 'f0a381e45283c3aaef05a731bb3d366fddede836', '18befb0ca74e39ba4ec36e00c72ac5949bbd79c1']) {
  if (spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: directory, env, stdio: 'ignore' }).status !== 128) throw Error('Unexpected history in validation repository');
 }
 process.stdout.write('[history-free] Empty Git repository; all three private commits absent. No local settings or Docs tree copied.\n');
 run('git', ['count-objects', '-v']);
 runNpm(['test']);
 runNpm(['run', 'verify:distribution']);
 process.stdout.write('[history-free] Both gates passed without private history.\n');
} finally {
 // The exact mkdtemp directory above, never a caller-supplied deletion target.
 await rm(directory, { recursive: true, force: true });
}
