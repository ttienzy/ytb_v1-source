import React, { useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { UserPlus, Upload, Trash2, X, Shirt, User, Sparkles, RotateCw, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import {
  characterSheetMissing,
  CHARACTER_SHEET_ROLE_LABEL,
  type CharacterSheetRole,
  type CharacterSheetState,
} from '../../services/motionCharacterSheet'

export interface MotionCharacterSheetNodeData {
  sheet: CharacterSheetState
  /** Ô Nhân Vật đang có ảnh do người dùng nạp (không phải ảnh sheet): cho phép lấy làm ảnh khuôn mặt. */
  canUseCharacterSlot: boolean
  applied: boolean
  /** Motion Control đang tạo video: không đổi ảnh nhân vật giữa chừng. */
  isMotionRunning: boolean
  onPickFile: (role: CharacterSheetRole, file: File) => void
  onClearSource: (role: CharacterSheetRole) => void
  onUseCharacterSlot: () => void
  onChangeText: (text: string) => void
  onGenerate: () => void
  onApply: () => void
  onClose: () => void
}

const ROLE_ICON: Record<CharacterSheetRole, React.ReactNode> = {
  identity: <User size={13} color="#10B981" />,
  outfit: <Shirt size={13} color="#10B981" />,
}

const ROLE_HINT: Record<CharacterSheetRole, string> = {
  identity: 'Khuôn mặt, tóc',
  outfit: 'Áo, quần muốn mặc',
}

export function MotionCharacterSheetNode({ data, selected }: NodeProps) {
  const d = data as unknown as MotionCharacterSheetNodeData
  const sheet = d.sheet
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pickRoleRef = useRef<CharacterSheetRole>('identity')
  const [dragOver, setDragOver] = useState<CharacterSheetRole | null>(null)
  const running = sheet.status === 'running'
  const missing = characterSheetMissing(sheet)

  const openPicker = (role: CharacterSheetRole, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (running) return
    pickRoleRef.current = role
    fileInputRef.current?.click()
  }

  const renderSlot = (role: CharacterSheetRole) => {
    const source = sheet[role]
    return (
      <div
        className={`mf-sub-slot ${dragOver === role ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(role)
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(null)
          const file = e.dataTransfer.files?.[0]
          if (file && !running) d.onPickFile(role, file)
        }}
        data-testid={`sheet-slot-${role}`}
      >
        <div className="mf-sub-header">
          <span className="mf-sub-title">
            {ROLE_ICON[role]}
            <span>{CHARACTER_SHEET_ROLE_LABEL[role]}</span>
          </span>
          <span style={{ fontSize: '10px', color: '#B91C1C', fontWeight: 600 }}>Cần có</span>
        </div>
        <div className="mf-sub-preview-box" onClick={(e) => openPicker(role, e)} title={`Chọn ${CHARACTER_SHEET_ROLE_LABEL[role].toLowerCase()}`}>
          {source?.previewUrl ? (
            <>
              <img src={source.previewUrl} alt={source.fileName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {!running && (
                <button
                  type="button"
                  className="mf-sheet-remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    d.onClearSource(role)
                  }}
                  title="Bỏ ảnh này"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', color: '#94A3B8', textAlign: 'center' }}>
              <Upload size={16} />
              <span style={{ fontSize: '10px' }}>{ROLE_HINT[role]}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`mf-node mf-sheet-node ${selected ? 'selected' : ''} ${running ? 'running' : ''}`}
      data-type="img"
      data-testid="motion-character-sheet-node"
    >
      <header className="mf-node-h">
        <span className="mf-chip">
          <UserPlus size={15} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <h2>Tạo Ảnh Nhân Vật Mới</h2>
          <small style={{ fontSize: '11px', color: '#64748B' }}>Tùy chọn · ChatGPT, không tốn credit Flow</small>
        </div>
        <button
          type="button"
          className="mf-sheet-close nodrag"
          onClick={(e) => {
            e.stopPropagation()
            d.onClose()
          }}
          disabled={running}
          title={running ? 'Đợi tạo ảnh xong rồi mới đóng' : 'Ẩn node này (không ảnh hưởng ô Nhân Vật)'}
        >
          <X size={14} />
        </button>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) d.onPickFile(pickRoleRef.current, file)
          e.target.value = ''
        }}
      />

      <div className="mf-node-b mf-sheet-body">
        <div className="mf-secondary-grid">
          {renderSlot('identity')}
          {renderSlot('outfit')}
        </div>

        {d.canUseCharacterSlot && !running && (
          <button type="button" className="mf-sheet-link nodrag" onClick={d.onUseCharacterSlot}>
            Lấy ảnh đang có ở ô Nhân Vật làm ảnh khuôn mặt
          </button>
        )}

        <label className="mf-sheet-label">
          Thay đổi thêm <span>(tùy chọn)</span>
          <textarea
            className="mf-sheet-textarea nodrag nowheel"
            value={sheet.changes}
            onChange={(e) => d.onChangeText(e.target.value)}
            placeholder="VD: tóc buộc cao, đi giày thể thao trắng"
            maxLength={600}
            rows={2}
            disabled={running}
          />
        </label>

        <button
          type="button"
          className="mf-btn-primary-hero nodrag"
          style={{ width: '100%' }}
          onClick={d.onGenerate}
          disabled={running || missing.length > 0}
          title={missing[0] || 'Gửi ảnh nhân vật + trang phục cho ChatGPT (thường 40–70 giây)'}
          data-testid="sheet-generate"
        >
          {running ? <RotateCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
          <span>{running ? 'Đang tạo ảnh (40–70 giây)…' : sheet.result ? 'Tạo ảnh khác' : 'Tạo ảnh nhân vật'}</span>
        </button>

        {sheet.error && (
          <div className="mf-sheet-error" role="alert">
            <AlertTriangle size={13} />
            <span>{sheet.error}</span>
          </div>
        )}

        {sheet.result && (
          <div className="mf-sheet-result">
            <img src={sheet.result.previewUrl} alt="Ảnh nhân vật mới" />
            <div className="mf-sheet-result-meta">
              <span>Ảnh mới · {sheet.result.seconds}s</span>
              {d.applied && (
                <span className="mf-sheet-applied">
                  <CheckCircle2 size={12} /> Đang dùng ở ô Nhân Vật
                </span>
              )}
            </div>
            <button
              type="button"
              className="mf-btn-secondary-hero nodrag"
              style={{ width: '100%' }}
              onClick={d.onApply}
              disabled={d.applied || d.isMotionRunning || running}
              title={d.isMotionRunning ? 'Motion Control đang tạo video; đợi xong rồi đổi ảnh nhân vật' : 'Đưa ảnh này vào ô Nhân Vật'}
              data-testid="sheet-apply"
            >
              <ArrowRight size={14} />
              <span>{d.applied ? 'Đã dùng làm Ảnh Nhân Vật' : 'Dùng làm Ảnh Nhân Vật'}</span>
            </button>
            {sheet.result.prompt && (
              <details className="mf-sheet-prompt nodrag nowheel">
                <summary>Xem prompt đã gửi</summary>
                <pre>{sheet.result.prompt}</pre>
              </details>
            )}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="out-sheet"
        className={`mf-ref-handle img ${sheet.result ? 'on' : ''}`}
        style={{ right: -7, top: 26 }}
      />
    </div>
  )
}
