import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root } from './build-lib.mjs';

if (!process.env.npm_execpath) throw new Error('Run via npm run test:standalone');
await mkdir(path.join(root, '.local/standalone'), { recursive: true });
const isolated = await mkdtemp(path.join(root, '.local/standalone/package-'));
for (const name of ['src','public','scripts','tests','package.json','package-lock.json']) {
  await cp(path.join(root,name),path.join(isolated,name),{recursive:true});
}
function run(args) {
  const result=spawnSync(process.execPath,args,{cwd:isolated,stdio:'inherit'});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error('Standalone check failed: '+args[0]);
}
// Offline installation demonstrates use of this package's own lockfile only.
// No source/node_modules imports from Frontend or Backend are available to it.
run([process.env.npm_execpath,'ci','--offline','--ignore-scripts','--no-audit','--no-fund','--cache',path.join(root,'.local/npm-cache')]);
run(['scripts/build.mjs','--release']);
const expected=JSON.parse(await readFile(path.join(root,'dist/release-build.json'),'utf8'));
const actual=JSON.parse(await readFile(path.join(isolated,'dist/release-build.json'),'utf8'));
assert.deepEqual(actual,expected,'Standalone build differs from project build');
await writeFile(path.join(root,'.local/standalone-check.json'),JSON.stringify({passed:true,isolated,version:actual.version,identicalRuntimeFiles:Object.keys(actual.hashes).length},null,2)+'\n');
console.log('Standalone install/build: identical release hashes; no Backend/Frontend dependency.');
