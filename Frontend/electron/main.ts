import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, delimiter, join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import http from 'node:http'

let mainWindow: BrowserWindow | null = null
let routerDashboardWindow: BrowserWindow | null = null
let routerProcess: ChildProcess | null = null
const backendProcesses: ChildProcess[] = []

/** Diệt cả cây tiến trình trên Windows / Linux khi app thoát */
function killProcessTree(pid?: number) {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', shell: true })
    } catch {
      /* ignore */
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* ignore */
      }
    }
  }
}

/** Tự động khởi chạy Backend Server trong môi trường đóng gói (Production) */
function startProductionBackend() {
  if (!app.isPackaged) return

  const userDataDir = app.getPath('userData')
  const resourcesDir = process.resourcesPath
  const binDir = join(resourcesDir, 'bin')
  const watermarkModulesDir = join(resourcesDir, 'watermark-runtime', 'node_modules')
  const watermarkGwrScript = join(watermarkModulesDir, '@pilio', 'gemini-watermark-remover', 'bin', 'gwr.mjs')
  const watermarkBrowsersDir = join(watermarkModulesDir, 'playwright-core', '.local-browsers')

  const backendExe = join(binDir, 'backend_server.exe')
  if (existsSync(backendExe)) {
    try {
      const backendProc = spawn(backendExe, [], {
        cwd: binDir,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          APP_DATA_DIR: userDataDir,
          PORT: '8000',
          HOST: '127.0.0.1',
          WATERMARK_NODE_PATH: process.execPath,
          WATERMARK_NODE_IS_ELECTRON: '1',
          WATERMARK_GWR_SCRIPT: watermarkGwrScript,
          WATERMARK_PLAYWRIGHT_BROWSERS_PATH: watermarkBrowsersDir,
        },
      })
      backendProcesses.push(backendProc)
      console.log(`[Electron] Started backend process (PID: ${backendProc.pid})`)
    } catch (err) {
      console.error('[Electron] Failed to start backend_server.exe:', err)
    }
  }

  const voiceExe = join(binDir, 'voice_server.exe')
  if (existsSync(voiceExe)) {
    try {
      const ffmpegExe = join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
      const voicePath = [binDir, process.env.PATH].filter(Boolean).join(delimiter)
      const voiceProc = spawn(voiceExe, [], {
        cwd: binDir,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          APP_DATA_DIR: userDataDir,
          HF_HOME: join(userDataDir, 'voice_data', 'models'),
          PATH: voicePath,
          PORT: '8001',
          HOST: '127.0.0.1',
          ...(existsSync(ffmpegExe) ? { FFMPEG_PATH: ffmpegExe } : {}),
        },
      })
      backendProcesses.push(voiceProc)
      console.log(`[Electron] Started voice process (PID: ${voiceProc.pid})`)
    } catch (err) {
      console.error('[Electron] Failed to start voice_server.exe:', err)
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('video:choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, { properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('video:get-default-folder', () => app.getPath('downloads'))

ipcMain.handle('video:save-file', async (_event, payload: { folder: string; name: string; data: ArrayBuffer }) => {
  const safeName = basename(payload.name).replace(/[<>:"/\\|?*]+/g, '_')
  const target = join(payload.folder, safeName)
  await writeFile(target, Buffer.from(payload.data))
  return target
})

function is9RouterRunning(port = 20128): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}`, (res) => {
      resolve(true)
      res.resume()
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1200, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function start9Router(port = 20128): Promise<boolean> {
  if (await is9RouterRunning(port)) return true

  try {
    const proc = spawn('9router', ['-p', String(port), '-t', '-n'], {
      windowsHide: true,
      stdio: 'ignore',
      shell: true,
    })
    proc.on('error', (err) => console.error('[9router] Spawn error:', err))
    backendProcesses.push(proc)
    routerProcess = proc

    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 400))
      if (await is9RouterRunning(port)) {
        console.log(`[9router] Ready on port ${port}`)
        return true
      }
    }
  } catch (err) {
    console.error('[9router] Failed to start:', err)
  }
  return false
}

ipcMain.handle('open-9router-dashboard', async () => {
  // 1. Khởi động 9router nếu chưa chạy
  await start9Router(20128)

  // 2. Nếu cửa sổ đã mở, đưa lên trước
  if (routerDashboardWindow && !routerDashboardWindow.isDestroyed()) {
    routerDashboardWindow.show()
    routerDashboardWindow.focus()
    return { ok: true }
  }

  // 3. Mở cửa sổ Electron chuyên biệt cho 9Router
  routerDashboardWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 800,
    minHeight: 550,
    title: '9Router - AI Infrastructure Management',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:9router',
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Các popup OAuth mở bằng trình duyệt hệ thống
  routerDashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  routerDashboardWindow.webContents.on('dom-ready', () => {
    routerDashboardWindow?.webContents.executeJavaScript(`
      try {
        const input = document.querySelector('input[type="password"]');
        if (input && !input.value) {
          input.placeholder = '123456 (Mật khẩu mặc định)';
        }
      } catch (e) {}
    `).catch(() => {})
  })

  routerDashboardWindow.on('closed', () => {
    routerDashboardWindow = null
    mainWindow?.webContents.send('9router:updated')
  })

  await routerDashboardWindow.loadURL('http://localhost:20128/')
  return { ok: true }
})

ipcMain.handle('check-9router-status', async () => {
  const running = await is9RouterRunning(20128)
  return { running }
})

app.whenReady().then(() => {
  startProductionBackend()
  createWindow()
  if (mainWindow) {
    mainWindow.on('focus', () => {
      mainWindow?.webContents.send('9router:updated')
    })
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function cleanUpBackends() {
  for (const proc of backendProcesses) {
    killProcessTree(proc.pid)
  }
  backendProcesses.length = 0
}

app.on('before-quit', () => {
  cleanUpBackends()
})

app.on('window-all-closed', () => {
  cleanUpBackends()
  if (process.platform !== 'darwin') app.quit()
})

