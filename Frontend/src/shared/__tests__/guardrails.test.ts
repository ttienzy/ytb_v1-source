/**
 * Guardrail tất định cho các lỗi đã xảy ra thật (mỗi lỗi một test, thông báo lỗi nói rõ cách sửa đúng).
 * Thêm guardrail mới ở đây thay vì thêm một dòng nhắc vào CLAUDE.md / memory.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { MUSE_NODE } from '../../features/workflow/services/museCanvasNodes.ts'

const SRC = fileURLToPath(new URL('../../', import.meta.url))

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') out.push(...sourceFiles(p))
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

/** Bỏ comment (khối và dòng) để chỉ xét code thật. */
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

test('không gọi window.prompt() / prompt() trong renderer (Electron không hỗ trợ)', () => {
  const offenders: string[] = []
  for (const file of sourceFiles(SRC)) {
    const code = stripComments(readFileSync(file, 'utf8'))
    code.split('\n').forEach((line, i) => {
      if (/\bwindow\.prompt\s*\(|(^|[^\w.$])prompt\(/.test(line)) offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim()}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    'Electron KHÔNG hỗ trợ window.prompt(): gọi là lỗi "prompt() is and will not be supported" và nút bấm như không làm gì.\n'
      + 'Dùng hộp nhập trong app: const [askText, promptDialog] = useTextPrompt() (features/workflow/components/TextPromptDialog.tsx), '
      + 'render {promptDialog} trong JSX, rồi const v = await askText({ title, label, defaultValue }).\n'
      + offenders.join('\n'),
  )
})

test('mọi loại node Muse Canvas đều được đăng ký trong MUSE_NODE_TYPES', () => {
  const ws = readFileSync(join(SRC, 'features/workflow/components/MuseCanvasWorkspace.tsx'), 'utf8')
  const block = ws.slice(ws.indexOf('const MUSE_NODE_TYPES'), ws.indexOf('}', ws.indexOf('const MUSE_NODE_TYPES')))
  assert.ok(block.length > 0, 'Không tìm thấy MUSE_NODE_TYPES trong MuseCanvasWorkspace.tsx')
  const missing = Object.keys(MUSE_NODE).filter((k) => !new RegExp(`\\[MUSE_NODE\\.${k}\\]\\s*:`).test(block))
  assert.deepEqual(
    missing,
    [],
    'Loại node chưa đăng ký sẽ bị React Flow vẽ thành node mặc định (hộp trống, mất cổng nối) — đã xảy ra 2 lần.\n'
      + 'Thêm `[MUSE_NODE.<tên>]: <Component>` vào MUSE_NODE_TYPES trong components/MuseCanvasWorkspace.tsx. Thiếu: '
      + missing.join(', '),
  )
})
