import { spawnSync } from 'node:child_process';
import { root } from './build-lib.mjs';
const result = spawnSync(process.execPath, ['--test', 'tests/*.test.cjs', 'tests/contract/*.test.cjs', 'tests/integration/*.test.cjs'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, TEST_MINIFY: '1' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
