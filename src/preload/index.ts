import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ActiveSessionInfo,
  ConnectOptions,
  SessionConfig,
  SessionInput,
  SftpEntry,
  TransferProgress,
  VexoApi
} from '../shared/types'

function onChannel<T extends unknown[]>(
  channel: string,
  callback: (...args: T) => void
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: T): void => {
    callback(...args)
  }
  ipcRenderer.on(channel, handler as never)
  return () => {
    ipcRenderer.removeListener(channel, handler as never)
  }
}

const api: VexoApi = {
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    save: (input: SessionInput & { id?: string }) => ipcRenderer.invoke('sessions:save', input),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    setFavorite: (id: string, favorite: boolean) =>
      ipcRenderer.invoke('sessions:setFavorite', id, favorite)
  },
  ssh: {
    connect: (options: ConnectOptions) => ipcRenderer.invoke('ssh:connect', options),
    disconnect: (activeSessionId: string) => ipcRenderer.invoke('ssh:disconnect', activeSessionId),
    write: (activeSessionId: string, data: string) =>
      ipcRenderer.invoke('ssh:write', activeSessionId, data),
    resize: (activeSessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('ssh:resize', activeSessionId, cols, rows),
    listActive: () => ipcRenderer.invoke('ssh:listActive'),
    onData: (callback: (activeSessionId: string, data: string) => void) =>
      onChannel<[string, string]>('ssh:data', callback),
    onStatus: (callback: (info: ActiveSessionInfo) => void) =>
      onChannel<[ActiveSessionInfo]>('ssh:status', callback)
  },
  sftp: {
    list: (activeSessionId: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:list', activeSessionId, remotePath),
    mkdir: (activeSessionId: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:mkdir', activeSessionId, remotePath),
    rename: (activeSessionId: string, from: string, to: string) =>
      ipcRenderer.invoke('sftp:rename', activeSessionId, from, to),
    remove: (activeSessionId: string, remotePath: string, isDir: boolean) =>
      ipcRenderer.invoke('sftp:remove', activeSessionId, remotePath, isDir),
    chmod: (activeSessionId: string, remotePath: string, mode: string) =>
      ipcRenderer.invoke('sftp:chmod', activeSessionId, remotePath, mode),
    download: (activeSessionId: string, remotePath: string, localPath?: string) =>
      ipcRenderer.invoke('sftp:download', activeSessionId, remotePath, localPath),
    upload: (activeSessionId: string, localPath: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:upload', activeSessionId, localPath, remotePath),
    pickLocalFiles: () => ipcRenderer.invoke('sftp:pickLocalFiles'),
    pickSavePath: (defaultName: string) => ipcRenderer.invoke('sftp:pickSavePath', defaultName),
    onProgress: (callback: (progress: TransferProgress) => void) =>
      onChannel<[TransferProgress]>('sftp:progress', callback)
  },
  path: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('api', api)

// Keep type-only exports happy for consumers importing SessionConfig etc. in d.ts
export type { SessionConfig, SftpEntry }
