// Runs in the native Flow page; no module-scope dependencies.
export function ingredientsUiStep(action, req) {
  try {
    const fail = (s) => { throw new Error(s); };
    if (action === 'unlock') { document.documentElement.removeAttribute('data-flowsveo-video-until'); return true; }
    if (location.hostname !== 'flow.google.com' || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== req.project_id) fail('Flow tab changed project.');
    if (action === 'lock') { document.documentElement.setAttribute('data-flowsveo-video-until', String(Date.now() + 1080000)); return true; }
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
    const triggers = () => [...document.querySelectorAll('.base-prompt-box flow-image-ingredient-chip')].filter(visible);
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
      if(editor().innerText.trim() || triggers().length) fail('Save or clear the existing Flow draft before starting Ingredients.');
      return true;
    }
    if(action==='openSettings'||action==='closeSettings') {
      const open=!!radio('x1');return open===(action==='openSettings')?null:point(find('button.settings-trigger-button',()=>true));
    }
    if(['mode','frames','aspect','resolution','duration','count'].includes(action)) {
      const e=action==='mode'?radio('Video'):action==='frames'?(radio('Thành phần')||radio('Ingredients')):action==='aspect'?radio(req.aspect_ratio):action==='resolution'?radio(req.resolution):action==='duration'?(radio(req.duration_seconds+' giây')||radio(req.duration_seconds+' seconds')||radio(req.duration_seconds+'s')):radio('x1');
      return e?.getAttribute('aria-checked')==='true'?null:point(e);
    }
    const modelButton=()=>find('button[aria-haspopup="menu"]',e=>/^(chon nhom mo hinh|select model family|select model)$/.test(label(e)));
    if(action==='modelMenu') {const e=modelButton();return e&&text(e).includes(norm(req.model_display_name))?null:point(e);}
    if(action==='model') {const e=find('[role="menuitem"]', e=>text(e)===norm(req.model_display_name));return e?point(e):null;}
    if(action==='verify') {
      const choices=[radio('Video'),radio('Thành phần')||radio('Ingredients'),radio(req.aspect_ratio),radio(req.resolution),radio(req.duration_seconds+' giây')||radio(req.duration_seconds+' seconds')||radio(req.duration_seconds+'s'),radio('x1')];
      if(choices.some(e=>e?.getAttribute('aria-checked')!=='true') || !modelButton() || !text(modelButton()).includes(norm(req.model_display_name))) fail('Flow model, Ingredients mode, aspect, duration, resolution or output count does not match the job.');
      if(document.querySelector('.agent-mode-chip[aria-pressed="true"]')) fail('Turn off Agent mode in Flow.'); return true;
    }
    if(action==='fill') { const e=editor();e.focus();const range=document.createRange();range.selectNodeContents(e);window.getSelection().removeAllRanges();window.getSelection().addRange(range);if(!document.execCommand('insertText',false,req.prompt.trim()))fail('Could not fill the Flow prompt.');return true; }
    if(action==='openIngredient') return point(find('.base-prompt-box button.add-menu-trigger',()=>true));
    if(action==='ensurePicker') return options().length?null:point(find('.base-prompt-box button.add-menu-trigger',()=>true));
    if(action==='assetKeys') return options().map(imageKey).filter(Boolean);
    if(action==='upload') return point(find('button',e=>/tai noi dung nghe nhin len|upload media|upload files/.test(label(e))));
    if(action==='uploadedAsset') {
      // Use the media ID returned by this upload, never the first recent asset.
      const e=options().find(e=>imageKey(e)?.endsWith('/image/'+req.mid) && e.getAttribute('aria-busy')!=='true');
      return e?{point:point(e),key:imageKey(e)}:null;
    }
    if(action==='add') return point(find('button',e=>/^(them vao cau lenh|add to prompt)$/.test(label(e))));
    if(action==='attachments') return triggers().map(e=>({key:imageKey(e),busy:e.querySelector('button')?.getAttribute('aria-busy')==='true'}));
    if(action==='generate') {
      // Keep this whitespace-only comparison aligned with normalizeFlowPrompt.
      if(editor().innerText.replace(/\s+/gu,' ').trim()!==req.prompt.replace(/\s+/gu,' ').trim())fail('Flow prompt changed before submit.');
      const a=triggers().map(imageKey);if(a.length!==req.expectedKeys?.length || a.some((key,i)=>!key || key!==req.expectedKeys[i]))fail('Ingredient images changed before submit.');
      return point(find('button',e=>/^(bat dau tao|start generation|generate|start creating)$/.test(label(e))));
    }
    fail('Unknown frames action: '+action);
  } catch(e) { return {error:e.message}; }
}
