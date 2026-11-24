import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  MUSE_HANDLE,
  MUSE_MEDIA_ORDER,
  MUSE_PORT_FIRST_TOP,
  MUSE_PORT_STEP,
  museHandleKind,
  museInputPortTops,
} from '../services/museCanvasNodes.ts'

test('mọi cổng có loại nội dung đúng: chữ / ảnh / video', () => {
  const kinds: Record<string, string> = {}
  for (const [name, id] of Object.entries(MUSE_HANDLE)) kinds[name] = museHandleKind(id)
  for (const name of ['promptOut', 'promptIn', 'scriptOut', 'scriptIn', 'clipOut', 'clipIn']) assert.equal(kinds[name], 'Text', name)
  for (const name of ['refVideoOut', 'refVideoIn', 'videoOut', 'videoIn', 'clipVideoOut', 'clipVideoIn']) assert.equal(kinds[name], 'Video', name)
  for (const name of ['imagesOut', 'imagesIn', 'jobOut', 'imageIn', 'imageOut', 'outfitsIn', 'scenesIn', 'refsIn', 'boardsIn']) assert.equal(kinds[name], 'Image', name)
  assert.equal(museHandleKind(undefined), 'Image')
  assert.equal(museHandleKind(null), 'Image')
})

test('cổng vào cạnh trái xếp Text → Image → Video bất kể thứ tự khai báo', () => {
  assert.deepEqual(MUSE_MEDIA_ORDER, ['Text', 'Image', 'Video'])
  const at = (slot: number) => MUSE_PORT_FIRST_TOP + slot * MUSE_PORT_STEP
  assert.deepEqual(museInputPortTops(['Text', 'Image']), [at(0), at(1)])
  assert.deepEqual(museInputPortTops(['Text', 'Image', 'Image']), [at(0), at(1), at(2)])
  assert.deepEqual(museInputPortTops(['Text', 'Video', 'Image']), [at(0), at(2), at(1)])
  assert.deepEqual(museInputPortTops(['Video', 'Image', 'Text']), [at(2), at(1), at(0)])
  assert.deepEqual(museInputPortTops(['Text', 'Text', 'Image']), [at(0), at(1), at(2)])
  assert.deepEqual(museInputPortTops([]), [])
})

test('cổng Prompt nằm cạnh trái, không còn ở đỉnh node; node nhiều cổng vào dùng museInputPortTops', () => {
  const dir = new URL('../nodes/muse/', import.meta.url)
  const promptPort = readFileSync(new URL('MusePromptPort.tsx', dir), 'utf8')
  assert.match(promptPort, /position=\{Position\.Left\}/)
  assert.doesNotMatch(promptPort, /Position\.Top/)
  for (const file of ['MuseJobNode', 'MuseScriptNode', 'GptClipScriptNode', 'GptClipPromptNode', 'MuseScriptTextNode', 'MuseVideoIngredientsNode']) {
    const src = readFileSync(new URL(`${file}.tsx`, dir), 'utf8')
    assert.match(src, /museInputPortTops\(/, `${file} phải xếp cổng bằng museInputPortTops`)
    assert.match(src, /<MusePromptPort[^>]*top=\{portTops\[0\]\}/, `${file}: cổng Prompt phải lấy vị trí từ museInputPortTops`)
    assert.doesNotMatch(src, /style=\{\{ top: \d+ \}\}/, `${file}: không tự đặt top cố định cho cổng vào, dùng museInputPortTops`)
  }
})
