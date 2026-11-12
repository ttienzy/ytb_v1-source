import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Hồi quy: ô checkbox ẩn của công tắc (position: absolute) mà label chứa nó không `position: relative` thì ô này định vị theo TRANG,
// nằm ngoài vùng cuộn của khung chứa, làm cả document dài ra; khi nhận focus trình duyệt cuộn cả ứng dụng (giao diện "trượt" mất nội dung).
const FILES: Array<[string, string]> = [
  ['src/features/video/VideoPage.css', '.vp-switch'],
  ['src/features/studio/audio/AudioWorkflow.css', '.aw-switch'],
]

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `không tìm thấy rule ${selector}`)
  return match[1]
}

for (const [file, selector] of FILES) {
  test(`${selector}: label chứa checkbox ẩn phải là position: relative`, () => {
    const css = readFileSync(file, 'utf8')
    assert.match(rule(css, selector), /position:\s*relative/)
    const input = rule(css, `${selector} input`)
    assert.match(input, /position:\s*absolute/)
    assert.match(input, /opacity:\s*0/)
  })
}
