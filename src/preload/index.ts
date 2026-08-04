import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ActiveSessionInfo,
  AppSettings,
  ConnectOptions,
  RemoteMetrics,
  SessionInput,
  TransferProgress,
  TreeReorderPayload,
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
    listFolders: () => ipcRenderer.invoke('sessions:listFolders'),
    save: (input: SessionInput & { id?: string }) => ipcRenderer.invoke('sessions:save', input),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    setFavorite: (id: string, favorite: boolean) =>
      ipcRenderer.invoke('sessions:setFavorite', id, favorite),
    createFolder: (name: string) => ipcRenderer.invoke('sessions:createFolder', name),
    renameFolder: (id: string, name: string) =>
      ipcRenderer.invoke('sessions:renameFolder', id, name),
    deleteFolder: (id: string) => ipcRenderer.invoke('sessions:deleteFolder', id),
    setFolderCollapsed: (id: string, collapsed: boolean) =>
      ipcRenderer.invoke('sessions:setFolderCollapsed', id, collapsed),
    reorder: (payload: TreeReorderPayload) => ipcRenderer.invoke('sessions:reorder', payload),
    export: () => ipcRenderer.invoke('sessions:export'),
    import: (mode?: 'merge' | 'replace') => ipcRenderer.invoke('sessions:import', mode ?? 'merge')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', partial),
    listFonts: () => ipcRenderer.invoke('settings:listFonts')
  },
  ssh: {
    connect: (options: ConnectOptions) => ipcRenderer.invoke('ssh:connect', options),
    disconnect: (activeSessionId: string) => ipcRenderer.invoke('ssh:disconnect', activeSessionId),
    write: (activeSessionId: string, data: string) =>
      ipcRenderer.invoke('ssh:write', activeSessionId, data),
    resize: (activeSessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('ssh:resize', activeSessionId, cols, rows),
    listActive: () => ipcRenderer.invoke('ssh:listActive'),
    onData: (callback) => onChannel<[string, string]>('ssh:data', callback),
    onStatus: (callback: (info: ActiveSessionInfo) => void) =>
      onChannel<[ActiveSessionInfo]>('ssh:status', callback),
    onCwd: (callback: (activeSessionId: string, cwd: string) => void) =>
      onChannel<[string, string]>('ssh:cwd', callback),
    onMetrics: (callback: (metrics: RemoteMetrics) => void) =>
      onChannel<[RemoteMetrics]>('ssh:metrics', callback)
  },
  sftp: {
    list: (activeSessionId, remotePath) =>
      ipcRenderer.invoke('sftp:list', activeSessionId, remotePath),
    home: (activeSessionId) => ipcRenderer.invoke('sftp:home', activeSessionId),
    mkdir: (activeSessionId, remotePath) =>
      ipcRenderer.invoke('sftp:mkdir', activeSessionId, remotePath),
    rename: (activeSessionId, from, to) =>
      ipcRenderer.invoke('sftp:rename', activeSessionId, from, to),
    remove: (activeSessionId, remotePath, isDir) =>
      ipcRenderer.invoke('sftp:remove', activeSessionId, remotePath, isDir),
    chmod: (activeSessionId, remotePath, mode) =>
      ipcRenderer.invoke('sftp:chmod', activeSessionId, remotePath, mode),
    download: (activeSessionId, remotePath, localPath) =>
      ipcRenderer.invoke('sftp:download', activeSessionId, remotePath, localPath),
    downloadToDesktop: (activeSessionId, remotePath) =>
      ipcRenderer.invoke('sftp:downloadToDesktop', activeSessionId, remotePath),
    upload: (activeSessionId, localPath, remotePath) =>
      ipcRenderer.invoke('sftp:upload', activeSessionId, localPath, remotePath),
    pickLocalFiles: () => ipcRenderer.invoke('sftp:pickLocalFiles'),
    pickSavePath: (defaultName) => ipcRenderer.invoke('sftp:pickSavePath', defaultName),
    startDrag: (localPath: string) => {
      ipcRenderer.send('sftp:startDrag', localPath)
    },
    onProgress: (callback: (progress: TransferProgress) => void) =>
      onChannel<[TransferProgress]>('sftp:progress', callback)
  },
  dialog: {
    pickPrivateKey: () => ipcRenderer.invoke('dialog:pickPrivateKey')
  },
  path: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    desktop: () => ipcRenderer.invoke('path:desktop')
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text)
  },
  window: {
    setTitle: (title: string) => ipcRenderer.invoke('window:setTitle', title)
  }
}

contextBridge.exposeInMainWorld('api', api)
