import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

let mainWindow: BrowserWindow | null = null
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

  const backendExe = join(resourcesDir, 'bin', 'backend_server.exe')
  if (existsSync(backendExe)) {
    try {
      const backendProc = spawn(backendExe, [], {
        cwd: join(resourcesDir, 'bin'),
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          APP_DATA_DIR: userDataDir,
          PORT: '8000',
          HOST: '127.0.0.1',
        },
      })
      backendProcesses.push(backendProc)
      console.log(`[Electron] Started backend process (PID: ${backendProc.pid})`)
    } catch (err) {
      console.error('[Electron] Failed to start backend_server.exe:', err)
    }
  }

  const voiceExe = join(resourcesDir, 'bin', 'voice_server.exe')
  if (existsSync(voiceExe)) {
    try {
      const voiceProc = spawn(voiceExe, [], {
        cwd: join(resourcesDir, 'bin'),
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          APP_DATA_DIR: userDataDir,
          PORT: '8001',
          HOST: '127.0.0.1',
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

app.whenReady().then(() => {
  startProductionBackend()
  createWindow()
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

