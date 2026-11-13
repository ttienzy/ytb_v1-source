/**
 * Node tùy chọn "Tạo ảnh nhân vật mới" của Motion Control (hàm thuần, có test).
 *
 * Người dùng đưa ảnh của họ + ảnh trang phục; Backend dùng mẫu look sheet của Chiến dịch AI để ChatGPT vẽ MỘT ảnh tham chiếu
 * nhân vật mới (chân dung + áo xoay 3 góc). Ảnh chỉ vào ô Nhân Vật khi người dùng bấm "Dùng làm Ảnh Nhân Vật":
 * node không chạm vào luồng tạo video chính và không tốn credit Flow.
 */

export const CHARACTER_SHEET_NODE_ID = 'n-sheet'
export const CHARACTER_SHEET_EDGE_ID = 'e-sheet-character'
export const CHARACTER_SHEET_TARGET_HANDLE = 'in-sheet'
export const CHARACTER_SHEET_MAX_BYTES = 10 * 1024 * 1024

export type CharacterSheetRole = 'identity' | 'outfit'

export interface CharacterSheetSource {
  fileName: string
  previewUrl: string | null
  file?: File
  /** Đường dẫn trên máy sau khi tải lên Backend (/api/veo/upload-image). */
  backendPath?: string
}

export interface CharacterSheetResult {
  previewUrl: string
  backendPath: string
  fileName: string
  prompt: string
  seconds: number
}

export interface CharacterSheetState {
  identity: CharacterSheetSource | null
  outfit: CharacterSheetSource | null
  changes: string
  status: 'idle' | 'running' | 'done' | 'error'
  error: string | null
  result: CharacterSheetResult | null
}

export const EMPTY_CHARACTER_SHEET: CharacterSheetState = {
  identity: null,
  outfit: null,
  changes: '',
  status: 'idle',
  error: null,
  result: null,
}

export const CHARACTER_SHEET_ROLE_LABEL: Record<CharacterSheetRole, string> = {
  identity: 'Ảnh nhân vật',
  outfit: 'Ảnh trang phục',
}

/** Lý do chưa tạo được (rỗng = sẵn sàng). */
export function characterSheetMissing(state: Pick<CharacterSheetState, 'identity' | 'outfit'>): string[] {
  const reasons: string[] = []
  if (!state.identity || (!state.identity.file && !state.identity.backendPath)) reasons.push('Thiếu ảnh nhân vật (khuôn mặt của bạn)')
  if (!state.outfit || (!state.outfit.file && !state.outfit.backendPath)) reasons.push('Thiếu ảnh trang phục muốn mặc')
  return reasons
}

/** null nếu nhận được ảnh; ngược lại là câu báo lỗi cho người dùng. */
export function characterSheetFileError(file: { name: string; type: string; size: number }): string | null {
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)
  if (!isImage || /\.(gif|svg|bmp|heic)$/i.test(file.name)) return 'Chỉ nhận ảnh PNG, JPG hoặc WebP.'
  if (file.size > CHARACTER_SHEET_MAX_BYTES) return 'Ảnh vượt quá giới hạn 10 MB.'
  return null
}

/** Đổi ảnh nguồn: xóa lỗi cũ, giữ ảnh kết quả cũ để xem (người dùng tự quyết có tạo lại hay không). */
export function withSource(state: CharacterSheetState, role: CharacterSheetRole, source: CharacterSheetSource | null): CharacterSheetState {
  const status = state.status === 'running' ? 'running' : state.result ? 'done' : 'idle'
  return { ...state, [role]: source, status, error: null }
}

/** Ô Nhân Vật đang dùng đúng ảnh kết quả này chưa (so theo đường dẫn file trên máy). */
export function isSheetApplied(
  result: Pick<CharacterSheetResult, 'backendPath'> | null,
  character: { filled: boolean; source?: string; backendPath?: string },
): boolean {
  return Boolean(result && character.filled && character.source === 'character_sheet' && character.backendPath === result.backendPath)
}
