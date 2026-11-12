import { useState } from 'react'
import { X } from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { EditPanel } from './EditPanel'
import { ResultTabs } from './ResultTabs'
import { SourceLibrary } from './SourceLibrary'
import { useVideoWorkspace } from './useVideoWorkspace'
import type { DoneItem } from './videoModel'
import './VideoPage.css'

/** Trang Video: kho video nguồn · chỉnh sửa + xem trước · kết quả (hoàn tất / gộp / đã gộp).
 *  `embedded`: nhúng trong trang khác (vd Workflow Audio) nên ẩn tiêu đề trang.
 *  `onLibraryChanged`: gọi mỗi khi danh sách video nguồn được nạp lại (mở, nhập, xóa). */
export function VideoPage({ embedded = false, onLibraryChanged }: { embedded?: boolean; onLibraryChanged?: () => void } = {}) {
  const workspace = useVideoWorkspace(onLibraryChanged)
  const [activeDone, setActiveDone] = useState<DoneItem | null>(null)

  return (
    <div className="vp">
      {!embedded && (
        <header className="vp-head">
          <p className="overline">VIDEO WORKSPACE</p>
          <h1>Video</h1>
          <span>Nhập video, chuẩn hóa khung hình, gộp và lưu state cho workflow.</span>
        </header>
      )}

      <div className="vp-main">
        <SourceLibrary
          videos={workspace.videos}
          selected={workspace.selected}
          toggleSelected={workspace.toggleSelected}
          toggleAll={workspace.toggleAll}
          upload={workspace.upload}
          importYoutube={workspace.importYoutube}
          remove={workspace.remove}
          busy={workspace.busy}
          youtubeBusy={workspace.youtubeBusy}
        />
        <EditPanel
          options={workspace.options}
          setOption={workspace.setOption}
          setBlur={workspace.setBlur}
          uploadBackground={workspace.uploadBackground}
          chooseFolder={workspace.chooseFolder}
          outputFolder={workspace.outputFolder}
          process={workspace.process}
          progress={workspace.progress}
          savedStates={workspace.savedStates}
          savePreset={workspace.savePreset}
          applyPreset={workspace.applyPreset}
          selected={workspace.selected}
          videos={workspace.videos}
          busy={workspace.busy}
          youtubeBusy={workspace.youtubeBusy}
          message={workspace.message}
        />
      </div>

      <ResultTabs
        done={workspace.done}
        merged={workspace.merged}
        runMerge={workspace.runMerge}
        mergeBusy={workspace.mergeBusy}
        mergeMessage={workspace.mergeMessage}
        mergeResult={workspace.mergeResult}
        onOpenDone={setActiveDone}
      />

      {activeDone && (
        <div className="video-modal-backdrop" onClick={() => setActiveDone(null)}>
          <div className="video-modal" onClick={event => event.stopPropagation()}>
            <div className="video-modal-head">
              <strong>{activeDone.name}</strong>
              <button type="button" className="icon-button" onClick={() => setActiveDone(null)} aria-label="Đóng"><X size={18} /></button>
            </div>
            <video controls autoPlay src={`${API_URL}/api/video/done/${activeDone.done_id}/file`} />
            <a className="primary-button modal-download" href={`${API_URL}/api/video/done/${activeDone.done_id}/file`} download={activeDone.name}>Tải lại video</a>
          </div>
        </div>
      )}
    </div>
  )
}
