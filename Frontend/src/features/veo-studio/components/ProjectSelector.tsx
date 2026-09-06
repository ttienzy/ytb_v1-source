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
    <div className="veo-project-bar">
      <div className="veo-project-bar-left">
        <div className="veo-project-icon-wrap">
          <FolderKanban size={18} className="veo-project-icon" />
        </div>
        <div className="veo-project-info">
          <div className="veo-project-label-row">
            <span className="veo-project-title">PROJECT LÀM VIỆC</span>
            {activeProject ? (
              <span className="veo-project-badge active" title={`Flow Project ID: ${activeProject.flow_project_id}`}>
                <CheckCircle2 size={12} />
                Đã chọn: {activeProject.name}
              </span>
            ) : (
              <span className="veo-project-badge warning">
                <AlertTriangle size={12} />
                Chưa chọn Project
              </span>
            )}
          </div>

          <div className="veo-project-select-row">
            {projects.length > 0 ? (
              <select
                className="veo-project-select"
                value={activeProject?.id || ''}
                onChange={(e) => {
                  if (e.target.value) onSelectProject(e.target.value)
                }}
                disabled={creating}
              >
                <option value="" disabled>
                  -- Chọn Project --
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.video_count || 0} clips) - Flow: {p.flow_project_id.slice(0, 8)}...
                  </option>
                ))}
              </select>
            ) : (
              <span className="veo-project-empty-text">
                Chưa có Project nào trong database. Hãy bấm nút tạo mới bên phải!
              </span>
            )}

            {activeProject && (
              <a
                href={`https://flow.google.com/u/1/project/${activeProject.flow_project_id}`}
                target="_blank"
                rel="noreferrer"
                className="veo-project-flow-link"
                title="Mở tab dự án này trên Google Flow"
              >
                <ExternalLink size={13} />
                <span>Mở trên Flow</span>
              </a>
            )}

            {activeProject && (
              <button
                className="veo-project-delete-btn"
                title="Xóa project này khỏi Database"
                onClick={() => {
                  if (confirm(`Bạn có chắc muốn xóa project '${activeProject.name}'?`)) {
                    onDeleteProject(activeProject.id)
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="veo-project-bar-right">
        <button
          className="veo-btn-create-project"
          onClick={handleOpenModal}
          disabled={creating}
        >
          {creating ? (
            <>
              <Loader2 size={15} className="spinning" />
              <span>Đang tạo trên Flow...</span>
            </>
          ) : (
            <>
              <Plus size={15} />
              <span>Tạo Project Mới</span>
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

            {errorMsg && <div className="veo-modal-error">⚠️ {errorMsg}</div>}

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
