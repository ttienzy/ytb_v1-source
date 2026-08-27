import { contextBridge, webUtils } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
