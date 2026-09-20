const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
const start = source.indexOf('async function runVideoUploadInPage(');
const end = source.indexOf('async function uploadVideoToFlow(', start);
assert.ok(start > 0 && end > start);
const uploadSource = source.slice(start, end);

function harness() {
  const calls = [];
  let uploadCount = 0;
  const context = vm.createContext({
    location: {
      origin: 'https://flow.google.com',
      pathname: '/u/3/project/project-test',
    },
    atob,
    Uint8Array,
    encodeURIComponent,
    setTimeout: (callback) => { callback(); return 1; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.includes('/upload/v1/flow/upload/video/')) {
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => name.toLowerCase() === 'x-goog-upload-url'
            ? 'https://flow.google.com/upload/session-test'
            : null },
          text: async () => '',
        };
      }
      uploadCount += 1;
      const mediaId = uploadCount === 1 ? 'video-media-id' : `video-media-id-${uploadCount}`;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          mediaId,
          media: { name: mediaId, projectId: 'project-test', workflowId: 'workflow-test' },
        }),
      };
    },
  });
  vm.runInContext(uploadSource, context);
  return {
    calls,
    run: (request) => context.runVideoUploadInPage(request),
  };
}

test('video upload uses Flow resumable start and finalize requests', async () => {
  const h = harness();
  const bytes = Buffer.from('FAKE_MP4_BYTES');
  const result = await h.run({
    project_id: 'project-test',
    video_base64: bytes.toString('base64'),
    video_mime: 'video/mp4',
    video_filename: 'reference.mp4',
  });

  assert.equal(result.ok, true);
  assert.equal(result.media_id, 'video-media-id');
  assert.equal(result.workflow_id, 'workflow-test');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, 'https://flow.google.com/upload/v1/flow/upload/video/project-test?authuser=3');
  assert.equal(h.calls[0].options.headers['X-Goog-AuthUser'], '3');
  assert.equal(h.calls[0].options.headers['X-Goog-Upload-Command'], 'start');
  assert.equal(h.calls[0].options.headers['X-Goog-Upload-Header-Content-Length'], String(bytes.length));
  assert.equal(h.calls[1].url, 'https://flow.google.com/upload/session-test');
  assert.equal(h.calls[1].options.headers['X-Goog-Upload-Command'], 'upload, finalize');
  assert.equal(h.calls[1].options.headers['X-Goog-AuthUser'], '3');
  assert.equal(Buffer.from(h.calls[1].options.body).toString(), bytes.toString());
});

test('video upload rejects a request for a different open project', async () => {
  const h = harness();
  const result = await h.run({
    project_id: 'another-project',
    video_base64: Buffer.from('FAKE_MP4_BYTES').toString('base64'),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /không phải project/);
  assert.equal(h.calls.length, 0);
});

test('force_fresh bypasses the in-page video media cache on repeated runs', async () => {
  const h = harness();
  const request = {
    project_id: 'project-test',
    video_base64: Buffer.from('SAME_VIDEO_BYTES').toString('base64'),
    video_mime: 'video/mp4',
    video_filename: 'reference.mp4',
  };

  const first = await h.run(request);
  const cached = await h.run(request);
  const fresh = await h.run({ ...request, force_fresh: true });

  assert.equal(first.media_id, 'video-media-id');
  assert.equal(cached.media_id, 'video-media-id');
  assert.equal(cached.cached, true);
  assert.equal(fresh.media_id, 'video-media-id-2');
  assert.equal(fresh.cached, undefined);
  assert.equal(h.calls.length, 4);
});
