import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseVideoBatchPrompts } from './batchPrompts.ts'

test('one prompt per line keeps order across Windows clipboard line endings', () => {
  assert.deepEqual(parseVideoBatchPrompts('  Prompt A\r\n\r\nPrompt B\rPrompt C\n ', 'line'), ['Prompt A', 'Prompt B', 'Prompt C'])
})

test('one prompt per paragraph preserves internal lines and handles whitespace on blank lines', () => {
  assert.deepEqual(parseVideoBatchPrompts('[0–3s] Walk\r\n[3–6s] Turn\r\n \t\r\n\r\nSlow zoom\r\nOne take', 'paragraph'), [
    '[0–3s] Walk\n[3–6s] Turn', 'Slow zoom\nOne take',
  ])
  assert.deepEqual(parseVideoBatchPrompts(' \r\n\t\r\n ', 'paragraph'), [])
})

test('numbered prompts drop list markers and keep multiline text in pasted order', () => {
  assert.deepEqual(parseVideoBatchPrompts('  4. First prompt\r\n1.5 seconds in, zoom slowly\r\n\r\n5. Second prompt\r\n  6) Third prompt', 'numbered'), [
    'First prompt\n1.5 seconds in, zoom slowly', 'Second prompt', 'Third prompt',
  ])
})

test('numbered mode requires a list without empty prompts', () => {
  assert.deepEqual(parseVideoBatchPrompts('1. First\n2.\n3. Third', 'numbered'), [])
  assert.deepEqual(parseVideoBatchPrompts('Intro\n1. First', 'numbered'), [])
  assert.deepEqual(parseVideoBatchPrompts('Unnumbered prompt', 'numbered'), [])
})
