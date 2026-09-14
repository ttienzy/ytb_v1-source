import { spawnSync } from 'node:child_process';
import { access, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const gwrScript = path.join(
  runtimeDir,
  'node_modules',
  '@pilio',
  'gemini-watermark-remover',
  'bin',
  'gwr.mjs',
);
const workDir = await mkdtemp(path.join(tmpdir(), 'watermark-runtime-smoke-'));

function run(command, args, label) {
  const result = spawnSync(command, args, {
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return result;
}

try {
  const inputPath = path.join(workDir, 'input.png');
  const outputPath = path.join(workDir, 'output.png');
  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background: { r: 18, g: 36, b: 54, alpha: 1 },
    },
  }).png().toFile(inputPath);

  run(
    process.execPath,
    [gwrScript, 'remove', inputPath, '--output', outputPath, '--overwrite'],
    'GWR image smoke test',
  );

  const metadata = await sharp(outputPath).metadata();
  if (metadata.width !== 1024 || metadata.height !== 1024) {
    throw new Error(`Unexpected GWR output dimensions: ${metadata.width}x${metadata.height}`);
  }

  const ffmpegCandidates = [
    path.join(runtimeDir, '..', 'bin', 'ffmpeg.exe'),
    path.join(runtimeDir, '..', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
  ];
  let ffmpegPath = null;
  for (const candidate of ffmpegCandidates) {
    try {
      await access(candidate);
      ffmpegPath = candidate;
      break;
    } catch {
      // Try the next development/packaged location.
    }
  }
  if (!ffmpegPath) throw new Error('Bundled FFmpeg was not found for the video smoke test');

  const inputVideo = path.join(workDir, 'input.mp4');
  const outputVideo = path.join(workDir, 'output.mp4');
  run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x122436:s=1024x1024:r=1:d=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', inputVideo,
  ], 'FFmpeg fixture generation');
  run(process.execPath, [
    gwrScript,
    'remove',
    inputVideo,
    '--output', outputVideo,
    '--overwrite',
    '--allow-low-confidence',
    '--video-timeout-ms', '120000',
  ], 'GWR video smoke test');
  const videoInfo = await stat(outputVideo);
  if (videoInfo.size === 0) throw new Error('GWR video smoke test produced an empty file');

  console.log(JSON.stringify({
    ok: true,
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    imageOutput: `${metadata.width}x${metadata.height}`,
    videoOutputBytes: videoInfo.size,
  }));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
