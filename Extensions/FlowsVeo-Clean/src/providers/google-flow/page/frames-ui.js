// Runs in the native Flow page; no module-scope dependencies.
export function framesUiStep(action, req) {
  try {
    const fail = (s) => { throw new Error(s); };
    if (action === 'unlock') { document.documentElement.removeAttribute('data-flowsveo-video-until'); return true; }
    if (location.hostname !== 'flow.google.com' || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== req.project_id) fail('Flow tab changed project.');
    if (action === 'lock') { document.documentElement.setAttribute('data-flowsveo-video-until', String(Date.now() + 600000)); return true; }
    const visible = (e) => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
    const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/🍌/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const text = (e) => { const c=e.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach(x=>x.remove()); return norm(c.textContent); };
    const label = (e) => norm(e.getAttribute('aria-label')) || text(e);
    const find = (selector, test) => [...document.querySelectorAll(selector)].find(e=>visible(e) && test(e));
    const point = (e) => {
      if (!e) fail('Flow control not found: ' + action);
      if (e.disabled || e.getAttribute('aria-disabled') === 'true') fail('Flow control is disabled: ' + action);
      e.scrollIntoView({block:'nearest'}); const r=e.getBoundingClientRect();
      const x=r.left+r.width/2, y=r.top+r.height/2;
      if (!e.contains(document.elementFromPoint(x,y))) fail('Flow control is covered: ' + action);
      return {x,y};
    };
    const radio = (s) => find('[role="radio"]', e=>text(e)===norm(s));
    const editor = () => {
      const all=[...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
      if(all.length!==1) fail('Open the project prompt editor in Flow.'); return all[0];
    };
    const triggers = () => [...document.querySelectorAll('.base-prompt-box .frame-trigger')].filter(visible);
    const imageKey = (e) => {
      if (!e) return null;
      const emptyBtn = e.querySelector('button.empty-chip');
      if (emptyBtn && visible(emptyBtn)) return null;
      const img = e.querySelector('img');
      if (!img || !visible(img)) return null;
      const s = img.currentSrc || img.src;
      if (!s || s.includes('gstatic.com') || s.includes('google.com/images') || s.includes('google.com/static') || s.startsWith('data:image/svg')) return null;
      try { const u = new URL(s); return u.origin + u.pathname.replace(/=s\d+.*$/, ''); } catch { return null; }
    };
    const options = () => [...document.querySelectorAll('[role="option"]')].filter(visible);
    if(action==='closeAccount') { const e=find('button', b=>/^(dong bang dieu khien tai khoan|close account panel)$/.test(label(b)));return e?point(e):null; }
    if(action==='preflight') {
      const ed = editor();
      if(ed && ed.innerText.trim()) {
        ed.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      }
      document.querySelectorAll('.base-prompt-box flow-image-ingredient-chip button, .base-prompt-box button[aria-label*="xóa" i], .base-prompt-box button[aria-label*="remove" i]').forEach(b => { try { b.click(); } catch{} });
      return true;
    }
    if(action==='openSettings'||action==='closeSettings') {
      const open=!!radio('x1');return open===(action==='openSettings')?null:point(find('button.settings-trigger-button',()=>true));
    }
    if(['mode','frames','aspect','resolution','duration','count'].includes(action)) {
      const e=action==='mode'?radio('Video'):action==='frames'?(radio('Khung hình')||radio('Frames')):action==='aspect'?radio(req.aspect_ratio):action==='resolution'?radio(req.resolution):action==='duration'?(radio(req.duration_seconds+' giây')||radio(req.duration_seconds+' seconds')||radio(req.duration_seconds+'s')):radio('x1');
      return e?.getAttribute('aria-checked')==='true'?null:point(e);
    }
    const modelButton=()=>find('button[aria-haspopup="menu"]',e=>/^(chon nhom mo hinh|select model family|select model)$/.test(label(e)));
    if(action==='modelMenu') {const e=modelButton();return e&&text(e).includes(norm(req.model_display_name))?null:point(e);}
    if(action==='model') {const e=find('[role="menuitem"]', e=>text(e)===norm(req.model_display_name));return e?point(e):null;}
    if(action==='verify') {
      const choices=[radio('Video'),radio('Khung hình')||radio('Frames'),radio(req.aspect_ratio),radio(req.resolution),radio(req.duration_seconds+' giây')||radio(req.duration_seconds+' seconds')||radio(req.duration_seconds+'s'),radio('x1')];
      if(choices.some(e=>e?.getAttribute('aria-checked')!=='true') || !modelButton() || !text(modelButton()).includes(norm(req.model_display_name))) fail('Flow model, Frames mode, aspect, duration, resolution or output count does not match the job.');
      if(document.querySelector('.agent-mode-chip[aria-pressed="true"]')) fail('Turn off Agent mode in Flow.'); return true;
    }
    if(action==='fill') { const e=editor();e.focus();const range=document.createRange();range.selectNodeContents(e);window.getSelection().removeAllRanges();window.getSelection().addRange(range);if(!document.execCommand('insertText',false,req.prompt.trim()))fail('Could not fill the Flow prompt.');return true; }
    if(action==='openStart'||action==='openEnd') return point(triggers()[action==='openStart'?0:1]?.querySelector('button.empty-chip'));
    if(action==='ensurePicker') return options().length?null:point(triggers()[req.frameIndex]?.querySelector('button.empty-chip'));
    if(action==='assetKeys') return options().map(imageKey).filter(Boolean);
    if(action==='upload') return point(find('button',e=>/tai noi dung nghe nhin len|upload media|upload files/.test(label(e))));
    if(action==='uploadedAsset') {
      const e=options().find(e=>imageKey(e)?.endsWith('/image/'+req.mid) && e.getAttribute('aria-busy')!=='true');
      return e?{point:point(e),key:imageKey(e)}:null;
    }
    if(action==='add') return point(find('button',e=>/^(them vao cau lenh|add to prompt)$/.test(label(e))));
    if(action==='attachments') return triggers().map(e=>({key:imageKey(e),busy:e.querySelector('button')?.getAttribute('aria-busy')==='true'}));
    if(action==='generate') {
      // Keep this whitespace-only comparison aligned with normalizeFlowPrompt.
      if(editor().innerText.replace(/\s+/gu,' ').trim()!==req.prompt.replace(/\s+/gu,' ').trim())fail('Flow prompt changed before submit.');
      const a=triggers().map(imageKey);if(!a[0] || (req.end_image_local_path?!a[1]:!!a[1]))fail('Start/end frames do not match the job.');
      return point(find('button',e=>/^(bat dau tao|start generation|generate|start creating)$/.test(label(e))));
    }
    fail('Unknown frames action: '+action);
  } catch(e) { return {error:e.message}; }
}

// Read only the exact media record; never recover an unrelated recent video.
export async function pollFramesVideo(projectId, mediaId, modelId) {
  try {
    if(location.hostname!=='flow.google.com' || location.pathname.match(/\/project\/([^/]+)/)?.[1]!==projectId) return {error:'Flow tab changed project.',terminal:true};
    const wiz=window.WIZ_global_data || {};
    if(!wiz.SNlM0e || !wiz.FdrFJe || !wiz.cfb2h)return {pending:true};
    const unwrap=(v,rpc)=>{if(!Array.isArray(v))return null;if(v[0]==='wrb.fr'&&v[1]===rpc&&typeof v[2]==='string')return JSON.parse(v[2]);for(const c of v){const x=unwrap(c,rpc);if(x)return x;}return null;};
    const callRpc=async(rpc,payload)=>{
      const q=new URLSearchParams({rpcids:rpc,'source-path':'/project/'+projectId,bl:String(wiz.cfb2h),'f.sid':String(wiz.FdrFJe),rt:'c',_reqid:String(Date.now()%10000000)});
      const body=new URLSearchParams({'f.req':JSON.stringify([[[rpc,JSON.stringify(payload),null,'generic']]]),at:wiz.SNlM0e});
      const res=await fetch(location.origin+'/_/AiSandboxAngularFrontend/data/batchexecute?'+q,{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','X-Same-Domain':'1'},body,signal:AbortSignal.timeout(12000)});
      if(!res.ok)return null;
      for(const line of (await res.text()).split(/\r?\n/)){if(!line.trim().startsWith('['))continue;try{const value=unwrap(JSON.parse(line),rpc);if(value)return value;}catch{}}
      return null;
    };
    const findAsset=(v)=>{if(!Array.isArray(v))return null;if(v[0]===mediaId&&v[1]===projectId)return v;for(const c of v){const a=findAsset(c);if(a)return a;}return null;};
    const terminalResult=(v)=>{
      const asset=findAsset(v),status=asset?.[5]?.[8]?.[0];
      if(typeof status==='number'&&![1,2,3,6].includes(status))return {terminal:true,error:`Flow render ended with status ${status}`};
      return null;
    };
    const findUrl=(v)=>{if(typeof v==='string'){try{const u=new URL(v);if(u.origin==='https://flow-content.google'&&u.pathname==='/video/'+mediaId)return v;}catch{}}if(Array.isArray(v))for(const c of v){const x=findUrl(c);if(x)return x;}return null;};
    const progress=await callRpc('jwpduf',[null,null,[[mediaId]]]);
    const failed=terminalResult(progress);
    if(failed)return failed;
    const final=await callRpc('as29s',[mediaId]);
    const finalFailure=terminalResult(final);
    if(finalFailure)return finalFailure;
    const asset=findAsset(final),url=asset&&findUrl(asset);
    if(url)return {ok:true,video_url:url,media_id:mediaId,provider_model_id:modelId,project_id:projectId};
    return {pending:true};
  }catch{return {pending:true};}
}
