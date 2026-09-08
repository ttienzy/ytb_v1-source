import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  chooseVideoFolder: () => ipcRenderer.invoke('video:choose-folder'),
  getDefaultVideoFolder: () => ipcRenderer.invoke('video:get-default-folder'),
  saveVideoFile: (folder: string, name: string, data: ArrayBuffer) => ipcRenderer.invoke('video:save-file', { folder, name, data }),
  open9routerDashboard: () => ipcRenderer.invoke('open-9router-dashboard'),
  check9routerStatus: () => ipcRenderer.invoke('check-9router-status'),
  on9RouterUpdated: (callback: () => void) => {
    const sub = () => callback()
    ipcRenderer.on('9router:updated', sub)
    return () => {
      ipcRenderer.removeListener('9router:updated', sub)
    }
  },
})
