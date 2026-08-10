export type AuthMethod = 'password' | 'privateKey' | 'agent'

/** Terminal byte encoding for SSH I/O */
export type TerminalEncoding = 'utf-8' | 'euc-kr' | 'cp949' | 'gbk' | 'latin1'

export type CursorStyle = 'block' | 'underline' | 'bar'
export type BellStyle = 'none' | 'visual' | 'sound'
/** OpenSSH-like host key checking */
export type HostKeyPolicy = 'accept-new' | 'strict' | 'ignore'
export type TermType = 'xterm-256color' | 'xterm' | 'vt100'
/** When to offer / apply password save after login */
export type PasswordSavePolicy = 'ask' | 'always' | 'never'

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
  /** True when a password is stored for this session (never the secret itself) */
  hasCredential?: boolean
  /** True when a private-key passphrase is stored */
  hasPassphrase?: boolean
  /** Default true */
  x11Forwarding?: boolean
  /** Default true */
  compression?: boolean
  /** Default true — send ^H (0x08) instead of DEL (0x7f) for Backspace */
  backspaceSendsCtrlH?: boolean
  /** Terminal encoding for this session (default utf-8) */
  encoding?: TerminalEncoding
  /** TERM env / ssh term (default xterm-256color) */
  termType?: TermType
  /** Remote directory after login (optional) */
  startupDirectory?: string
  /** Command run once after shell is ready (optional) */
  startupCommand?: string
  /**
   * Password save behavior for password auth:
   * ask | always | never (default ask)
   */
  passwordSavePolicy?: PasswordSavePolicy
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
  /** Saved only when username is non-empty (account-scoped) */
  password?: string
  passphrase?: string
  x11Forwarding?: boolean
  compression?: boolean
  backspaceSendsCtrlH?: boolean
  encoding?: TerminalEncoding
  termType?: TermType
  startupDirectory?: string
  startupCommand?: string
  passwordSavePolicy?: PasswordSavePolicy
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
  encoding?: TerminalEncoding
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
  /** 1-based index when several files share one transfer job */
  batchIndex?: number
  batchTotal?: number
}

export interface ConnectOptions {
  sessionConfigId: string
  password?: string
  passphrase?: string
}

export type LocaleId = 'en' | 'ko'

export interface AppSettings {
  locale: LocaleId
  /** Terminal (xterm) font */
  terminalFontFamily: string
  terminalFontSize: number
  /** App chrome / menus UI font */
  uiFontFamily: string
  uiFontSize: number
  colorScheme: ColorSchemeId
  pasteOnRightClick: boolean
  remoteMonitoring: boolean
  /**
   * When true: selecting text in the terminal copies to clipboard automatically.
   * Ctrl+C / Ctrl+V clipboard shortcuts are disabled in that mode.
   * When false: use Ctrl+C (with selection) / Ctrl+V for copy-paste.
   */
  copyOnSelect: boolean
  /** SSH TCP keep-alive interval in seconds (0 = off) */
  keepAliveIntervalSec: number
  /** xterm scrollback buffer lines */
  scrollback: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  bellStyle: BellStyle
  /** Soft wrap at terminal edge (DECAWM) */
  /** Default encoding for new sessions */
  defaultEncoding: TerminalEncoding
  /** Default TERM for new sessions */
  defaultTermType: TermType
  hostKeyPolicy: HostKeyPolicy
  /** @deprecated migrated to terminal* / ui* */
  fontFamily?: string
  fontSize?: number
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
    export: (opts?: {
      includeSecrets?: boolean
      password?: string
    }) => Promise<{ canceled: true } | { ok: true; path: string }>
    /** Open file picker only — canceled leaves the UI modal open */
    pickImportFile: () => Promise<
      | { canceled: true }
      | { ok: true; path: string; encrypted: boolean }
    >
    /** Import a previously picked file (replace). Password only if encrypted. */
    importFile: (
      filePath: string,
      password?: string
    ) => Promise<{ ok: true; folders: number; sessions: number; path: string }>
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
    /** Password save dialog (after auth, before shell) */
    onAskPasswordSave: (
      callback: (payload: {
        activeSessionId: string
        sessionConfigId: string
        username: string
        host: string
      }) => void
    ) => () => void
    answerPasswordSave: (
      activeSessionId: string,
      save: boolean,
      dontAskAgain: boolean
    ) => Promise<void>
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
    /** Multi-file download: one folder/desktop prompt, progress 1/N…N/N */
    downloadBatch: (
      activeSessionId: string,
      remotePaths: string[],
      mode: 'ask' | 'desktop'
    ) => Promise<{ transferId: string }>
    upload: (
      activeSessionId: string,
      localPath: string,
      remotePath: string
    ) => Promise<{ transferId: string }>
    cancel: (transferId: string) => Promise<boolean>
    pickLocalFiles: () => Promise<string[]>
    pickSavePath: (defaultName: string) => Promise<string | null>
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
  window: {
    setTitle: (title: string) => Promise<void>
  }
  /** Main-process delivered shortcuts (Ctrl+Arrow etc. that Chromium may eat) */
  app: {
    getInfo: () => Promise<{ name: string; version: string }>
    onShortcut: (
      callback: (payload: { action: 'tab-next' | 'tab-prev' }) => void
    ) => () => void
  }
  broadcast: {
    getHistory: () => Promise<string[]>
    pushHistory: (line: string) => Promise<string[]>
    clearHistory: () => Promise<string[]>
  }
}
