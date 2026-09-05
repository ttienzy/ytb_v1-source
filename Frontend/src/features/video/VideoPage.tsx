import { useEffect, useRef, useState } from 'react'
import { Check, Film, Play, Save, Trash2, UploadCloud } from 'lucide-react'
import { API_URL } from '../../shared/constants'

type VideoItem = { video_id: string; name: string; size_bytes: number; duration_sec: number }
type DoneItem = { done_id: string; name: string; source_name: string; aspect: string; created_at: string }
type ProcessProgress = { percent: number; status: 'processing' | 'done' | 'error'; phase?: string; error?: string }
type SavedState = { preset_id: string; name: string; options: Options; created_at: string }
type Options = { aspect: '9:16' | '16:9'; crop: 'fit' | 'square' | 'custom'; background: string; background_image: string; label: string; label_background: string; crop_x: number; crop_y: number; crop_w: number; crop_h: number; remove_audio: boolean; label_position: 'top' | 'center' | 'bottom' | 'custom'; label_x: number; label_y: number; blur: { enabled: boolean; x: number; y: number; w: number; h: number; amount: number } }
const defaults: Options = { aspect: '9:16', crop: 'fit', background: '#111827', background_image: '', label: '', label_background: '#000000', crop_x: 0, crop_y: 0, crop_w: 1, crop_h: 1, remove_audio: false, label_position: 'bottom', label_x: .5, label_y: .88, blur: { enabled: false, x: .25, y: .25, w: .5, h: .25, amount: 60 } }

function CustomSelect({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(option => option.value === value) || options[0]
  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return <div className={`custom-select ${open ? 'custom-select-open' : ''}`} ref={ref}>
    <button type="button" className="custom-select-trigger" onClick={() => setOpen(current => !current)} aria-expanded={open}>
      <span>{selected?.label}</span><span className="custom-select-chevron">⌄</span>
    </button>
    {open && <div className="custom-select-menu">{options.map(option => <button type="button" className={`custom-select-option ${option.value === value ? 'custom-select-option-active' : ''}`} key={option.value} onClick={() => { onChange(option.value); setOpen(false) }}>{option.label}{option.value === value && <span>✓</span>}</button>)}</div>}
  </div>
}

export function VideoPage() {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [options, setOptions] = useState<Options>(() => { try { const saved = JSON.parse(localStorage.getItem('video-preset') || '{}'); return { ...defaults, ...saved, blur: { ...defaults.blur, ...(saved.blur || {}) } } } catch { return defaults } })
  const [sourceMode, setSourceMode] = useState<'local' | 'youtube'>('local'); const [youtubeUrl, setYoutubeUrl] = useState('')
  const [done, setDone] = useState<DoneItem[]>([]); const [activeDone, setActiveDone] = useState<DoneItem | null>(null)
  const [outputFolder, setOutputFolder] = useState(() => localStorage.getItem('video-custom-output-folder') || '')
  const [backgroundMode, setBackgroundMode] = useState<'color' | 'image'>(() => {
    try { return JSON.parse(localStorage.getItem('video-preset') || '{}').background_image ? 'image' : 'color' } catch { return 'color' }
  })
  const [savedStates, setSavedStates] = useState<SavedState[]>([]); const [stateName, setStateName] = useState('')
  const [busy, setBusy] = useState(false); const [youtubeBusy, setYoutubeBusy] = useState(false); const [processProgress, setProcessProgress] = useState<Record<string, ProcessProgress>>({}); const [message, setMessage] = useState(''); const input = useRef<HTMLInputElement>(null); const bgInput = useRef<HTMLInputElement>(null)
  const set = <K extends keyof Options>(key: K, value: Options[K]) => setOptions(x => ({ ...x, [key]: value }))
  const setBlur = (key: keyof Options['blur'], value: number | boolean) => setOptions(x => ({ ...x, blur: { ...x.blur, [key]: value } }))
  const uploadBackground = async (file: File | undefined) => { if (!file) return; setBusy(true); const body = new FormData(); body.append('file', file); try { const r = await fetch(`${API_URL}/api/video/background`, { method: 'POST', body }); if (!r.ok) throw new Error(); const item = await r.json(); set('background_image', item.background_id); setBackgroundMode('image'); setMessage(`Đã chọn ảnh nền: ${file.name}`) } catch { setMessage('Không tải được ảnh nền.') } finally { setBusy(false) } }
  const load = () => fetch(`${API_URL}/api/video/library`).then(r => r.json()).then(setVideos).catch(() => setMessage('Không kết nối được Backend.'))
  const loadDone = () => fetch(`${API_URL}/api/video/done`).then(r => r.json()).then(setDone).catch(() => {})
  const loadStates = () => fetch(`${API_URL}/api/video/presets`).then(r => r.json()).then(setSavedStates).catch(() => {})
  useEffect(() => { load(); loadDone(); loadStates(); if (!localStorage.getItem('video-preset')) fetch(`${API_URL}/api/video/preset`).then(r => r.ok ? r.json() : {}).then(p => { if (p.aspect) { setOptions({ ...defaults, ...p, blur: { ...defaults.blur, ...(p.blur || {}) } }); setBackgroundMode(p.background_image ? 'image' : 'color') } }).catch(() => {}) }, [])
  const chooseFolder = async () => { try { if (!window.desktop?.chooseVideoFolder) { setMessage('Chức năng chọn thư mục chỉ hoạt động trong Electron.'); return } const folder = await window.desktop.chooseVideoFolder(); if (folder) { setOutputFolder(folder); localStorage.setItem('video-custom-output-folder', folder); setMessage(`Đã chọn nơi lưu thêm: ${folder}`) } else setMessage('Bạn đã hủy chọn nơi lưu thêm.') } catch (error) { setMessage(`Không mở được hộp chọn thư mục: ${error instanceof Error ? error.message : 'không rõ lỗi'}`) } }
  const upload = async (files: FileList | null) => { if (!files?.length) return; setBusy(true); const body = new FormData(); Array.from(files).forEach(f => body.append('files', f)); try { const r = await fetch(`${API_URL}/api/video/library`, { method: 'POST', body }); if (!r.ok) throw new Error(); await load(); setMessage(`Đã nhập ${files.length} video vào kho.`) } catch { setMessage('Nhập video thất bại.') } finally { setBusy(false) } }
  const importYoutube = async () => { if (!youtubeUrl.trim()) return setMessage('Hãy nhập link YouTube.'); setYoutubeBusy(true); setMessage('Đang tải video YouTube...'); const body = new FormData(); body.append('url', youtubeUrl.trim()); try { const r = await fetch(`${API_URL}/api/video/youtube`, { method: 'POST', body }); if (!r.ok) throw new Error(); const item = await r.json(); await load(); setSelected(x => [...x, item.video_id]); setYoutubeUrl(''); setMessage('Đã tải video YouTube vào kho.') } catch { setMessage('Tải YouTube thất bại. Kiểm tra link, yt-dlp hoặc đăng nhập YouTube.') } finally { setYoutubeBusy(false) } }
  const process = async () => {
    if (!selected.length) return setMessage('Hãy chọn ít nhất một video.')
    setBusy(true)
    setProcessProgress(Object.fromEntries(selected.map(id => [id, { percent: 0, status: 'processing' as const }])))
    setMessage(`Đang xử lý 0/${selected.length} video...`)
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const id = selected[index]
        const body = new FormData()
        body.append('video_ids', id)
        body.append('options', JSON.stringify(options))
        try {
          const r = await fetch(`${API_URL}/api/video/process`, { method: 'POST', body })
          if (!r.ok) {
            let detail = `Backend trả về lỗi ${r.status}`
            try { const data = await r.json(); detail = data.detail || detail } catch { /* response không phải JSON */ }
            throw new Error(detail)
          }
          const { job_id: jobId } = await r.json() as { job_id: string }
          const deadline = Date.now() + 30 * 60 * 1000
          let status: { status: string; progress: number; phase?: string; error?: string } | null = null
          while (Date.now() < deadline) {
            const statusResponse = await fetch(`${API_URL}/api/video/process/${jobId}`)
            if (!statusResponse.ok) throw new Error(`Không đọc được tiến trình (HTTP ${statusResponse.status}).`)
            status = await statusResponse.json()
            const currentPercent = Math.max(0, Math.min(100, status?.progress || 0))
            setProcessProgress(current => ({ ...current, [id]: { percent: currentPercent, phase: status?.phase, status: status?.status === 'completed' ? 'done' : 'processing' } }))
            setMessage(`Video ${index + 1}/${selected.length} · ${status?.phase || 'Đang xử lý...'} · ${currentPercent}%`)
            if (status.status === 'completed') break
            if (status.status === 'error') throw new Error(status.error || 'FFmpeg xử lý thất bại.')
            await new Promise(resolve => window.setTimeout(resolve, 700))
          }
          if (!status || status.status !== 'completed') throw new Error('Xử lý quá lâu (hơn 30 phút), đã tự dừng để tránh treo ứng dụng.')
          const fileResponse = await fetch(`${API_URL}/api/video/process/${jobId}/file`)
          if (!fileResponse.ok) throw new Error(`Không tải được video đầu ra (HTTP ${fileResponse.status}).`)
          const blob = await fileResponse.blob()
          if (outputFolder && window.desktop) {
            const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
            const name = `video_${stamp}_${id}_${options.aspect.replace(':', 'x')}.mp4`
            try { await window.desktop.saveVideoFile(outputFolder, name, await blob.arrayBuffer()) }
            catch (error) { throw new Error(`Không ghi được vào nơi lưu thêm: ${error instanceof Error ? error.message : 'không rõ lỗi'}`) }
          }
          setProcessProgress(current => ({ ...current, [id]: { percent: 100, phase: 'Hoàn tất', status: 'done' } }))
          await loadDone()
          setMessage(`Đang xử lý ${index + 1}/${selected.length} video...`)
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Xử lý video thất bại.'
          setProcessProgress(current => ({ ...current, [id]: { percent: current[id]?.percent || 0, phase: 'Đã xảy ra lỗi', status: 'error', error: detail } }))
          throw error
        }
      }
      await loadDone()
      setMessage(`Đã hoàn tất ${selected.length} video trong Data/media/videos/processed${outputFolder ? ' và nơi lưu thêm' : ''}.`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Xử lý video thất bại.'
      setMessage(`Lỗi: ${detail}`)
      window.alert(`Xử lý video thất bại\n\n${detail}`)
    } finally { setBusy(false) }
  }
  const savePreset = async () => { const name = stateName.trim(); if (!name) return setMessage('Hãy nhập tên state trước khi lưu.'); localStorage.setItem('video-preset', JSON.stringify(options)); try { const r = await fetch(`${API_URL}/api/video/presets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, options }) }); if (!r.ok) throw new Error(); await loadStates(); setStateName(''); setMessage(`Đã lưu state “${name}”.`) } catch { setMessage('Không lưu được state.') } }
  const applyPreset = (state: SavedState) => { setOptions({ ...defaults, ...state.options, blur: { ...defaults.blur, ...(state.options.blur || {}) } }); setBackgroundMode(state.options.background_image ? 'image' : 'color'); localStorage.setItem('video-preset', JSON.stringify(state.options)); setMessage(`Đã áp dụng state “${state.name}”.`) }
  const remove = async (id: string) => { await fetch(`${API_URL}/api/video/library/${id}`, { method: 'DELETE' }); setSelected(x => x.filter(v => v !== id)); load() }
  const all = videos.length > 0 && selected.length === videos.length
  const preview = <><label className="preview-title">Preview realtime {selected.length ? `· ${videos.find(v => v.video_id === selected[0])?.name || ''}` : ''}</label><div className={`video-preview preview-${options.aspect.replace(':', '-')}`} style={{ backgroundColor: options.background, ...(options.background_image ? { backgroundImage: `url(${API_URL}/api/video/background/${options.background_image})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}) }}><video src={selected[0] ? `${API_URL}/api/video/library/${selected[0]}/file` : undefined} muted controls/><div className="preview-safe-area"/><div className="preview-crop-frame" style={options.crop === 'custom' ? { left: `${options.crop_x * 100}%`, top: `${options.crop_y * 100}%`, width: `${options.crop_w * 100}%`, height: `${options.crop_h * 100}%` } : options.crop === 'square' ? { width: '70%', height: '70%' } : undefined}/>{options.blur.enabled && <><video className="preview-blurred-video" src={selected[0] ? `${API_URL}/api/video/library/${selected[0]}/file` : undefined} muted autoPlay loop style={{ clipPath: `inset(${options.blur.y * 100}% ${100 - (options.blur.x + options.blur.w) * 100}% ${100 - (options.blur.y + options.blur.h) * 100}% ${options.blur.x * 100}%)`, filter: `blur(${Math.max(1, options.blur.amount / 8)}px)` }}/><div className="preview-blur-frame" style={{ left: `${options.blur.x * 100}%`, top: `${options.blur.y * 100}%`, width: `${options.blur.w * 100}%`, height: `${options.blur.h * 100}%` }}>Làm mờ {options.blur.amount}%</div></>}<div className={`preview-label label-${options.label_position}`} style={{ background: options.label_background, ...(options.label_position === 'custom' ? { left: `${options.label_x * 100}%`, top: `${options.label_y * 100}%`, bottom: 'auto' } : {}) }}>{options.label || 'Label preview'}</div></div></>
  return <div>
    <div className="settings-heading"><p className="overline">VIDEO WORKSPACE</p><h1>Video</h1><p className="page-subtitle">Nhập video, chuẩn hóa khung hình và lưu preset cho workflow.</p></div>
    <div className="video-layout">
      <section className="settings-card video-library-shell"><div className="video-library-pane"><div className="video-section-head"><div><h2>Kho video chưa upload</h2><p>Nhập video local hoặc tải trực tiếp từ YouTube.</p></div></div>
        <div className="video-source-tabs"><button className={sourceMode === 'local' ? 'source-active' : ''} onClick={() => setSourceMode('local')}><UploadCloud size={14}/> Local</button><button className={sourceMode === 'youtube' ? 'source-active' : ''} onClick={() => setSourceMode('youtube')}><Film size={14}/> Link YouTube</button></div>
        {sourceMode === 'local' ? <><div className="video-drop" onClick={() => input.current?.click()}><Film size={28}/><strong>Kéo thả video vào đây hoặc bấm để chọn</strong><span>MP4, MOV, WEBM, MKV · có thể chọn nhiều file</span></div><input ref={input} hidden type="file" multiple accept="video/*" onChange={e => upload(e.target.files)}/></> : <div className="youtube-import"><input value={youtubeUrl} placeholder="https://www.youtube.com/watch?v=..." onChange={e => setYoutubeUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && importYoutube()}/><button className="primary-button" onClick={importYoutube} disabled={busy || youtubeBusy}><Film size={15}/> {youtubeBusy ? 'Đang tải & nhập...' : 'Tải & nhập'}</button><span>Video sẽ được tải về kho bằng yt-dlp.</span></div>}
        {videos.length > 0 && <div className="video-list"><div className="video-list-tools"><label><input type="checkbox" checked={all} onChange={() => setSelected(all ? [] : videos.map(v => v.video_id))}/> Chọn tất cả ({videos.length})</label><span>{selected.length} đã chọn</span></div>{videos.map(v => <div className={`video-row ${selected.includes(v.video_id) ? 'video-row-selected' : ''}`} key={v.video_id}><input type="checkbox" checked={selected.includes(v.video_id)} onChange={() => setSelected(x => x.includes(v.video_id) ? x.filter(id => id !== v.video_id) : [...x, v.video_id])}/><video className="video-thumb" src={`${API_URL}/api/video/library/${v.video_id}/file`} muted preload="metadata"/><div className="video-row-copy"><strong>{v.name}</strong><span>{v.duration_sec ? `${Math.round(v.duration_sec)} giây` : 'Chưa đọc được thời lượng'} · {(v.size_bytes / 1024 / 1024).toFixed(1)} MB</span></div><button className="icon-button" title="Xóa khỏi kho" onClick={() => remove(v.video_id)}><Trash2 size={15}/></button></div>)}</div>}
        {!videos.length && <div className="video-empty">Kho video đang trống</div>}
       </div><div className="done-pane"><div className="video-section-head"><div><h2>Kho video hoàn tất <span className="done-count">{done.length}</span></h2><p>Video đã xử lý được lưu tại thư mục processed. Bấm vào một mục để xem.</p></div></div>{done.length ? <div className="done-grid">{done.map(item => <button className="done-card" key={item.done_id} onClick={() => setActiveDone(item)}><video src={`${API_URL}/api/video/done/${item.done_id}/file`} muted preload="metadata"/><div><strong>{item.name}</strong><span>{item.aspect} · {item.source_name}</span></div></button>)}</div> : <div className="video-empty">Chưa có video hoàn tất</div>}</div></section>
       <section className="settings-card edit-video-shell"><div className="edit-video-heading"><div><h2>Edit Video</h2><p>Preview kết quả và cấu hình video trong cùng một khu vực.</p></div></div><div className="edit-preview-pane"><div className="video-section-head"><div><h2>Preview</h2><p>Thay đổi cấu hình và xem kết quả trực tiếp.</p></div></div>{preview}</div>
       <div className="video-editor"><div className="video-section-head"><div><h2>Chỉnh sửa</h2><p>Cấu hình chung áp dụng cho các video đã chọn.</p></div></div><div className="state-save-row"><input value={stateName} placeholder="Tên state, ví dụ: Facebook 9:16" onChange={e => setStateName(e.target.value)} onKeyDown={e => e.key === 'Enter' && savePreset()}/><button className="chrome-button" onClick={savePreset}><Save size={14}/> Lưu state mới</button></div>{savedStates.length > 0 && <div className="saved-states"><label>State đã lưu</label>{savedStates.map(state => <button className="saved-state" key={state.preset_id} onClick={() => applyPreset(state)}><span>{state.name}</span><small>Áp dụng</small></button>)}</div>}<div className="output-location"><div><strong>Nơi lưu mặc định</strong><span>Data/media/videos/processed</span>{outputFolder && <small>Nơi lưu thêm: {outputFolder}</small>}</div><button className="chrome-button" onClick={chooseFolder}>Chọn nơi lưu khác</button></div>
        <label>Khổ đầu ra</label><div className="aspect-options">{(['9:16', '16:9'] as const).map(a => <button key={a} className={options.aspect === a ? 'aspect-active' : ''} onClick={() => set('aspect', a)}><span className={`aspect-shape shape-${a.replace(':', '-')}`}/><b>{a}</b><small>{a === '9:16' ? 'Reels · TikTok · Facebook' : 'YouTube · video ngang'}</small></button>)}</div>
        <label>Cắt khung hình</label><CustomSelect value={options.crop} onChange={value => set('crop', value as Options['crop'])} options={[{ value: 'fit', label: 'Giữ nguyên, căn giữa vào khung' }, { value: 'square', label: 'Cắt thành hình vuông (chính giữa)' }, { value: 'custom', label: 'Tự chỉnh vùng cắt' }]} />
        {options.crop === 'custom' && <div className="crop-grid">{([['crop_x','Vị trí ngang'],['crop_y','Vị trí dọc'],['crop_w','Chiều rộng'],['crop_h','Chiều cao']] as const).map(([key, text]) => <label key={key}>{text}<input type="range" min="0" max="1" step="0.01" value={options[key]} onChange={e => set(key, Number(e.target.value))}/><span>{Math.round(options[key] * 100)}%</span></label>)}</div>}
        <div className="settings-grid"><div className="background-editor"><label className="background-editor-title">Nền video</label><div className="background-mode-tabs"><button type="button" className={backgroundMode === 'color' ? 'background-mode-active' : ''} onClick={() => { setBackgroundMode('color'); set('background_image', '') }}>Màu nền</button><button type="button" className={backgroundMode === 'image' ? 'background-mode-active' : ''} onClick={() => setBackgroundMode('image')}>Ảnh nền</button></div>{backgroundMode === 'color' ? <div className="color-input"><input type="color" value={options.background} onChange={e => { set('background', e.target.value); set('background_image', ''); setBackgroundMode('color') }}/><code>{options.background}</code></div> : <div className="background-image-control"><button className="chrome-button" onClick={() => bgInput.current?.click()} disabled={busy}>Chọn ảnh nền</button><input ref={bgInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e => uploadBackground(e.target.files?.[0])}/>{options.background_image ? <><span className="background-selected">Đã chọn ảnh nền</span><button className="text-button" onClick={() => set('background_image', '')}>Bỏ ảnh</button></> : <span className="background-hint">PNG, JPG hoặc WEBP</span>}</div>}</div><div><label>Nhãn trên video <span>(tùy chọn)</span></label><input value={options.label} placeholder="Ví dụ: Kênh của tôi" onChange={e => set('label', e.target.value)}/></div><div><label>Màu nền nhãn</label><div className="color-input"><input type="color" value={options.label_background} onChange={e => set('label_background', e.target.value)}/><code>{options.label_background}</code></div></div><label className="audio-toggle"><input type="checkbox" checked={options.remove_audio} onChange={e => set('remove_audio', e.target.checked)}/> Xóa âm thanh khỏi video</label></div>
        <label>Vị trí label</label><CustomSelect value={options.label_position} onChange={value => set('label_position', value as Options['label_position'])} options={[{ value: 'top', label: 'Phía trên' }, { value: 'center', label: 'Chính giữa' }, { value: 'bottom', label: 'Phía dưới' }, { value: 'custom', label: 'Tùy chỉnh vị trí' }]} />{options.label_position === 'custom' && <div className="crop-grid"><label>Ngang<input type="range" min="0" max="1" step=".01" value={options.label_x} onChange={e => set('label_x', Number(e.target.value))}/><span>{Math.round(options.label_x * 100)}%</span></label><label>Dọc<input type="range" min="0" max="1" step=".01" value={options.label_y} onChange={e => set('label_y', Number(e.target.value))}/><span>{Math.round(options.label_y * 100)}%</span></label></div>}
        <div className="blur-box"><label className="audio-toggle"><input type="checkbox" checked={options.blur.enabled} onChange={e => setBlur('enabled', e.target.checked)}/> Chọn khuôn làm mờ</label>{options.blur.enabled && <div className="crop-grid">{([['x','Ngang'],['y','Dọc'],['w','Rộng'],['h','Cao']] as const).map(([key, text]) => <label key={key}>{text}<input type="range" min="0" max="1" step=".01" value={options.blur[key]} onChange={e => setBlur(key, Number(e.target.value))}/><span>{Math.round(options.blur[key] * 100)}%</span></label>)}<label>Độ mờ<input type="range" min="1" max="100" value={options.blur.amount} onChange={e => setBlur('amount', Number(e.target.value))}/><span>{options.blur.amount}%</span></label></div>}</div>
        <div className="video-editor-actions"><button className="primary-button" onClick={process} disabled={busy || youtubeBusy || !selected.length}><Play size={14} fill="currentColor"/> {busy ? 'Đang xử lý...' : `Xử lý ${selected.length || ''} video`}</button>{message && <span className="video-message"><Check size={14}/> {message}</span>}</div>
        {Object.keys(processProgress).length > 0 && <div className="video-progress-list">{selected.map((id, index) => { const item = processProgress[id]; const video = videos.find(v => v.video_id === id); return <div className="video-progress-item" key={id}><div className="video-progress-head"><span>Video {index + 1}: {video?.name || id}</span><small>{item?.phase || 'Đang chuẩn bị...'}</small><strong className={`video-progress-${item?.status || 'processing'}`}>{item?.status === 'error' ? 'Lỗi' : `${item?.percent || 0}%`}</strong></div><div className="video-progress-track"><div className={`video-progress-fill video-progress-fill-${item?.status || 'processing'}`} style={{ width: `${item?.percent || 0}%` }}/></div>{item?.error && <small className="video-progress-error">{item.error}</small>}</div>})}</div>}
      </div></section>
    </div>
    {activeDone && <div className="video-modal-backdrop" onClick={() => setActiveDone(null)}><div className="video-modal" onClick={e => e.stopPropagation()}><div className="video-modal-head"><strong>{activeDone.name}</strong><button className="icon-button" onClick={() => setActiveDone(null)}>×</button></div><video controls autoPlay src={`${API_URL}/api/video/done/${activeDone.done_id}/file`}/><a className="primary-button modal-download" href={`${API_URL}/api/video/done/${activeDone.done_id}/file`} download={activeDone.name}>Tải lại video</a></div></div>}
  </div>
}
