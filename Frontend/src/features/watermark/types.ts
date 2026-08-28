export type WatermarkVideoItem = {
  name: string
  size_bytes: number
  status: 'pending' | 'running' | 'done' | 'error'
  output_name?: string | null
  error?: string | null
  processed_frames?: number | null
  frame_estimate?: number | null
  drive_status?: 'idle' | 'uploading' | 'done' | 'error' | null
  drive_file_id?: string | null
  drive_url?: string | null
}


export type WatermarkBatchJob = {
  job_id: string
  status: 'idle' | 'running' | 'done' | 'error'
  total: number
  done: number
  failed: number
  videos: WatermarkVideoItem[]
  created_at: string
  updated_at: string
}

export type QueuedFile = {
  path: string // đường dẫn native hoặc tên file
  name: string
  size: number
  file?: File // File object từ browser (cho upload mode)
}
