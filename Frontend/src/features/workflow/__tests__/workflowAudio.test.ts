import assert from 'node:assert/strict'
import test from 'node:test'
import { buildVoiceoverPlan, selectCachedVoiceoverPath } from '../services/workflowAudio.ts'

const scenes = [
  { sceneNumber: 1, title: 'Hook', prompt: 'English visual prompt', durationSec: 10, aspectRatio: '9:16' as const, voiceover: 'Lời đọc cảnh một' },
  { sceneNumber: 2, title: 'CTA', prompt: 'Another visual prompt', durationSec: 10, aspectRatio: '9:16' as const, voiceover: 'Lời đọc cảnh hai' },
]

test('voiceover plan uses narration fields and never falls back to visual prompts', () => {
  const plan = buildVoiceoverPlan(scenes, 'voice-a', false)
  assert.deepEqual(plan.texts, ['Lời đọc cảnh một', 'Lời đọc cảnh hai'])
  assert.equal(plan.texts.some(text => text.includes('visual prompt')), false)
})

test('voiceover cache is accepted only when the signature matches', () => {
  const plan = buildVoiceoverPlan(scenes, 'voice-a', false)
  const cache = { voiceoverSignature: plan.signature, voiceoverFilePath: 'voice.wav' }
  assert.equal(selectCachedVoiceoverPath(true, plan.signature, cache), 'voice.wav')
  assert.equal(selectCachedVoiceoverPath(true, `${plan.signature}-changed`, cache), undefined)
  assert.equal(selectCachedVoiceoverPath(false, plan.signature, cache), undefined)
})

test('voiceover plan rejects an explicitly empty narration field', () => {
  assert.throws(() => buildVoiceoverPlan([
    { ...scenes[0], voiceover: '' },
  ], 'voice-a', false), /chưa có lời thoại/)
})
