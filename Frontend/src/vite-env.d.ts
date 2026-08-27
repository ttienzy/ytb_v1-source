/// <reference types="vite/client" />

interface Window {
  desktop?: {
    platform: string
    getPathForFile: (file: File) => string
  }
}
