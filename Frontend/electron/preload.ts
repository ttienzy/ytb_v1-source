import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  chooseVideoFolder: () => ipcRenderer.invoke('video:choose-folder'),
  getDefaultVideoFolder: () => ipcRenderer.invoke('video:get-default-folder'),
  saveVideoFile: (folder: string, name: string, data: ArrayBuffer) => ipcRenderer.invoke('video:save-file', { folder, name, data }),
})
