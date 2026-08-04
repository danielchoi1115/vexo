import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, app } from 'electron'
import { join } from 'path'
import type { ConnectOptions, SessionInput, TreeReorderPayload, AppSettings } from '../shared/types'
import * as sessionStore from './sessionStore'
import * as settingsStore from './settingsStore'
import type { SshManager } from './ssh/SshManager'

export function registerIpc(ssh: SshManager, getWindow: () => BrowserWindow | null): void {
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
    'sftp:upload',
    (_e, activeSessionId: string, localPath: string, remotePath: string) =>
      ssh.upload(activeSessionId, localPath, remotePath)
  )
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

  // Native drag-out (after file is local)
  ipcMain.on('sftp:startDrag', (event, localPath: string) => {
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.png'))
    event.sender.startDrag({
      file: localPath,
      icon: icon.isEmpty() ? nativeImage.createEmpty() : icon
    })
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
