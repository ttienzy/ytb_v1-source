import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  Send,
  Share2,
  Sparkles,
  X,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { BackendCaption } from '../types'

function FacebookIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function getLocalDateStr(d: Date = new Date()): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getNextSlot(d: Date = new Date()): { date: string; time: string } {
  const target = new Date(d.getTime() + 15 * 60 * 1000)
  const minutes = target.getMinutes()
  const roundedMins = Math.ceil(minutes / 15) * 15
  target.setMinutes(roundedMins)
  target.setSeconds(0)
  target.setMilliseconds(0)
  const hh = String(target.getHours()).padStart(2, '0')
  const mm = String(target.getMinutes()).padStart(2, '0')
  return {
    date: getLocalDateStr(target),
    time: `${hh}:${mm}`,
  }
}

interface FacebookPublishModalProps {
  jobId: string
  caption?: BackendCaption | null
  pippitTasks?: any[]
  onClose: () => void
}

interface ConnectedPageOption {
  accountId: string
  accountEmail: string
  pageId: string
  pageName: string
  avatarUrl: string
  unExpired: boolean
}

export function FacebookPublishModal({
  jobId,
  caption,
  pippitTasks,
  onClose,
}: FacebookPublishModalProps) {

  const [pages, setPages] = useState<ConnectedPageOption[]>([])
  const [loadingPages, setLoadingPages] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string>('')

  // Form inputs
  const titlePart = caption?.title ? String(caption.title).trim() : ''
  const descPart = caption?.description ? String(caption.description).trim() : ''
  const [title, setTitle] = useState(titlePart)

  const hashtagsStr = Array.isArray(caption?.hashtags)
    ? caption.hashtags
        .map(t => (String(t).startsWith('#') ? String(t) : `#${String(t)}`))
        .join(' ')
    : typeof caption?.hashtags === 'string'
    ? caption.hashtags
    : ''

  const initialDesc = [titlePart, descPart, hashtagsStr]
    .filter(Boolean)
    .join('\n\n')

  const [description, setDescription] = useState(initialDesc)


  // Timing state
  const [timing, setTiming] = useState<'soon' | 'custom'>('soon')
  const [scheduleDate, setScheduleDate] = useState(() => getNextSlot().date)
  const [scheduleTime, setScheduleTime] = useState(() => getNextSlot().time)

  // 96 time slots: 00:00, 00:15, ..., 23:45
  const timeSlots = useMemo(() => {
    const slots: string[] = []
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const hh = String(h).padStart(2, '0')
        const mm = String(m).padStart(2, '0')
        slots.push(`${hh}:${mm}`)
      }
    }
    return slots
  }, [])

  // Calculate target Date & Minutes ahead
  const targetDateObj = useMemo(() => {
    if (timing === 'soon') return null
    try {
      const [hh, mm] = scheduleTime.split(':').map(Number)
      const [year, month, day] = scheduleDate.split('-').map(Number)
      return new Date(year, month - 1, day, hh, mm, 0, 0)
    } catch {
      return null
    }
  }, [timing, scheduleDate, scheduleTime])

  const minutesUntilTarget = useMemo(() => {
    if (!targetDateObj) return 1
    const diffMs = targetDateObj.getTime() - Date.now()
    return Math.round(diffMs / (60 * 1000))
  }, [targetDateObj])

  const isPastTime = timing === 'custom' && minutesUntilTarget <= 0

  // Presets
  function applyPresetOffset(mins: number) {
    const target = new Date(Date.now() + mins * 60 * 1000)
    const minutes = target.getMinutes()
    const roundedMins = Math.ceil(minutes / 15) * 15
    target.setMinutes(roundedMins)
    target.setSeconds(0)
    target.setMilliseconds(0)
    const hh = String(target.getHours()).padStart(2, '0')
    const mm = String(target.getMinutes()).padStart(2, '0')
    setScheduleDate(getLocalDateStr(target))
    setScheduleTime(`${hh}:${mm}`)
  }

  function applyPresetTime(targetHour: number, isTomorrow: boolean = false) {
    const now = new Date()
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + (isTomorrow ? 1 : 0),
      targetHour,
      0,
      0,
      0
    )
    const hh = String(target.getHours()).padStart(2, '0')
    setScheduleDate(getLocalDateStr(target))
    setScheduleTime(`${hh}:00`)
  }

  // Submission state
  const [publishing, setPublishing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [resultData, setResultData] = useState<{
    task_id?: string
    message?: string
  } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadAccounts() {
      setLoadingPages(true)
      try {
        const res = await fetch(`${API_URL}/api/pippit/accounts`)
        if (!res.ok) throw new Error('Không thể tải danh sách tài khoản Pippit.')
        const accounts = await res.json()

        const list: ConnectedPageOption[] = []
        for (const acc of Array.isArray(accounts) ? accounts : []) {
          for (const p of acc?.facebook_pages || []) {
            const pid = p?.page_id ? String(p.page_id).trim() : ''
            if (pid !== '') {
              list.push({
                accountId: String(acc.id || ''),
                accountEmail: String(acc.email || ''),
                pageId: pid,
                pageName: String(p.page_name || `Page ${pid}`),
                avatarUrl: String(p.avatar_url || ''),
                unExpired: Boolean(p.un_expired),
              })
            }
          }
        }
        setPages(list)
        if (list.length > 0) {
          setSelectedKey(`${list[0].accountId}::${list[0].pageId}`)
        }
      } catch (err: any) {
        setError(err?.message || 'Lỗi tải danh sách Facebook Pages.')
      } finally {
        setLoadingPages(false)
      }
    }
    loadAccounts()
  }, [])

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedKey) {
      setError('Vui lòng chọn Fanpage để đăng bài.')
      return
    }
    if (isPastTime) {
      setError('Thời gian hẹn giờ đã qua. Vui lòng chọn mốc thời gian trong tương lai.')
      return
    }
    const [accountId, pageId] = selectedKey.split('::')
    const finalMinutes = timing === 'soon' ? 1 : Math.max(1, minutesUntilTarget)

    setPublishing(true)
    setError('')
    try {
      const res = await fetch(
        `${API_URL}/api/recap/jobs/${jobId}/publish-facebook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: accountId,
            page_id: pageId,
            title: title.trim(),
            caption: description.trim(),
            when_minutes_ahead: finalMinutes,
          }),
        }
      )
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.detail || 'Đăng bài lên Facebook thất bại.')
      }
      setSuccess(true)
      setResultData(data)
    } catch (err: any) {
      setError(err?.message || 'Đã xảy ra lỗi khi đăng bài.')
    } finally {
      setPublishing(false)
    }
  }

  const selectedPage = pages.find(
    p => `${p.accountId}::${p.pageId}` === selectedKey
  )

  const todayStr = getLocalDateStr()

  const modalContent = (
    <div className="modal-backdrop" onClick={() => !publishing && onClose()}>
      <div
        className="publish-fb-modal"
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 24,
          width: 530,
          maxWidth: '92vw',
          maxHeight: '92vh',
          overflowY: 'auto',
          boxShadow: '0 25px 35px -5px rgba(0,0,0,0.2)',
          border: '1px solid #e2e8f0',
          zIndex: 10000,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                display: 'grid',
                width: 36,
                height: 36,
                placeItems: 'center',
                background: '#1877f2',
                color: '#fff',
                borderRadius: 10,
              }}
            >
              <FacebookIcon size={20} />
            </div>
            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: 16,
                  fontWeight: 800,
                  color: '#0f172a',
                }}
              >
                Đăng bài lên Facebook Page
              </h3>
              <span style={{ fontSize: 11.5, color: '#64748b' }}>
                Xuất bản video tự động qua Pippit AI (CapCut Commerce)
              </span>
            </div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            disabled={publishing}
            style={{ width: 30, height: 30 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Duplicate warning notice */}
        {pippitTasks && pippitTasks.length > 0 && !success && (
          <div
            style={{
              padding: '10px 14px',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 10,
              fontSize: 12,
              color: '#92400e',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1, color: '#d97706' }} />
            <div>
              <strong>Lưu ý tránh đăng trùng:</strong> Video này đã được lên lịch/đăng lên Fanpage: <strong>{pippitTasks.map(t => t.page_name || t.page_id).join(', ')}</strong> ({pippitTasks.length} lần). Vui lòng chọn Page khác nếu không muốn đăng lặp nội dung.
            </div>
          </div>
        )}

        {/* Success State */}
        {success ? (

          <div style={{ textAlign: 'center', padding: '16px 8px 8px' }}>
            <div
              style={{
                display: 'grid',
                width: 54,
                height: 54,
                placeItems: 'center',
                background: '#dcfce7',
                color: '#16a34a',
                borderRadius: '50%',
                margin: '0 auto 14px',
              }}
            >
              <CheckCircle2 size={32} />
            </div>
            <h4
              style={{
                margin: '0 0 8px',
                fontSize: 16,
                fontWeight: 700,
                color: '#14532d',
              }}
            >
              Lên lịch đăng bài thành công!
            </h4>
            <p
              style={{
                fontSize: 13,
                color: '#475569',
                lineHeight: 1.5,
                margin: '0 0 16px',
              }}
            >
              Video đã được upload lên Pippit Cloud và lên lịch xuất bản tới
              Fanpage <strong>{selectedPage?.pageName}</strong>.
            </p>
            {resultData?.task_id && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  padding: '12px 14px',
                  fontSize: 12,
                  color: '#475569',
                  marginBottom: 20,
                  textAlign: 'left',
                }}
              >
                <div>
                  <strong>Task ID:</strong> <code>{resultData.task_id}</code>
                </div>
                <div style={{ marginTop: 4 }}>
                  <strong>Lịch phát sóng:</strong>{' '}
                  {timing === 'soon'
                    ? 'Xuất bản sau ~1 phút'
                    : `${scheduleTime} ngày ${scheduleDate} (sau ~${minutesUntilTarget} phút)`}
                </div>
              </div>
            )}
            <button
              type="button"
              className="btn-p"
              onClick={onClose}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Hoàn tất
            </button>
          </div>
        ) : (
          <form onSubmit={handlePublish}>
            {error && (
              <div
                className="err-block"
                style={{ margin: '0 0 14px', padding: '10px 12px' }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 12 }}>{error}</span>
              </div>
            )}

            {/* Step 1: Chọn Page */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Chọn Facebook Fanpage đích <span style={{ color: '#dc2626' }}>*</span>
              </label>
              {loadingPages ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: '#64748b',
                    padding: '10px',
                  }}
                >
                  <Loader2 size={14} className="spin" /> Đang tải danh sách
                  Pages...
                </div>
              ) : pages.length === 0 ? (
                <div
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 12,
                    color: '#991b1b',
                  }}
                >
                  Chưa có Fanpage nào được liên kết trong Cài đặt Pippit. Vui
                  lòng vào <strong>Cài đặt → Pippit</strong> để kết nối
                  Fanpage trước!
                </div>
              ) : (
                <select
                  value={selectedKey}
                  onChange={e => setSelectedKey(e.target.value)}
                  style={{
                    width: '100%',
                    height: 42,
                    padding: '0 12px',
                    fontSize: 12.5,
                    fontWeight: 600,
                    borderRadius: 9,
                    border: '1px solid #dfe4eb',
                    background: '#fff',
                    outline: 'none',
                    color: '#1e293b',
                  }}
                >
                  {pages.map(p => (
                    <option
                      key={`${p.accountId}::${p.pageId}`}
                      value={`${p.accountId}::${p.pageId}`}
                    >
                      {p.pageName} (ID: {p.pageId}) — {p.accountEmail}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Step 2: Tiêu đề video */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Tiêu đề video
              </label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Nhập tiêu đề video Facebook..."
                style={{ height: 40, fontSize: 12.5 }}
              />
            </div>

            {/* Step 3: Caption & Hashtags */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Nội dung mô tả bài viết (Caption &amp; Hashtags)
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Nhập nội dung mô tả, hashtag..."
                style={{ minHeight: 110, fontSize: 12.5, lineHeight: 1.5 }}
              />
            </div>

            {/* Step 4: Lên lịch & Hẹn giờ */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                Thời gian xuất bản bài viết (Giờ Local)
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                <label
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    background: timing === 'soon' ? '#eff6ff' : '#f8fafc',
                    border: `1.5px solid ${
                      timing === 'soon' ? '#3b82f6' : '#e2e8f0'
                    }`,
                    borderRadius: 9,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    color: timing === 'soon' ? '#1d4ed8' : '#475569',
                    margin: 0,
                  }}
                >
                  <input
                    type="radio"
                    name="timing"
                    checked={timing === 'soon'}
                    onChange={() => setTiming('soon')}
                    style={{ width: 'auto', height: 'auto' }}
                  />
                  <span>Đăng ngay (~1 phút)</span>
                </label>

                <label
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    background: timing === 'custom' ? '#eff6ff' : '#f8fafc',
                    border: `1.5px solid ${
                      timing === 'custom' ? '#3b82f6' : '#e2e8f0'
                    }`,
                    borderRadius: 9,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    color: timing === 'custom' ? '#1d4ed8' : '#475569',
                    margin: 0,
                  }}
                >
                  <input
                    type="radio"
                    name="timing"
                    checked={timing === 'custom'}
                    onChange={() => setTiming('custom')}
                    style={{ width: 'auto', height: 'auto' }}
                  />
                  <span>Hẹn ngày &amp; giờ đăng</span>
                </label>
              </div>

              {timing === 'custom' && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '12px 14px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/* Date & Time Selectors */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.2fr 1fr',
                      gap: 10,
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#64748b',
                          display: 'block',
                          marginBottom: 4,
                        }}
                      >
                        📅 Ngày đăng
                      </span>
                      <input
                        type="date"
                        min={todayStr}
                        value={scheduleDate}
                        onChange={e => setScheduleDate(e.target.value)}
                        style={{
                          height: 38,
                          padding: '0 10px',
                          fontSize: 12.5,
                          fontWeight: 600,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          background: '#fff',
                          color: '#1e293b',
                        }}
                      />
                    </div>

                    <div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#64748b',
                          display: 'block',
                          marginBottom: 4,
                        }}
                      >
                        ⏰ Khung giờ (15 phút/mốc)
                      </span>
                      <select
                        value={scheduleTime}
                        onChange={e => setScheduleTime(e.target.value)}
                        style={{
                          width: '100%',
                          height: 38,
                          padding: '0 10px',
                          fontSize: 12.5,
                          fontWeight: 700,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          background: '#fff',
                          color: '#1e293b',
                          outline: 'none',
                        }}
                      >
                        {timeSlots.map(slot => (
                          <option key={slot} value={slot}>
                            {slot}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Preset Buttons */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 5,
                      paddingTop: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: '#94a3b8',
                        fontWeight: 600,
                        marginRight: 2,
                      }}
                    >
                      Chọn nhanh:
                    </span>
                    <button
                      type="button"
                      className="scene-chip"
                      onClick={() => applyPresetOffset(30)}
                      title="Sau 30 phút"
                    >
                      +30 phút
                    </button>
                    <button
                      type="button"
                      className="scene-chip"
                      onClick={() => applyPresetOffset(60)}
                      title="Sau 1 tiếng"
                    >
                      +1 giờ
                    </button>
                    <button
                      type="button"
                      className="scene-chip"
                      onClick={() => applyPresetOffset(120)}
                      title="Sau 2 tiếng"
                    >
                      +2 giờ
                    </button>
                    <button
                      type="button"
                      className="scene-chip"
                      onClick={() => applyPresetTime(20, false)}
                      title="20:00 tối nay"
                    >
                      Tối nay (20:00)
                    </button>
                    <button
                      type="button"
                      className="scene-chip"
                      onClick={() => applyPresetTime(8, true)}
                      title="08:00 sáng mai"
                    >
                      Sáng mai (08:00)
                    </button>
                    <button
                      type="button"
                      className="scene-chip"
                      onClick={() => applyPresetTime(20, true)}
                      title="20:00 tối mai"
                    >
                      Tối mai (20:00)
                    </button>
                  </div>

                  {/* Live Status Feedback */}
                  {isPastTime ? (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: '#dc2626',
                        background: '#fef2f2',
                        padding: '6px 10px',
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        fontWeight: 600,
                      }}
                    >
                      <AlertCircle size={13} />
                      Thời gian đã qua trong quá khứ. Vui lòng chọn mốc giờ trong tương lai!
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: '#15803d',
                        background: '#f0fdf4',
                        padding: '6px 10px',
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Clock3 size={13} />
                      <span>
                        Dự kiến phát sóng lúc <strong>{scheduleTime}</strong> ngày{' '}
                        <strong>{scheduleDate}</strong> (khoảng{' '}
                        {Math.floor(minutesUntilTarget / 60) > 0 &&
                          `${Math.floor(minutesUntilTarget / 60)} giờ `}
                        {minutesUntilTarget % 60} phút nữa).
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 8,
              }}
            >
              <button
                type="button"
                className="btn-cancel"
                onClick={onClose}
                disabled={publishing}
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                className="btn-fb-publish"
                disabled={publishing || pages.length === 0 || isPastTime}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '9px 18px',
                  background: isPastTime ? '#94a3b8' : '#1877f2',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 9,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor:
                    pages.length === 0 || isPastTime
                      ? 'not-allowed'
                      : 'pointer',
                  transition: 'background .15s',
                }}
              >
                {publishing ? (
                  <>
                    <Loader2 size={14} className="spin" /> Đang upload &amp;
                    lên lịch...
                  </>
                ) : (
                  <>
                    <Send size={14} /> Lên lịch đăng bài
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
