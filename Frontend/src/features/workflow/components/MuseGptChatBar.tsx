import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  MessagesSquare,
  NotebookPen,
  RefreshCw,
  Send,
  Settings2,
  Upload,
  X,
} from 'lucide-react'
import {
  GptChatApiError,
  fetchGptChatPoolStatus,
  museMediaUrl,
  sendMuseGptChat,
  uploadMuseImage,
} from '../services/museCanvasApi.ts'
import type { MuseNodeLike } from '../services/museCanvasNodes.ts'
import {
  GPT_CHAT_MAX_ATTACHMENTS,
  collectCanvasImages,
  formatPoolBadge,
  promptBoxLabelFromReply,
  trimChatHistory,
  type GptChatAttachment,
  type GptChatErrorCode,
  type GptChatMessage,
  type GptChatPoolStatus,
} from '../services/museGptChat.ts'

interface MuseGptChatBarProps {
  nodes: MuseNodeLike[]
  onSpawnPromptBox: (text: string, label: string) => void
  onOpenSettings?: () => void
}

interface ChatErrorState {
  code: GptChatErrorCode
  message: string
}

const makeId = () => `gpt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export function MuseGptChatBar({ nodes, onSpawnPromptBox, onOpenSettings }: MuseGptChatBarProps) {
  // Toàn bộ ngữ cảnh giữ trong RAM; tắt app hoặc đổi project là reset sạch.
  const [messages, setMessages] = useState<GptChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<GptChatAttachment[]>([])
  const [expanded, setExpanded] = useState(false)
  const [sending, setSending] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<ChatErrorState | null>(null)
  const [pool, setPool] = useState<GptChatPoolStatus | null>(null)
  const [poolLoading, setPoolLoading] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [spawnedId, setSpawnedId] = useState<string | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const attachRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refreshPool = useCallback(async () => {
    setPoolLoading(true)
    try {
      setPool(await fetchGptChatPoolStatus())
    } catch {
      /* backend chưa sẵn sàng thì giữ nguyên trạng thái cũ */
    } finally {
      setPoolLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshPool()
  }, [refreshPool])

  useEffect(() => {
    if (!sending) {
      setElapsed(0)
      return
    }
    const started = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.max(1, Math.floor((Date.now() - started) / 1000)))
    }, 1000)
    return () => clearInterval(timer)
  }, [sending])

  useEffect(() => {
    if (!expanded || !listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [expanded, messages.length, sending, error])

  useEffect(() => {
    if (!attachOpen) return
    const onDown = (e: MouseEvent) => {
      if (attachRef.current && !attachRef.current.contains(e.target as globalThis.Node)) {
        setAttachOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [attachOpen])

  const canvasImages = useMemo(() => collectCanvasImages(nodes), [nodes])
  const attachedPaths = useMemo(() => new Set(attachments.map((a) => a.path)), [attachments])
  const badge = useMemo(() => formatPoolBadge(pool), [pool])

  const addAttachment = (item: GptChatAttachment) => {
    setAttachments((prev) => {
      if (prev.some((x) => x.path === item.path) || prev.length >= GPT_CHAT_MAX_ATTACHMENTS) return prev
      return [...prev, item]
    })
  }

  const handleUploadFile = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setAttachOpen(false)
    setUploading(true)
    setError(null)
    try {
      const up = await uploadMuseImage(file)
      addAttachment({ path: up.path, previewUrl: up.previewUrl, label: up.name })
    } catch (e: any) {
      setExpanded(true)
      setError({ code: 'all_failed', message: e?.message || 'Không tải được ảnh lên.' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || sending) return
    const usedAttachments = [...attachments]
    const history = trimChatHistory(messages)
    setSending(true)
    setPendingPrompt(text)
    setExpanded(true)
    setError(null)
    setAttachOpen(false)

    try {
      const res = await sendMuseGptChat({
        message: text,
        history,
        reference_images: usedAttachments.map((a) => a.path),
      })
      const now = Date.now()
      const userMsg: GptChatMessage = {
        id: makeId(),
        role: 'user',
        content: text,
        attachments: usedAttachments.length ? usedAttachments : undefined,
        createdAt: now,
      }
      const botMsg: GptChatMessage = {
        id: makeId(),
        role: 'assistant',
        content: res.reply,
        accountLabel: res.account_label,
        durationSeconds: res.duration_seconds,
        createdAt: now + 1,
      }
      setMessages((prev) => [...prev, userMsg, botMsg])
      setDraft('')
      if (res.pool) setPool(res.pool)
      else void refreshPool()
    } catch (e: any) {
      if (e instanceof GptChatApiError) {
        setError({ code: e.code, message: e.message })
        if (e.pool) setPool(e.pool)
        else void refreshPool()
      } else {
        setError({ code: 'all_failed', message: e?.message || 'Không gửi được yêu cầu tới ChatGPT.' })
        void refreshPool()
      }
    } finally {
      setSending(false)
      setPendingPrompt('')
    }
  }

  const handleReset = () => {
    if (sending) return
    setMessages([])
    setError(null)
    setAttachments([])
    setExpanded(false)
  }

  const handleCopy = async (msg: GptChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content)
      setCopiedId(msg.id)
      setTimeout(() => setCopiedId((cur) => (cur === msg.id ? null : cur)), 1600)
    } catch {
      /* bỏ qua nếu clipboard bị chặn */
    }
  }

  const handleToPromptBox = (msg: GptChatMessage) => {
    onSpawnPromptBox(msg.content, promptBoxLabelFromReply(msg.content))
    setSpawnedId(msg.id)
    setTimeout(() => setSpawnedId((cur) => (cur === msg.id ? null : cur)), 1800)
  }

  const showDrawer = expanded && (messages.length > 0 || sending || !!error)

  return (
    <div className="mc-gptbar nodrag nopan nowheel" role="region" aria-label="ChatGPT viết kịch bản">
      {showDrawer && (
        <div className="mc-gptbar-drawer">
          <div className="mc-gptbar-head">
            <MessagesSquare size={14} />
            <strong>ChatGPT · Kịch bản tạm thời</strong>
            <span className="mc-gptbar-hint">Nhớ tạm trong phiên, tắt app tự reset</span>
            <div className="mc-gptbar-head-actions">
              {messages.length > 0 && (
                <button
                  type="button"
                  className="mc-mini-btn"
                  onClick={handleReset}
                  disabled={sending}
                  title="Bắt đầu cuộc hội thoại mới"
                >
                  <MessageSquarePlus size={12} /> Chat mới
                </button>
              )}
              <button
                type="button"
                className="mc-mini-btn"
                onClick={() => setExpanded(false)}
                title="Thu gọn khung chat (Esc)"
              >
                <ChevronDown size={13} />
              </button>
            </div>
          </div>

          <div className="mc-gptbar-messages" ref={listRef}>
            {messages.map((m) => (
              <div key={m.id} className={`mc-gptbar-msg is-${m.role}`}>
                {m.attachments && m.attachments.length > 0 && (
                  <div className="mc-gptbar-msg-refs">
                    {m.attachments.map((a) => (
                      <span key={a.path} className="mc-gptbar-msg-ref">
                        {a.previewUrl && <img src={museMediaUrl(a.previewUrl)} alt={a.label} />}
                        <span>{a.label}</span>
                      </span>
                    ))}
                  </div>
                )}
                <div className="mc-gptbar-msg-text">{m.content}</div>
                {m.role === 'assistant' && (
                  <div className="mc-gptbar-msg-foot">
                    <span className="mc-gptbar-msg-meta">
                      {m.accountLabel || 'ChatGPT'} · {m.durationSeconds ?? 0}s
                    </span>
                    <button type="button" className="mc-mini-btn" onClick={() => void handleCopy(m)}>
                      {copiedId === m.id ? <Check size={11} /> : <Copy size={11} />}
                      {copiedId === m.id ? 'Đã chép' : 'Chép'}
                    </button>
                    <button
                      type="button"
                      className="mc-mini-btn mc-mini-accent"
                      onClick={() => handleToPromptBox(m)}
                      title="Tạo node Ô prompt mới trên canvas với nội dung này"
                    >
                      {spawnedId === m.id ? <Check size={11} /> : <NotebookPen size={11} />}
                      {spawnedId === m.id ? 'Đã tạo Ô prompt' : 'Ra Ô prompt'}
                    </button>
                  </div>
                )}
              </div>
            ))}

            {sending && (
              <>
                <div className="mc-gptbar-msg is-user is-pending">
                  <div className="mc-gptbar-msg-text">{pendingPrompt}</div>
                </div>
                <div className="mc-gptbar-msg is-assistant is-pending">
                  <div className="mc-gptbar-thinking">
                    <Loader2 size={13} className="animate-spin" />
                    <span>ChatGPT đang viết… {elapsed > 0 ? `${elapsed}s` : ''}</span>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className={`mc-gptbar-err is-${error.code}`} role="alert">
                <AlertTriangle size={14} />
                <span>{error.message}</span>
                {(error.code === 'no_accounts' || error.code === 'auth_expired' || error.code === 'all_busy') && onOpenSettings && (
                  <button type="button" className="mc-mini-btn" onClick={onOpenSettings}>
                    <Settings2 size={11} /> Cài đặt GPT
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mc-gptbar-chips">
          {attachments.map((a) => (
            <span key={a.path} className="mc-gptbar-chip" title={a.path}>
              {a.previewUrl && <img src={museMediaUrl(a.previewUrl)} alt={a.label} />}
              <span>{a.label}</span>
              <button
                type="button"
                aria-label={`Bỏ ${a.label}`}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mc-gptbar-bar">
        <div className="mc-gptbar-left">
          <button
            type="button"
            className={`mc-gptbar-toggle ${expanded ? 'on' : ''}`}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Thu gọn hội thoại' : 'Mở khung hội thoại ChatGPT'}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            <MessagesSquare size={13} />
            {messages.length > 0 && <span className="mc-gptbar-count">{messages.length}</span>}
          </button>

          <button
            type="button"
            className={`mc-gptbar-pool tone-${badge.tone}`}
            onClick={() => void refreshPool()}
            disabled={poolLoading}
            title="Trạng thái kho tài khoản ChatGPT (bấm để kiểm tra lại)"
          >
            <span className="mc-gptbar-dot" />
            <span>{badge.text}</span>
            {poolLoading && <RefreshCw size={10} className="animate-spin" />}
          </button>

          <div className="mc-gptbar-attach-wrap" ref={attachRef}>
            <button
              type="button"
              className="mc-gptbar-icon-btn"
              onClick={() => setAttachOpen((v) => !v)}
              disabled={sending || uploading || attachments.length >= GPT_CHAT_MAX_ATTACHMENTS}
              title={`Đính kèm ảnh từ Canvas hoặc từ máy (${attachments.length}/${GPT_CHAT_MAX_ATTACHMENTS})`}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            </button>

            {attachOpen && (
              <div className="mc-gptbar-attach-menu">
                <div className="mc-gptbar-attach-head">Đính kèm ảnh cho ChatGPT ({attachments.length}/{GPT_CHAT_MAX_ATTACHMENTS})</div>
                <button type="button" className="mc-gptbar-attach-upload" onClick={() => fileRef.current?.click()}>
                  <Upload size={13} /> Tải ảnh từ máy…
                </button>
                {canvasImages.length > 0 ? (
                  <div className="mc-gptbar-attach-list">
                    {canvasImages.map((img) => {
                      const picked = attachedPaths.has(img.path)
                      return (
                        <button
                          key={img.path}
                          type="button"
                          disabled={picked}
                          onClick={() => {
                            addAttachment(img)
                            setAttachOpen(false)
                          }}
                        >
                          {img.previewUrl && <img src={museMediaUrl(img.previewUrl)} alt={img.label} />}
                          <span>{img.label}</span>
                          {picked && <Check size={12} />}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="mc-gptbar-attach-empty">Chưa có ảnh nào trên canvas.</div>
                )}
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => void handleUploadFile(e.target.files)}
            />
          </div>
        </div>

        <textarea
          className="mc-gptbar-input"
          rows={1}
          value={draft}
          disabled={sending}
          maxLength={20000}
          placeholder="Nhắn ChatGPT viết kịch bản / prompt… (Enter gửi)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            } else if (e.key === 'Escape') {
              setExpanded(false)
              setAttachOpen(false)
            }
          }}
        />

        <button
          type="button"
          className="mc-gptbar-send"
          onClick={() => void handleSend()}
          disabled={sending || !draft.trim()}
          title="Gửi tới ChatGPT"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          <span>{sending ? `${elapsed || 1}s` : 'Gửi'}</span>
        </button>
      </div>
    </div>
  )
}
