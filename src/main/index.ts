import { app, shell, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { SshManager } from './ssh/SshManager'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
const sshManager = new SshManager(() => mainWindow)

function resolveAppIcon(): string | Electron.NativeImage {
  // Packaged: electron-builder puts icons via buildResources; runtime uses resources/
  // Dev: Vite asset URL / path from resources/icon.png
  if (icon) {
    const img = nativeImage.createFromPath(icon)
    if (!img.isEmpty()) return img
  }
  const candidates = [
    join(__dirname, '../../resources/icon.png'),
    join(process.resourcesPath ?? '', 'icon.png'),
    join(app.getAppPath(), 'resources', 'icon.png')
  ]
  for (const p of candidates) {
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    } catch {
      /* try next */
    }
  }
  return icon
}

function createWindow(): void {
  const appIcon = resolveAppIcon()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Vexo',
    // Windows/Linux window & taskbar; macOS uses .icns from the bundle for Dock
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Ensure OS chrome never falls back to "Electron"
  mainWindow.setTitle('Vexo')

  // Windows/Linux: a hidden menu bar still takes focus on Alt (IME 한/영).
  // Removing the window menu — not swallowing Alt — leaves terminal Meta keys intact.
  if (process.platform !== 'darwin') {
    mainWindow.setMenu(null)
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.setTitle('Vexo')
    mainWindow?.show()
  })

  // Prevent Chromium page zoom so Ctrl+wheel only affects terminal font size
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  mainWindow.webContents.on('zoom-changed', () => {
    mainWindow?.webContents.setZoomFactor(1)
  })

  // Ctrl+Arrow: Chromium/Electron may treat as history or never deliver to the page.
  // Intercept and dispatch a reliable IPC shortcut for cross-pane tab cycling.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (!(input.control || input.meta) || input.alt) return
    const left = input.key === 'ArrowLeft' || input.key === 'Left'
    const right = input.key === 'ArrowRight' || input.key === 'Right'
    if (!left && !right) return
    event.preventDefault()
    mainWindow?.webContents.send('app:shortcut', {
      action: right ? 'tab-next' : 'tab-prev'
    })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.vexo.ssh')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc(sshManager, () => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Last-resort: network/SSH socket errors must never take down the whole app.
// SshManager attaches Client 'error' handlers; this covers any missed edge case.
process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err)
  const code = (err as NodeJS.ErrnoException)?.code
  const networkish =
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    /Connection lost before handshake/i.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /read ECONNRESET/i.test(msg)
  if (networkish) {
    console.error('[vexo] swallowed network/SSH error:', msg)
    return
  }
  console.error('[vexo] uncaughtException:', err)
})

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  if (/ECONNRESET|Connection lost before handshake|ECONNREFUSED|EPIPE|ETIMEDOUT/i.test(msg)) {
    console.error('[vexo] swallowed unhandledRejection:', msg)
    return
  }
  console.error('[vexo] unhandledRejection:', reason)
})

app.on('window-all-closed', () => {
  sshManager.disposeAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  sshManager.disposeAll()
})
