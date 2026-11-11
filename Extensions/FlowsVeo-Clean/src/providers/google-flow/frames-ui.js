import { createLostGenerationFinder } from './lost-generation.js';
import { ensureTabVisible } from './visibility.js';
import { normalizeFlowPrompt } from './prompt-text.js';
import { framesUiStep, pollFramesVideo } from './page/frames-ui.js';
import { sleep } from '../../shared/time.js';
import { logActivity } from '../../background/runtime/log.js';

export function frameRpcPayload(body, rpcId) {
  if(body.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY')) throw new Error('PUBLIC_ERROR_UNUSUAL_ACTIVITY: Flow rejected this generation. Check the Flow tab.');
  const find=(v)=>{if(!Array.isArray(v))return null;if(v[0]==='wrb.fr'&&v[1]===rpcId&&typeof v[2]==='string')return JSON.parse(v[2]);for(const c of v){const x=find(c);if(x)return x;}return null;};
  for(const line of body.split(/\r?\n/)){if(!line.trim().startsWith('['))continue;let v;try{v=JSON.parse(line);}catch{continue;}const x=find(v);if(x)return x;}
  throw new Error('Flow returned no usable '+rpcId+' result. Check Flow before retrying.');
}

export function matchFrameRequest(body, req, ids) {
  let batches;try{batches=JSON.parse(new URLSearchParams(body).get('f.req'));}catch{return null;}
  if(!Array.isArray(batches))return null;
  for(const batch of batches){
    if(!Array.isArray(batch))continue;
    for(const rpc of batch){
    if(!Array.isArray(rpc))continue;
    if(!['nprQif','eb1hJf'].includes(rpc[0]))continue;
    let p;try{p=JSON.parse(rpc[1]);}catch{continue;}
    const item=p?.[0]?.[0];
    if(normalizeFlowPrompt(item?.[0]?.[2]?.[0]?.[0]?.[0])!==normalizeFlowPrompt(req.prompt) || p?.[1]?.[5]!==req.project_id)continue;
    const modelMatches = item[1] === req.provider_model_id;
    if(p[0].length!==1 || !modelMatches || item[2]!==({'16:9':2,'9:16':1})[req.aspect_ratio]
      || item[4]?.[1]!==ids[0] || (req.end_image_local_path ? item[5]?.[1]!==ids[1] : rpc[0]!=='eb1hJf')
      || (req.end_image_local_path && rpc[0]!=='nprQif')) throw new Error('Flow submitted different frames/model/aspect/count. Check Flow before retrying.');
    return {rpc:rpc[0],start:ids[0],end:ids[1]||null};
  }}return null;
}

export function parseFrameCreation(body, rpc, req) {
  const p=frameRpcPayload(body,rpc);
  const assets=(Array.isArray(p?.[3])?p[3]:[]).filter(a=>(['CAE','CAM','CAI'].includes(a?.[3]) || a?.[3]==null) && a[1]===req.project_id && normalizeFlowPrompt(a?.[5]?.[1])===normalizeFlowPrompt(req.prompt));
  if(assets.length!==1 || !/^[0-9a-f-]{36}$/i.test(assets[0][0])){
    // Chẩn đoán cấu trúc (không chứa token/nội dung): giúp biết Flow đổi dạng response hay từ chối thật.
    const all=Array.isArray(p?.[3])?p[3]:[];
    const per=all.slice(0,4).map(a=>`[type=${a?.[3]} proj=${a?.[1]===req.project_id} prompt=${normalizeFlowPrompt(a?.[5]?.[1])===normalizeFlowPrompt(req.prompt)} idOk=${/^[0-9a-f-]{36}$/i.test(a?.[0]||'')}]`).join('');
    throw new Error(`Flow response has no unique video asset for this prompt/project. (${rpc}; payloadLen=${Array.isArray(p)?p.length:'n/a'}; p3=${all.length}; matched=${assets.length}; ${per})`);
  }
  return {mediaId:assets[0][0],sceneId:assets[0][2]};
}

export async function generateFramesThroughUi(req, tabId) {
  const failResult=(message)=>({ok:false,error:'FLOW_UI: '+message});
  if(!req.image_local_path || !req.prompt?.trim())return failResult('Start Frame and prompt are required.');
  if(req.model_display_name!=='Omni 1.1 Flash' || req.resolution!=='720p' || Number(req.num_outputs||1)!==1)return failResult('Frames currently supports Omni 1.1 Flash, 720p, one output per job.');
  if(!chrome.debugger)return failResult('Reload the FlowsVeo extension to enable browser control.');
  const target={tabId}, ids=[], requestTypes=new Map();
  const {image_base64,end_image_base64,ingredient_images,...pageReq}=req;
  let attached=false, closed=false, armed=false, created=null, failure=null, upload=null, chooser=null, submissionRpc=null, lost=null;
  const command=(name,params={})=>chrome.debugger.sendCommand(target,name,params);
  const step=async(action,extra={})=>{
    if(closed || failure)throw new Error(failure||'Flow control has stopped.');
    if(action==='closeSettings'){
      await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await sleep(350);return null;
    }
    let r;
    for(let attempt=0;attempt<8;attempt++){
      r=await chrome.scripting.executeScript({target,world:'MAIN',func:framesUiStep,args:[action,{...pageReq,...extra}]});
      if(!/^(Flow control is covered:|Flow control not found:)/.test(r?.[0]?.result?.error||''))break;
      await sleep(300);
    }
    if(!r?.length || !Object.hasOwn(r[0],'result'))throw new Error('Flow page did not respond: '+action);
    if(r[0].result?.error)throw new Error(r[0].result.error);return r[0].result;
  };
  const click=async(p)=>{if(!p)return;if(failure)throw new Error(failure);await command('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await command('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});await sleep(350);};
  const waitFor=async(fn,ms,message)=>{const end=Date.now()+ms;while(Date.now()<end){if(failure)throw new Error(failure);const v=await fn();if(v)return v;await sleep(400);}throw new Error(message);};
  const onDetach=(source)=>{if(source.tabId===tabId && !closed)failure='Chrome detached from Flow. Check the result in Flow before retrying.';};
  const onEvent=(source,method,p)=>{
    if(source.tabId!==tabId || source.sessionId || closed)return;
    if(method==='Page.fileChooserOpened' && chooser){const current=chooser;command('DOM.setFileInputFiles',{backendNodeId:p.backendNodeId,files:[current.path]}).then(()=>{current.done=true;}).catch(()=>{failure='Chrome could not read the selected frame file.';});return;}
    if(method==='Network.requestWillBeSent'){
      const r=p.request;if(!r?.url?.startsWith('https://flow.google.com/')||!r.url.includes('/data/batchexecute'))return;
      const rpc=new URL(r.url).searchParams.get('rpcids');
      if(upload && rpc==='maseQ')requestTypes.set(p.requestId,{rpc,upload});
      if(armed && !created && r.postData){try{const m=matchFrameRequest(r.postData,req,ids);if(m){requestTypes.set(p.requestId,{rpc:m.rpc,generation:true,actualModelId:m.actualModelId});submissionRpc=m.rpc;}}catch(e){failure=e.message;}}
    }
    const info=requestTypes.get(p.requestId);if(!info)return;
    if(method==='Network.loadingFailed'){if(info.upload){logActivity('warn',`Flow upload request bị ngắt (${p.errorText||'unknown'}${p.canceled?', canceled':''}) — chờ request thử lại`);requestTypes.delete(p.requestId);return;}if(info.generation){lost={actualModelId:info.actualModelId};logActivity('warn',`Flow hủy request tạo video (${p.errorText||'unknown'}) — không gửi lại, đi tìm video trên server`);requestTypes.delete(p.requestId);return;}failure=`Flow network request failed (${info.rpc}${info.upload?' upload':''}${info.generation?' generation':''}: ${p.errorText||'unknown'}${p.canceled?', canceled':''}); check Flow before retrying.`;requestTypes.delete(p.requestId);}
    if(method==='Network.loadingFinished'){
      requestTypes.delete(p.requestId);
      command('Network.getResponseBody',{requestId:p.requestId}).then(r=>{
        if(closed)return;
        const body=r.base64Encoded?new TextDecoder().decode(Uint8Array.from(atob(r.body),c=>c.charCodeAt(0))):r.body;
        if(info.generation){created=parseFrameCreation(body,info.rpc,req);created.actualModelId=info.actualModelId;logActivity('info',`Frames accepted: rpc=${info.rpc} media=${created.mediaId} start=${ids[0]} end=${ids[1]||'none'}`);}
        else {const data=frameRpcPayload(body,'maseQ');if(data?.[0]?.[1]===req.project_id && data?.[1]?.[3]?.[0]===info.upload.name){info.upload.mediaId=data[0][0];}}
      }).catch(e=>{failure=String(e.message||'Could not read the Flow result.');});
    }
  };
  const openSettings=async()=>{
    for(let attempt=0;attempt<4;attempt++){
      const p=await step('openSettings');if(!p)return;
      await click(p);await sleep(500);
    }
    if(await step('openSettings'))throw new Error('The Flow settings panel did not open.');
  };
  const uploadFrame=async(index,path,name)=>{
    if(!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path||''))throw new Error('The frame file path must be absolute.');
    await click(await step(index===0?'openStart':'openEnd'));
    const previousKeys=await step('assetKeys');
    upload={name,mediaId:null};chooser={path,done:false};
    await click(await step('upload'));
    await waitFor(()=>chooser.done,12000,'Image file chooser did not open.');chooser=null;
    const mid=await waitFor(()=>upload.mediaId,60000,'Frame upload timed out. No video was submitted.');
    await click(await step('ensurePicker',{frameIndex:index}));
    const asset=await waitFor(()=>step('uploadedAsset',{filename:name,previousKeys,mid}),60000,'The newly uploaded image did not appear in Flow.');
    await click(asset.point);await click(await step('add'));
    await waitFor(async()=>{const a=await step('attachments');return a[index]?.key===asset.key&&!a[index]?.busy;},15000,'The uploaded image was not attached to the requested frame slot.');
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await sleep(400);
    ids.push(mid);upload=null;
    logActivity('info',`Frames attached: slot=${index===0?'start':'end'} media=${mid}`);
  };
  try{
    await chrome.debugger.attach(target,'1.3');attached=true;
    await ensureTabVisible(tabId);
    chrome.debugger.onEvent.addListener(onEvent);chrome.debugger.onDetach.addListener(onDetach);
    await command('Network.enable',{maxPostDataSize:1048576,maxResourceBufferSize:5242880,maxTotalBufferSize:10485760});
    await command('Page.enable');await command('DOM.enable');await command('Page.setInterceptFileChooserDialog',{enabled:true});
    await step('lock');await click(await step('closeAccount'));
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await sleep(450);
    await step('preflight');
    await openSettings();
    for(const action of ['mode','frames','modelMenu','model','aspect','resolution','duration','count'])await click(await step(action));
    await step('verify');await click(await step('closeSettings'));await step('fill');
    await uploadFrame(0,req.image_local_path,req.image_name);
    if(req.end_image_local_path)await uploadFrame(1,req.end_image_local_path,req.end_image_name);
    // Attaching the second frame may change Flow's duration/model availability.
    if(req.end_image_local_path){
      await openSettings();
      for(const action of ['aspect','resolution','duration','count'])await click(await step(action));
      await step('verify');await click(await step('closeSettings'));
    }
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await sleep(350);
    const submit=await step('generate');const findLost=createLostGenerationFinder(tabId,req,Date.now());armed=true;await click(submit);
    await waitFor(async()=>{if(!created&&lost){const found=await findLost();if(found)created={...found,actualModelId:lost.actualModelId};}return created;},90000,'No matching generation result. Check Flow before retrying; no automatic resubmit.');
    closed=true;chrome.debugger.onEvent.removeListener(onEvent);chrome.debugger.onDetach.removeListener(onDetach);
    await command('Page.setInterceptFileChooserDialog',{enabled:false}).catch(()=>{});
    await chrome.debugger.detach(target);attached=false;
    const end=Date.now()+420000;
    while(Date.now()<end){
      const pollModelId = created.actualModelId || req.provider_model_id;
      const r=await chrome.scripting.executeScript({target,world:'MAIN',func:pollFramesVideo,args:[req.project_id,created.mediaId,pollModelId]});
      const value=r?.[0]?.result;
      if(value?.ok)return {...value,diagnostics:{adapter:'frames-ui-v1',rpc:submissionRpc,start_media_id:ids[0],end_media_id:ids[1]||null,scene_id:created.sceneId,prompt_verified:true}};
      if(value?.terminal)throw new Error(value.error);
      await sleep(3500);
    }
    throw new Error('Video render timed out. Check Flow before retrying; no automatic resubmit.');
  }catch(e){return failResult(e.message||'Could not control the Flow tab.');}
  finally{
    closed=true;chrome.debugger.onEvent.removeListener(onEvent);chrome.debugger.onDetach.removeListener(onDetach);
    if(attached){await command('Page.setInterceptFileChooserDialog',{enabled:false}).catch(()=>{});await chrome.debugger.detach(target).catch(()=>{});}
    await chrome.scripting.executeScript({target,world:'MAIN',func:framesUiStep,args:['unlock',pageReq]}).catch(()=>{});
  }
}
