import { BrowserWindow, clipboard, dialog, ipcMain, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import type { ConnectOptions, SessionInput, TreeReorderPayload, AppSettings } from '../shared/types'
import * as sessionStore from './sessionStore'
import * as settingsStore from './settingsStore'
import * as broadcastHistory from './broadcastHistoryStore'
import type { SshManager } from './ssh/SshManager'

export function registerIpc(ssh: SshManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('window:setTitle', (_e, title: string) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.setTitle(title || 'Vexo')
    }
  })

  ipcMain.handle('broadcast:history:get', () => broadcastHistory.getHistory())
  ipcMain.handle('broadcast:history:push', (_e, line: string) =>
    broadcastHistory.pushCommand(line)
  )
  ipcMain.handle('broadcast:history:clear', () => broadcastHistory.clearHistory())

  ipcMain.handle('sessions:list', () => sessionStore.listSessions())
  ipcMain.handle('sessions:listFolders', () => sessionStore.listFolders())
  ipcMain.handle('sessions:save', (_e, input: SessionInput & { id?: string }) =>
    sessionStore.saveSession(input)
  )
  ipcMain.handle('sessions:delete', (_e, id: string) => {
    sessionStore.deleteSession(id)
  })
  ipcMain.handle('sessions:setFavorite', (_e, id: string, favorite: boolean) => {
    const s = sessionStore.setFavorite(id, favorite)
    if (!s) throw new Error('Session not found')
    return s
  })
  ipcMain.handle('sessions:createFolder', (_e, name: string) => sessionStore.createFolder(name))
  ipcMain.handle('sessions:renameFolder', (_e, id: string, name: string) => {
    const f = sessionStore.renameFolder(id, name)
    if (!f) throw new Error('Folder not found')
    return f
  })
  ipcMain.handle('sessions:deleteFolder', (_e, id: string) => {
    sessionStore.deleteFolder(id)
  })
  ipcMain.handle('sessions:setFolderCollapsed', (_e, id: string, collapsed: boolean) => {
    const f = sessionStore.setFolderCollapsed(id, collapsed)
    if (!f) throw new Error('Folder not found')
    return f
  })
  ipcMain.handle('sessions:reorder', (_e, payload: TreeReorderPayload) => {
    sessionStore.reorder(payload)
  })

  ipcMain.handle(
    'sessions:export',
    async (_e, opts?: { includeSecrets?: boolean; password?: string }) => {
      const win = getWindow()
      const includeSecrets = Boolean(opts?.includeSecrets)
      const password = opts?.password ?? ''
      if (includeSecrets && !password) {
        throw new Error('Password required when exporting secrets')
      }
      const result = await dialog.showSaveDialog(win!, {
        title: includeSecrets ? 'Export sessions (encrypted)' : 'Export sessions',
        defaultPath: join(
          app.getPath('documents'),
          includeSecrets ? 'vexo-sessions.encrypted.json' : 'vexo-sessions.json'
        ),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { canceled: true as const }
      const data = sessionStore.exportData(includeSecrets)
      if (includeSecrets) {
        const { encryptJson } = await import('./sessionCrypto')
        writeFileSync(result.filePath, JSON.stringify(encryptJson(data, password), null, 2), 'utf8')
      } else {
        writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8')
      }
      return { ok: true as const, path: result.filePath }
    }
  )

  ipcMain.handle('sessions:pickImportFile', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import sessions',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true as const }
    const path = result.filePaths[0]
    const raw = readFileSync(path, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Invalid JSON file')
    }
    const { isEncryptedExport } = await import('./sessionCrypto')
    return {
      ok: true as const,
      path,
      encrypted: isEncryptedExport(parsed)
    }
  })

  ipcMain.handle(
    'sessions:importFile',
    async (_e, filePath: string, password?: string) => {
      const raw = readFileSync(filePath, 'utf8')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error('Invalid JSON file')
      }
      const { isEncryptedExport, decryptJson } = await import('./sessionCrypto')
      let data: sessionStore.SessionsExportFile
      if (isEncryptedExport(parsed)) {
        if (!password) throw new Error('Password required for encrypted file')
        try {
          data = decryptJson<sessionStore.SessionsExportFile>(parsed, password)
        } catch {
          throw new Error('Decryption failed — wrong password or corrupt file')
        }
      } else {
        data = parsed as sessionStore.SessionsExportFile
      }
      const stats = sessionStore.importData(data, 'replace')
      return { ok: true as const, ...stats, path: filePath }
    }
  )

  ipcMain.handle('settings:get', () => settingsStore.getSettings())
  ipcMain.handle('settings:set', (_e, partial: Partial<AppSettings>) => {
    const next = settingsStore.updateSettings(partial)
    ssh.refreshMetricsPreference()
    return next
  })
  ipcMain.handle('settings:listFonts', async () => {
    try {
      // font-list is CJS
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fontList = require('font-list') as {
        getFonts: (opts?: { disableQuoting?: boolean }) => Promise<string[]>
      }
      const fonts = await fontList.getFonts({ disableQuoting: true })
      const unique = [...new Set(fonts.map((f) => f.replace(/^"|"$/g, '').trim()))].filter(Boolean)
      unique.sort((a, b) => a.localeCompare(b))
      return unique
    } catch {
      return [
        'Consolas',
        'Cascadia Code',
        'Cascadia Mono',
        'Courier New',
        'Lucida Console',
        'MS Gothic',
        'Segoe UI',
        'Segoe UI Mono'
      ]
    }
  })

  ipcMain.handle('ssh:connect', (_e, options: ConnectOptions) => ssh.connect(options))
  ipcMain.handle('ssh:disconnect', (_e, activeSessionId: string) => ssh.disconnect(activeSessionId))
  ipcMain.handle('ssh:write', (_e, activeSessionId: string, data: string) => {
    ssh.write(activeSessionId, data)
  })
  ipcMain.handle('ssh:resize', (_e, activeSessionId: string, cols: number, rows: number) => {
    ssh.resize(activeSessionId, cols, rows)
  })
  ipcMain.handle('ssh:listActive', () => ssh.listActive())
  ipcMain.handle(
    'ssh:answerPasswordSave',
    (_e, activeSessionId: string, save: boolean, dontAskAgain: boolean) => {
      ssh.answerPasswordSave(activeSessionId, save, dontAskAgain)
    }
  )

  ipcMain.handle('sftp:list', (_e, activeSessionId: string, remotePath: string) =>
    ssh.listDir(activeSessionId, remotePath)
  )
  ipcMain.handle('sftp:home', (_e, activeSessionId: string) => ssh.homeDir(activeSessionId))
  ipcMain.handle('sftp:mkdir', (_e, activeSessionId: string, remotePath: string) =>
    ssh.mkdir(activeSessionId, remotePath)
  )
  ipcMain.handle('sftp:rename', (_e, activeSessionId: string, from: string, to: string) =>
    ssh.rename(activeSessionId, from, to)
  )
  ipcMain.handle('sftp:remove', (_e, activeSessionId: string, remotePath: string, isDir: boolean) =>
    ssh.remove(activeSessionId, remotePath, isDir)
  )
  ipcMain.handle('sftp:chmod', (_e, activeSessionId: string, remotePath: string, mode: string) =>
    ssh.chmod(activeSessionId, remotePath, mode)
  )
  ipcMain.handle(
    'sftp:download',
    (_e, activeSessionId: string, remotePath: string, localPath?: string) =>
      ssh.download(activeSessionId, remotePath, localPath)
  )
  ipcMain.handle('sftp:downloadToDesktop', (_e, activeSessionId: string, remotePath: string) =>
    ssh.downloadToDesktop(activeSessionId, remotePath)
  )
  ipcMain.handle(
    'sftp:downloadBatch',
    (_e, activeSessionId: string, remotePaths: string[], mode: 'ask' | 'desktop') =>
      ssh.downloadBatch(activeSessionId, remotePaths, mode)
  )
  ipcMain.handle(
    'sftp:upload',
    (_e, activeSessionId: string, localPath: string, remotePath: string) =>
      ssh.upload(activeSessionId, localPath, remotePath)
  )
  ipcMain.handle('sftp:cancel', (_e, transferId: string) => ssh.cancelTransfer(transferId))
  ipcMain.handle('sftp:pickLocalFiles', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('sftp:pickSavePath', async (_e, defaultName: string) => {
    const win = getWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: join(app.getPath('desktop'), defaultName)
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  ipcMain.handle('dialog:pickPrivateKey', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select private key',
      properties: ['openFile'],
      filters: [
        { name: 'Key files', extensions: ['pem', 'ppk', 'key', 'pub', ''] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('path:desktop', () => app.getPath('desktop'))
  ipcMain.handle('clipboard:writeText', (_e, text: string) => {
    clipboard.writeText(text)
  })
}
