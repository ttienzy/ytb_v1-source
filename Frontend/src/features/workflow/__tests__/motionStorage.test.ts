import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import {
  loadStoredMotionConfig,
  saveStoredMotionConfig,
  loadStoredCreativeDirection,
  saveStoredCreativeDirection,
  DEFAULT_MOTION_OUTPUT_CONFIG,
} from '../services/motionStorage.ts'
import {
  resolveBestProfile,
  getAvailableResolutions,
  getAvailableAspectRatios,
  getAvailableDurations,
} from '../services/motionProfiles.ts'
import type { VeoCapabilityProfile } from '../../veo-studio/types.ts'

// In-memory mock localStorage for Node test runner
const memoryStorage = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => memoryStorage.set(key, String(value)),
  removeItem: (key: string) => memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
}

const mockProfiles: VeoCapabilityProfile[] = [
  {
    id: 'omni_flash_video_edit_portrait_10s_360p',
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
  },
  {
    id: 'omni_flash_video_edit_portrait_10s_720p',
    model_display_name: 'Omni 1.1 Flash',
    provider_model_id: 'abra_edit',
    input_mode: 'video_edit',
    aspect_ratio: '9:16',
    duration_seconds: 10,
    resolution: '720p',
    num_outputs: 1,
    credit_cost: 40,
    documented: true,
    runtime_verified: false,
  },
  {
    id: 'omni_flash_video_edit_landscape_10s_360p',
    model_display_name: 'Omni 1.1 Flash',
    provider_model_id: 'abra_edit_360p',
    input_mode: 'video_edit',
    aspect_ratio: '16:9',
    duration_seconds: 10,
    resolution: '360p',
    num_outputs: 1,
    credit_cost: 40,
    documented: true,
    runtime_verified: false,
  },
  {
    id: 'omni_flash_video_edit_landscape_10s_720p',
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
  },
]

test('motionStorage loads defaults when empty', () => {
  memoryStorage.clear()
  const cfg = loadStoredMotionConfig()
  assert.equal(cfg.aspectRatio, '9:16')
  assert.equal(cfg.resolution, '720p')
  assert.equal(cfg.projectMode, 'selected')
  assert.equal(cfg.freshAssets, false)
})

test('motionStorage saves and restores output configuration', () => {
  memoryStorage.clear()
  saveStoredMotionConfig({
    aspectRatio: '16:9',
    resolution: '720p',
    durationSeconds: 8,
    projectMode: 'selected',
    freshAssets: false,
    showReferenceComparison: true,
    activePresetId: 'fashion_walk',
    numOutputs: 2,
  })

  const reloaded = loadStoredMotionConfig()
  assert.equal(reloaded.aspectRatio, '16:9')
  assert.equal(reloaded.resolution, '720p')
  assert.equal(reloaded.durationSeconds, 8)
  assert.equal(reloaded.projectMode, 'selected')
  assert.equal(reloaded.freshAssets, false)
  assert.equal(reloaded.activePresetId, 'fashion_walk')
  assert.equal(reloaded.numOutputs, 2)
})

test('motionStorage saves and restores creative direction', () => {
  memoryStorage.clear()
  saveStoredCreativeDirection({
    creativeBrief: 'Custom fashion walk brief',
    subjectAction: 'Striding catwalk smoothly',
    cameraMovement: 'Steady dolly forward',
  })

  const reloaded = loadStoredCreativeDirection()
  assert.equal(reloaded.creativeBrief, 'Custom fashion walk brief')
  assert.equal(reloaded.subjectAction, 'Striding catwalk smoothly')
  assert.equal(reloaded.cameraMovement, 'Steady dolly forward')
})

test('resolveBestProfile respects saved preferences and does not force 360p', () => {
  // Khi người dùng đã lưu 720p 16:9, profile tìm được phải là 720p 16:9
  const matched = resolveBestProfile(mockProfiles, '16:9', '720p')
  assert.ok(matched)
  assert.equal(matched.aspect_ratio, '16:9')
  assert.equal(matched.resolution, '720p')
  assert.equal(matched.id, 'omni_flash_video_edit_landscape_10s_720p')
})

test('getAvailableResolutions dynamically extracts resolution options with credit costs', () => {
  const options = getAvailableResolutions(mockProfiles, '9:16')
  assert.equal(options.length, 2)
  const resList = options.map((o) => o.resolution)
  assert.ok(resList.includes('360p'))
  assert.ok(resList.includes('720p'))
  assert.equal(options[0].creditCost, 40)
})

test('getAvailableAspectRatios extracts unique aspect ratios', () => {
  const ratios = getAvailableAspectRatios(mockProfiles)
  assert.ok(ratios.includes('9:16'))
  assert.ok(ratios.includes('16:9'))
})

test('getAvailableDurations returns duration steps', () => {
  const durs = getAvailableDurations(mockProfiles)
  assert.deepEqual(durs, [4, 6, 8, 10])
})
