const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= require('node:path').resolve(__dirname, '../.local/browsers');
const {chromium}=require('playwright');
test('prompt normalization preserves wording, case and accents',async()=>{
 const {normalizeFlowPrompt:n}=await import('../src/providers/google-flow/prompt-text.js');
 assert.equal(n('Shirt.\r\n\r\nChất Liệu\u00a0Chỉn Chu'),n('Shirt.\nChất Liệu Chỉn Chu'));
 for(const other of ['shirt. Chất Liệu Chỉn Chu','Shirt. Chat Lieu Chin Chu','Different product'])assert.notEqual(n('Shirt. Chất Liệu Chỉn Chu'),n(other));
});
test('native multiline editor validates after whitespace reserialization',async()=>{
 const {framesUiStep}=await import('../src/providers/google-flow/page/frames-ui.js');
 const {ingredientsUiStep}=await import('../src/providers/google-flow/page/ingredients-ui.js');
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div class="base-prompt-box"><div class="frame-trigger"><img src="https://flow-content.google/image/start" width="20" height="20"></div><div contenteditable="true" style="width:500px;min-height:40px"></div><button aria-label="Generate">Generate</button></div>'}));
  await page.goto('https://flow.google.com/project/test');
  const req={project_id:'test',prompt:'Continue the camera motion.\n\nOn-screen text: "Chất Liệu Chỉn Chu"',expectedKeys:[]};
  const step=(fn,action)=>page.evaluate(([source,action,req])=>(0,eval)('('+source+')')(action,req),[fn.toString(),action,req]);
  assert.equal(await step(framesUiStep,'fill'),true);
  await page.locator('[contenteditable]').evaluate(e=>{e.innerHTML='Continue the camera motion.<div><br></div><div><br></div><div>On-screen text: "Chất Liệu&nbsp;Chỉn Chu"</div>'});
  for(const fn of [framesUiStep,ingredientsUiStep]){
   const result=await step(fn,'generate');assert.equal(result.error,undefined);assert.equal(typeof result.x,'number');
  }
  await page.locator('[contenteditable]').fill('Different product');
  assert.match((await step(framesUiStep,'generate')).error,/prompt changed/);
 }finally{await browser.close();}
});
test('RPC matching accepts equivalent whitespace but rejects changed content',async()=>{
 const {matchFrameRequest,parseFrameCreation}=await import('../src/providers/google-flow/frames-ui.js');
 const req={prompt:'Keep the shirt.\n\nChất Liệu Chỉn Chu',project_id:'p',provider_model_id:'abra_i2v_8s',aspect_ratio:'9:16'};
 const actual='Keep the shirt.\nChất Liệu\u00a0Chỉn Chu';
 const payload=[[[[null,null,[[[actual]]]],req.provider_model_id,1,null,[null,'start']]], [null,22,null,null,null,'p']];
 const body=new URLSearchParams({'f.req':JSON.stringify([[['eb1hJf',JSON.stringify(payload),null,'generic']]])}).toString();
 assert.equal(matchFrameRequest(body,req,['start']).rpc,'eb1hJf');
 const media='22222222-2222-2222-2222-222222222222';
 const response=JSON.stringify([['wrb.fr','eb1hJf',JSON.stringify([null,0,[],[[media,'p','scene','CAE',null,[123,actual]]]])]]);
 assert.equal(parseFrameCreation(response,'eb1hJf',req).mediaId,media);
 assert.equal(matchFrameRequest(body,{...req,prompt:'Changed'},['start']),null);
});

test('Motion Control prompt read preserves case and accents after chip removal',async()=>{
 const {motionUiStep}=await import('../src/providers/google-flow/page/motion-ui.js');
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div class="base-prompt-box"><div contenteditable="true" style="width:500px;min-height:40px"></div></div>'}));
  await page.goto('https://flow.google.com/project/test');
  const prompt='Transfer the motion to the character. Ch\u1ea5t Li\u1ec7u';
  await page.locator('[contenteditable]').evaluate((el,prompt)=>{el.textContent=prompt;const chip=document.createElement('flow-video-ingredient-chip');chip.textContent='Video reference';el.appendChild(chip)},prompt);
  const actual=await page.evaluate(source=>(0,eval)('('+source+')')('promptText',{project_id:'test'}),motionUiStep.toString());
  assert.equal(actual,prompt);
 }finally{await browser.close();}
});

test('Motion Control resolves opaque thumbnails and keeps video/image chips separate',async()=>{
 const {motionUiStep}=await import('../src/providers/google-flow/page/motion-ui.js');
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:`<div class="base-prompt-box">
   <flow-video-ingredient-chip style="display:block"><img src="https://flow.google.com/asb/video-token=s512-rw" width="30" height="30"></flow-video-ingredient-chip>
   <flow-image-ingredient-chip style="display:block"><img src="https://lh3.googleusercontent.com/asb/image-token=s1600-rw" width="30" height="30"></flow-image-ingredient-chip>
   <button class="add-menu-trigger" aria-label="Add to prompt">Open picker</button>
   <button class="detail-add-to-prompt-btn">Add to prompt</button>
   <div contenteditable="true" style="width:400px;height:30px">Transfer motion.</div>
   <button aria-label="B\u1eaft \u0111\u1ea7u t\u1ea1o">Generate</button>
   </div>`}));
  await page.goto('https://flow.google.com/project/test');
  const req={project_id:'test',asset_catalog:[
   {id:'video-id',thumbnails:['https://lh3.googleusercontent.com/asb/video-token=s1600-rw']},
   {id:'image-id',thumbnails:['https://lh3.googleusercontent.com/asb/image-token=s512-rw']},
  ]};
  const step=action=>page.evaluate(([source,action,req])=>(0,eval)('('+source+')')(action,req),[motionUiStep.toString(),action,req]);
  assert.deepEqual(await step('videoChipIds'),['video-id']);
  assert.deepEqual(await step('imageChipIds'),['image-id']);
  const addPoint=await step('addSelected');
  assert.equal(await page.evaluate(point=>document.elementFromPoint(point.x,point.y).className,addPoint),'detail-add-to-prompt-btn');
  req.asset_catalog.push({id:'ambiguous-id',thumbnails:req.asset_catalog[0].thumbnails});
  assert.deepEqual(await step('videoChipIds'),[null]);
  await page.locator('flow-video-ingredient-chip').evaluate(el=>{el.innerHTML='<video src="https://flow-content.google/video/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb?Expires=123" style="width:30px;height:30px"></video>'});
  assert.deepEqual(await step('videoChipIds'),['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
  Object.assign(req,{prompt:'Transfer motion.',reference_video_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',expected_image_ids:['image-id']});
  const generate=await step('generate');assert.equal(generate.error,undefined);assert.equal(typeof generate.x,'number');
 }finally{await browser.close();}
});

test('Motion trim uses handle positions to target the requested range',async()=>{
 const {motionUiStep}=await import('../src/providers/google-flow/page/motion-ui.js');
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:`
   <div style="position:relative;width:600px;height:50px">
    <div style="position:absolute;left:0;width:10px;height:30px" role="slider" aria-label="Trim start point" aria-valuemin="0" aria-valuemax="6" aria-valuenow="0"></div>
    <div style="position:absolute;left:300px;width:10px;height:30px" role="slider" aria-label="Trim end point" aria-valuemin="0" aria-valuemax="12" aria-valuenow="6"></div>
   </div>`}));
  await page.goto('https://flow.google.com/project/test');
  const plan=await page.evaluate(source=>(0,eval)('('+source+')')('trimPlan',{project_id:'test',reference_video_start_seconds:0,reference_video_end_seconds:10}),motionUiStep.toString());
  assert.equal(plan.error,undefined);
  assert.equal(plan.startTo.x,plan.startFrom.x);
  assert.equal(plan.endTo.x-plan.endFrom.x,200);
 }finally{await browser.close();}
});

test('Motion picker resets its scroll and searches without choosing an unrelated asset',async()=>{
 const {motionUiStep}=await import('../src/providers/google-flow/page/motion-ui.js');
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:`
   <div id="picker" style="height:80px;width:300px;overflow-y:auto"><div role="option" class="asset-item" style="height:40px"><img src="https://flow-content.google/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" width="30" height="30"></div><div style="height:600px"></div></div>`}));
  await page.goto('https://flow.google.com/project/test');
  const req={project_id:'test',media_id:'missing'};
  const step=action=>page.evaluate(([source,action,req])=>(0,eval)('('+source+')')(action,req),[motionUiStep.toString(),action,req]);
  assert.equal(await step('seekAsset'),false);
  assert.ok(await page.locator('#picker').evaluate(el=>el.scrollTop)>0);
  assert.equal(await step('resetPicker'),true);
  assert.equal(await page.locator('#picker').evaluate(el=>el.scrollTop),0);
  req.media_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(await step('seekAsset'),true);
 }finally{await browser.close();}
});
