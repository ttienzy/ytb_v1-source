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

export type BackendCaption = {
  title?: string
  description?: string
  hashtags?: string[]
}

export type BackendRecap = {
  video_url?: string
  caption?: BackendCaption
  scenes: BackendScene[]
}

/** Thời gian 1 phase (backend app/recap/timing.py). `duration_sec` null khi đang chạy. */
export type PhaseTiming = {
  started_at?: string | null
  ended_at?: string | null
  duration_sec?: number | null
  ok?: boolean | null
  attempts?: number
  detail?: {
    // gemini
    chunks?: number[]
    rate_limit_wait_sec?: number
    cookie_refresh_sec?: number
    network_retries?: number
    tail_sec?: number
    // voice (TTS theo lô)
    tts_sec?: number
    unpack_sec?: number
    batches?: number
    resumed_batches?: number
    // merge
    segments?: number
    ffmpeg_sec?: number
  } | null
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
    recap?: { done: number; total: number; phase?: string; step?: string }
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
  caption?: BackendCaption | null
  clips?: string[] | null
  overspeed?: number[] | null
  final?: string | null
  final_studio?: string | null
  credits?: string | null
  timings?: Record<string, PhaseTiming> | null
  pippit_tasks?: any[]
  youtube_tasks?: any[]
  // legacy compat
  detail?: string



}

export type NodeState = 'idle' | 'running' | 'done' | 'error' | 'skipped'

// ── Batch Queue Types ─────────────────────────────────────────────────────────

export type BatchItemOut = {
  url: string
  job_id: string | null
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  error: string | null
  retry_count: number
}

export type BatchOut = {
  batch_id: string
  status: 'idle' | 'running' | 'stopped' | 'done'
  current_index: number
  items: BatchItemOut[]
  voice_id: string
  total: number
  done_count: number
  error_count: number
  pending_count: number
  created_at?: string
  updated_at?: string
}
