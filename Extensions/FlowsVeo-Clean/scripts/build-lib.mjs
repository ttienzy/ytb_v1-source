import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const entries = {
  background: 'src/background/index.js',
  content: 'src/content/index.js',
  popup: 'src/popup/index.js',
};

export async function runtimeFiles(directory) {
  const names = ['background.js', 'content.js', 'popup.js', 'popup.html', 'manifest.json'];
  for (const name of (await readdir(path.join(directory, 'icons'))).sort()) names.push('icons/' + name);
  return names;
}

export function bundleOptions(release = false) {
  return {
    bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
    charset: 'utf8', sourcemap: false, legalComments: 'none',
    // No syntax rewrites/keepNames helpers that could escape serialized functions.
    minifyWhitespace: release, minifyIdentifiers: release, minifySyntax: false,
    treeShaking: false, write: false,
  };
}

export async function buildExtension({ release = false, compatibility = false } = {}) {
  const output = path.join(root, 'dist', release ? 'release' : 'dev');
  await mkdir(output, { recursive: true });
  for (const [name, entry] of Object.entries(entries)) {
    const result = await build({ ...bundleOptions(release), absWorkingDir: root, entryPoints: [entry] });
    await writeFile(path.join(output, name + '.js'), result.outputFiles[0].contents);
  }
  for (const name of ['manifest.json', 'popup.html', 'icons']) {
    await cp(path.join(root, 'public', name), path.join(output, name), { recursive: true });
  }
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) throw new Error('Manifest/package version mismatch');
  const hashes = {};
  for (const name of await runtimeFiles(output)) {
    hashes[name] = createHash('sha256').update(await readFile(path.join(output, name))).digest('hex');
  }
  const metadata = { version: manifest.version, mode: release ? 'release' : 'dev', hashes };
  await writeFile(path.join(root, 'dist', release ? 'release-build.json' : 'dev-build.json'), JSON.stringify(metadata, null, 2) + '\n');
  // Explicit compatibility build, preserving the existing Load unpacked path.
  // Never deletes directories and never copies tests/source into the runtime ZIP.
  if (compatibility) {
    for (const name of await runtimeFiles(output)) await cp(path.join(output, name), path.join(root, name));
  }
  return output;
}
