import { useState } from 'react'
import { Hash, Loader2, Plus, Sparkles, Tag, Wand2, X } from 'lucide-react'
import { normalizeTag, uniqueTags, type CaptionMode } from '../captionUtils'

export interface CaptionPreset {
  id: string
  name: string
  template: string
  tags: string[]
}

export const DEFAULT_PRESETS: CaptionPreset[] = [
  {
    id: 'fashion',
    name: 'Thời trang / TikTok Shop',
    template: '{Mặc lên là ưng ngay|Form đẹp mặc cực tôn dáng|Outfit mặc đi đâu cũng xinh} {title}\n\n{hashtags}',
    tags: ['#thoitrangnu', '#outfit', '#tiktokshop', '#mixmatch', '#xuhuong'],
  },
  {
    id: 'review',
    name: 'Review / Ẩm thực',
    template: '{title}\n\n{hashtags}',
    tags: ['#shorts', '#reviewamthuc', '#foodreview', '#reels'],
  },
  {
    id: 'recap',
    name: 'Recap / Truyện',
    template: '{title}\n\n{hashtags}',
    tags: ['#recap', '#tomtat', '#truyenhay', '#shorts'],
  },
]

const TONE_OPTIONS = [
  { id: 'sales_tiktok', label: 'Bán hàng TikTok Shop' },
  { id: 'storytelling', label: 'Kể chuyện tự nhiên' },
  { id: 'trendy_short', label: 'Ngắn gọn bắt trend' },
  { id: 'review', label: 'Review chân thật' },
]

export const PRESETS_STORAGE_KEY = 'pippit_caption_presets_v2'

export function loadCaptionPresets(): CaptionPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) || 'null')
    if (Array.isArray(raw) && raw.length > 0) return raw
  } catch { /* fallback */ }
  return DEFAULT_PRESETS
}

interface Props {
  mode: CaptionMode
  onModeChange: (m: CaptionMode) => void
  template: string
  onTemplateChange: (t: string) => void
  tags: string[]
  onTagsChange: (tags: string[]) => void
  presets: CaptionPreset[]
  activePresetId: string
  onSelectPreset: (id: string) => void
  onSavePreset: (name?: string) => void
  onDeletePreset: (id: string) => void
  tone: string
  onToneChange: (t: string) => void
  extraBrief: string
  onExtraBriefChange: (b: string) => void
  includeDisclosure: boolean
  onIncludeDisclosureChange: (v: boolean) => void
  selectedCount: number
  isGenerating: boolean
  aiError: string
  onGenerateAll: () => void
}

export function CaptionComposer({
  mode,
  onModeChange,
  template,
  onTemplateChange,
  tags,
  onTagsChange,
  presets,
  activePresetId,
  onSelectPreset,
  onSavePreset,
  onDeletePreset,
  tone,
  onToneChange,
  extraBrief,
  onExtraBriefChange,
  includeDisclosure,
  onIncludeDisclosureChange,
  selectedCount,
  isGenerating,
  aiError,
  onGenerateAll,
}: Props) {
  const [newTag, setNewTag] = useState('')
  const [creatingPreset, setCreatingPreset] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')

  const activePreset = presets.find(p => p.id === activePresetId) || presets[0]
  const chipPool = uniqueTags([...(activePreset?.tags || []), ...tags])

  const toggleTag = (tag: string) => {
    const has = tags.some(t => t.toLowerCase() === tag.toLowerCase())
    onTagsChange(has ? tags.filter(t => t.toLowerCase() !== tag.toLowerCase()) : [...tags, tag])
  }

  const addCustomTag = () => {
    const t = normalizeTag(newTag)
    if (!t) return
    if (!tags.some(x => x.toLowerCase() === t.toLowerCase())) onTagsChange([...tags, t])
    setNewTag('')
  }

  const insertToken = (token: string) => {
    onTemplateChange(template.trim() ? `${template.trimEnd()} ${token}` : token)
  }

  const submitPreset = () => {
    const name = newPresetName.trim()
    if (!name) return
    onSavePreset(name)
    setNewPresetName('')
    setCreatingPreset(false)
  }

  return (
    <div className="pub2-caption-box">
      <div className="pub-label-between">
        <label className="pub-label">
          <Tag size={13} /> Caption & Hashtag:
        </label>
        <div className="pub2-seg-toggle">
          <button
            type="button"
            className={`pub2-seg-btn ${mode === 'smart' ? 'active' : ''}`}
            onClick={() => onModeChange('smart')}
            title="Ưu tiên caption sẵn có từ Chiến dịch AI / Recap, hoặc chỉnh riêng từng bài"
          >
            Riêng từng bài / Tự kéo nguồn
          </button>
          <button
            type="button"
            className={`pub2-seg-btn ${mode === 'template' ? 'active' : ''}`}
            onClick={() => onModeChange('template')}
            title="Áp dụng cùng một mẫu biến động (có hỗ trợ spintax) cho mọi bài chưa sửa tay"
          >
            Mẫu chung + Spintax
          </button>
        </div>
      </div>

      {/* Khối AI viết caption hàng loạt bằng Gemini (0 credit) */}
      <div className="pub2-ai-cap-card">
        <div className="pub2-ai-cap-head">
          <span className="pub2-ai-cap-title">
            <Wand2 size={13} /> AI viết caption riêng từng bài <small>(Gemini · 0 credit)</small>
          </span>
          <select className="pub2-tone-select" value={tone} onChange={e => onToneChange(e.target.value)} aria-label="Phong cách caption">
            {TONE_OPTIONS.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="pub2-ai-cap-row">
          <input
            type="text"
            className="pub-input pub2-ai-brief-input"
            value={extraBrief}
            onChange={e => onExtraBriefChange(e.target.value)}
            placeholder="Gợi ý thêm (tùy chọn): vd. Set thun trắng NY form rộng, nhấn mạnh mặc mát..."
          />
          <button
            type="button"
            className="pub2-ai-gen-btn"
            disabled={selectedCount === 0 || isGenerating}
            onClick={onGenerateAll}
            title={selectedCount > 15 ? 'Viết cho 15 video đầu tiên trong danh sách đang chọn' : 'Dùng Gemini viết caption riêng cho các video đang chọn'}
          >
            {isGenerating ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            {isGenerating ? 'Đang viết…' : `AI viết (${Math.min(selectedCount, 15)} bài)`}
          </button>
        </div>
        <label className="pub2-disclosure-check">
          <input type="checkbox" checked={includeDisclosure} onChange={e => onIncludeDisclosureChange(e.target.checked)} />
          <span>Tự thêm dòng khai báo nội dung AI ở cuối caption</span>
        </label>
        {aiError && <div className="pub2-inline-error">{aiError}</div>}
      </div>

      {/* Mẫu dự phòng / mẫu chung & bộ hashtag */}
      <div className="pub2-tpl-section">
        <div className="pub2-preset-bar">
          <div className="pub2-preset-pills">
            {presets.map(p => (
              <span key={p.id} className={`pub2-preset-pill ${p.id === activePresetId ? 'active' : ''}`}>
                <button type="button" onClick={() => onSelectPreset(p.id)}>{p.name}</button>
                {presets.length > 1 && !DEFAULT_PRESETS.some(d => d.id === p.id) && (
                  <button type="button" className="pub2-preset-del" onClick={() => onDeletePreset(p.id)} title="Xóa bộ mẫu">
                    <X size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="pub2-preset-actions">
            <button type="button" className="pub-tag-btn" onClick={() => onSavePreset()} title="Lưu mẫu & hashtag vào bộ đang chọn">
              Lưu bộ này
            </button>
            <button type="button" className="pub-tag-btn" onClick={() => setCreatingPreset(v => !v)}>
              <Plus size={11} /> Bộ mới
            </button>
          </div>
        </div>

        {creatingPreset && (
          <div className="pub-caption-state-create">
            <input
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              placeholder="Tên bộ mẫu (VD: Thời trang hè)"
              onKeyDown={e => { if (e.key === 'Enter') submitPreset() }}
            />
            <button type="button" className="pub-tag-btn" onClick={submitPreset} disabled={!newPresetName.trim()}>Tạo</button>
            <button type="button" className="pub-tag-btn" onClick={() => setCreatingPreset(false)}>Hủy</button>
          </div>
        )}

        <div className="pub2-token-bar">
          <span>Chèn nhanh:</span>
          <button type="button" className="pub-tag-btn" onClick={() => insertToken('{title}')}>+ {'{title}'}</button>
          <button type="button" className="pub-tag-btn" onClick={() => insertToken('{hashtags}')}>+ {'{hashtags}'}</button>
          <button type="button" className="pub-tag-btn" onClick={() => insertToken('{cta}')}>+ {'{cta}'}</button>
          <button type="button" className="pub-tag-btn" onClick={() => insertToken('{Mặc là mê|Xinh hết nấc|Chốt đơn ngay}')}>+ Spintax</button>
        </div>

        <textarea
          rows={2}
          value={template}
          onChange={e => onTemplateChange(e.target.value)}
          className="pub-textarea"
          placeholder={
            mode === 'smart'
              ? 'Mẫu dự phòng cho video chưa có sẵn caption (hỗ trợ {title}, {hashtags}, {a|b|c})...'
              : 'Nhập mẫu caption chung (hỗ trợ {title}, {hashtags}, {cta}, {a|b|c})...'
          }
        />

        <div className="pub-hashtag-chips">
          {chipPool.map(tag => {
            const active = tags.some(t => t.toLowerCase() === tag.toLowerCase())
            return (
              <span key={tag} className={`pub-hash-chip ${active ? 'pub-hash-chip-active' : ''}`} onClick={() => toggleTag(tag)}>
                <Hash size={11} />
                {tag.replace(/^#/, '')}
              </span>
            )
          })}
          <div className="pub-custom-tag-create">
            <input
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              placeholder="#tag_moi"
              onKeyDown={e => { if (e.key === 'Enter') addCustomTag() }}
            />
            <button type="button" className="pub-hash-chip pub-custom-tag-button" onClick={addCustomTag} disabled={!newTag.trim()}>
              + Thêm tag
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
