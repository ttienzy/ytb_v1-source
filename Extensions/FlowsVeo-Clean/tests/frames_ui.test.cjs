const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=import('../src/providers/google-flow/frames-ui.js');
const req={prompt:'A castle becomes a volcano',project_id:'project-1',provider_model_id:'omni_flash_i2v_6s_first_last',aspect_ratio:'16:9',end_image_local_path:'C:/end.jpg'};
const ids=['start-id','end-id'];
function request(mutator=()=>{}) {
 const item=[[null,null,[[[req.prompt]]]],req.provider_model_id,2,null,[null,ids[0]],[null,ids[1]]];
 const payload=[[item],[null,22,null,null,null,req.project_id],['scene-1',2]];
 mutator(payload);
 return new URLSearchParams({'f.req':JSON.stringify([[['nprQif',JSON.stringify(payload),null,'generic']]])}).toString();
}
function response(prompt=req.prompt,project=req.project_id){
 const payload=[null,7,[['11111111-1111-1111-1111-111111111111']],[['22222222-2222-2222-2222-222222222222',project,'11111111-1111-1111-1111-111111111111','CAE',null,[123,prompt]]]];
 return ")]}'\n871\n"+JSON.stringify([['wrb.fr','nprQif',JSON.stringify(payload),null,null,null,'generic']]);
}
test('landscape enum 2 is valid for ONE output',async()=>{
 const {matchFrameRequest}=await api;
 assert.deepEqual(matchFrameRequest(request(),req,ids),{rpc:'nprQif',start:ids[0],end:ids[1]});
});
test('reject wrong frame, model, aspect and multiple outputs',async()=>{
 const {matchFrameRequest}=await api;
 for(const change of [p=>p[0][0][4][1]='end-id',p=>p[0][0][5][1]='start-id',p=>p[0][0][1]='wrong',p=>p[0][0][2]=1,p=>p[0].push(p[0][0])])
 assert.throws(()=>matchFrameRequest(request(change),req,ids),/different frames/);
});
test('ignore unrelated project or prompt',async()=>{
 const {matchFrameRequest}=await api;
 assert.equal(matchFrameRequest(request(p=>p[1][5]='other'),req,ids),null);
 assert.equal(matchFrameRequest(request(p=>p[0][0][0][2][0][0][0]='other'),req,ids),null);
});
test('return media id, never the earlier scene id',async()=>{
 const {parseFrameCreation}=await api;
 assert.deepEqual(parseFrameCreation(response(),'nprQif',req),{mediaId:'22222222-2222-2222-2222-222222222222',sceneId:'11111111-1111-1111-1111-111111111111'});
 assert.throws(()=>parseFrameCreation(response('other'),'nprQif',req),/no unique/);
 assert.throws(()=>parseFrameCreation(response(req.prompt,'other'),'nprQif',req),/no unique/);
});
test('surface provider rejection without recovery',async()=>{
 const {frameRpcPayload}=await api;
 assert.throws(()=>frameRpcPayload('PUBLIC_ERROR_UNUSUAL_ACTIVITY','nprQif'),/PUBLIC_ERROR_UNUSUAL_ACTIVITY/);
});

test('ignore malformed unrelated network envelopes',async()=>{
 const {matchFrameRequest}=await api;
 for(const payload of [null,{},[null],[{}],[[null]],[[['nprQif','bad JSON']]]]) {
  const body=new URLSearchParams({'f.req':JSON.stringify(payload)}).toString();
  assert.equal(matchFrameRequest(body,req,ids),null);
 }
});
test('malformed asset collection returns a useful error',async()=>{
 const {parseFrameCreation}=await api;
 const body=JSON.stringify([['wrb.fr','nprQif',JSON.stringify([null,7,[],{}])]]);
 assert.throws(()=>parseFrameCreation(body,'nprQif',req),/no unique video asset/);
});

test('workflow continuation uses eb1hJf with exact single-frame model and image',async()=>{
 const {matchFrameRequest}=await api;
 const single={...req,provider_model_id:'abra_i2v_10s',end_image_local_path:null};
 const payload=[[[[null,null,[[[single.prompt]]]],single.provider_model_id,2,null,[null,ids[0]],[null,null,'scene']]], [null,22,null,null,null,single.project_id]];
 const body=new URLSearchParams({'f.req':JSON.stringify([[['eb1hJf',JSON.stringify(payload),null,'generic']]])}).toString();
 assert.deepEqual(matchFrameRequest(body,single,[ids[0]]),{rpc:'eb1hJf',start:ids[0],end:null});
 assert.throws(()=>matchFrameRequest(body,{...single,provider_model_id:'abra_r2v_10s'},[ids[0]]),/different frames/);
 assert.throws(()=>matchFrameRequest(body,single,['wrong-frame']),/different frames/);
});
