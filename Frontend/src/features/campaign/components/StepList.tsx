import { IMPLEMENTED_STEPS, describeElement, describeGate, elementLabel } from '../services/campaignView.ts'
import type { BlockView } from '../types.ts'
import { Badge } from './Common.tsx'

const LANE_LABEL: Record<string, string> = {
  llm: 'LLM', 'chatgpt-image': 'Ảnh ChatGPT', flow: 'Video Flow (tốn credit)', local: 'Cục bộ',
}

/** Danh sách bước của một khối + trạng thái từng phần tử (shot/cảnh). */
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
                          {el.element_key && <small className="cp-muted">{elementLabel(el.element_key)}</small>}
                          <Badge badge={describeElement(el)} />
                          {(() => { const g = describeGate(el.gate); return g ? <Badge badge={g} /> : null })()}
                        </span>
                      ))
                    : <Badge badge={{ label: 'Không có trong giao diện này', tone: 'muted' }} />}
                </td>
                <td className="cp-muted">{step.elements.length > 1 ? `${step.elements.length} phần tử` : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="cp-note">✋ có cổng duyệt · 💳 tốn credit Flow. Trạng thái tính từ đầu vào hiện tại; “Cũ” không xóa kết quả, chỉ gợi ý tạo lại.</p>
    </section>
  )
}
