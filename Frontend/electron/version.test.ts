import assert from 'node:assert/strict'
import test from 'node:test'
import { compareVersions, isNewerVersion } from './version.ts'

test('isNewerVersion: chỉ true khi bản trên GitHub mới hơn bản đang chạy', () => {
  assert.equal(isNewerVersion('v2.1.0', '2.0.0'), true)
  assert.equal(isNewerVersion('2.0.1', 'v2.0.0'), true)
  assert.equal(isNewerVersion('2.10.0', '2.9.9'), true) // so số, không so chuỗi
  assert.equal(isNewerVersion('v2.0.0', 'v2.1.0'), false) // bản cũ hơn (dev đang chạy bản mới hơn release)
  assert.equal(isNewerVersion('2.1.0', '2.1.0'), false)
})

test('bản pre-release nhỏ hơn bản chính thức cùng số', () => {
  assert.equal(isNewerVersion('2.1.0', '2.1.0-beta.1'), true)
  assert.equal(isNewerVersion('2.1.0-beta.1', '2.1.0'), false)
  assert.ok(compareVersions('2.1.0-beta.2', '2.1.0-beta.1') > 0)
})

test('chuỗi không hợp lệ không bao giờ được coi là bản mới', () => {
  assert.equal(isNewerVersion('', '2.0.0'), false)
  assert.equal(isNewerVersion('latest', '2.0.0'), false)
  assert.ok(Number.isNaN(compareVersions('abc', '2.0.0')))
})
