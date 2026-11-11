/**
 * Motion Storage Service
 * Quản lý lưu trữ bền vững (Persistence) cho Motion Control Studio.
 * Kết hợp LocalStorage (khôi phục tức thì khi chuyển tab hoặc F5) và Backend API sync.
 */

import type { MotionOutputConfig, MotionCreativeDirection } from '../types'
import { DEFAULT_MOTION_CREATIVE_DIRECTION, migrateLegacyCreative } from './motionPromptBuilder.ts'
import { saveMotionConfigApi } from './workflowApi.ts'

export const MOTION_STORAGE_CONFIG_KEY = 'motion_control_config_v1'
export const MOTION_STORAGE_CREATIVE_KEY = 'motion_creative_direction_v1'

export const DEFAULT_MOTION_OUTPUT_CONFIG: MotionOutputConfig = {
  aspectRatio: '9:16',
  durationSeconds: 10,
  resolution: '720p',
  numOutputs: 1,
  projectMode: 'selected',
  projectNamePrefix: 'Motion Control',
  freshAssets: false,
  showReferenceComparison: true,
  activePresetId: 'choreography',
}

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage
  return null
}

let syncTimeout: any = null

/**
 * Nạp cấu hình Output đã lưu từ LocalStorage, fallback về default nếu chưa có
 */
export function loadStoredMotionConfig(): MotionOutputConfig {
  const storage = getStorage()
  if (!storage) {
    return { ...DEFAULT_MOTION_OUTPUT_CONFIG }
  }

  try {
    const raw = storage.getItem(MOTION_STORAGE_CONFIG_KEY)
    if (!raw) return { ...DEFAULT_MOTION_OUTPUT_CONFIG }
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_MOTION_OUTPUT_CONFIG,
      ...parsed,
      aspectRatio: parsed.aspectRatio === '16:9' ? '16:9' : '9:16',
      resolution: '720p',   // Omni 1.2 chỉnh video mới xác minh 720p (bản lưu cũ 360p của Omni 1.1 được chuyển lên 720p)
      durationSeconds: Number.isFinite(parsed.durationSeconds) ? parsed.durationSeconds : 10,
      projectMode: parsed.projectMode === 'new_per_run' ? 'new_per_run' : 'selected',
      freshAssets: parsed.freshAssets === true,
      showReferenceComparison: parsed.showReferenceComparison !== false,
      activePresetId: parsed.activePresetId || 'choreography',
      numOutputs: Number.isFinite(parsed.numOutputs) ? Math.min(4, Math.max(1, Number(parsed.numOutputs))) : 1,
    }
  } catch (e) {
    console.warn('[MotionStorage] Lỗi đọc config từ localStorage, dùng mặc định:', e)
    return { ...DEFAULT_MOTION_OUTPUT_CONFIG }
  }
}

/**
 * Lưu cấu hình Output vào LocalStorage và debounce đồng bộ lên Backend API
 */
export function saveStoredMotionConfig(
  updates: Partial<MotionOutputConfig>,
  currentCreative?: MotionCreativeDirection,
): MotionOutputConfig {
  const storage = getStorage()
  if (!storage) {
    return { ...DEFAULT_MOTION_OUTPUT_CONFIG, ...updates }
  }

  try {
    const current = loadStoredMotionConfig()
    const next: MotionOutputConfig = {
      ...current,
      ...updates,
    }
    storage.setItem(MOTION_STORAGE_CONFIG_KEY, JSON.stringify(next))

    // Debounced sync to backend
    if (syncTimeout) clearTimeout(syncTimeout)
    syncTimeout = setTimeout(() => {
      syncMotionConfigToBackend(next, currentCreative).catch((err) => {
        console.debug('[MotionStorage] Backend sync warning:', err)
      })
    }, 600)

    return next
  } catch (e) {
    console.warn('[MotionStorage] Lỗi lưu config vào localStorage:', e)
    return { ...DEFAULT_MOTION_OUTPUT_CONFIG, ...updates }
  }
}

/**
 * Nạp cấu hình Creative Direction đã lưu từ LocalStorage
 */
export function loadStoredCreativeDirection(): MotionCreativeDirection {
  const storage = getStorage()
  if (!storage) {
    return { ...DEFAULT_MOTION_CREATIVE_DIRECTION }
  }

  try {
    const raw = storage.getItem(MOTION_STORAGE_CREATIVE_KEY)
    if (!raw) return { ...DEFAULT_MOTION_CREATIVE_DIRECTION }
    return migrateLegacyCreative(JSON.parse(raw))
  } catch (e) {
    console.warn('[MotionStorage] Lỗi đọc creative direction từ localStorage:', e)
    return { ...DEFAULT_MOTION_CREATIVE_DIRECTION }
  }
}

/**
 * Lưu cấu hình Creative Direction vào LocalStorage
 */
export function saveStoredCreativeDirection(
  updates: Partial<MotionCreativeDirection>,
  currentConfig?: MotionOutputConfig,
): MotionCreativeDirection {
  const storage = getStorage()
  if (!storage) {
    return { ...DEFAULT_MOTION_CREATIVE_DIRECTION, ...updates }
  }

  try {
    const current = loadStoredCreativeDirection()
    const next: MotionCreativeDirection = {
      ...current,
      ...updates,
    }
    storage.setItem(MOTION_STORAGE_CREATIVE_KEY, JSON.stringify(next))

    // Debounced sync to backend
    if (currentConfig) {
      if (syncTimeout) clearTimeout(syncTimeout)
      syncTimeout = setTimeout(() => {
        syncMotionConfigToBackend(currentConfig, next).catch((err) => {
          console.debug('[MotionStorage] Backend sync warning:', err)
        })
      }, 600)
    }

    return next
  } catch (e) {
    console.warn('[MotionStorage] Lỗi lưu creative direction vào localStorage:', e)
    return { ...DEFAULT_MOTION_CREATIVE_DIRECTION, ...updates }
  }
}

/**
 * Đồng bộ cấu hình lên Backend API
 */
export async function syncMotionConfigToBackend(
  config: MotionOutputConfig,
  creative?: MotionCreativeDirection,
): Promise<void> {
  try {
    await saveMotionConfigApi({
      aspect_ratio: config.aspectRatio,
      resolution: config.resolution,
      duration_seconds: config.durationSeconds,
      project_mode: config.projectMode || 'selected',
      project_name_prefix: config.projectNamePrefix || 'Motion Control',
      fresh_assets: config.freshAssets === true,
      show_reference_comparison: config.showReferenceComparison !== false,
      active_preset_id: config.activePresetId || 'choreography',
      num_outputs: config.numOutputs || 1,
      creative: creative || null,
    })
  } catch (err) {
    console.debug('[MotionStorage] Không thể đồng bộ cấu hình lên Backend (offline):', err)
  }
}
