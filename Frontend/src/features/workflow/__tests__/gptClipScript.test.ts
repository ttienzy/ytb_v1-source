import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_MUSE_CANVAS_CONFIG } from '../services/museCanvasConfig.ts'
import {
  CLIP_SCRIPT_MAX_REFS,
  MUSE_NODE,
  buildClipScriptContext,
  buildClipScriptRequest,
  checkClipBeats,
  clipCredits720p,
  clipsCredits,
  createClipScriptNode,
  createOutputNode,
  explainMuseConnection,
  interruptClipScript,
  isValidMuseConnection,
  normalizeClipScriptData,
  parseClipScript,
  scriptRefsFromSources,
  scriptState,
} from '../services/museCanvasNodes.ts'

const ref = (p: string) => ({ id: p, name: p, path: p, previewUrl: '/x?file=' + p, size: 1 })
const board = (id: string, label: string, img = `D:/${id}.png`) =>
  createOutputNode({ x: 0, y: 0 }, ref(img), { jobNodeId: 'sheet', jobType: MUSE_NODE.characterSheet, sourceNodeId: id, rowLabel: label }, '', id)

const SAMPLE = `**Tổng quan:** 2 clip, tổng 17s.
**IDENTITY LOCK:** A young woman...
**Kế hoạch chuyển cảnh:**
| Mối nối | Kiểu |
|---|---|
| 1→2 | WALK-THROUGH |

=== SCRIPT 1/2 — REF #1 — Áo blouse xanh + chân váy — 8s ===
**Outfit:** blouse **Signature detail:** puff sleeves **Vì sao 8s:** hook + xoay
**Timeline:**
| Thời gian | Hành động |
|---|---|
| 0–1.5s | IN |
**VIDEO PROMPT:**
\`\`\`
Vertical 9:16 fashion video, ONE continuous single shot, exactly 8 seconds. [0.0–1.5s] She walks in from frame left. [1.5–6.5s] She twirls 360°. [6.5–8.0s] She walks out of frame right; the empty studio remains.
\`\`\`
=== END SCRIPT 1 ===

=== SCRIPT 2/2 — REF #2 — Tee trắng + quần short đen — 9s ===
**VIDEO PROMPT:**
\`\`\`
Vertical 9:16 fashion video, exactly 9 seconds. [0–1s] Empty studio. [1–5s] She tugs the tee hem. [5–8s] Hero pose.
\`\`\`
=== END SCRIPT 2 ===

**Ghép video:**
1. Generate each clip separately.`

test('clip script: tách bài theo dòng === SCRIPT k/N, lấy tên, số giây, prompt và mốc thời gian', () => {
  const p = parseClipScript(SAMPLE, 2)
  assert.deepEqual(p.warnings, [])
  assert.equal(p.clips.length, 2)
  assert.match(p.intro, /^\*\*Tổng quan/)
  assert.match(p.outro, /^\*\*Ghép video/)
  const [c1, c2] = p.clips
  assert.deepEqual([c1.k, c1.n, c1.ref, c1.name, c1.seconds], [1, 2, 1, 'Áo blouse xanh + chân váy', 8])
  assert.match(c1.videoPrompt, /^Vertical 9:16/)
  assert.deepEqual(c1.beats, [{ from: 0, to: 1.5 }, { from: 1.5, to: 6.5 }, { from: 6.5, to: 8 }])
  assert.deepEqual(c1.warnings, [])
  assert.match(c1.body, /Signature detail/)
  // clip 2: mốc cuối 8s nhưng clip 9s
  assert.equal(c2.seconds, 9)
  assert.deepEqual(c2.warnings, ['Mốc cuối 8s khác độ dài clip 9s.'])
  assert.equal(p.totalSeconds, 17)
  // tổng = cộng giá từng clip (8 s = 24, 9 s = 27), không coi 17 s là một clip
  assert.equal(clipsCredits(p.clips.map((c) => c.seconds)), 51)
  assert.equal(clipCredits720p(8), 24)
})

test('clip script: cảnh báo sai số clip, quá 15s, mốc hở/chồng, thiếu prompt', () => {
  const p = parseClipScript(SAMPLE, 3)
  assert.deepEqual(p.warnings, ['ChatGPT viết 2 kịch bản, cần 3 (1 kịch bản / ảnh tham chiếu).'])
  const long = parseClipScript('=== SCRIPT 1/1 — REF #2 — Váy — 18s ===\nkhông có prompt\n=== END SCRIPT 1 ===', 1)
  assert.deepEqual(long.clips[0].warnings, ['Dài 18s — Omni 1.2 tối đa 15s.', 'Tiêu đề ghi REF #2 nhưng là clip 1.', 'Không tìm thấy VIDEO PROMPT.'])
  assert.deepEqual(parseClipScript('chỉ có chữ', 2).warnings, ['Không tách được kịch bản nào theo dòng “=== SCRIPT k/N … ===” — xem bài đầy đủ.'])
  assert.deepEqual(checkClipBeats([{ from: 0.5, to: 2 }, { from: 2.5, to: 4 }, { from: 3.5, to: 6 }], 6), [
    'Mốc đầu bắt đầu ở 0.5s, không phải 0s.',
    'Mốc 2s → 2.5s bị hở.',
    'Mốc 4s → 3.5s bị chồng.',
  ])
  // tiêu đề có in đậm / dấu gạch thường, prompt không có khối ```
  const loose = parseClipScript('**=== SCRIPT 1/1 - REF #1 - Đầm đỏ - 10 s ===**\n**VIDEO PROMPT:** [0-4s] a. [4-10s] b.\n=== END SCRIPT 1 ===', 1)
  assert.deepEqual([loose.clips[0].name, loose.clips[0].seconds, loose.clips[0].beats.length, loose.clips[0].warnings], ['Đầm đỏ', 10, 2, []])
})

test('clip script: request gửi prompt + đoạn danh sách #k, N bắt buộc, ghi chú; không mang tham số Muse', () => {
  const refs = scriptRefsFromSources([board('b1', 'Nhân vật 1 × Trang phục 1'), board('b2', 'Nhân vật 1 × Trang phục 2')])
  const body = buildClipScriptRequest(DEFAULT_MUSE_CANVAS_CONFIG, '  PROMPT  ', refs, 'chỉ 6/8/10s')
  assert.deepEqual(Object.keys(body).sort(), ['chat_title', 'file_prefix', 'prompt', 'reference_images'])
  assert.deepEqual(body.reference_images, ['D:/b1.png', 'D:/b2.png'])
  assert.equal(body.chat_title, 'Muse Canvas · Kịch bản clip · 2 ảnh')
  const ctx = buildClipScriptContext(refs, '')
  assert.match(String(body.prompt), /^PROMPT\n\n## Reference images/)
  assert.match(String(body.prompt), /## User note\nchỉ 6\/8\/10s/)
  assert.match(ctx, /- #1: character design board .* — "Nhân vật 1 × Trang phục 1"\./)
  assert.match(ctx, /N = 2\. Write exactly 2 scripts \(=== SCRIPT 1\/2 … === SCRIPT 2\/2\)/)
  assert.match(ctx, /## User note\n\(none\)/)
  const many = Array.from({ length: CLIP_SCRIPT_MAX_REFS + 1 }, (_, i) => board(`x${i}`, `B${i}`))
  const manyRefs = scriptRefsFromSources(many)
  assert.throws(() => buildClipScriptRequest(DEFAULT_MUSE_CANVAS_CONFIG, 'p', manyRefs), /Tối đa 10 ảnh/)
  assert.equal(scriptState(manyRefs, null, CLIP_SCRIPT_MAX_REFS), 'too_many')
  assert.equal(scriptState(manyRefs, null), 'pending') // node Muse vẫn giới hạn 16 như cũ
})

test('clip script: node mới, dữ liệu cũ, dây nối và gián đoạn', () => {
  const n = createClipScriptNode({ x: 0, y: 0 }, 'P', 'cs')
  assert.equal(n.type, 'gptClipScript')
  assert.equal(normalizeClipScriptData(n.data).title, 'Kịch bản tạo video')
  assert.equal(normalizeClipScriptData({}).prompt, '')
  const b = board('b1', 'Bảng 1')
  const c = (source: string, target: string, targetHandle = 'boards') => ({ source, target, sourceHandle: 'image', targetHandle })
  assert.equal(isValidMuseConnection(c('b1', 'cs'), [b, n]), true)
  assert.equal(isValidMuseConnection(c('b1', 'cs', 'images'), [b, n]), false)
  assert.equal(isValidMuseConnection({ source: 'cs', target: 'b1', sourceHandle: 'script', targetHandle: 'image' }, [b, n]), false)
  assert.match(explainMuseConnection('cs', 'source', 'b1', [b, n], []), /chỉ nối ra node Clip/)
  const fixed = interruptClipScript({ inputPath: 'a', status: 'running', updatedAt: 1 }, 2)!
  assert.equal(fixed.status, 'interrupted')
  assert.match(fixed.error || '', /ChatGPT/)
  assert.equal(interruptClipScript({ inputPath: 'a', status: 'done', updatedAt: 1 }), null)
})

// ---------------------------------------------------------------- tách clip ra node "Clip"

import { checkClipPrompt, newerClipFor, normalizeClipPromptData, planClipPromptNodes } from '../services/museCanvasNodes.ts'

function writtenScript(updatedAt = 100, text = SAMPLE) {
  const node = createClipScriptNode({ x: 0, y: 0 }, 'P', 'cs')
  ;(node.data as any).result = { inputPath: 'D:/b1.png|D:/b2.png', status: 'done', text, updatedAt }
  return node
}

test('clip node: "Tất cả ra node" tạo 1 node Clip / clip, nối cổng clips → clip, gắn đúng ảnh #k', () => {
  const script = writtenScript()
  const refs = scriptRefsFromSources([board('b1', 'Bảng 1'), board('b2', 'Bảng 2', 'D:/khac.png')])
  const plan = planClipPromptNodes(script, refs, [script])
  assert.equal(plan.nodes.length, 2)
  const d1 = normalizeClipPromptData(plan.nodes[0].data)
  assert.deepEqual([d1.title, d1.name, d1.seconds, d1.k, d1.origin], ['Clip 1/2', 'Áo blouse xanh + chân váy', 8, 1, { clipScriptNodeId: 'cs', updatedAt: 100, k: 1 }])
  assert.match(d1.prompt, /exactly 8 seconds/)
  assert.equal(d1.prompt, d1.originalPrompt)
  assert.equal(d1.image?.path, 'D:/b1.png')
  // ảnh #2 hiện tại khác ảnh lúc viết -> không gắn nhầm ảnh
  assert.equal(normalizeClipPromptData(plan.nodes[1].data).image, null)
  assert.deepEqual([plan.edges[0].source, plan.edges[0].sourceHandle, plan.edges[0].targetHandle], ['cs', 'clips', 'clip'])
  // đã có node clip 1 -> chỉ tạo clip 2; only = 1 -> không tạo gì nữa
  const again = planClipPromptNodes(script, refs, [script, plan.nodes[0]])
  assert.deepEqual(again.nodes.map((n) => normalizeClipPromptData(n.data).k), [2])
  assert.equal(planClipPromptNodes(script, refs, [script, plan.nodes[0]], 1).nodes.length, 0)
  // chưa viết -> không tạo
  assert.equal(planClipPromptNodes(createClipScriptNode({ x: 0, y: 0 }, 'P', 'x'), refs, []).nodes.length, 0)
})

test('clip node: kiểm tra lại khi sửa số giây / mốc thời gian; độ dài prompt không bao giờ thành cảnh báo', () => {
  const ok = '[0–2s] a. [2–8s] b.'
  assert.deepEqual(checkClipPrompt(ok, 8), [])
  assert.deepEqual(checkClipPrompt(ok, 10), ['Mốc cuối 8s khác độ dài clip 10s.'])
  assert.deepEqual(checkClipPrompt(ok, 16)[0], 'Dài 16s — Omni 1.2 tối đa 15s.')
  assert.deepEqual(checkClipPrompt('', 8), ['Prompt video đang trống.'])
  // prompt dài hơn 2000 ký tự: không cảnh báo (cả ở node Clip lẫn thẻ clip của node nguồn)
  assert.deepEqual(checkClipPrompt('[0–2s] a. [2–8s] b. ' + 'x'.repeat(3000), 8), [])
  const text = SAMPLE.replace('She walks in from frame left.', 'She walks in from frame left. ' + 'y'.repeat(3000))
  assert.deepEqual(parseClipScript(text, 2).clips[0].warnings, [])
})

test('clip node: nguồn viết lại thì có bản mới cùng số clip; dây chỉ từ Kịch bản tạo video, 1 nguồn', () => {
  const plan = planClipPromptNodes(writtenScript(100), scriptRefsFromSources([board('b1', 'B1'), board('b2', 'B2')]), [writtenScript(100)])
  const clip1 = normalizeClipPromptData(plan.nodes[0].data)
  assert.equal(newerClipFor(clip1, normalizeClipScriptData(writtenScript(100).data)), null)
  const newer = newerClipFor(clip1, normalizeClipScriptData(writtenScript(200, SAMPLE.replace('exactly 8 seconds', 'exactly 8 seconds, v2')).data))
  assert.equal(newer?.updatedAt, 200)
  assert.match(newer?.clip.videoPrompt || '', /v2/)
  assert.equal(newer?.imagePath, 'D:/b1.png')
  const cs = writtenScript()
  const clipNode = plan.nodes[0]
  const b = board('b1', 'B1')
  const nodes = [cs, clipNode, b]
  assert.equal(isValidMuseConnection({ source: 'cs', target: clipNode.id, sourceHandle: 'clips', targetHandle: 'clip' }, nodes), true)
  assert.equal(isValidMuseConnection({ source: 'cs', target: clipNode.id, sourceHandle: 'clips', targetHandle: 'clip' }, nodes, [{ source: 'x', target: clipNode.id }]), false)
  assert.equal(isValidMuseConnection({ source: 'b1', target: clipNode.id, sourceHandle: 'image', targetHandle: 'clip' }, nodes), false)
  assert.equal(isValidMuseConnection({ source: clipNode.id, target: 'cs', sourceHandle: 'clip', targetHandle: 'boards' }, nodes), false)
  assert.match(explainMuseConnection('b1', 'source', clipNode.id, nodes, []), /chỉ nhận dây từ Kịch bản tạo video/)
})
