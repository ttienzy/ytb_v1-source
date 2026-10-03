import assert from 'node:assert/strict'
import test from 'node:test'
import { motionRunErrorFromJob, motionRunErrorFromUnknown, normalizeMotionRunError } from '../services/motionRunError.ts'

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

test('picker control failures do not tell users their reference file is invalid', () => {
  const message = 'Google Flow: FLOW_UI: Flow control not found: requested asset in picker'
  const error = motionRunErrorFromUnknown(new Error(message), 'reference_upload')
  assert.equal(error.code, 'FLOW_UI_CONTROL_MISSING')
  assert.equal(error.stage, 'generation')
  assert.equal(error.message, message)
  assert.match(error.hint, /extension/)
})

test('corrects the invalid-file classification on saved legacy picker failures', () => {
  const error = motionRunErrorFromJob({
    job_id: '92dcf37f-f20', status: 'error', input_mode: 'video_edit',
    prompt: 'test', model_display_name: 'Omni 1.1 Flash', aspect_ratio: '9:16',
    duration_seconds: 10, resolution: '720p', num_outputs: 1, current_step: '',
    error_message: 'Google Flow: FLOW_UI: Flow control not found: requested asset in picker',
    error_code: 'REFERENCE_INVALID', error_stage: 'reference_upload',
    error_hint: 'Choose the reference file again.', error_retryable: true,
    output_files: [], created_at: '', updated_at: '',
  })
  assert.equal(error.code, 'FLOW_UI_CONTROL_MISSING')
  assert.equal(error.stage, 'generation')
  assert.notEqual(error.hint, 'Choose the reference file again.')
})

test('normalizes an existing variant error before displaying the output node', () => {
  const legacy = {
    ...motionRunErrorFromUnknown('Missing file', 'reference_upload', '92dcf37f-f20'),
    code: 'REFERENCE_INVALID',
    title: 'File tham chiếu không hợp lệ',
    hint: 'Choose the reference file again.',
    message: 'Google Flow: FLOW_UI: Flow control not found: requested asset in picker',
  }
  const error = normalizeMotionRunError(legacy)!
  assert.equal(error.code, 'FLOW_UI_CONTROL_MISSING')
  assert.equal(error.stage, 'generation')
  assert.equal(error.jobId, legacy.jobId)
  assert.equal(error.message, legacy.message)
  assert.notEqual(error.title, legacy.title)
  assert.notEqual(error.hint, legacy.hint)
  assert.equal(legacy.code, 'REFERENCE_INVALID')
})

test('preserves unrelated errors and handles an empty output slot', () => {
  const error = motionRunErrorFromUnknown('Upload video failed', 'reference_upload')
  assert.equal(normalizeMotionRunError(error), error)
  assert.equal(normalizeMotionRunError(null), null)
  assert.equal(normalizeMotionRunError(undefined), null)
})
