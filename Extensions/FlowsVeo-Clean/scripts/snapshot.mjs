import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(root, '.local', 'snapshots', stamp);
await mkdir(destination, { recursive: true });
const runtime = ['background.js', 'content.js', 'popup.js', 'popup.html', 'manifest.json', 'icons'];
for (const name of [...runtime, 'tests']) {
  await cp(path.join(root, name), path.join(destination, name), { recursive: true, errorOnExist: true, force: false });
}
const hashes = {};
async function hashFiles(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await hashFiles(path.join(dir, entry.name), relative + '/');
    else hashes[relative] = createHash('sha256').update(await readFile(path.join(dir, entry.name))).digest('hex');
  }
}
await hashFiles(destination);
await writeFile(path.join(destination, 'snapshot.json'), JSON.stringify({ createdAt: stamp, hashes }, null, 2) + '\n');
console.log(destination);
