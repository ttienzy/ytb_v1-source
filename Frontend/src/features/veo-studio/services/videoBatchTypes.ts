import type { VeoJobOut } from '../types'

export interface VideoBatchImage {
  id: string
  source: 'upload' | 'library'
  name: string
}

export interface VideoBatchSettings {
  aspect_ratio: '16:9' | '9:16'
  resolution: '720p' | '360p'
  duration_seconds: number
}

export interface VideoBatchUnit {
  image: VideoBatchImage
  prompt: string
  references: VideoBatchImage[]
  settings: VideoBatchSettings
}

export interface VideoBatchRequest {
  batch_id: string
  project_id: string
  items: VideoBatchUnit[]
}

export interface VideoBatch {
  batch_id: string
  project_id: string
  created_at: string
  status: 'queued' | 'running' | 'paused' | 'done'
  items: {
    unit: VideoBatchUnit
    status: 'queued' | 'running' | 'done' | 'error'
    error: string | null
    job: VeoJobOut | null
  }[]
}
