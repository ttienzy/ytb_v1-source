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
  const context = vm.createContext({
    location: {
      origin: 'https://flow.google.com',
      pathname: '/u/3/project/project-dedup',
    },
    atob,
    Uint8Array,
    encodeURIComponent,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name) => (name.toLowerCase() === 'x-goog-upload-url' ? 'https://flow.google.com/upload/session-dedup' : null),
          },
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            mediaId: 'video-media-id-cached-123',
            media: { name: 'video-media-id-cached-123', projectId: 'project-dedup', workflowId: 'workflow-1' },
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

test('deduplication: second upload of identical video in same project reuses media_id without calling fetch', async () => {
  const h = harness();
  const bytes = Buffer.from('IDENTICAL_VIDEO_CONTENT_12345');
  const payload = {
    project_id: 'project-dedup',
    video_base64: bytes.toString('base64'),
    video_mime: 'video/mp4',
    video_filename: 'dance_ref.mp4',
  };

  // Lần 1: Chưa có trong cache, gọi 2 network calls (start + finalize)
  const res1 = await h.run(payload);
  assert.equal(res1.ok, true);
  assert.equal(res1.media_id, 'video-media-id-cached-123');
  assert.equal(h.calls.length, 2);

  // Lần 2: Cùng payload trên cùng project -> Lấy từ cache, calls.length KHÔNG TĂNG!
  const res2 = await h.run(payload);
  assert.equal(res2.ok, true);
  assert.equal(res2.media_id, 'video-media-id-cached-123');
  assert.equal(res2.cached, true);
  assert.equal(h.calls.length, 2, 'Không được phát thêm network calls nào lên Google Flow');
});
