import assert from 'node:assert/strict'
import test from 'node:test'
import { PcmDecoder } from './pcmPreview.ts'

test('PCM samples survive arbitrary HTTP byte boundaries', () => {
  const decoder = new PcmDecoder()
  assert.deepEqual(Array.from(decoder.decode(new Uint8Array([0]))), [])
  assert.deepEqual(Array.from(decoder.decode(new Uint8Array([128, 0, 0, 255]))), [-1, 0])
  assert.deepEqual(Array.from(decoder.decode(new Uint8Array([127]))), [32767 / 32768])
  decoder.finish()
})

test('truncated PCM is reported', () => {
  const decoder = new PcmDecoder()
  decoder.decode(new Uint8Array([1]))
  assert.throws(() => decoder.finish())
})
