import Store from 'electron-store'
import type {
  SessionConfig,
  SessionFolder,
  SessionInput,
  TreeReorderPayload
} from '../shared/types'
import {
  deleteSecret,
  exportPasswordsForSession,
  getPassphraseForExport,
  hasAnyPassword,
  hasPassphrase,
  importPasswordsForSession,
  migrateLegacyPassword,
  setPassphrase,
  setPassphraseFromImport,
  setPassword
} from './credentialStore'

interface SessionSchema {
  sessions: SessionConfig[]
  folders: SessionFolder[]
}

const store = new Store<SessionSchema>({
  name: 'sessions',
  defaults: { sessions: [], folders: [] }
})

// Migrate legacy `group` string → folders once
function migrate(): void {
  const sessions = store.get('sessions') as Array<SessionConfig & { group?: string }>
  let folders = store.get('folders')
  let changed = false

  for (const s of sessions) {
    if (typeof s.order !== 'number') {
      s.order = 0
      changed = true
    }
    if (s.x11Forwarding === undefined) {
      s.x11Forwarding = true
      changed = true
    }
    if (s.compression === undefined) {
      s.compression = true
      changed = true
    }
    if (s.backspaceSendsCtrlH === undefined) {
      s.backspaceSendsCtrlH = true
      changed = true
    }
    if (s.group && !s.folderId) {
      let folder = folders.find((f) => f.name === s.group)
      if (!folder) {
        folder = {
          id: crypto.randomUUID(),
          name: s.group,
          order: folders.length,
          collapsed: false
        }
        folders = [...folders, folder]
      }
      s.folderId = folder.id
      delete s.group
      changed = true
    }
  }

  if (changed) {
    store.set('sessions', sessions)
    store.set('folders', folders)
  }
}

migrate()

function stripSecrets(s: SessionConfig): SessionConfig {
  const user = (s.username || '').trim()
  if (user) migrateLegacyPassword(s.id, user)
  return {
    ...s,
    hasCredential: user ? hasAnyPassword(s.id) : hasAnyPassword(s.id),
    hasPassphrase: hasPassphrase(s.id),
    passwordSavePolicy: s.passwordSavePolicy ?? 'ask'
  }
}

export function listSessions(): SessionConfig[] {
  return store
    .get('sessions')
    .map(stripSecrets)
    .sort((a, b) => a.order - b.order)
}

export function listFolders(): SessionFolder[] {
  return [...store.get('folders')].sort((a, b) => a.order - b.order)
}

export function getSession(id: string): SessionConfig | undefined {
  const s = store.get('sessions').find((x) => x.id === id)
  return s ? stripSecrets(s) : undefined
}

export function saveSession(input: SessionInput & { id?: string }): SessionConfig {
  const sessions = store.get('sessions')
  const id = input.id ?? crypto.randomUUID()
  const existing = sessions.find((s) => s.id === id)
  const folderId = input.folderId !== undefined ? input.folderId : (existing?.folderId ?? null)

  const siblings = sessions.filter((s) => (s.folderId ?? null) === (folderId ?? null) && s.id !== id)
  const order =
    input.order ??
    existing?.order ??
    (siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0)

  const next: SessionConfig = {
    id,
    name: input.name,
    host: input.host,
    port: input.port || 22,
    username: input.username ?? '',
    authMethod: input.authMethod,
    privateKeyPath: input.privateKeyPath,
    folderId: folderId ?? null,
    order,
    color: input.color,
    tags: input.tags,
    favorite: input.favorite ?? existing?.favorite ?? false,
    lastConnectedAt: existing?.lastConnectedAt,
    x11Forwarding: input.x11Forwarding ?? existing?.x11Forwarding ?? true,
    compression: input.compression ?? existing?.compression ?? true,
    backspaceSendsCtrlH: input.backspaceSendsCtrlH ?? existing?.backspaceSendsCtrlH ?? true,
    encoding: input.encoding ?? existing?.encoding,
    termType: input.termType ?? existing?.termType,
    startupDirectory: input.startupDirectory ?? existing?.startupDirectory,
    startupCommand: input.startupCommand ?? existing?.startupCommand,
    passwordSavePolicy: input.passwordSavePolicy ?? existing?.passwordSavePolicy ?? 'ask'
  }

  const user = (next.username || '').trim()
  // Password only when username is set (account-scoped)
  if (input.password && user) {
    setPassword(id, user, input.password)
  }
  if (input.passphrase) setPassphrase(id, input.passphrase)

  const idx = sessions.findIndex((s) => s.id === id)
  if (idx >= 0) sessions[idx] = next
  else sessions.push(next)
  store.set('sessions', sessions)
  return stripSecrets(next)
}

export function deleteSession(id: string): void {
  store.set(
    'sessions',
    store.get('sessions').filter((s) => s.id !== id)
  )
  deleteSecret(id)
  deleteSecret(`${id}:passphrase`)
}

export function setFavorite(id: string, favorite: boolean): SessionConfig | undefined {
  const sessions = store.get('sessions')
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx < 0) return undefined
  sessions[idx] = { ...sessions[idx], favorite }
  store.set('sessions', sessions)
  return stripSecrets(sessions[idx])
}

export function touchLastConnected(id: string): void {
  const sessions = store.get('sessions')
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx < 0) return
  sessions[idx] = { ...sessions[idx], lastConnectedAt: Date.now() }
  store.set('sessions', sessions)
}

export function createFolder(name: string): SessionFolder {
  const folders = store.get('folders')
  const folder: SessionFolder = {
    id: crypto.randomUUID(),
    name: name.trim() || 'New folder',
    order: folders.length ? Math.max(...folders.map((f) => f.order)) + 1 : 0,
    collapsed: false
  }
  store.set('folders', [...folders, folder])
  return folder
}

export function renameFolder(id: string, name: string): SessionFolder | undefined {
  const folders = store.get('folders')
  const idx = folders.findIndex((f) => f.id === id)
  if (idx < 0) return undefined
  folders[idx] = { ...folders[idx], name: name.trim() || folders[idx].name }
  store.set('folders', folders)
  return folders[idx]
}

export function deleteFolder(id: string): void {
  store.set(
    'folders',
    store.get('folders').filter((f) => f.id !== id)
  )
  // Move sessions to root
  const sessions = store.get('sessions').map((s) =>
    s.folderId === id ? { ...s, folderId: null } : s
  )
  store.set('sessions', sessions)
}

export function setFolderCollapsed(id: string, collapsed: boolean): SessionFolder | undefined {
  const folders = store.get('folders')
  const idx = folders.findIndex((f) => f.id === id)
  if (idx < 0) return undefined
  folders[idx] = { ...folders[idx], collapsed }
  store.set('folders', folders)
  return folders[idx]
}

export function reorder(payload: TreeReorderPayload): void {
  const { dragId, dragType, targetFolderId, targetIndex } = payload

  if (dragType === 'folder') {
    const folders = [...store.get('folders')].sort((a, b) => a.order - b.order)
    const from = folders.findIndex((f) => f.id === dragId)
    if (from < 0) return
    const [item] = folders.splice(from, 1)
    const to = Math.max(0, Math.min(targetIndex, folders.length))
    folders.splice(to, 0, item)
    store.set(
      'folders',
      folders.map((f, i) => ({ ...f, order: i }))
    )
    return
  }

  const sessions = store.get('sessions')
  const drag = sessions.find((s) => s.id === dragId)
  if (!drag) return

  // Remove from list conceptually and reinsert into target folder siblings
  const others = sessions.filter((s) => s.id !== dragId)
  const siblings = others
    .filter((s) => (s.folderId ?? null) === (targetFolderId ?? null))
    .sort((a, b) => a.order - b.order)

  const moved: SessionConfig = {
    ...drag,
    folderId: targetFolderId === undefined ? null : targetFolderId
  }
  const idx = Math.max(0, Math.min(targetIndex, siblings.length))
  siblings.splice(idx, 0, moved)

  const reorderedSiblings = siblings.map((s, i) => ({ ...s, order: i }))
  const siblingIds = new Set(reorderedSiblings.map((s) => s.id))
  const rest = others.filter((s) => !siblingIds.has(s.id))

  store.set('sessions', [...rest, ...reorderedSiblings])
}

export interface SessionsExportFile {
  version: 1
  exportedAt: string
  folders: SessionFolder[]
  sessions: Omit<SessionConfig, 'hasCredential' | 'hasPassphrase'>[]
  /** account passwords: sessionIndex or temp key → { username: password } */
  secrets?: {
    /** parallel to sessions[] by index at export time */
    bySessionIndex: Array<{
      passwords: Record<string, string>
      passphrase?: string
    }>
  }
}

export function exportData(includeSecrets = false): SessionsExportFile {
  const raw = store.get('sessions')
  const sessions = raw.map((s) => {
    const stripped = stripSecrets(s)
    const { hasCredential: _c, hasPassphrase: _p, ...rest } = stripped
    return rest
  })
  const file: SessionsExportFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: listFolders(),
    sessions
  }
  if (includeSecrets) {
    file.secrets = {
      bySessionIndex: raw.map((s) => {
        const passwords = exportPasswordsForSession(s.id)
        // Drop empty-username legacy bucket from export map keys if any
        const cleaned: Record<string, string> = {}
        for (const [u, p] of Object.entries(passwords)) {
          if (u && p) cleaned[u] = p
        }
        const passphrase = getPassphraseForExport(s.id) ?? undefined
        return { passwords: cleaned, passphrase }
      })
    }
  }
  return file
}

export function importData(
  data: SessionsExportFile,
  mode: 'merge' | 'replace' = 'merge'
): { folders: number; sessions: number } {
  if (!data || data.version !== 1 || !Array.isArray(data.sessions)) {
    throw new Error('Invalid session export file')
  }

  if (mode === 'replace') {
    for (const s of store.get('sessions')) deleteSecret(s.id)
    store.set('folders', [])
    store.set('sessions', [])
  }

  const folderIdMap = new Map<string, string>()
  const existingFolders = store.get('folders')
  let foldersAdded = 0

  for (const f of data.folders ?? []) {
    const existing = existingFolders.find((x) => x.name === f.name)
    if (existing) {
      folderIdMap.set(f.id, existing.id)
      continue
    }
    const newId = crypto.randomUUID()
    folderIdMap.set(f.id, newId)
    existingFolders.push({
      id: newId,
      name: f.name,
      order: existingFolders.length,
      collapsed: f.collapsed ?? false
    })
    foldersAdded++
  }
  store.set('folders', existingFolders)

  const sessions = store.get('sessions')
  let sessionsAdded = 0
  let sessionIndex = 0
  for (const s of data.sessions) {
    const mappedFolder =
      s.folderId && folderIdMap.has(s.folderId)
        ? folderIdMap.get(s.folderId)!
        : s.folderId
          ? existingFolders.find((f) => f.id === s.folderId)?.id ?? null
          : null

    // Skip exact host+port+user+name duplicates on merge
    if (
      mode === 'merge' &&
      sessions.some(
        (x) =>
          x.name === s.name &&
          x.host === s.host &&
          x.port === s.port &&
          x.username === s.username
      )
    ) {
      sessionIndex++
      continue
    }

    const id = crypto.randomUUID()
    sessions.push({
      id,
      name: s.name,
      host: s.host,
      port: s.port || 22,
      username: s.username ?? '',
      authMethod: s.authMethod ?? 'password',
      privateKeyPath: s.privateKeyPath,
      folderId: mappedFolder,
      order: sessions.length,
      color: s.color,
      tags: s.tags,
      favorite: s.favorite ?? false,
      x11Forwarding: s.x11Forwarding !== false,
      compression: s.compression !== false,
      backspaceSendsCtrlH: s.backspaceSendsCtrlH !== false,
      encoding: s.encoding,
      termType: s.termType,
      startupDirectory: s.startupDirectory,
      startupCommand: s.startupCommand,
      passwordSavePolicy: s.passwordSavePolicy ?? 'ask'
    })

    const sec = data.secrets?.bySessionIndex?.[sessionIndex]
    if (sec) {
      if (sec.passwords) importPasswordsForSession(id, sec.passwords)
      if (sec.passphrase) setPassphraseFromImport(id, sec.passphrase)
    }
    sessionIndex++
    sessionsAdded++
  }
  store.set('sessions', sessions)
  return { folders: foldersAdded, sessions: sessionsAdded }
}

export function updatePasswordSavePolicy(
  id: string,
  policy: NonNullable<SessionConfig['passwordSavePolicy']>
): SessionConfig | undefined {
  const sessions = store.get('sessions')
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx < 0) return undefined
  sessions[idx] = { ...sessions[idx], passwordSavePolicy: policy }
  store.set('sessions', sessions)
  return stripSecrets(sessions[idx])
}
