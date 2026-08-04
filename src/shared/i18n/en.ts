export const en = {
  app: {
    brand: 'Vexo',
    welcomeTitle: 'Welcome to Vexo',
    welcomeBody: 'Double-click a saved session on the left to connect.',
    welcomeHint: 'Right-click the session list for New Session / New Folder.',
    maxSessions: 'Maximum {max} sessions can be open at once.'
  },
  common: {
    ok: 'OK',
    cancel: 'Cancel',
    apply: 'Apply',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    connect: 'Connect',
    settings: 'Settings',
    optional: '(optional)',
    dismiss: 'Dismiss',
    create: 'Create',
    rename: 'Rename',
    open: 'Open',
    refresh: 'Refresh'
  },
  sidebar: {
    sessions: 'Sessions',
    sftp: 'SFTP',
    newSession: 'New session',
    search: 'Search…',
    connectFirst: 'Connect a session first',
    emptySessions: 'Click + or right-click for New Session / New Folder',
    sftpNeedConnect: 'Connect a session to use SFTP.'
  },
  session: {
    newSession: 'New session',
    editSession: 'Edit session',
    newFolder: 'New folder',
    folderName: 'Folder name',
    name: 'Name',
    host: 'Host',
    port: 'Port',
    username: 'Username',
    auth: 'Auth',
    password: 'Password',
    privateKey: 'Private key',
    privateKeyPath: 'Private key path',
    passphrase: 'Passphrase',
    agent: 'SSH agent',
    browse: 'Browse…',
    x11: 'X11-Forwarding',
    compression: 'Compression',
    backspace: 'Backspace sends ^H',
    leaveEmptyUsername: 'Leave empty to type at connect',
    selectKey: 'Select key file…',
    favorite: 'Favorite',
    unfavorite: 'Unfavorite',
    duplicate: 'Duplicate',
    selectFolder: 'Select folder',
    newSessionHere: 'New Session here',
    expand: 'Expand',
    collapse: 'Collapse',
    deleteFolder: 'Delete folder',
    deleteFolderConfirm: 'Delete folder "{name}"? Sessions move to root.',
    deleteSessionConfirm: 'Delete session "{name}"?',
    export: 'Export sessions…',
    importMerge: 'Import sessions (merge)…',
    importReplace: 'Import sessions (replace)…',
    replaceConfirm: 'Replace all current sessions and folders?',
    exportedTo: 'Exported to:\n{path}',
    imported: 'Imported {sessions} session(s), {folders} folder(s).',
    replaced: 'Replaced with {sessions} session(s), {folders} folder(s).'
  },
  tabs: {
    close: 'Close',
    closeTab: 'Close tab',
    closeOthers: 'Close all except this tab',
    closeDisconnected: 'Close all disconnected',
    closeAll: 'Close all tabs'
  },
  sftp: {
    connectToBrowse: 'Connect a session to browse files.',
    empty: 'Empty — drop files to upload',
    followFolder: 'Follow terminal folder',
    open: 'Open',
    download: 'Download',
    downloadDesktop: 'Download to Desktop',
    delete: 'Delete',
    rename: 'Rename',
    copyPath: 'Copy file path',
    properties: 'Properties',
    permissions: 'Permissions',
    deleteConfirm: 'Delete {name}?',
    chmodLabel: 'Octal mode (e.g. 755)',
    refresh: 'Refresh'
  },
  settings: {
    title: 'Settings',
    general: 'General',
    appearance: 'Appearance',
    generalDesc: 'Language, behavior, and remote tools.',
    appearanceDesc: 'Terminal fonts, UI fonts, and theme.',
    language: 'Language',
    pasteRightClick: 'Paste using right-click',
    pasteRightClickHint: 'Paste clipboard text into the terminal',
    copyOnSelect: 'Copy on select',
    copyOnSelectHint:
      'Copy when you drag-select text. Disables Ctrl+C / Ctrl+V clipboard shortcuts.',
    remoteMonitoring: 'Remote monitoring',
    remoteMonitoringHint: 'Show hostname, CPU, memory, network, uptime, storage',
    terminalFont: 'Terminal Font Family',
    terminalFontSize: 'Terminal Font Size ({size}px)',
    uiFont: 'UI Font Family',
    uiFontSize: 'UI Font Size ({size}px)',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light'
  },
  locale: {
    en: 'English',
    ko: '한국어'
  }
}

type DeepStringify<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringify<T[K]>
}

export type MessageTree = DeepStringify<typeof en>
