const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const api = import('../src/providers/google-flow/page/frames-ui.js');
const project = 'project-1';
const media = 'video-1';

function asset(status, id = media, pid = project, url = null) {
  const metadata = [];
  metadata[8] = [status];
  return [id, pid, null, null, null, metadata, null, url ? [[null, null, null, null, null, null, null, null, url]] : null];
}

async function poll(progress, final) {
  const { pollFramesVideo } = await api;
  const calls = [];
  const run = vm.runInNewContext(`(${pollFramesVideo.toString()})`, {
    location: { hostname: 'flow.google.com', pathname: `/project/${project}`, origin: 'https://flow.google.com' },
    window: { WIZ_global_data: { SNlM0e: 'test', FdrFJe: 'test', cfb2h: 'test' } },
    URL, URLSearchParams, AbortSignal, Date,
    fetch: async (url, options) => {
      const rpc = new URL(url).searchParams.get('rpcids');
      calls.push(rpc);
      const payload = JSON.parse(new URLSearchParams(options.body).get('f.req'));
      assert.equal(payload[0][0][0], rpc);
      const value = rpc === 'jwpduf' ? progress : final;
      return { ok: true, text: async () => ")]}'\n" + JSON.stringify([['wrb.fr', rpc, JSON.stringify(value)]]) };
    },
  });
  return { result: JSON.parse(JSON.stringify(await run(project, media, 'abra_edit'))), calls };
}

test('stops polling when the exact video fails instead of waiting seven minutes', async () => {
  const { result, calls } = await poll([null, 7, [], [asset(4)]], null);
  assert.deepEqual(result, { terminal: true, error: 'Flow render ended with status 4' });
  assert.deepEqual(calls, ['jwpduf']);
});

test('queued and rendering videos remain pending', async () => {
  for (const state of [1, 2, 6]) assert.deepEqual((await poll([asset(state)], null)).result, { pending: true });
});

test('returns the signed URL only for the exact completed video and project', async () => {
  const url = `https://flow-content.google/video/${media}?test=signature`;
  const { result } = await poll([asset(3)], asset(3, media, project, url));
  assert.deepEqual(result, { ok: true, video_url: url, media_id: media, provider_model_id: 'abra_edit', project_id: project });
});

test('ignores another video or project even when a matching URL appears', async () => {
  const url = `https://flow-content.google/video/${media}`;
  for (const other of [asset(4, 'other-video'), asset(4, media, 'other-project')]) {
    assert.deepEqual((await poll([other], [other, url])).result, { pending: true });
  }
});

test('also surfaces terminal status from the final exact asset', async () => {
  assert.deepEqual((await poll(null, asset(4))).result, { terminal: true, error: 'Flow render ended with status 4' });
});
