const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = import('../src/providers/google-flow/video-upload-ui.js');
const project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const media = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('native video upload result must include a media ID and matching Flow project', async () => {
  const { parseUploadResult } = await api;
  assert.deepEqual(parseUploadResult(JSON.stringify({ mediaId: media, media: { projectId: project } }), project), {
    media_id: media, project_id: project,
  });
  assert.equal(parseUploadResult(JSON.stringify({ mediaId: media, media: { projectId: 'other-project' } }), project), null);
  assert.equal(parseUploadResult('not json', project), null);
});
