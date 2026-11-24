import { useState } from 'react'
import { FileText, RotateCcw, Save } from 'lucide-react'
import type { RecapPrompts, useRecapPrompts } from '../useRecapPrompts'
import './RecapPromptEditor.css'

export function RecapPromptEditor({ model, batch = false }: { model: ReturnType<typeof useRecapPrompts>; batch?: boolean }) {
  const [tab, setTab] = useState<keyof RecapPrompts>('script')
  const custom = model.value && model.originals && (model.value.script !== model.originals.script || model.value.caption !== model.originals.caption)
  const unsaved = model.value && model.saved && (model.value.script !== model.saved.script || model.value.caption !== model.saved.caption)
  return <section className="recap-prompts" aria-label="Prompt tạo nội dung">
    <div className="recap-prompts-head">
      <div><h3><FileText size={16} /> Prompt tạo nội dung</h3><p>Mẫu gốc: Khám phá ẩm thực · {batch ? 'Áp dụng cho toàn bộ hàng đợi mới' : 'Áp dụng cho lượt tạo tiếp theo'}</p></div>
      <span className="recap-prompts-badge">{model.loading ? 'Đang tải…' : custom ? 'Prompt tùy chỉnh' : 'Đang dùng bản gốc'}</span>
    </div>
    {model.value && <>
      <div className="recap-prompts-tabs" role="tablist" aria-label="Loại prompt">
        {([['script', 'Kịch bản & lời bình'], ['caption', 'Tiêu đề, mô tả & hashtag']] as const).map(([key, title]) => <button key={key} type="button" id={`recap-prompt-tab-${key}`} role="tab" aria-selected={tab === key} aria-controls="recap-prompt-panel" tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={e => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'script' : e.key === 'End' ? 'caption' : tab === 'script' ? 'caption' : 'script'; setTab(next); document.getElementById(`recap-prompt-tab-${next}`)?.focus() }
        }}>{title}</button>)}
      </div>
      <div id="recap-prompt-panel" role="tabpanel" aria-labelledby={`recap-prompt-tab-${tab}`}>
        <label htmlFor="recap-prompt-text">{tab === 'script' ? 'Prompt kịch bản đang dùng' : 'Prompt tiêu đề, mô tả & hashtag đang dùng'} · có thể chỉnh sửa</label>
        <textarea id="recap-prompt-text" value={model.value[tab]} onChange={e => model.change(tab, e.target.value)} spellCheck={false} disabled={model.loading || model.saving} aria-describedby="recap-prompt-tip" />
        <div className="recap-prompts-meta"><span id="recap-prompt-tip">Giữ nguyên các biến trong {'{{…}}'} và tên trường JSON để app xử lý kết quả.</span><span>{model.value[tab].length.toLocaleString('vi-VN')} ký tự</span></div>
      </div>
      <div className="recap-prompts-footer">
        <span aria-live="polite">{model.notice || (unsaved ? 'Đã sửa · chưa lưu mặc định. Bấm tạo để dùng cho lượt này.' : 'Dùng nội dung hiện tại khi bắt đầu tạo. Job đang chạy giữ prompt ban đầu.')}</span>
        <div><button type="button" className="btn-g" disabled={model.loading || model.saving} onClick={() => model.reset(tab)}><RotateCcw size={14} /> Khôi phục prompt gốc</button><button type="button" className="btn-g" disabled={!model.ready || model.saving || !unsaved} onClick={model.save}><Save size={14} /> {model.saving ? 'Đang lưu…' : 'Lưu làm mặc định'}</button></div>
      </div>
    </>}
    {(model.error || model.validation) && <p className="recap-prompts-error" role="alert">{model.error || model.validation}</p>}
    {!model.value && !model.loading && <button type="button" className="btn-g" onClick={model.retry}>Tải lại prompt</button>}
  </section>
}
