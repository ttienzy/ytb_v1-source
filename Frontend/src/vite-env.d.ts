/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __GITHUB_REPO__: {
  owner: string
  repo: string
}

export interface UpdaterStatusEvent {
  status: 'checking' | 'available' | 'up_to_date' | 'downloading' | 'downloaded' | 'error' | 'checked' | 'idle'
  version?: string
  releaseDate?: string
  releaseNotes?: string | null
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  message?: string
  isDev?: boolean
  currentVersion?: string
}

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
    getAppVersion: () => Promise<string>
    getUpdaterStatus: () => Promise<UpdaterStatusEvent>
    checkForUpdates: () => Promise<UpdaterStatusEvent>
    startDownloadUpdate: () => Promise<{ ok?: boolean; error?: string }>
    quitAndInstall: () => Promise<void>
    onUpdaterStatus: (callback: (data: UpdaterStatusEvent) => void) => () => void
  }
}
