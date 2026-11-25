import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Folder, FolderOpen, HardDrive, Loader2, Plus, RefreshCw, Search } from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import * as api from '../services/publisherApi'
import type { DriveFolder, PublishableVideo } from '../types'
import { driveToPublishable } from '../videoModel'
import type { TargetChannelRef } from '../scheduleChecks'
import { DriveFolderModal } from './DriveFolderModal'
import { FilterPills, SelectionBar, VideoRow, isPostedToAny, type PostedFilter } from './VideoRows'

const LAST_FOLDER_KEY = 'pippit_drive_last_folder'

function readLastFolder(): { id: string; name: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_FOLDER_KEY) || 'null')
    return v?.id ? v : null
  } catch {
    return null
  }
}

interface Props {
  selectedUids: Set<string>
  targets: TargetChannelRef[]
  refreshKey: number
  onToggle: (video: PublishableVideo) => void
  onSetMany: (videos: PublishableVideo[], on: boolean) => void
  onRegister: (videos: PublishableVideo[]) => void
}

export function DriveSourcePanel({ selectedUids, targets, refreshKey, onToggle, onSetMany, onRegister }: Props) {
  const [status, setStatus] = useState<any>(null)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(readLastFolder)
  const [videos, setVideos] = useState<PublishableVideo[]>([])
  const [childFolders, setChildFolders] = useState<DriveFolder[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedVideos, setExpandedVideos] = useState<Record<string, PublishableVideo[]>>({})
  const [loadingExpanded, setLoadingExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [postedFilter, setPostedFilter] = useState<PostedFilter>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [savingWorkflow, setSavingWorkflow] = useState(false)
  const [workflowName, setWorkflowName] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.fetchDriveStatus().then(
      s => {
        if (!alive) return
        setStatus(s)
        setStatusLoaded(true)
        setFolder(cur => cur || (s?.folder_id ? { id: s.folder_id, name: s.folder_name || 'Thư mục mặc định' } : null))
      },
      () => alive && setStatusLoaded(true),
    )
    return () => {
      alive = false
    }
  }, [])

  const load = useCallback(async (folderId: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await api.fetchDriveVideos(folderId)
      const mapped = (res.videos || []).map(driveToPublishable)
      setVideos(mapped)
      setChildFolders(res.folders || [])
      setExpandedId(null)
      setExpandedVideos({})
      onRegister(mapped)
      if (res.folder_name) setFolder(cur => (cur && cur.id === folderId ? { ...cur, name: res.folder_name } : cur))
    } catch (err: any) {
      setError(err?.message || 'Không thể tải danh sách video từ Google Drive')
    } finally {
      setLoading(false)
    }
  }, [onRegister])

  useEffect(() => {
    if (folder?.id && status?.connected !== false) void load(folder.id)
  }, [folder?.id, refreshKey, status?.connected, load])

  const pickFolder = (f: { id: string; name: string }) => {
    setModalOpen(false)
    setFolder(f)
    try { localStorage.setItem(LAST_FOLDER_KEY, JSON.stringify(f)) } catch { /* bộ nhớ đầy: bỏ qua */ }
  }

  const openChild = async (child: DriveFolder) => {
    if (expandedId === child.id) return setExpandedId(null)
    setExpandedId(child.id)
    if (expandedVideos[child.id]) return
    setLoadingExpanded(true)
    try {
      const res = await api.fetchDriveVideos(child.id)
      const mapped = (res.videos || []).map(driveToPublishable)
      onRegister(mapped)
      setExpandedVideos(cur => ({ ...cur, [child.id]: mapped }))
    } catch (err: any) {
      setError(err?.message || 'Không thể tải video trong folder con.')
      setExpandedId(null)
    } finally {
      setLoadingExpanded(false)
    }
  }

  const saveWorkflow = async () => {
    const workflow = (workflowName || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '')
    if (!workflow || !folder) return
    setSavingWorkflow(true)
    setError('')
    try {
      const r = await fetch(`${API_URL}/api/gdrive/workflow-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow, folder_id: folder.id, folder_name: folder.name }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Không thể lưu folder workflow.')
      setStatus(data)
      setWorkflowName(null)
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu folder workflow.')
    } finally {
      setSavingWorkflow(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return videos.filter(v => {
      if (q && !v.file_name.toLowerCase().includes(q) && !v.title.toLowerCase().includes(q)) return false
      return postedFilter === 'unposted' ? !isPostedToAny(v, targets) : true
    })
  }, [videos, search, postedFilter, targets])

  const selectedInList = filtered.filter(v => selectedUids.has(v.uid)).length
  const unposted = videos.filter(v => v.published_channels.length === 0).length

  if (statusLoaded && status && status.connected === false) {
    return (
      <div className="pub-empty-box">
        <HardDrive size={28} />
        <p>Google Drive chưa kết nối. Kết nối ở Cài đặt để dùng nguồn này — các tab khác vẫn dùng bình thường.</p>
      </div>
    )
  }

  const workflowFolders = Object.entries(status?.workflow_folders || {}).filter(([, f]: [string, any]) => f?.folder_id) as [string, any][]

  return (
    <>
      <div className="pub-curr-folder-card">
        <div className="pub-curr-folder-icon"><FolderOpen size={22} /></div>
        <div className="pub-curr-folder-info">
          <div className="pub-curr-folder-top">
            <strong className="pub-curr-folder-name">{folder?.name || 'Chưa chọn thư mục'}</strong>
            <span className="pub-curr-folder-count">{videos.length} video</span>
          </div>
          <span className="pub-curr-folder-sub">ID: {folder?.id ? `${folder.id.slice(0, 16)}...` : '—'}</span>
        </div>
        <button type="button" className="chrome-button pub-btn-refresh" onClick={() => folder && load(folder.id)} disabled={loading || !folder} title="Quét lại từ Google Drive">
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
        </button>
        <button type="button" className="chrome-button pub-btn-change-folder" onClick={() => setModalOpen(true)}>
          <Folder size={13} /> Đổi thư mục
        </button>
      </div>

      <div className="pub-quick-workflow-folders">
        <span className="pub-quick-workflow-label">Thư mục nhanh:</span>
        {status?.folder_id && (
          <button type="button" className={`pub-quick-workflow-btn ${folder?.id === status.folder_id ? 'active' : ''}`} onClick={() => pickFolder({ id: status.folder_id, name: status.folder_name || 'Thư mục mặc định' })}>
            <Folder size={13} /> Mặc định
          </button>
        )}
        {workflowFolders.map(([name, f]) => (
          <button key={name} type="button" className={`pub-quick-workflow-btn ${folder?.id === f.folder_id ? 'active' : ''}`} onClick={() => pickFolder({ id: f.folder_id, name: f.folder_name || name })} title={f.folder_name}>
            <Folder size={13} /> {name.replace(/_/g, ' ')}
          </button>
        ))}
        {workflowName === null ? (
          <button type="button" className="pub-quick-workflow-btn pub-quick-workflow-add" onClick={() => setWorkflowName('')} disabled={!folder} title="Lưu thư mục đang mở thành lối tắt">
            <Plus size={13} /> Lưu thư mục này
          </button>
        ) : (
          <span className="pub2-inline-form">
            <input value={workflowName} onChange={e => setWorkflowName(e.target.value)} placeholder="Tên lối tắt (VD: thoitrang)" disabled={savingWorkflow} onKeyDown={e => { if (e.key === 'Enter') void saveWorkflow() }} />
            <button type="button" className="pub2-mini-btn" onClick={saveWorkflow} disabled={savingWorkflow || !workflowName.trim()}>
              {savingWorkflow ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Lưu
            </button>
            <button type="button" className="pub2-mini-btn" onClick={() => setWorkflowName(null)}>Hủy</button>
          </span>
        )}
      </div>

      {error && <div className="pub2-inline-error">{error}</div>}

      <div className="pub-search-box">
        <Search size={14} className="pub-search-icon" />
        <input type="text" placeholder="Lọc tên video trong thư mục này..." value={search} onChange={e => setSearch(e.target.value)} className="pub-search-input" />
      </div>
      <FilterPills
        value={postedFilter}
        onChange={setPostedFilter}
        options={[{ id: 'all', label: `Tất cả (${videos.length})` }, { id: 'unposted', label: `🆕 Chưa đăng (${unposted})` }]}
      />
      <SelectionBar
        total={filtered.length}
        selectedInList={selectedInList}
        selectedTotal={selectedUids.size}
        onToggleAll={() => onSetMany(filtered, selectedInList !== filtered.length)}
        onSelectUnposted={() => onSetMany(filtered.filter(v => !isPostedToAny(v, targets)), true)}
      />

      <div className="pub-video-list">
        {loading ? (
          <div className="pub-empty-box"><Loader2 size={24} className="spin" /><p>Đang tải video từ Google Drive...</p></div>
        ) : filtered.length === 0 && childFolders.length === 0 ? (
          <div className="pub-empty-box"><p>Không tìm thấy file video nào phù hợp với bộ lọc.</p></div>
        ) : (
          <>
            {childFolders.map(child => {
              const open = expandedId === child.id
              const list = expandedVideos[child.id] || []
              return (
                <div key={child.id}>
                  <div className={`pub-drive-folder-card ${open ? 'pub-drive-folder-card-expanded' : ''}`} onClick={() => void openChild(child)}>
                    <div className="pub-drive-folder-card-icon"><FolderOpen size={22} /></div>
                    <div className="pub-drive-folder-card-info">
                      <strong>{child.name}</strong>
                      <span>{open ? `${list.length} video · Bấm để thu gọn` : 'Folder con · Bấm để xổ video'}</span>
                    </div>
                    {loadingExpanded && open ? <Loader2 size={17} className="spin pub-drive-folder-card-arrow" /> : <ChevronRight size={17} className="pub-drive-folder-card-arrow" />}
                  </div>
                  {open && list.map(v => <VideoRow key={v.uid} video={v} selected={selectedUids.has(v.uid)} targets={targets} onToggle={() => onToggle(v)} />)}
                  {open && !loadingExpanded && list.length === 0 && <div className="pub-drive-folder-empty">Folder này chưa có video trực tiếp.</div>}
                </div>
              )
            })}
            {filtered.map(v => <VideoRow key={v.uid} video={v} selected={selectedUids.has(v.uid)} targets={targets} onToggle={() => onToggle(v)} />)}
          </>
        )}
      </div>

      <DriveFolderModal open={modalOpen} onClose={() => setModalOpen(false)} onPick={pickFolder} />
    </>
  )
}
