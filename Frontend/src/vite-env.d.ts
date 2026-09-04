/// <reference types="vite/client" />

interface Window {
  desktop?: {
    platform: string
    getPathForFile: (file: File) => string
    chooseVideoFolder: () => Promise<string | null>
    getDefaultVideoFolder: () => Promise<string>
    saveVideoFile: (folder: string, name: string, data: ArrayBuffer) => Promise<string>
  }
}
