import type { VeoJobOut } from '../../veo-studio/types'
import type { MotionRunError, MotionRunStage } from '../types'

const STAGE_LABELS: Record<MotionRunStage, string> = {
  preflight: 'Kiểm tra đầu vào',
  connection: 'Kết nối Flow',
  authentication: 'Tài khoản Flow',
  project: 'Flow project',
  reference_upload: 'Upload video tham chiếu',
  image_upload: 'Upload ảnh tham chiếu',
  submission: 'Gửi yêu cầu',
  captcha: 'Xác thực reCAPTCHA',
  generation: 'Google Flow tạo video',
  download: 'Tải video kết quả',
  backend: 'Backend',
  unknown: 'Không xác định',
}

const KNOWN_STAGES = new Set<MotionRunStage>(Object.keys(STAGE_LABELS) as MotionRunStage[])

const ERROR_TITLES: Record<string, string> = {
  BRIDGE_OFFLINE: 'Backend Bridge chưa hoạt động',
  EXTENSION_DISCONNECTED: 'Extension Flow đã mất kết nối',
  FLOW_AUTH_REQUIRED: 'Phiên đăng nhập Flow chưa sẵn sàng',
  CAPTCHA_QUEUE_BUSY: 'Extension đang bận',
  CAPTCHA_FAILED: 'Không thể xác thực reCAPTCHA',
  REFERENCE_INVALID: 'File tham chiếu không hợp lệ',
  FLOW_TIMEOUT: 'Google Flow phản hồi quá lâu',
  FLOW_REJECTED: 'Google Flow từ chối yêu cầu',
  FLOW_AUDIO_FILTERED: 'Video bị dính bản quyền âm thanh',
  FLOW_RENDER_FAILED: 'Google Flow không tạo được video',
  FLOW_EMPTY_RESULT: 'Flow không trả về video',
  DOWNLOAD_FAILED: 'Không tải được video kết quả',
  JOB_INTERRUPTED: 'Job bị gián đoạn',
  PROJECT_MISSING: 'Chưa có Flow project hợp lệ',
  VIDEO_UPLOAD_FAILED: 'Upload video tham chiếu thất bại',
  IMAGE_UPLOAD_FAILED: 'Upload ảnh tham chiếu thất bại',
  SUBMISSION_FAILED: 'Không gửi được job tới Backend',
  NETWORK_ERROR: 'Không kết nối được Backend',
  UNKNOWN_ERROR: 'Không thể tạo video',
}

const DEFAULT_HINTS: Partial<Record<MotionRunStage, string>> = {
  preflight: 'Kiểm tra lại các mục còn thiếu rồi chạy lại workflow.',
  connection: 'Kiểm tra Backend, mở tab Google Flow và bảo đảm FlowsVeo-Clean đang bật.',
  authentication: 'Đăng nhập Google Flow trong tab Chrome đang được extension sử dụng.',
  project: 'Chọn hoặc tạo lại project trong Veo Studio rồi thử lại.',
  reference_upload: 'Chọn lại video tham chiếu hợp lệ rồi upload lại.',
  image_upload: 'Chọn lại ảnh PNG, JPG hoặc WebP hợp lệ rồi upload lại.',
  submission: 'Kiểm tra cấu hình đầu ra và kết nối Backend rồi thử lại.',
  captcha: 'Giữ tab Flow mở, kiểm tra phiên đăng nhập và thử lại.',
  generation: 'Kiểm tra cảnh báo trên Flow, prompt, credits và các file tham chiếu.',
  download: 'Kiểm tra thư viện Flow vì video có thể đã tạo xong nhưng chưa tải được về máy.',
  backend: 'Khởi động lại Backend và kiểm tra job trên Flow trước khi tạo lại.',
  unknown: 'Kiểm tra Backend và tab Google Flow, sau đó thử lại.',
}

export function motionStageLabel(stage: MotionRunStage): string {
  return STAGE_LABELS[stage]
}

function normalizeStage(stage: string | null | undefined, fallback: MotionRunStage): MotionRunStage {
  return stage && KNOWN_STAGES.has(stage as MotionRunStage) ? stage as MotionRunStage : fallback
}

function codeFromMessage(message: string, stage: MotionRunStage): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('bridge server')) return 'BRIDGE_OFFLINE'
  if (normalized.includes('extension') && (normalized.includes('chưa kết nối') || normalized.includes('mất kết nối'))) {
    return 'EXTENSION_DISCONNECTED'
  }
  if (normalized.includes('đăng nhập') || normalized.includes('google labs')) return 'FLOW_AUTH_REQUIRED'
  if (normalized.includes('captcha') && (normalized.includes('queue') || normalized.includes('đang bận'))) return 'CAPTCHA_QUEUE_BUSY'
  if (normalized.includes('captcha')) return 'CAPTCHA_FAILED'
  if (normalized.includes('project')) return 'PROJECT_MISSING'
  if (stage === 'reference_upload' || normalized.includes('upload video')) return 'VIDEO_UPLOAD_FAILED'
  if (stage === 'image_upload' || normalized.includes('upload ảnh')) return 'IMAGE_UPLOAD_FAILED'
  if (normalized.includes('timeout') || normalized.includes('quá 5 phút')) return 'FLOW_TIMEOUT'
  if (normalized.includes('no result') || normalized.includes('không trả video') || normalized.includes('không trả về file')) return 'FLOW_EMPTY_RESULT'
  if (normalized.includes('audio_filtered')) return 'FLOW_AUDIO_FILTERED'
  if (normalized.includes('render ended with status')) return 'FLOW_RENDER_FAILED'
  if (normalized.includes('google flow')) return 'FLOW_REJECTED'
  if (stage === 'download') return 'DOWNLOAD_FAILED'
  if (normalized.includes('failed to fetch') || normalized.includes('không kết nối')) return 'NETWORK_ERROR'
  if (stage === 'submission') return 'SUBMISSION_FAILED'
  return 'UNKNOWN_ERROR'
}

export function motionRunErrorFromUnknown(
  error: unknown,
  fallbackStage: MotionRunStage = 'unknown',
  jobId?: string,
): MotionRunError {
  const message = error instanceof Error ? error.message : String(error || 'Không có thông tin lỗi từ hệ thống.')
  const code = codeFromMessage(message, fallbackStage)
  return {
    code,
    stage: fallbackStage,
    stageLabel: motionStageLabel(fallbackStage),
    title: ERROR_TITLES[code] || ERROR_TITLES.UNKNOWN_ERROR,
    message,
    hint: DEFAULT_HINTS[fallbackStage] || DEFAULT_HINTS.unknown!,
    retryable: true,
    jobId,
  }
}

export function motionRunErrorFromJob(
  job: VeoJobOut,
  fallbackStage: MotionRunStage = 'generation',
): MotionRunError {
  const stage = normalizeStage(job.error_stage, fallbackStage)
  const message = job.error_message || job.current_step || 'Google Flow không cung cấp chi tiết lỗi.'
  const fallback = motionRunErrorFromUnknown(message, stage, job.job_id)
  const code = job.error_code || fallback.code
  return {
    ...fallback,
    code,
    stage,
    stageLabel: motionStageLabel(stage),
    title: ERROR_TITLES[code] || fallback.title,
    hint: job.error_hint || fallback.hint,
    retryable: job.error_retryable ?? true,
    jobId: job.job_id,
  }
}
