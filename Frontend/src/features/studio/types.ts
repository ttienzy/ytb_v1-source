export type BackendSegment = {
  start_time_sec: number
  end_time_sec: number
  duration_sec: number
  original_text: string
  vietnamese_vo: string
}

export type BackendScene = {
  scene_title?: string
  segments: BackendSegment[]
}

export type BackendRecap = {
  video_url?: string
  scenes: BackendScene[]
}

export type JobOut = {
  job_id: string
  youtube_url: string
  overall: string // idle | running | recap_done | error | merged | polished
  recap_status: string // idle | running | done | error
  cut_status: string
  voice_status: string
  merge_status: string
  polish_status: string // idle | running | done | error (Phase R5)
  progress: {
    cut: { done: number; total: number }
    voice: { done: number; total: number; phase?: string }
    merge: { done: number; total: number }
    polish?: { done: number; total: number; step?: string }
  }
  created_at?: string
  updated_at?: string
  voice_id?: string | null
  error?: string | null
  recap?: BackendRecap | null
  clips?: string[] | null
  overspeed?: number[] | null
  final?: string | null
  final_studio?: string | null
  credits?: string | null
  // legacy compat
  detail?: string
}

export type NodeState = 'idle' | 'running' | 'done' | 'error' | 'skipped'
