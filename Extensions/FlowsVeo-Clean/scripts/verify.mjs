import { spawnSync } from 'node:child_process';
import { root } from './build-lib.mjs';
const checks = [
  ['scripts/build.mjs'],
  ['--test','tests/*.test.cjs','tests/contract/*.test.cjs','tests/integration/*.test.cjs'],
  ['scripts/test-minified.mjs'],
  ['scripts/build.mjs','--release'],
  ['scripts/browser-smoke.mjs'],
  ['scripts/package.mjs'],
];
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
