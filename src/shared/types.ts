export type AuthMethod = 'password' | 'privateKey' | 'agent'

export type ColorSchemeId =
  | 'github-dark'
  | 'dracula'
  | 'monokai'
  | 'solarized-dark'
  | 'nord'
  | 'one-dark'
  | 'tokyo-night'
  | 'catppuccin-mocha'
  | 'gruvbox-dark'
  | 'ayu-dark'
  | 'github-light'
  | 'solarized-light'
  | 'one-light'
  | 'catppuccin-latte'
  | 'gruvbox-light'
  | 'paper'

export interface SessionFolder {
  id: string
  name: string
  order: number
  collapsed: boolean
}

export interface SessionConfig {
  id: string
  name: string
  host: string
  port: number
  /** Optional — if empty, prompted in the terminal */
  username: string
  authMethod: AuthMethod
  privateKeyPath?: string
  /** Folder id, or null/undefined for root */
  folderId?: string | null
  /** Sort order within folder/root */
  order: number
  color?: string
  tags?: string[]
  favorite?: boolean
  lastConnectedAt?: number
  hasCredential?: boolean
  /** Default true */
  x11Forwarding?: boolean
  /** Default true */
  compression?: boolean
  /** Default true — send ^H (0x08) instead of DEL (0x7f) for Backspace */
  backspaceSendsCtrlH?: boolean
}

export interface SessionInput {
  name: string
  host: string
  port: number
  username?: string
  authMethod: AuthMethod
  privateKeyPath?: string
  folderId?: string | null
  order?: number
  color?: string
  tags?: string[]
  favorite?: boolean
  password?: string
  passphrase?: string
  x11Forwarding?: boolean
  compression?: boolean
  backspaceSendsCtrlH?: boolean
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface ActiveSessionInfo {
  id: string
  sessionConfigId: string
  name: string
  status: ConnectionStatus
  error?: string
  remoteCwd?: string
  backspaceSendsCtrlH?: boolean
}

export interface SftpEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifyTime: number
  accessTime: number
  mode?: number
  rights?: { user: string; group: string; other: string }
  owner?: number
  group?: number
}

export interface TransferProgress {
  transferId: string
  activeSessionId: string
  filename: string
  direction: 'upload' | 'download'
  transferred: number
  total: number
  done: boolean
  error?: string
}

export interface ConnectOptions {
  sessionConfigId: string
  password?: string
  passphrase?: string
}

export interface AppSettings {
  fontFamily: string
  fontSize: number
  colorScheme: ColorSchemeId
  pasteOnRightClick: boolean
  remoteMonitoring: boolean
}

export interface RemoteMetrics {
  activeSessionId: string
  hostname: string
  cpu: string
  memory: string
  network: string
  uptime: string
  storage: string
  error?: string
}

export interface TreeReorderPayload {
  dragId: string
  dragType: 'session' | 'folder'
  targetFolderId: string | null
  targetIndex: number
}

export interface VexoApi {
  sessions: {
    list: () => Promise<SessionConfig[]>
    listFolders: () => Promise<SessionFolder[]>
    save: (input: SessionInput & { id?: string }) => Promise<SessionConfig>
    delete: (id: string) => Promise<void>
    setFavorite: (id: string, favorite: boolean) => Promise<SessionConfig>
    createFolder: (name: string) => Promise<SessionFolder>
    renameFolder: (id: string, name: string) => Promise<SessionFolder>
    deleteFolder: (id: string) => Promise<void>
    setFolderCollapsed: (id: string, collapsed: boolean) => Promise<SessionFolder>
    reorder: (payload: TreeReorderPayload) => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (partial: Partial<AppSettings>) => Promise<AppSettings>
    listFonts: () => Promise<string[]>
  }
  ssh: {
    connect: (options: ConnectOptions) => Promise<ActiveSessionInfo>
    disconnect: (activeSessionId: string) => Promise<void>
    write: (activeSessionId: string, data: string) => Promise<void>
    resize: (activeSessionId: string, cols: number, rows: number) => Promise<void>
    listActive: () => Promise<ActiveSessionInfo[]>
    onData: (callback: (activeSessionId: string, data: string) => void) => () => void
    onStatus: (callback: (info: ActiveSessionInfo) => void) => () => void
    onCwd: (callback: (activeSessionId: string, cwd: string) => void) => () => void
    onMetrics: (callback: (metrics: RemoteMetrics) => void) => () => void
  }
  sftp: {
    list: (activeSessionId: string, remotePath: string) => Promise<SftpEntry[]>
    home: (activeSessionId: string) => Promise<string>
    mkdir: (activeSessionId: string, remotePath: string) => Promise<void>
    rename: (activeSessionId: string, from: string, to: string) => Promise<void>
    remove: (activeSessionId: string, remotePath: string, isDir: boolean) => Promise<void>
    chmod: (activeSessionId: string, remotePath: string, mode: string) => Promise<void>
    download: (
      activeSessionId: string,
      remotePath: string,
      localPath?: string
    ) => Promise<{ transferId: string; localPath: string }>
    downloadToDesktop: (
      activeSessionId: string,
      remotePath: string
    ) => Promise<{ transferId: string; localPath: string }>
    upload: (
      activeSessionId: string,
      localPath: string,
      remotePath: string
    ) => Promise<{ transferId: string }>
    pickLocalFiles: () => Promise<string[]>
    pickSavePath: (defaultName: string) => Promise<string | null>
    startDrag: (localPath: string) => void
    onProgress: (callback: (progress: TransferProgress) => void) => () => void
  }
  dialog: {
    pickPrivateKey: () => Promise<string | null>
  }
  path: {
    getPathForFile: (file: File) => string
    desktop: () => Promise<string>
  }
  clipboard: {
    writeText: (text: string) => Promise<void>
  }
}
