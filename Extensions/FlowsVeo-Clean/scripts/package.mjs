import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';
import path from 'node:path';
import assert from 'node:assert/strict';
import { root, runtimeFiles } from './build-lib.mjs';

const directory = path.join(root, 'dist/release');
const metadata = JSON.parse(await readFile(path.join(root, 'dist/release-build.json'), 'utf8'));
const names = await runtimeFiles(directory);
const files = {};
for (const name of names) {
  const bytes = await readFile(path.join(directory, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.hashes[name], `Build changed: ${name}`);
  files[name] = [bytes, { mtime: new Date(2020, 0, 1, 0, 0, 0) }];
}
const archive = zipSync(files, { level: 9 });
assert.deepEqual(Object.keys(unzipSync(archive)).sort(), names.sort());
const output = path.join(root, 'release', `FlowsVeo-Clean-v${metadata.version}.zip`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, archive);
const sha256 = createHash('sha256').update(archive).digest('hex');
await writeFile(output + '.sha256', `${sha256}  ${path.basename(output)}\n`);
console.log(JSON.stringify({ output, bytes: archive.length, sha256 }, null, 2));
