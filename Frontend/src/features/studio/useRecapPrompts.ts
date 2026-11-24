import { useEffect, useState } from 'react'
import { API_URL } from '../../shared/constants'

export interface RecapPrompts { script: string; caption: string }

async function readResponse(response: Response) {
  const data = await response.json()
  if (!response.ok) {
    const detail = data.detail
    throw new Error(Array.isArray(detail) ? detail.map(e => e.msg).join('; ') : detail || `Lỗi ${response.status}`)
  }
  return data
}

export function useRecapPrompts() {
  const [value, setValue] = useState<RecapPrompts | null>(null)
  const [originals, setOriginals] = useState<RecapPrompts | null>(null)
  const [saved, setSaved] = useState<RecapPrompts | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetch(`${API_URL}/api/recap/prompts`, { signal: controller.signal })
      .then(readResponse)
      .then(data => { setValue(data.current); setSaved(data.current); setOriginals(data.originals) })
      .catch(e => { if (!controller.signal.aborted) setError(`Không tải được prompt: ${e.message}`) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reload])

  let validation = ''
  if (value && originals) {
    for (const key of ['script', 'caption'] as const) {
      if (!value[key].trim()) { validation = 'Điền đầy đủ cả hai prompt trước khi chạy.'; break }
      if (value[key].length > 60000) { validation = 'Mỗi prompt tối đa 60.000 ký tự.'; break }
      const required = [...originals[key].matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1])
      const supplied = [...value[key].matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1])
      const missing = [...new Set(required)].filter(v => !supplied.includes(v))
      if (missing.length) { validation = `Giữ nguyên các biến bắt buộc: ${missing.map(v => `{{${v}}}`).join(', ')}`; break }
      const unknown = supplied.filter(v => !required.includes(v))
      if (unknown.length) { validation = `Biến không được hỗ trợ: ${unknown.join(', ')}`; break }
      const fields = key === 'script' ? ['scenes', 'segments', 'start_time_sec', 'end_time_sec', 'duration_sec', 'vietnamese_vo', 'chunk_summary_for_next'] : ['title', 'description', 'hashtags']
      const missingFields = fields.filter(field => !value[key].includes(`"${field}"`))
      if (missingFields.length) { validation = `Giữ các trường JSON: ${missingFields.join(', ')}`; break }
    }
  }

  async function save() {
    if (!value || validation) return
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await readResponse(await fetch(`${API_URL}/api/recap/prompts`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
      }))
      setSaved(result)
      setNotice('Đã lưu mặc định cho những lần tạo tiếp theo.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Không lưu được prompt.') }
    finally { setSaving(false) }
  }

  return {
    value, originals, saved, loading, saving, error, notice, validation,
    ready: Boolean(value && !loading && !validation),
    change: (key: keyof RecapPrompts, text: string) => { setValue(v => v ? { ...v, [key]: text } : v); setError(''); setNotice('') },
    reset: (key: keyof RecapPrompts) => { if (originals) { setValue(v => v ? { ...v, [key]: originals[key] } : v); setError(''); setNotice('Đã khôi phục prompt gốc cho lượt tiếp theo. Lưu mặc định để dùng lại.') } },
    retry: () => setReload(n => n + 1), save,
  }
}
