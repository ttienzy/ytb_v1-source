import assert from 'node:assert/strict'
import test from 'node:test'
import { motionRunErrorFromJob, motionRunErrorFromUnknown } from '../services/motionRunError.ts'

test('uses structured backend error metadata for a failed Flow job', () => {
  const error = motionRunErrorFromJob({
    job_id: 'job-123',
    status: 'error',
    input_mode: 'video_edit',
    prompt: 'test',
    model_display_name: 'Omni 1.1 Flash',
    aspect_ratio: '9:16',
    duration_seconds: 10,
    resolution: '360p',
    num_outputs: 1,
    current_step: 'Lỗi',
    error_message: 'Google Flow: insufficient credits',
    error_code: 'FLOW_REJECTED',
    error_stage: 'generation',
    error_hint: 'Nạp thêm credits rồi thử lại.',
    error_retryable: false,
    output_files: [],
    created_at: '',
    updated_at: '',
  })

  assert.equal(error.title, 'Google Flow từ chối yêu cầu')
  assert.equal(error.stageLabel, 'Google Flow tạo video')
  assert.equal(error.hint, 'Nạp thêm credits rồi thử lại.')
  assert.equal(error.retryable, false)
  assert.equal(error.jobId, 'job-123')
})

test('classifies local upload errors before a job exists', () => {
  const error = motionRunErrorFromUnknown(new Error('Upload video tham chiếu thất bại'), 'reference_upload')
  assert.equal(error.code, 'VIDEO_UPLOAD_FAILED')
  assert.equal(error.stageLabel, 'Upload video tham chiếu')
  assert.match(error.hint, /Chọn lại video/)
})
