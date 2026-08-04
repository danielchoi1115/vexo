import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ConnectOptions, SessionInput } from '../shared/types'
import * as sessionStore from './sessionStore'
import type { SshManager } from './ssh/SshManager'

export function registerIpc(ssh: SshManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('sessions:list', () => sessionStore.listSessions())

  ipcMain.handle('sessions:save', (_e, input: SessionInput & { id?: string }) => {
    return sessionStore.saveSession(input)
  })

  ipcMain.handle('sessions:delete', (_e, id: string) => {
    sessionStore.deleteSession(id)
  })

  ipcMain.handle('sessions:setFavorite', (_e, id: string, favorite: boolean) => {
    const s = sessionStore.setFavorite(id, favorite)
    if (!s) throw new Error('Session not found')
    return s
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
    const result = await dialog.showSaveDialog(win!, { defaultPath: defaultName })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })
}
