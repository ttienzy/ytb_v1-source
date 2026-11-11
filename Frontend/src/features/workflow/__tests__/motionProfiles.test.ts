import assert from 'node:assert/strict'
import test from 'node:test'
import type { VeoCapabilityProfile } from '../../veo-studio/types.ts'
import {
  findMotionProfile,
  getMotionTrimDuration,
  getVideoEditProfiles,
  MOTION_DURATION_OPTIONS,
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
  assert.deepEqual([...MOTION_DURATION_OPTIONS], [3, 4, 5, 6, 7, 8, 9, 10])   // Omni 1.2: đoạn chỉnh 3–10 giây
})

test('motion trim duration accepts only whole segments from 3 to 10 seconds (Omni 1.2)', () => {
  assert.equal(getMotionTrimDuration(2, 8), 6)
  assert.equal(getMotionTrimDuration(0, 3), 3)
  assert.equal(getMotionTrimDuration(0, 2), null)
  assert.equal(getMotionTrimDuration(0, 10.5), null)
  assert.equal(getMotionTrimDuration(4, 15), null)
})
