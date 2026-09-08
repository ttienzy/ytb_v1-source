/// <reference types="vite/client" />

interface Window {
  desktop?: {
    platform: string
    getPathForFile: (file: File) => string
    chooseVideoFolder: () => Promise<string | null>
    getDefaultVideoFolder: () => Promise<string>
    saveVideoFile: (folder: string, name: string, data: ArrayBuffer) => Promise<string>
    open9routerDashboard: () => Promise<{ ok: boolean; message?: string }>
    check9routerStatus: () => Promise<{ running: boolean }>
    on9RouterUpdated: (callback: () => void) => () => void
  }
}
