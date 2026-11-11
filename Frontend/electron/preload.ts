import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  chooseVideoFolder: () => ipcRenderer.invoke('video:choose-folder'),
  getDefaultVideoFolder: () => ipcRenderer.invoke('video:get-default-folder'),
  saveVideoFile: (folder: string, name: string, data: ArrayBuffer) => ipcRenderer.invoke('video:save-file', { folder, name, data }),
  getAppVersion: () => ipcRenderer.invoke('updater:get-app-version'),
  getUpdaterStatus: () => ipcRenderer.invoke('updater:get-status'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  startDownloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  onUpdaterStatus: (callback: (data: any) => void) => {
    const sub = (_event: any, data: any) => callback(data)
    ipcRenderer.on('updater:status', sub)
    return () => {
      ipcRenderer.removeListener('updater:status', sub)
    }
  },
})
