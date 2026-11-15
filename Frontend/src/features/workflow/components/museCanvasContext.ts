/** Cấu hình + tài khoản của Muse Canvas cho các node (node nằm trong ReactFlow nên không nhận props trực tiếp). */
import { createContext, useContext } from 'react'
import { DEFAULT_MUSE_CANVAS_CONFIG, type MuseAccountLite, type MuseCanvasConfig } from '../services/museCanvasConfig.ts'
import type { LibraryImage } from '../services/imageLibraryApi'

export interface MuseCanvasContextValue {
  config: MuseCanvasConfig
  accounts: MuseAccountLite[]
  /** Lỗi chặn chạy (rỗng = chạy được) */
  blockers: string[]
  /** Mở Thư Viện Ảnh ở chế độ chọn; trả ảnh đã chọn hoặc null nếu đóng. */
  pickLibraryImage: (title?: string) => Promise<LibraryImage | null>
}

export const MuseCanvasContext = createContext<MuseCanvasContextValue>({
  config: DEFAULT_MUSE_CANVAS_CONFIG,
  accounts: [],
  blockers: [],
  pickLibraryImage: async () => null,
})

export const useMuseCanvas = () => useContext(MuseCanvasContext)
