export type AuthMethod = 'password' | 'privateKey' | 'agent'

export interface SessionConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  /** Relative path under user data or absolute path to private key file */
  privateKeyPath?: string
  group?: string
  color?: string
  tags?: string[]
  favorite?: boolean
  lastConnectedAt?: number
  /** Whether a credential is stored for this session (never the secret itself) */
  hasCredential?: boolean
}

export interface SessionInput {
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  privateKeyPath?: string
  group?: string
  color?: string
  tags?: string[]
  favorite?: boolean
  /** Plain password or key passphrase — stored encrypted, never returned as plain text later */
  password?: string
  passphrase?: string
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface ActiveSessionInfo {
  id: string
  sessionConfigId: string
  name: string
  status: ConnectionStatus
  error?: string
}

export interface SftpEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  modifyTime: number
  accessTime: number
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
  /** One-shot password if not stored */
  password?: string
  passphrase?: string
}

/** API exposed to renderer via contextBridge */
export interface VexoApi {
  sessions: {
    list: () => Promise<SessionConfig[]>
    save: (input: SessionInput & { id?: string }) => Promise<SessionConfig>
    delete: (id: string) => Promise<void>
    setFavorite: (id: string, favorite: boolean) => Promise<SessionConfig>
  }
  ssh: {
    connect: (options: ConnectOptions) => Promise<ActiveSessionInfo>
    disconnect: (activeSessionId: string) => Promise<void>
    write: (activeSessionId: string, data: string) => Promise<void>
    resize: (activeSessionId: string, cols: number, rows: number) => Promise<void>
    listActive: () => Promise<ActiveSessionInfo[]>
    onData: (callback: (activeSessionId: string, data: string) => void) => () => void
    onStatus: (callback: (info: ActiveSessionInfo) => void) => () => void
  }
  sftp: {
    list: (activeSessionId: string, remotePath: string) => Promise<SftpEntry[]>
    mkdir: (activeSessionId: string, remotePath: string) => Promise<void>
    rename: (activeSessionId: string, from: string, to: string) => Promise<void>
    remove: (activeSessionId: string, remotePath: string, isDir: boolean) => Promise<void>
    chmod: (activeSessionId: string, remotePath: string, mode: string) => Promise<void>
    download: (
      activeSessionId: string,
      remotePath: string,
      localPath?: string
    ) => Promise<{ transferId: string; localPath: string }>
    upload: (
      activeSessionId: string,
      localPath: string,
      remotePath: string
    ) => Promise<{ transferId: string }>
    pickLocalFiles: () => Promise<string[]>
    pickSavePath: (defaultName: string) => Promise<string | null>
    onProgress: (callback: (progress: TransferProgress) => void) => () => void
  }
  path: {
    getPathForFile: (file: File) => string
  }
}
