import { useState } from 'react'
import { FolderKanban, Plus, Trash2, CheckCircle2, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react'
import type { VeoProject } from '../types'

interface Props {
  projects: VeoProject[]
  activeProject: VeoProject | null
  onSelectProject: (projectId: string) => Promise<void>
  onCreateProject: (name: string) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
  creating: boolean
}

export function ProjectSelector({
  projects,
  activeProject,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  creating,
}: Props) {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const handleOpenModal = () => {
    const now = new Date()
    const defaultName = `Dự án ${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
    setNewProjectName(defaultName)
    setErrorMsg('')
    setShowCreateModal(true)
  }

  const handleConfirmCreate = async () => {
    if (!newProjectName.trim()) return
    setErrorMsg('')
    try {
      await onCreateProject(newProjectName.trim())
      setShowCreateModal(false)
    } catch (err: any) {
      setErrorMsg(err.message || 'Không thể tạo project')
    }
  }

  return (
    <div className="veo-project-toolbar">
      <div className="veo-project-controls">
        <div className="veo-project-select-wrap">
          <FolderKanban size={14} className="veo-project-icon" />
          {projects.length > 0 ? (
            <select
              className="veo-project-select-compact"
              value={activeProject?.id || ''}
              onChange={(e) => {
                if (e.target.value) onSelectProject(e.target.value)
              }}
              disabled={creating}
              title="Chọn Project Workspace"
            >
              <option value="" disabled>
                -- Chọn Project --
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.video_count || 0} clips)
                </option>
              ))}
            </select>
          ) : (
            <span className="veo-project-empty-tag">Chưa có Project</span>
          )}
        </div>

        {activeProject && (
          <a
            href={`https://flow.google.com/u/1/project/${activeProject.flow_project_id}`}
            target="_blank"
            rel="noreferrer"
            className="veo-icon-btn"
            title="Mở dự án trên Google Flow"
          >
            <ExternalLink size={13} />
          </a>
        )}

        {activeProject && (
          <button
            type="button"
            className="veo-icon-btn danger"
            title="Xóa project khỏi Database"
            onClick={() => {
              if (confirm(`Bạn có chắc muốn xóa project '${activeProject.name}'?`)) {
                onDeleteProject(activeProject.id)
              }
            }}
          >
            <Trash2 size={13} />
          </button>
        )}

        <button
          type="button"
          className="veo-new-project-btn"
          onClick={handleOpenModal}
          disabled={creating}
          title="Tạo Project mới"
        >
          {creating ? (
            <>
              <Loader2 size={13} className="spin" />
              <span>Đang tạo...</span>
            </>
          ) : (
            <>
              <Plus size={13} />
              <span>Tạo Project</span>
            </>
          )}
        </button>
      </div>

      {/* Modal Tạo Project */}
      {showCreateModal && (
        <div className="veo-modal-overlay" onClick={() => !creating && setShowCreateModal(false)}>
          <div className="veo-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Khởi tạo Project mới cho Veo Studio</h3>
            <p className="veo-modal-desc">
              Extension sẽ tự động điều phối tab Google Flow để tạo mới một không gian làm việc (Workspace Project)
              và lưu thông tin vào Database máy tính của bạn.
            </p>

            <div className="veo-modal-field">
              <label>Tên hiển thị Project</label>
              <input
                type="text"
                className="veo-input"
                placeholder="Ví dụ: Chiến binh Cyberpunk, Truyện kiếm hiệp tập 1..."
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                disabled={creating}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmCreate()
                }}
              />
            </div>

            {errorMsg && <div className="veo-modal-error">{errorMsg}</div>}

            <div className="veo-modal-actions">
              <button
                className="veo-btn-secondary"
                onClick={() => setShowCreateModal(false)}
                disabled={creating}
              >
                Hủy
              </button>
              <button
                className="veo-btn-primary"
                onClick={handleConfirmCreate}
                disabled={creating || !newProjectName.trim()}
              >
                {creating ? (
                  <>
                    <Loader2 size={14} className="spinning" />
                    Đang tạo Project trên Google Flow...
                  </>
                ) : (
                  'Xác nhận Tạo Project'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
