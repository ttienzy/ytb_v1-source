import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Sparkles, RotateCw, CheckCircle2, AlertCircle, Eye, Settings2, Columns2 } from 'lucide-react'
import type { MotionOutputConfig, MotionRunError, MotionVariantSlot } from '../../types'
import { normalizeMotionRunError } from '../../services/motionRunError'

export interface MotionOutputNodeData {
  config: MotionOutputConfig
  projectLabel?: string
  isReady: boolean
  missingReasons?: string[]
  isRunning?: boolean
  runningStageText?: string
  runError?: MotionRunError | null
  resultVideoUrl?: string | null
  resultVideoUrls?: string[]
  activeVariantIndex?: number
  onSelectVariantIndex?: (idx: number) => void
  variants?: MotionVariantSlot[]
  onRetryVariant?: (variantIndex: number) => void
  referenceVideoUrl?: string | null
  showReferenceComparison?: boolean
  onRun?: () => void
  onOpenPreviewModal?: (videoUrl: string) => void
  onOpenInspector?: () => void
}

export function MotionOutputNode({ data, selected }: NodeProps) {
  const rawData = data as unknown as MotionOutputNodeData
  const nodeData: MotionOutputNodeData = {
    ...rawData,
    runError: normalizeMotionRunError(rawData.runError),
    variants: rawData.variants?.map(slot => ({ ...slot, error: normalizeMotionRunError(slot.error) })),
  }
  const config = nodeData.config || {
    aspectRatio: '9:16',
    durationSeconds: 10,
    resolution: '720p',
    numOutputs: 1,
  }

  const isReady = nodeData.isReady
  const isRunning = nodeData.isRunning

  const variants = nodeData.variants || []
  const hasVariantSlots = variants.length > 0

  const videoList = nodeData.resultVideoUrls && nodeData.resultVideoUrls.length > 0
    ? nodeData.resultVideoUrls
    : (nodeData.resultVideoUrl ? [nodeData.resultVideoUrl] : [])
  const maxIdx = hasVariantSlots ? Math.max(0, variants.length - 1) : Math.max(0, videoList.length - 1)
  const currentVariantIdx = Math.min(nodeData.activeVariantIndex ?? 0, maxIdx)
  const currentSlot = hasVariantSlots ? variants[currentVariantIdx] : null
  const currentVideoUrl = currentSlot?.videoUrl || videoList[currentVariantIdx] || null

  const hasActiveError = hasVariantSlots
    ? currentSlot?.status === 'error'
    : Boolean(nodeData.runError)

  return (
    <div
      className={`mf-node mf-out-node ${selected ? 'selected' : ''} ${isRunning ? 'running' : ''} ${hasActiveError ? 'has-error' : ''}`}
      style={{ width: 330, padding: 0 }}
    >
      {/* Input Handle on the Left */}
      <Handle
        type="target"
        position={Position.Left}
        id="in-prompt"
        className={`mf-rf-handle txt ${isReady ? 'on' : ''}`}
        style={{ left: -7, top: '50%', transform: 'translateY(-50%)' }}
      />

      {/* Header */}
      <header className="mf-node-h" style={{ borderBottom: '1px solid #E2E8F0' }}>
        <span className="mf-chip out" style={{ background: '#EEF2FF', color: '#4F46E5' }}>
          <Sparkles size={15} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <h2 style={{ fontSize: '13px', margin: 0, fontWeight: 700 }}>Tạo Video (Veo Flow)</h2>
          <small style={{ fontSize: '11px', color: '#64748B' }}>Video Output Destination</small>
        </div>
        <button
          type="button"
          onClick={() => nodeData.onOpenInspector?.()}
          title="Tùy chỉnh định dạng xuất"
          style={{
            border: 'none',
            background: '#F1F5F9',
            color: '#475569',
            padding: '4px 6px',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            fontSize: '11px',
          }}
        >
          <Settings2 size={12} />
          <span>Cấu hình</span>
        </button>
      </header>

      {/* Body Content */}
      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Output Specs Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '4px 8px',
              borderRadius: '5px',
              background: '#ECFDF5',
              fontSize: '11px',
              fontWeight: 600,
              color: '#047857',
            }}
            title="Flow project dùng cho lượt tạo"
          >
            📁 {nodeData.projectLabel || 'Project mới / lượt'}
          </span>
          <span
            style={{
              padding: '4px 8px',
              borderRadius: '5px',
              background: '#EEF2FF',
              fontSize: '11px',
              fontWeight: 600,
              color: '#4338CA',
            }}
          >
            {config.modelDisplayName || 'Đang tải profile BE'}
          </span>
          <span
            style={{
              padding: '4px 8px',
              borderRadius: '5px',
              background: '#F1F5F9',
              fontSize: '11px',
              fontWeight: 600,
              color: '#334155',
            }}
          >
            📐 {config.aspectRatio}
          </span>
          <span
            style={{
              padding: '4px 8px',
              borderRadius: '5px',
              background: '#F1F5F9',
              fontSize: '11px',
              fontWeight: 600,
              color: '#334155',
            }}
          >
            ⏱️ {config.durationSeconds}s
          </span>
          <span
            style={{
              padding: '4px 8px',
              borderRadius: '5px',
              background: '#F1F5F9',
              fontSize: '11px',
              fontWeight: 600,
              color: '#334155',
            }}
          >
            📺 {config.resolution}
          </span>
          {config.creditCost != null && (
            <span
              style={{
                padding: '4px 8px',
                borderRadius: '5px',
                background: '#FFF7ED',
                fontSize: '11px',
                fontWeight: 600,
                color: '#C2410C',
              }}
            >
              {config.creditCost} credits
            </span>
          )}
        </div>

        {/* Status / Output Preview Area */}
        {hasVariantSlots ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* Thanh Tab Biến Thể kèm icon trạng thái */}
            {variants.length > 1 && (
              <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
                {variants.map((v, idx) => {
                  const isActive = currentVariantIdx === idx
                  let statusIcon = <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#94A3B8' }} />
                  if (v.status === 'done') {
                    statusIcon = <CheckCircle2 size={11} color="#10B981" />
                  } else if (v.status === 'submitting' || v.status === 'generating') {
                    statusIcon = <RotateCw size={11} className="animate-spin" color="#4F46E5" />
                  } else if (v.status === 'error') {
                    statusIcon = <AlertCircle size={11} color="#EF4444" />
                  }
                  return (
                    <button
                      key={v.index || idx}
                      type="button"
                      onClick={() => nodeData.onSelectVariantIndex?.(idx)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        border: isActive ? '1.5px solid #4F46E5' : '1px solid #CBD5E1',
                        background: isActive ? '#EEF2FF' : '#FFFFFF',
                        color: isActive ? '#4F46E5' : '#475569',
                        fontSize: '10.5px',
                        fontWeight: isActive ? 700 : 500,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {statusIcon}
                      <span>Biến thể #{v.index}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Chi tiết cho biến thể đang kích hoạt */}
            {currentSlot?.status === 'done' && currentVideoUrl ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {nodeData.showReferenceComparison && nodeData.referenceVideoUrl ? (
                  <div style={{ padding: '7px', borderRadius: '8px', background: '#F8FAFC', border: '1px solid #DBEAFE' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px', color: '#3730A3', fontSize: '10.5px', fontWeight: 800 }}>
                      <Columns2 size={13} />
                      <span>Đối chiếu chuyển động</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ position: 'relative', height: 112, borderRadius: '6px', overflow: 'hidden', background: '#0F172A' }}>
                          <video
                            key={currentVideoUrl}
                            src={currentVideoUrl}
                            aria-label="Video kết quả"
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            autoPlay
                            loop
                            muted
                            playsInline
                          />
                          <button
                            type="button"
                            onClick={() => nodeData.onOpenPreviewModal?.(currentVideoUrl)}
                            title="Xem video kết quả lớn hơn"
                            style={{ position: 'absolute', top: '5px', right: '5px', background: 'rgba(0,0,0,0.62)', color: '#FFFFFF', border: 'none', borderRadius: '4px', padding: '4px', cursor: 'pointer', display: 'flex' }}
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                        <div style={{ marginTop: '4px', color: '#4338CA', fontSize: '9.5px', fontWeight: 800 }}>
                          Kết quả #{currentSlot.index}
                        </div>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ height: 112, borderRadius: '6px', overflow: 'hidden', background: '#0F172A' }}>
                          <video
                            src={nodeData.referenceVideoUrl}
                            aria-label="Video tham chiếu"
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            autoPlay
                            loop
                            muted
                            playsInline
                          />
                        </div>
                        <div style={{ marginTop: '4px', color: '#64748B', fontSize: '9.5px', fontWeight: 800 }}>Video tham chiếu</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      position: 'relative',
                      width: '100%',
                      height: 140,
                      borderRadius: '6px',
                      overflow: 'hidden',
                      background: '#0F172A',
                    }}
                  >
                    <video
                      key={currentVideoUrl}
                      src={currentVideoUrl}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      autoPlay
                      loop
                      muted
                      playsInline
                    />
                    <button
                      type="button"
                      onClick={() => nodeData.onOpenPreviewModal?.(currentVideoUrl)}
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '6px',
                        background: 'rgba(0,0,0,0.62)',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                      }}
                      title="Mở trình phát video toàn màn hình"
                    >
                      <Eye size={13} />
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: '#10B981' }}>
                  <CheckCircle2 size={14} />
                  <span>Biến thể #{currentSlot.index} render hoàn tất thành công!</span>
                </div>
              </div>
            ) : (currentSlot?.status === 'submitting' || currentSlot?.status === 'generating') ? (
              <div
                style={{
                  padding: '14px',
                  borderRadius: '6px',
                  background: '#EEF2FF',
                  border: '1px solid #C7D2FE',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  alignItems: 'center',
                  textAlign: 'center',
                }}
              >
                <RotateCw size={22} className="animate-spin" color="#4F46E5" />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#3730A3' }}>
                  {currentSlot.progressText || nodeData.runningStageText || `Đang tạo Biến thể #${currentSlot.index}...`}
                </span>
                <small style={{ fontSize: '11px', color: '#6366F1' }}>
                  {currentSlot.jobId ? `Job ID: ${currentSlot.jobId}` : 'Đang xử lý trực tiếp từ Google Flow'}
                </small>
              </div>
            ) : currentSlot?.status === 'error' && currentSlot.error ? (
              <div
                role="alert"
                style={{
                  padding: '10px',
                  borderRadius: '7px',
                  background: '#FFF7F7',
                  border: '1px solid #FCA5A5',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <AlertCircle size={17} color="#DC2626" style={{ marginTop: '1px', flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1, color: '#7F1D1D', lineHeight: 1.4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                      <b style={{ fontSize: '11.5px' }}>Biến thể #{currentSlot.index}: {currentSlot.error.title}</b>
                      <span style={{ padding: '1px 5px', borderRadius: '4px', background: '#FEE2E2', fontSize: '9px', fontWeight: 700 }}>
                        {currentSlot.error.stageLabel}
                      </span>
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '10.5px', overflowWrap: 'anywhere' }}>
                      {currentSlot.error.message}
                    </div>
                    <div style={{ marginTop: '5px', paddingTop: '5px', borderTop: '1px solid #FECACA', fontSize: '10px', color: '#991B1B' }}>
                      <b>Cách xử lý:</b> {currentSlot.error.hint}
                    </div>
                    <div style={{ marginTop: '5px', fontSize: '9px', color: '#B91C1C' }}>
                      Mã: {currentSlot.error.code}
                      {currentSlot.error.jobId ? ` · Job: ${currentSlot.error.jobId}` : ''}
                    </div>
                  </div>
                </div>
                {nodeData.onRetryVariant && (
                  <button
                    type="button"
                    onClick={() => nodeData.onRetryVariant?.(currentSlot.index)}
                    disabled={isRunning}
                    style={{
                      alignSelf: 'flex-start',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '5px 10px',
                      borderRadius: '5px',
                      border: '1px solid #DC2626',
                      background: '#FEF2F2',
                      color: '#DC2626',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: isRunning ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <RotateCw size={12} />
                    <span>Thử lại riêng Biến thể #{currentSlot.index}</span>
                  </button>
                )}
              </div>
            ) : currentSlot?.status === 'idle' ? (
              <div
                style={{
                  padding: '14px',
                  borderRadius: '6px',
                  background: '#F8FAFC',
                  border: '1px dashed #CBD5E1',
                  textAlign: 'center',
                  color: '#64748B',
                  fontSize: '11px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span style={{ fontWeight: 600, color: '#334155' }}>Biến thể #{currentSlot.index}</span>
                <span>Đang chờ đến lượt xử lý sau các biến thể trước...</span>
              </div>
            ) : nodeData.runError ? (
              <div
                role="alert"
                style={{
                  padding: '10px',
                  borderRadius: '7px',
                  background: '#FFF7F7',
                  border: '1px solid #FCA5A5',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <AlertCircle size={17} color="#DC2626" style={{ marginTop: '1px', flexShrink: 0 }} />
                <div style={{ minWidth: 0, flex: 1, color: '#7F1D1D', lineHeight: 1.4 }}>
                  <b style={{ fontSize: '11.5px' }}>{nodeData.runError.title}</b>
                  <div style={{ marginTop: '4px', fontSize: '10.5px' }}>{nodeData.runError.message}</div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: '12px',
                  borderRadius: '6px',
                  background: '#F8FAFC',
                  border: '1px dashed #CBD5E1',
                  textAlign: 'center',
                  color: '#64748B',
                  fontSize: '11px',
                }}
              >
                Sẵn sàng tạo {variants.length} biến thể Motion Control.
              </div>
            )}
          </div>
        ) : currentVideoUrl ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* Bộ chọn biến thể (khi có > 1 video) */}
            {videoList.length > 1 && (
              <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
                {videoList.map((_, idx) => {
                  const isActive = currentVariantIdx === idx
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => nodeData.onSelectVariantIndex?.(idx)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '4px',
                        border: isActive ? '1px solid #4F46E5' : '1px solid #E2E8F0',
                        background: isActive ? '#EEF2FF' : '#FFFFFF',
                        color: isActive ? '#4F46E5' : '#475569',
                        fontSize: '10.5px',
                        fontWeight: isActive ? 700 : 500,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Biến thể #{idx + 1}
                    </button>
                  )
                })}
              </div>
            )}

            {nodeData.showReferenceComparison && nodeData.referenceVideoUrl ? (
              <div style={{ padding: '7px', borderRadius: '8px', background: '#F8FAFC', border: '1px solid #DBEAFE' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px', color: '#3730A3', fontSize: '10.5px', fontWeight: 800 }}>
                  <Columns2 size={13} />
                  <span>Đối chiếu chuyển động</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ position: 'relative', height: 112, borderRadius: '6px', overflow: 'hidden', background: '#0F172A' }}>
                      <video
                        key={currentVideoUrl}
                        src={currentVideoUrl}
                        aria-label="Video kết quả"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                      <button
                        type="button"
                        onClick={() => nodeData.onOpenPreviewModal?.(currentVideoUrl)}
                        title="Xem video kết quả lớn hơn"
                        style={{ position: 'absolute', top: '5px', right: '5px', background: 'rgba(0,0,0,0.62)', color: '#FFFFFF', border: 'none', borderRadius: '4px', padding: '4px', cursor: 'pointer', display: 'flex' }}
                      >
                        <Eye size={12} />
                      </button>
                    </div>
                    <div style={{ marginTop: '4px', color: '#4338CA', fontSize: '9.5px', fontWeight: 800 }}>
                      Kết quả {videoList.length > 1 ? `(#${currentVariantIdx + 1})` : 'Flow'}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ height: 112, borderRadius: '6px', overflow: 'hidden', background: '#0F172A' }}>
                      <video
                        src={nodeData.referenceVideoUrl}
                        aria-label="Video tham chiếu"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                    </div>
                    <div style={{ marginTop: '4px', color: '#64748B', fontSize: '9.5px', fontWeight: 800 }}>Video tham chiếu</div>
                  </div>
                </div>
              </div>
            ) : (
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: 140,
                borderRadius: '6px',
                overflow: 'hidden',
                background: '#0F172A',
              }}
            >
              <video
                key={currentVideoUrl}
                src={currentVideoUrl}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                autoPlay
                loop
                muted
                playsInline
              />
              <button
                type="button"
                onClick={() => nodeData.onOpenPreviewModal?.(currentVideoUrl)}
                style={{
                  position: 'absolute',
                  top: '6px',
                  right: '6px',
                  background: 'rgba(0,0,0,0.62)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                }}
                title="Mở trình phát video toàn màn hình"
              >
                <Eye size={13} />
              </button>
            </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: '#10B981' }}>
              <CheckCircle2 size={14} />
              <span>Video render hoàn tất thành công!</span>
            </div>
          </div>
        ) : isRunning ? (
          <div
            style={{
              padding: '14px',
              borderRadius: '6px',
              background: '#EEF2FF',
              border: '1px solid #C7D2FE',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <RotateCw size={22} className="animate-spin" color="#4F46E5" />
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#3730A3' }}>
              {nodeData.runningStageText || 'Đang xử lý tạo video...'}
            </span>
            <small style={{ fontSize: '11px', color: '#6366F1' }}>
              Tiến trình được cập nhật trực tiếp từ Backend
            </small>
          </div>
        ) : nodeData.runError ? (
          <div
            role="alert"
            style={{
              padding: '10px',
              borderRadius: '7px',
              background: '#FFF7F7',
              border: '1px solid #FCA5A5',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}
          >
            <AlertCircle size={17} color="#DC2626" style={{ marginTop: '1px', flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1, color: '#7F1D1D', lineHeight: 1.4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                <b style={{ fontSize: '11.5px' }}>{nodeData.runError.title}</b>
                <span style={{ padding: '1px 5px', borderRadius: '4px', background: '#FEE2E2', fontSize: '9px', fontWeight: 700 }}>
                  {nodeData.runError.stageLabel}
                </span>
              </div>
              <div style={{ marginTop: '4px', fontSize: '10.5px', overflowWrap: 'anywhere' }}>
                {nodeData.runError.message}
              </div>
              <div style={{ marginTop: '5px', paddingTop: '5px', borderTop: '1px solid #FECACA', fontSize: '10px', color: '#991B1B' }}>
                <b>Cách xử lý:</b> {nodeData.runError.hint}
              </div>
              <div style={{ marginTop: '5px', fontSize: '9px', color: '#B91C1C' }}>
                Mã: {nodeData.runError.code}
                {nodeData.runError.jobId ? ` · Job: ${nodeData.runError.jobId}` : ''}
              </div>
            </div>
          </div>
        ) : !isReady ? (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}
          >
            <AlertCircle size={15} color="#DC2626" style={{ marginTop: '2px', flexShrink: 0 }} />
            <div style={{ fontSize: '11px', color: '#991B1B', lineHeight: 1.4 }}>
              <b>Chưa đủ điều kiện:</b>
              <ul style={{ margin: '2px 0 0', paddingLeft: '14px' }}>
                {(nodeData.missingReasons || ['Cần có Video chuyển động tham chiếu']).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: '6px',
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11.5px',
              color: '#166534',
            }}
          >
            <CheckCircle2 size={15} color="#16A34A" />
            <span>Đã sẵn sàng tạo video với các nguyên liệu tham chiếu.</span>
          </div>
        )}

        {/* Run / Generate Button */}
        <button
          type="button"
          disabled={!isReady || isRunning}
          onClick={() => nodeData.onRun?.()}
          style={{
            width: '100%',
            padding: '9px 12px',
            borderRadius: '6px',
            border: 'none',
            background: !isReady || isRunning ? '#94A3B8' : 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
            color: '#FFFFFF',
            fontSize: '12.5px',
            fontWeight: 700,
            cursor: !isReady || isRunning ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: !isReady || isRunning ? 'none' : '0 2px 8px rgba(79, 70, 229, 0.35)',
            transition: 'all 0.15s ease',
          }}
        >
          {isRunning ? (
            <>
              <RotateCw size={15} className="animate-spin" />
              <span>Đang tạo video...</span>
            </>
          ) : nodeData.runError ? (
            <>
              <RotateCw size={15} />
              <span>{nodeData.runError.retryable ? 'Thử Lại' : 'Chạy Lại Sau Khi Sửa'}</span>
            </>
          ) : (
            <>
              <Sparkles size={15} />
              <span>Tạo Video Ngay</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
