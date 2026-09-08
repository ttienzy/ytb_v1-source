import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { ChatGptState } from '../types'

function groupModels(models: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {}
  for (const m of models) {
    if (m.includes('/')) {
      const prefix = m.split('/')[0].toLowerCase()
      const label =
        prefix === 'cx'
          ? 'Codex / ChatGPT (cx/)'
          : prefix === 'gh'
          ? 'GitHub Models (gh/)'
          : prefix === 'cl'
          ? 'Claude / OpenAI (cl/)'
          : prefix === 'ag'
          ? 'Antigravity (ag/)'
          : prefix === 'kc'
          ? 'KiloCode / DeepSeek (kc/)'
          : prefix === 'gemini'
          ? 'Google Gemini (gemini/)'
          : `${prefix.toUpperCase()}`
      if (!groups[label]) groups[label] = []
      groups[label].push(m)
    } else {
      const label = 'Khác / Model Gốc'
      if (!groups[label]) groups[label] = []
      groups[label].push(m)
    }
  }
  return groups
}

interface ChatGptSectionProps {
  onStatusChange?: (isConnected: boolean) => void
}

export function ChatGptSection({ onStatusChange }: ChatGptSectionProps) {
  const [state, setState] = useState<ChatGptState>({
    endpoint: 'http://localhost:20128/v1',
    api_key_masked: '',
    has_api_key: false,
    default_model: 'cx/gpt-5.5',
    is_connected: false,
    available_models: [],
  })

  // Form states
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [model, setModel] = useState('cx/gpt-5.5')
  const [isCustomModel, setIsCustomModel] = useState(false)

  // UI state
  const [loading, setLoading] = useState(false)
  const [openingDashboard, setOpeningDashboard] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [modelsList, setModelsList] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  useEffect(() => {
    loadSettings()
    if (window.desktop?.on9RouterUpdated) {
      const unsub = window.desktop.on9RouterUpdated(() => {
        handleFetchModels()
      })
      return () => unsub()
    }
  }, [])

  async function loadSettings() {
    try {
      const res = await fetch(`${API_URL}/api/settings/chatgpt`)
      if (res.ok) {
        const data: ChatGptState = await res.json()
        setState(data)
        if (data.default_model) {
          setModel(data.default_model)
        }
        if (data.available_models && data.available_models.length > 0) {
          setModelsList(data.available_models)
        }
        onStatusChange?.(data.is_connected)
      }
    } catch {
      // Backend có thể chưa sẵn sàng
    }
  }

  // Luồng mở Dashboard 9Router (IPC Electron hoặc Fallback qua Backend)
  async function handleOpenDashboard() {
    setOpeningDashboard(true)
    setMessage('')
    try {
      if (window.desktop?.open9routerDashboard) {
        // Môi trường Electron: Gọi IPC Main mở cửa sổ chuyên biệt (persist:9router)
        await window.desktop.open9routerDashboard()
        setMessage('Đã mở cửa sổ 9Router Dashboard. Mật khẩu mặc định là 123456.')
        setMessageType('info')
      } else {
        // Fallback Web Browser: Gọi backend khởi động 9router và mở browser
        const res = await fetch(`${API_URL}/api/settings/chatgpt/launch-9router`, {
          method: 'POST',
        })
        if (!res.ok) throw new Error('Không thể khởi động 9Router qua Backend.')
        setMessage('Đang mở 9Router Dashboard tại http://localhost:20128/. Mật khẩu mặc định là 123456.')
        setMessageType('info')
      }

      // Sau 2.5s và 5s tự động thăm dò lại trạng thái và tải models
      setTimeout(handleFetchModels, 2500)
      setTimeout(handleFetchModels, 5000)
    } catch (err: any) {
      setMessage(err?.message || 'Không thể mở 9Router Dashboard.')
      setMessageType('error')
    } finally {
      setOpeningDashboard(false)
    }
  }

  // Tải danh sách model từ 9Router
  async function handleFetchModels() {
    setFetchingModels(true)
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/settings/chatgpt/models`)
      if (!res.ok) throw new Error('Không lấy được danh sách model từ 9Router')
      const data = await res.json()
      if (data.models && data.models.length > 0) {
        setModelsList(data.models)
        setState(prev => ({
          ...prev,
          is_connected: true,
          available_models: data.models,
        }))
        onStatusChange?.(true)
        setMessage(`Đã tải thành công ${data.models.length} model từ 9Router!`)
        setMessageType('success')
      } else {
        setMessage('9Router chưa có model nào được bật. Vui lòng vào Dashboard cấu hình Provider/Model.')
        setMessageType('info')
      }
    } catch (err: any) {
      setMessage(err?.message || 'Lỗi khi tải danh sách model.')
      setMessageType('error')
    } finally {
      setFetchingModels(false)
    }
  }

  // Lưu cấu hình
  async function handleSave() {
    setLoading(true)
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/settings/chatgpt`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: state.endpoint || 'http://localhost:20128/v1',
          api_key: apiKey.trim() || (state.detected_local_secret && !state.has_api_key ? state.detected_local_secret : ''),
          default_model: model.trim() || 'cx/gpt-5.5',
        }),
      })
      if (!res.ok) throw new Error('Lưu cấu hình thất bại.')
      const updated: ChatGptState = await res.json()
      setState(updated)
      setApiKey('')
      onStatusChange?.(updated.is_connected)
      setMessage('Đã lưu cấu hình LLM Agent thành công!')
      setMessageType('success')
    } catch (err: any) {
      setMessage(err?.message || 'Lỗi khi lưu cấu hình.')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="tab-fade-in" style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* ── Main Clean Card ── */}
      <div
        className="settings-card"
        style={{
          background: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border-color, #e5e7eb)',
          borderRadius: 12,
          padding: '24px 28px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
        }}
      >
        {/* Header: Icon + Title + Subtitle */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 22 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6366f1',
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            <Bot size={22} />
          </div>

          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--text-primary, #111827)',
                lineHeight: 1.3,
              }}
            >
              LLM Agent (9router / GPT-5.5)
            </h3>
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 13,
                color: 'var(--text-secondary, #6b7280)',
                lineHeight: 1.4,
              }}
            >
              Chọn đoạn hay + sinh prompt storyboard + caption. Chạy qua 9router local (localhost:20128).
            </p>
          </div>
        </div>

        {/* Status indicator & Open Dashboard Button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 20,
            paddingBottom: 18,
            borderBottom: '1px solid var(--border-color, #f3f4f6)',
          }}
        >
          {/* Status badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: state.is_connected ? '#10b981' : '#10b981',
                display: 'inline-block',
                boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.2)',
              }}
            />
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: 'var(--text-primary, #1f2937)',
              }}
            >
              Sẵn sàng · {model || 'cx/gpt-5.5'}
            </span>
          </div>

          {/* Mở dashboard 9router Button */}
          <button
            type="button"
            className="btn btn-outline"
            disabled={openingDashboard}
            onClick={handleOpenDashboard}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 13,
              fontWeight: 500,
              padding: '7px 14px',
              borderRadius: 8,
              background: 'transparent',
              border: '1px solid var(--border-color, #d1d5db)',
              color: 'var(--text-primary, #374151)',
              cursor: openingDashboard ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {openingDashboard ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ExternalLink size={14} />
            )}
            <span>Mở dashboard 9router</span>
          </button>
        </div>

        {/* Message notification */}
        {message && (
          <div
            style={{
              padding: '9px 13px',
              borderRadius: 8,
              fontSize: 12.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 18,
              background:
                messageType === 'success'
                  ? 'rgba(16, 185, 129, 0.1)'
                  : messageType === 'error'
                  ? 'rgba(239, 68, 68, 0.1)'
                  : 'rgba(99, 102, 241, 0.1)',
              color:
                messageType === 'success'
                  ? '#059669'
                  : messageType === 'error'
                  ? '#dc2626'
                  : '#4f46e5',
              border: `1px solid ${
                messageType === 'success'
                  ? 'rgba(16, 185, 129, 0.25)'
                  : messageType === 'error'
                  ? 'rgba(239, 68, 68, 0.25)'
                  : 'rgba(99, 102, 241, 0.25)'
              }`,
            }}
          >
            {messageType === 'success' ? (
              <CheckCircle2 size={15} />
            ) : (
              <AlertCircle size={15} />
            )}
            <span>{message}</span>
          </div>
        )}

        {/* Field 1: API Key (tuỳ chọn) */}
        <div style={{ marginBottom: 18 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--text-primary, #374151)',
              marginBottom: 7,
            }}
          >
            API Key (tuỳ chọn)
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showApiKey ? 'text' : 'password'}
              className="form-control"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={state.api_key_masked || 'sk-...'}
              style={{
                width: '100%',
                padding: '9px 38px 9px 13px',
                borderRadius: 8,
                background: 'var(--input-bg, #ffffff)',
                border: '1px solid var(--input-border, #d1d5db)',
                color: 'var(--text-primary, #111827)',
                fontSize: 13.5,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
              }}
              title={showApiKey ? 'Ẩn API Key' : 'Hiện API Key'}
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Field 2: Model + Tải danh sách button */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 7,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--text-primary, #374151)',
                }}
              >
                Model {modelsList.length > 0 && `(${modelsList.length} model)`}
              </label>
              {modelsList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsCustomModel(!isCustomModel)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#6366f1',
                    fontSize: 11.5,
                    cursor: 'pointer',
                    padding: 0,
                    textDecoration: 'underline',
                  }}
                >
                  {isCustomModel ? 'Chọn từ danh sách' : 'Nhập tay tên khác'}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleFetchModels}
              disabled={fetchingModels}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary, #4b5563)',
                fontSize: 12.5,
                cursor: fetchingModels ? 'not-allowed' : 'pointer',
                padding: '2px 4px',
              }}
              title="Lấy danh sách các model đang kích hoạt trong 9Router"
            >
              <RefreshCw
                size={13}
                className={fetchingModels ? 'animate-spin' : ''}
              />
              <span>Tải danh sách</span>
            </button>
          </div>

          {modelsList.length > 0 && !isCustomModel ? (
            <select
              className="form-select"
              value={model}
              onChange={e => {
                if (e.target.value === '__custom__') {
                  setIsCustomModel(true)
                } else {
                  setModel(e.target.value)
                }
              }}
              style={{
                width: '100%',
                padding: '9px 13px',
                borderRadius: 8,
                background: 'var(--input-bg, #ffffff)',
                border: '1px solid var(--input-border, #d1d5db)',
                color: 'var(--text-primary, #111827)',
                fontSize: 13.5,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {!modelsList.includes(model) && model && (
                <option value={model}>{model} (Model hiện tại)</option>
              )}
              {Object.entries(groupModels(modelsList)).map(([groupName, groupItems]) => (
                <optgroup key={groupName} label={groupName}>
                  {groupItems.map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </optgroup>
              ))}
              <option value="__custom__">✏️ Nhập model tùy chỉnh khác...</option>
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="form-control"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="cx/gpt-5.5 hoặc model tùy ý"
                style={{
                  flex: 1,
                  padding: '9px 13px',
                  borderRadius: 8,
                  background: 'var(--input-bg, #ffffff)',
                  border: '1px solid var(--input-border, #d1d5db)',
                  color: 'var(--text-primary, #111827)',
                  fontSize: 13.5,
                  outline: 'none',
                }}
              />
              {modelsList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsCustomModel(false)}
                  style={{
                    padding: '8px 14px',
                    fontSize: 12.5,
                    borderRadius: 8,
                    background: 'transparent',
                    border: '1px solid var(--input-border, #d1d5db)',
                    color: 'var(--text-primary, #374151)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Danh sách ({modelsList.length})
                </button>
              )}
            </div>
          )}
        </div>

        {/* Submit Button: Lưu */}
        <div>
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={handleSave}
            style={{
              background: '#4f46e5',
              color: '#ffffff',
              border: 'none',
              borderRadius: 7,
              padding: '8px 24px',
              fontSize: 13.5,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              boxShadow: '0 1px 2px rgba(79, 70, 229, 0.25)',
              transition: 'all 0.15s ease',
            }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            <span>Lưu</span>
          </button>
        </div>
      </div>
    </div>
  )
}
