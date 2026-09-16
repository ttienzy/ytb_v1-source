import assert from 'node:assert/strict'
import test from 'node:test'
import { getVeoStageProgress, VEO_STAGE_PROGRESS } from '../services/renderJobService.ts'

test('maps every Veo lifecycle stage to a monotonic estimated progress', () => {
  assert.deepEqual(Object.keys(VEO_STAGE_PROGRESS), [
    'pending', 'captcha', 'submitting', 'generating', 'downloading', 'done', 'error',
  ])
  assert.deepEqual(
    ['pending', 'captcha', 'submitting', 'generating', 'downloading', 'done']
      .map(status => getVeoStageProgress(status as keyof typeof VEO_STAGE_PROGRESS)),
    [15, 25, 35, 65, 90, 100],
  )
  assert.equal(getVeoStageProgress('error'), 0)
})
