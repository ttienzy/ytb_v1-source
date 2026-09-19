import type { VeoCapabilityProfile } from '../../veo-studio/types'
import type { MotionOutputConfig } from '../types'

export const MOTION_DURATION_OPTIONS = [4, 6, 8, 10] as const

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
  if (startSeconds < 0 || !Number.isInteger(duration) || duration < 4 || duration > 10) return null
  return duration
}
