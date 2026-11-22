// Typecheck thật (renderer + Electron main/preload) so với danh sách lỗi CŨ đã ghi lại: chỉ fail khi có lỗi MỚI.
//
//   npm run typecheck                  kiểm tra (CI chạy lệnh này)
//   npm run typecheck -- --update      ghi lại danh sách lỗi cũ sau khi đã SỬA bớt lỗi (không dùng để nuốt lỗi mới)
//
// Trước đây `tsc --noEmit` chạy tsconfig.json gốc (`files: []`) nên không kiểm tra gì; phải tự đếm "vẫn 66 lỗi".
// Lỗi so theo file + mã + nội dung (bỏ số dòng) để sửa code phía trên không làm lỗi cũ thành "mới".
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(ROOT, 'typecheck-baseline.json')
const PROJECTS = ['tsconfig.web.json', 'tsconfig.node.json']
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')

function runTsc(project) {
  const r = spawnSync(process.execPath, [TSC, '-p', project, '--noEmit', '--pretty', 'false'], { cwd: ROOT, encoding: 'utf8' })
  if (r.error) throw r.error
  const lines = `${r.stdout}\n${r.stderr}`.split(/\r?\n/)
  const errors = []
  for (const line of lines) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)
    if (m) errors.push({ file: m[1].replace(/\\/g, '/'), line: Number(m[2]), code: m[4], message: m[5], raw: line })
    else if (/error TS\d+/.test(line) && !/^\s/.test(line)) errors.push({ file: '(global)', line: 0, code: 'TS', message: line, raw: line })
  }
  return errors
}

const keyOf = (e) => `${e.file} | ${e.code} | ${e.message}`
const countBy = (errors) => errors.reduce((m, e) => m.set(keyOf(e), (m.get(keyOf(e)) || 0) + 1), new Map())

const errors = PROJECTS.flatMap(runTsc)
const current = countBy(errors)

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries([...current.entries()].sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
  console.log(`[typecheck] đã ghi ${errors.length} lỗi cũ vào typecheck-baseline.json`)
  process.exit(0)
}

const baseline = new Map(Object.entries(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}))
const fresh = []
for (const [key, n] of current) {
  const extra = n - (baseline.get(key) || 0)
  if (extra > 0) fresh.push(...errors.filter((e) => keyOf(e) === key).slice(-extra))
}
let fixed = 0
for (const [key, n] of baseline) fixed += Math.max(0, n - (current.get(key) || 0))

const total = errors.length
if (fresh.length) {
  console.error(`[typecheck] ${fresh.length} lỗi MỚI (tổng ${total}, cũ ${total - fresh.length}):`)
  for (const e of fresh) console.error(`  ${e.raw}`)
  console.error('Sửa các lỗi mới. Không chạy --update để nuốt lỗi mới vào danh sách cũ.')
  process.exit(1)
}
console.log(`[typecheck] không có lỗi mới (${total} lỗi cũ còn lại trong typecheck-baseline.json).`)
if (fixed) console.log(`[typecheck] đã hết ${fixed} lỗi cũ — chạy "npm run typecheck -- --update" để thu nhỏ danh sách.`)
