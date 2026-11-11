const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = import('../src/providers/google-flow/motion-ui.js');
const project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const video = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const image1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const image2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const prompt = 'Preserve the subject; follow the reference camera movement.';
const req = {
  project_id: project,
  prompt,
  reference_video_id: video,
  reference_video_start_seconds: 1.25,
  reference_video_end_seconds: 7.5,
  provider_model_id: 'abra_edit',
  num_outputs: 1,
};

test('recognizes a directly attached uploaded video or image after the picker closes',async()=>{
 const {isMotionReferenceAttached:isAttached}=await api;
 assert.equal(isAttached('video',[video],video),true);
 for(const ids of [[],[null],[image1],[video,image1]]) assert.equal(isAttached('video',ids,video),false);
 assert.equal(isAttached('image',[image1,image2],image2,[image1]),true);
 assert.equal(isAttached('image',[image2,image1],image2,[image1]),false);
 assert.equal(isAttached('image',[video,image2],image2,[image1]),false);
});

function request(change = () => {}, rpcId = 'jIps6') {
  const edit = [
    [null, video, Math.round(req.reference_video_start_seconds * 30), Math.round(req.reference_video_end_seconds * 30)],
    [null, null, [[[prompt]]]],
    'abra_edit',
    1,
    [null, null, null, null, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
    null,
    null,
    null,
    [[null, image1], [null, image2]],
  ];
  // Native jIps6 has one edit list at payload[0], without another wrapper.
  const payload = [[edit], [null, 22, null, null, null, project], ['33333333-3333-4333-8333-333333333333', 2]];
  change(payload, edit);
  return new URLSearchParams({
    'f.req': JSON.stringify([[[rpcId, JSON.stringify(payload), null, 'generic']]]),
  }).toString();
}

function response(mediaId = '44444444-4444-4444-8444-444444444444', projectId = project) {
  const payload = [null, 7, [], [[mediaId, projectId, '55555555-5555-4555-8555-555555555555', 'CAE']]];
  return ")]}'\n871\n" + JSON.stringify([['wrb.fr', 'jIps6', JSON.stringify(payload), null, null, null, 'generic']]);
}

test('matches the native Flow video edit request with trim and ordered reference images', async () => {
  const { matchMotionRequest } = await api;
  assert.deepEqual(matchMotionRequest(request(), req, [image1, image2]), {
    rpc: 'jIps6', reference_video_id: video, start_frame: 38, end_frame: 225, image_ids: [image1, image2],
  });
});

test('refuses mismatched source, trim, prompt, model, output count or images', async () => {
  const { matchMotionRequest } = await api;
  const mutations = [
    (_payload, edit) => { edit[0][1] = image1; },
    (_payload, edit) => { edit[0][3] += 1; },
    (_payload, edit) => { edit[1][2][0][0][0] = 'different prompt'; },
    (_payload, edit) => { edit[2] = 'different-model'; },
    (_payload, edit) => { edit[3] = 2; },
    (_payload, edit) => { edit[8].reverse(); },
  ];
  for (const mutate of mutations) assert.throws(() => matchMotionRequest(request(mutate), req, [image1, image2]));
});

test('ignores other RPCs and other projects', async () => {
  const { matchMotionRequest } = await api;
  assert.equal(matchMotionRequest(request(() => {}, 'nprQif'), req, [image1, image2]), null);
  assert.equal(matchMotionRequest(request((payload) => { payload[1][5] = 'other-project'; }), req, [image1, image2]), null);
});

test('accepts only one video asset returned for the requested Flow project', async () => {
  const { parseMotionCreation } = await api;
  assert.deepEqual(parseMotionCreation(response(), project), {
    mediaId: '44444444-4444-4444-8444-444444444444',
    sceneId: '55555555-5555-4555-8555-555555555555',
  });
  assert.throws(() => parseMotionCreation(response('44444444-4444-4444-8444-444444444444', 'other-project'), project), /one video asset/);
  assert.throws(() => parseMotionCreation('PUBLIC_ERROR_UNUSUAL_ACTIVITY', project), /rejected Motion Control/);
});

test('accepts the native Motion Control asset with null type and verified edit metadata',async()=>{
 const {parseMotionCreation}=await api;
 const id='44444444-4444-4444-8444-444444444444';
 const metadata=[null,prompt,null,null,null,null,[null,[['abra_edit',4,[10]],[[null,4,image1]],[[null,null,null,video]]]]];
 const asset=[id,project,'scene',null,null,metadata,null,[[null,0,null,null,null,null,null,prompt], [null,null,[10]], [id]]];
 const body=JSON.stringify([['wrb.fr','jIps6',JSON.stringify([null,7,[],[asset]])]]);
 assert.equal(parseMotionCreation(body,project,req).mediaId,id);
 assert.throws(()=>parseMotionCreation(body,project,{...req,prompt:'Different'}),/different prompt/);
 metadata[6][1][0][0]='different-model';
 assert.throws(()=>parseMotionCreation(JSON.stringify([['wrb.fr','jIps6',JSON.stringify([null,7,[],[asset]])]]),project,req),/one video asset/);
});

test('Omni 1.2 Motion Control (macaron_cookie_edit) is accepted with the same shape as the HAR capture',async()=>{
 const {parseMotionCreation,matchMotionRequest,MOTION_EDIT_MODELS}=await api;
 assert.ok(MOTION_EDIT_MODELS.has('macaron_cookie_edit'));
 const req12={...req,provider_model_id:'macaron_cookie_edit',reference_video_start_seconds:0,reference_video_end_seconds:8};
 // Request đúng dạng HAR flow.google_video_motion.com: đoạn 0–240 khung (8 giây x 30), 1 ảnh tham chiếu.
 const payload=[[[[null,video,0,240],[null,null,[[[prompt]]]],'macaron_cookie_edit',1,[null,null,null,null,'X','Y'],null,null,null,[[null,image1]]]],[null,22,null,null,null,project,null,null,null,null,['token',1]],['Z',2]];
 const post=new URLSearchParams({'f.req':JSON.stringify([[['jIps6',JSON.stringify(payload),null,'generic']]])}).toString();
 assert.deepEqual(matchMotionRequest(post,req12,[image1]),{rpc:'jIps6',reference_video_id:video,start_frame:0,end_frame:240,image_ids:[image1]});
 // Phản hồi: model nằm ở metadata[6][1][0][0], loại asset null như Omni 1.1.
 const id='44444444-4444-4444-8444-444444444444';
 const metadata=[[1794395413,610000000],prompt,null,null,null,null,[null,[['macaron_cookie_edit',4,[10],null,1,1],[[null,4,image1]],[[null,null,null,video]]],[[null,null,[[[prompt]]]]],null,1],null,[3],1];
 const asset=[id,project,'scene',null,null,metadata,null,[[null,0,null,null,null,null,null,prompt],[null,null,[10]],[id]]];
 const body=JSON.stringify([['wrb.fr','jIps6',JSON.stringify([null,464,[],[asset]])]]);
 assert.equal(parseMotionCreation(body,project,req12).mediaId,id);
 assert.throws(()=>parseMotionCreation(body,project,{...req12,provider_model_id:'abra_edit'}),/different prompt or model/);
});
