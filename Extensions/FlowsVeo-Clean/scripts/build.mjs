import { buildExtension } from './build-lib.mjs';
const release = process.argv.includes('--release');
console.log(await buildExtension({ release, compatibility: !release }));
