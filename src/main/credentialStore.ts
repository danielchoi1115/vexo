import { safeStorage } from 'electron'
import Store from 'electron-store'

interface CredentialSchema {
  /**
   * Keys:
   * - `${sessionId}:user:${username}` — password for that account
   * - `${sessionId}:passphrase` — private key passphrase
   * Legacy: bare `${sessionId}` (password) — migrated on read when username known
   */
  secrets: Record<string, string>
}

const store = new Store<CredentialSchema>({
  name: 'credentials',
  defaults: { secrets: {} }
})

function encode(buf: Buffer): string {
  return buf.toString('base64')
}

function decode(b64: string): Buffer {
  return Buffer.from(b64, 'base64')
}

function encryptPlain(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return encode(Buffer.from(plain, 'utf8'))
  }
  return encode(safeStorage.encryptString(plain))
}

function decryptPlain(b64: string): string | null {
  try {
    const buf = decode(b64)
    if (!safeStorage.isEncryptionAvailable()) {
      return buf.toString('utf8')
    }
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

export function passwordKey(sessionId: string, username: string): string {
  return `${sessionId}:user:${username}`
}

export function passphraseKey(sessionId: string): string {
  return `${sessionId}:passphrase`
}

export function setPassword(sessionId: string, username: string, plain: string): void {
  const user = username.trim()
  if (!user || !plain) return
  const secrets = { ...store.get('secrets') }
  secrets[passwordKey(sessionId, user)] = encryptPlain(plain)
  // Drop legacy bare key if present
  delete secrets[sessionId]
  store.set('secrets', secrets)
}

export function getPassword(sessionId: string, username: string): string | null {
  const user = username.trim()
  if (!user) return null
  const secrets = store.get('secrets')
  const key = passwordKey(sessionId, user)
  if (secrets[key]) return decryptPlain(secrets[key])

  // Legacy: bare sessionId secret — only when username matches later migration
  if (secrets[sessionId]) {
    const legacy = decryptPlain(secrets[sessionId])
    if (legacy) return legacy
  }
  return null
}

export function hasPassword(sessionId: string, username: string): boolean {
  return getPassword(sessionId, username) !== null
}

/** Any password stored for this session (any account) — for list UI badge */
export function hasAnyPassword(sessionId: string): boolean {
  const secrets = store.get('secrets')
  if (secrets[sessionId]) return true
  const prefix = `${sessionId}:user:`
  return Object.keys(secrets).some((k) => k.startsWith(prefix))
}

export function setPassphrase(sessionId: string, plain: string): void {
  if (!plain) return
  const secrets = { ...store.get('secrets') }
  secrets[passphraseKey(sessionId)] = encryptPlain(plain)
  store.set('secrets', secrets)
}

export function getPassphrase(sessionId: string): string | null {
  const b64 = store.get('secrets')[passphraseKey(sessionId)]
  if (!b64) return null
  return decryptPlain(b64)
}

export function hasPassphrase(sessionId: string): boolean {
  return Boolean(store.get('secrets')[passphraseKey(sessionId)])
}

/** @deprecated use setPassword — kept for migration helpers */
export function setSecret(sessionId: string, plain: string): void {
  // Legacy API: store under bare id (will migrate on next username-scoped save)
  const secrets = { ...store.get('secrets') }
  secrets[sessionId] = encryptPlain(plain)
  store.set('secrets', secrets)
}

export function getSecret(sessionId: string): string | null {
  const b64 = store.get('secrets')[sessionId]
  if (!b64) return null
  return decryptPlain(b64)
}

export function hasSecret(sessionId: string): boolean {
  return hasAnyPassword(sessionId)
}

export function deleteSecret(sessionId: string): void {
  const secrets = { ...store.get('secrets') }
  delete secrets[sessionId]
  delete secrets[passphraseKey(sessionId)]
  const prefix = `${sessionId}:user:`
  for (const k of Object.keys(secrets)) {
    if (k.startsWith(prefix)) delete secrets[k]
  }
  store.set('secrets', secrets)
}

/**
 * Migrate legacy bare sessionId password → user-scoped when username is known.
 */
export function migrateLegacyPassword(sessionId: string, username: string): void {
  const user = username.trim()
  if (!user) return
  const secrets = store.get('secrets')
  if (!secrets[sessionId] || secrets[passwordKey(sessionId, user)]) return
  const plain = decryptPlain(secrets[sessionId])
  if (!plain) return
  setPassword(sessionId, user, plain)
}

/** All account passwords for a session (for encrypted export) */
export function exportPasswordsForSession(
  sessionId: string
): Record<string, string> {
  const out: Record<string, string> = {}
  const secrets = store.get('secrets')
  const prefix = `${sessionId}:user:`
  for (const [k, v] of Object.entries(secrets)) {
    if (k.startsWith(prefix)) {
      const user = k.slice(prefix.length)
      const plain = decryptPlain(v)
      if (plain) out[user] = plain
    }
  }
  // Legacy bare key → empty username key only if no user keys
  if (Object.keys(out).length === 0 && secrets[sessionId]) {
    const plain = decryptPlain(secrets[sessionId])
    if (plain) out[''] = plain
  }
  return out
}

export function importPasswordsForSession(
  sessionId: string,
  byUser: Record<string, string>
): void {
  for (const [user, plain] of Object.entries(byUser)) {
    if (user && plain) setPassword(sessionId, user, plain)
  }
}

export function getPassphraseForExport(sessionId: string): string | null {
  return getPassphrase(sessionId)
}

export function setPassphraseFromImport(sessionId: string, plain: string): void {
  setPassphrase(sessionId, plain)
}
