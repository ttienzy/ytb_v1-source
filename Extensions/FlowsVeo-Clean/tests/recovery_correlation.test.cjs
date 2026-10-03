const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { pageSource } = require('./helpers/modules.cjs');

async function recover(completedTarget) {
  const oldUrl = 'https://flow-content.google/video/old-video.mp4';
  const newUrl = 'https://flow-content.google/video/new-video.mp4';
  const probes = [];
  const ctx = vm.createContext({
    window: { WIZ_global_data: { SNlM0e: 'fixture', FdrFJe: 'fixture', cfb2h: 'fixture' } },
    location: { pathname: '/project/fixture', origin: 'https://flow.google.com', href: 'https://flow.google.com/project/fixture' },
    document: {
      documentElement: { lang: 'en' }, querySelector: () => null,
      querySelectorAll: selector => selector === 'video' ? [{ currentSrc: oldUrl, querySelectorAll: () => [] }] : [],
    },
    performance: { getEntriesByType: () => [{ name: oldUrl }] },
    URL, URLSearchParams, AbortSignal, setTimeout,
    fetch: async (url) => {
      const rpc = new URL(url).searchParams.get('rpcids');
      if (!rpc) {
        probes.push(url);
        return { ok: true, headers: { get: () => 'video/mp4' } };
      }
      const payload = rpc === 'Zzl0ze'
        ? [null, [], [['old-video', 'fixture', null, 'CAE', oldUrl]]]
        : rpc === 'as29s' && completedTarget ? ['new-video', 'fixture', null, 'CAE', newUrl] : [];
      return { ok: true, text: async () => JSON.stringify([['wrb.fr', rpc, JSON.stringify(payload)]]) };
    },
  });
  vm.runInContext(pageSource('src/providers/google-flow/page/recovery.js', 'recoverCurrentSceneInPage'), ctx);
  return { result: await ctx.recoverCurrentSceneInPage('abra_t2v_6s', 'new-video'), probes };
}

test('pending recovery never returns an older project video or cached DOM resource', async () => {
  const { result, probes } = await recover(false);
  assert.equal(result.ok, false);
  assert.deepEqual(probes, []);
});

test('recovery waits for the requested video result despite older project videos', async () => {
  const { result } = await recover(true);
  assert.equal(result.ok, true);
  assert.equal(result.media_id, 'new-video');
  assert.equal(result.video_url, 'https://flow-content.google/video/new-video.mp4');
});
