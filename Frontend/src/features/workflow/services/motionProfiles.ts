import type { VeoCapabilityProfile } from '../../veo-studio/types'
import type { MotionOutputConfig } from '../types'

// Omni 1.2: đoạn chỉnh dài 3–15 giây (Backend/Extension MOTION_REF_MAX_SECONDS = 15; từ giây 11 Flow tính credit gấp đôi).
export const MOTION_MIN_DURATION_SECONDS = 3
export const MOTION_MAX_DURATION_SECONDS = 15
export const MOTION_DURATION_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const

export function estimateMotionCreditCost(
  durationSeconds: number,
  resolution: '360p' | '720p' = '720p',
): number {
  const rate = resolution === '360p' ? 1 : 3
  const s = Math.max(0, Number.isFinite(durationSeconds) ? durationSeconds : 10)
  return Math.round(Math.min(s, 10) * rate + Math.max(0, s - 10) * rate * 2)
}

export function getVideoEditProfiles(profiles: VeoCapabilityProfile[]): VeoCapabilityProfile[] {
  return profiles.filter(
    (profile) =>
      profile.input_mode === 'video_edit' &&
      (profile.resolution === '360p' || profile.resolution === '720p')
  )
}

export function findMotionProfile(
  profiles: VeoCapabilityProfile[],
  aspectRatio: MotionOutputConfig['aspectRatio'],
  resolution: MotionOutputConfig['resolution'],
): VeoCapabilityProfile | null {
  return profiles.find(
    (profile) => profile.aspect_ratio === aspectRatio && profile.resolution === resolution
  ) || null
}

export function getMotionTrimDuration(startSeconds: number, endSeconds: number): number | null {
  const duration = endSeconds - startSeconds
  if (
    startSeconds < 0 ||
    !Number.isInteger(duration) ||
    duration < MOTION_MIN_DURATION_SECONDS ||
    duration > MOTION_MAX_DURATION_SECONDS
  ) return null
  return duration
}

export function getAvailableAspectRatios(profiles: VeoCapabilityProfile[]): ('9:16' | '16:9')[] {
  const set = new Set<'9:16' | '16:9'>()
  for (const p of profiles) {
    if (p.aspect_ratio === '9:16' || p.aspect_ratio === '16:9') {
      set.add(p.aspect_ratio)
    }
  }
  return set.size > 0 ? Array.from(set) : ['9:16', '16:9']
}

export interface ResolutionOption {
  resolution: '360p' | '720p'
  title: string
  detail: string
  creditCost: number
}

export function getAvailableResolutions(
  profiles: VeoCapabilityProfile[],
  aspectRatio: string = '9:16',
): ResolutionOption[] {
  const matching = profiles.filter((p) => p.aspect_ratio === aspectRatio)
  const result: ResolutionOption[] = []
  const seen = new Set<string>()

  for (const p of matching) {
    if (p.resolution === '360p' || p.resolution === '720p') {
      if (!seen.has(p.resolution)) {
        seen.add(p.resolution)
        result.push({
          resolution: p.resolution,
          title: p.resolution === '360p' ? 'Draft 360p' : 'Standard 720p',
          detail: p.resolution === '360p' ? 'Nhanh để thử chuyển động' : 'Chi tiết tốt hơn',
          creditCost: p.credit_cost,
        })
      }
    }
  }

  if (result.length === 0) {
    return [{ resolution: '720p', title: 'Standard 720p', detail: 'Omni 1.2', creditCost: 30 }]
  }

  return result.sort((a, b) => (a.resolution === '360p' ? -1 : 1))
}

export function getAvailableDurations(profiles?: VeoCapabilityProfile[]): number[] {
  if (profiles && profiles.length > 0) {
    const durs = new Set<number>()
    for (const p of profiles) {
      if (p.duration_seconds && p.duration_seconds > 0) {
        durs.add(p.duration_seconds)
      }
    }
    if (durs.size === 1 && durs.has(10)) {
      return [...MOTION_DURATION_OPTIONS]
    }
    if (durs.size > 1) {
      return Array.from(durs).sort((a, b) => a - b)
    }
  }
  return [...MOTION_DURATION_OPTIONS]
}

export function resolveBestProfile(
  profiles: VeoCapabilityProfile[],
  preferredAspectRatio?: string,
  preferredResolution?: string,
): VeoCapabilityProfile | null {
  if (!profiles || profiles.length === 0) return null

  if (preferredAspectRatio && preferredResolution) {
    const exact = profiles.find(
      (p) => p.aspect_ratio === preferredAspectRatio && p.resolution === preferredResolution
    )
    if (exact) return exact
  }

  if (preferredAspectRatio) {
    const matchAspect = profiles.find((p) => p.aspect_ratio === preferredAspectRatio)
    if (matchAspect) return matchAspect
  }

  return profiles.find((p) => p.runtime_verified) || profiles[0]
}
