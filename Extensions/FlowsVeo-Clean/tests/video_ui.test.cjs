const { test } = require('node:test');
const assert = require('node:assert/strict');

const api = import('../src/providers/google-flow/video-ui.js');

test('parseVideoUiCreateResponse extracts mediaId from CAE record for YhhmEf, never sceneId', async () => {
  const { parseVideoUiCreateResponse } = await api;
  const sceneId = 'f5cf2bbc-b633-4dfa-b1b4-f7543cf8d51a';
  const mediaId = '0566d8db-5db0-4701-a508-b37d8f85b35b';
  const projectId = 'b3cda909-545e-443e-8d29-c22a090deca2';

  // Realistic YhhmEf response structure from HAR
  const payload = [
    null,
    791,
    [
      [
        sceneId, // [2][0][0] is sceneId
        null,
        null,
        ['cat', [1788599004, 592098000], null, null, mediaId],
        projectId,
      ],
    ],
    [
      [
        mediaId, // [3][0][0] is mediaId
        projectId,
        sceneId,
        'CAE',
        null,
      ],
    ],
  ];

  const body = `)]}'\n\n810\n[[["wrb.fr","YhhmEf",${JSON.stringify(JSON.stringify(payload))},null,null,null,"generic"]]]`;
  const result = parseVideoUiCreateResponse(body, { project_id: projectId });
  assert.equal(result.mediaId, mediaId);
  assert.equal(result.sceneId, sceneId);
  assert.equal(result.projectId, projectId);
  assert.notEqual(result.mediaId, sceneId);
});

test('matchVideoUiRequest validates output count for YhhmEf text-to-video', async () => {
  const { matchVideoUiRequest } = await api;
  const buildPostData = (numOutputs) => {
    const singleItem = [
      [null, null, [[['cat']]]],
      'abra_t2v_6s',
      2, // aspect ratio 16:9
    ];
    const items = Array.from({ length: numOutputs }, () => singleItem);
    const payload = [
      items,
      [null, 22, null, null, null, 'proj-1'],
    ];
    return `f.req=${encodeURIComponent(JSON.stringify([[["YhhmEf", JSON.stringify(payload), null, "generic"]]]))}`;
  };

  // Expected 1, received 1 -> match
  const match1 = matchVideoUiRequest(buildPostData(1), { num_outputs: 1 });
  assert.ok(match1);
  assert.equal(match1.rpcId, 'YhhmEf');
  assert.equal(match1.error, undefined);

  // Expected 1, received 4 -> mismatch error
  const mismatch = matchVideoUiRequest(buildPostData(4), { num_outputs: 1 });
  assert.ok(mismatch);
  assert.ok(mismatch.error && mismatch.error.includes('does not match the app request'));
});

