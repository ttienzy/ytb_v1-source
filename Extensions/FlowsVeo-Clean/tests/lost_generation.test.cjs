const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = import('../src/providers/google-flow/lost-generation.js');

const PROJECT = '958030aa-aeec-4700-b1d2-0b8747961208';
const SUBMITTED = Date.parse('2026-11-08T10:00:00Z');
const ID = (n) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`;
const SEC = SUBMITTED / 1000;

function asset(id, createdSec, prompt, model) {
  return [id, PROJECT, 'aaaaaaaa-0000-4000-8000-000000000000', null, null, [[createdSec, 0], prompt, null, null, null, null, [null, [[model, 3, [5], null, 1, 1], []]], null, [6], 1]];
}

async function find(assets, { status = 200, date = 'Sun, 08 Nov 2026 10:00:30 GMT', prompt = 'The cat blinks' } = {}) {
  const payload = JSON.stringify([null, [], assets]);
  const body = `)]}'\n\n1\n${JSON.stringify([['wrb.fr', 'Zzl0ze', payload, null, null, null, 'generic']])}\n`;
  global.location = { hostname: 'flow.google.com', pathname: `/project/${PROJECT}`, origin: 'https://flow.google.com' };
  global.window = { WIZ_global_data: { SNlM0e: 'a', FdrFJe: 'b', cfb2h: 'c' } };
  global.fetch = async () => ({ ok: status === 200, headers: { get: () => date }, text: async () => body });
  const { findCreatedVideoInPage } = await api;
  const realNow = Date.now;
  Date.now = () => SUBMITTED + 30_000; // máy khớp giờ server trừ khi test truyền date khác
  try { return await findCreatedVideoInPage(PROJECT, prompt, SUBMITTED); } finally { Date.now = realNow; }
}

test('finds the one new video matching prompt and submit time', async () => {
  const r = await find([asset(ID(1), SEC + 5, 'The cat blinks', 'abra_r2v_6s')]);
  assert.equal(r.found.mediaId, ID(1));
});

test('never returns an older video with the same prompt', async () => {
  assert.deepEqual(await find([asset(ID(1), SEC - 120, 'The cat blinks', 'abra_r2v_6s')]), { pending: true });
});

test('ignores a different prompt and an image with the same prompt', async () => {
  assert.deepEqual(await find([
    asset(ID(1), SEC + 5, 'Another prompt', 'abra_r2v_6s'),
    asset(ID(2), SEC + 5, 'The cat blinks', 'GEM_PIX_2'),
  ]), { pending: true });
});

test('stops instead of guessing when two new videos match', async () => {
  const r = await find([asset(ID(1), SEC + 5, 'The cat blinks', 'abra_r2v_6s'), asset(ID(2), SEC + 6, 'The cat blinks', 'abra_r2v_6s')]);
  assert.equal(r.terminal, true);
  assert.equal(r.found, undefined);
});

test('uses the server clock so a skewed local clock cannot admit old videos', async () => {
  // Máy chạy nhanh hơn server 5 phút: server mới ở SUBMITTED-270s, nên lượt bấm tương ứng SEC-300.
  const date = new Date(SUBMITTED - 270_000).toUTCString();
  assert.equal((await find([asset(ID(1), SEC - 295, 'The cat blinks', 'abra_r2v_6s')], { date })).found.mediaId, ID(1));
  assert.deepEqual(await find([asset(ID(1), SEC - 400, 'The cat blinks', 'abra_r2v_6s')], { date }), { pending: true });
});
