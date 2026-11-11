import { BLOCK_PHASE, IMPLEMENTED_STEPS, describeElement, describeGate } from '../services/campaignView.ts'
import type { BlockView } from '../types.ts'
import { Badge } from './Common.tsx'

const LANE_LABEL: Record<string, string> = {
  llm: 'LLM', 'chatgpt-image': 'Ảnh ChatGPT', flow: 'Video Flow (tốn credit)', local: 'Cục bộ',
}

/** Khối chưa có giao diện riêng: nói rõ khối sẽ làm gì và hiện việc đó đang được làm ở đâu. */
export function PendingBlock({ block, onGo }: { block: BlockView; onGo: (block: number) => void }) {
  const pending = block.steps.filter(s => !IMPLEMENTED_STEPS.has(s.key))
  return (
    <section className="cp-card cp-pending" data-testid={`pending-${block.block}`}>
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>{block.title}</h3>
          <span className="cp-head-sub">Khối này chưa có phần chạy tự động ({BLOCK_PHASE[block.block] ?? 'giai đoạn sau'}).</span>
        </div>
        <Badge badge={{ label: 'Sắp có', tone: 'muted' }} />
      </header>
      {pending.length > 0 && (
        <ul className="cp-checklist">
          {pending.map(s => <li key={s.key}><span className="cp-dot" /> <span>{s.title}{s.paid ? ' (tốn credit)' : ''}</span></li>)}
        </ul>
      )}
      <p className="cp-note">Trong lúc chờ, bạn tự kiểm tra bằng cách xem và duyệt từng clip ở khối 6. Video chỉ được ghép từ clip đã duyệt.</p>
      <div className="cp-row">
        <button type="button" className="btn-g cp-small" onClick={() => onGo(6)}>Sang khối 6 (Clip)</button>
        <button type="button" className="btn-p cp-small" onClick={() => onGo(8)}>Sang khối 8 (Ghép & Xuất)</button>
      </div>
    </section>
  )
}

/** Danh sách bước của một khối + trạng thái; bước chưa có thực thi ghi rõ giai đoạn dự kiến. */
export function StepList({ block }: { block: BlockView }) {
  return (
    <section className="cp-card">
      <header className="cp-card-head">
        <h3>Các bước trong khối “{block.title}”</h3>
      </header>
      <table className="cp-table">
        <thead>
          <tr><th>Bước</th><th>Loại</th><th>Trạng thái</th><th /></tr>
        </thead>
        <tbody>
          {block.steps.map(step => {
            const implemented = IMPLEMENTED_STEPS.has(step.key)
            return (
              <tr key={step.key}>
                <td>{step.title}{step.gate && ' ✋'}{step.paid && ' 💳'}</td>
                <td>{step.kind === 'compute' ? (LANE_LABEL[step.lane] ?? step.lane) : step.kind === 'input_files' ? 'Ảnh đầu vào' : 'Tham số'}</td>
                <td>
                  {implemented
                    ? step.elements.map(el => (
                        <span key={el.element_key} className="cp-inline">
                          <Badge badge={describeElement(el)} />
                          {(() => { const g = describeGate(el.gate); return g ? <Badge badge={g} /> : null })()}
                        </span>
                      ))
                    : <Badge badge={{ label: `Sắp có (${BLOCK_PHASE[block.block] ?? ''})`, tone: 'muted' }} />}
                </td>
                <td className="cp-muted">{step.elements.length > 1 ? `${step.elements.length} phần tử` : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="cp-note">✋ có cổng duyệt · 💳 tốn credit Flow. Bước “Sắp có” đã nằm trong engine nhưng chưa có thực thi; mỗi giai đoạn sẽ mở thêm giao diện cho khối tương ứng.</p>
    </section>
  )
}
