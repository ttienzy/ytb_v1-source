import assert from 'node:assert/strict'
import test from 'node:test'
import type { VeoCapabilityProfile } from '../../veo-studio/types.ts'
import {
  MOTION_DURATION_OPTIONS,
  MOTION_MAX_DURATION_SECONDS,
  MOTION_MIN_DURATION_SECONDS,
  estimateMotionCreditCost,
  findMotionProfile,
  getMotionTrimDuration,
  getVideoEditProfiles,
} from '../services/motionProfiles.ts'

const profiles: VeoCapabilityProfile[] = [
  {
    id: 'portrait-draft',
    model_display_name: 'Omni 1.1 Flash',
    provider_model_id: 'abra_edit_360p',
    input_mode: 'video_edit',
    aspect_ratio: '9:16',
    duration_seconds: 10,
    resolution: '360p',
    num_outputs: 1,
    credit_cost: 40,
    documented: true,
    runtime_verified: true,
    note: '',
  },
  {
    id: 'landscape-standard',
    model_display_name: 'Omni 1.1 Flash',
    provider_model_id: 'abra_edit',
    input_mode: 'video_edit',
    aspect_ratio: '16:9',
    duration_seconds: 10,
    resolution: '720p',
    num_outputs: 1,
    credit_cost: 40,
    documented: true,
    runtime_verified: false,
    note: '',
  },
  {
    id: 'unrelated',
    model_display_name: 'Omni 1.1 Flash',
    provider_model_id: 'abra_t2v_10s',
    input_mode: 'text_to_video',
    aspect_ratio: '9:16',
    duration_seconds: 10,
    resolution: '720p',
    num_outputs: 1,
    credit_cost: 15,
    documented: true,
    runtime_verified: false,
    note: '',
  },
]

test('motion settings resolve only compatible video-edit profiles', () => {
  const videoEditProfiles = getVideoEditProfiles(profiles)
  assert.equal(videoEditProfiles.length, 2)
  assert.equal(findMotionProfile(videoEditProfiles, '16:9', '720p')?.id, 'landscape-standard')
  assert.equal(findMotionProfile(videoEditProfiles, '9:16', '720p'), null)
  assert.deepEqual([...MOTION_DURATION_OPTIONS], [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) // Omni 1.2: đoạn chỉnh 3–15 giây
})

test('motion trim duration accepts only whole segments from 3 to 15 seconds (Omni 1.2)', () => {
  assert.equal(MOTION_MIN_DURATION_SECONDS, 3)
  assert.equal(MOTION_MAX_DURATION_SECONDS, 15)
  assert.equal(getMotionTrimDuration(2, 8), 6)
  assert.equal(getMotionTrimDuration(0, 3), 3)
  assert.equal(getMotionTrimDuration(0, 15), 15)
  assert.equal(getMotionTrimDuration(4, 15), 11)
  assert.equal(getMotionTrimDuration(0, 2), null)
  assert.equal(getMotionTrimDuration(0, 10.5), null)
  assert.equal(getMotionTrimDuration(0, 16), null)
})

test('estimateMotionCreditCost scales 3-15s and doubles credit rate after 10s', () => {
  assert.equal(estimateMotionCreditCost(3, '720p'), 9)
  assert.equal(estimateMotionCreditCost(6, '720p'), 18)
  assert.equal(estimateMotionCreditCost(10, '720p'), 30)
  assert.equal(estimateMotionCreditCost(11, '720p'), 36)
  assert.equal(estimateMotionCreditCost(13, '720p'), 48)
  assert.equal(estimateMotionCreditCost(15, '720p'), 60)
  assert.equal(estimateMotionCreditCost(10, '360p'), 10)
  assert.equal(estimateMotionCreditCost(15, '360p'), 20)
})
