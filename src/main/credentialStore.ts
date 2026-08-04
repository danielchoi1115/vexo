import { safeStorage } from 'electron'
import Store from 'electron-store'

interface CredentialSchema {
  /** sessionId -> base64(encrypted) */
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

export function setSecret(sessionId: string, plain: string): void {
  const secrets = { ...store.get('secrets') }
  if (!safeStorage.isEncryptionAvailable()) {
    secrets[sessionId] = encode(Buffer.from(plain, 'utf8'))
  } else {
    secrets[sessionId] = encode(safeStorage.encryptString(plain))
  }
  store.set('secrets', secrets)
}

export function getSecret(sessionId: string): string | null {
  const b64 = store.get('secrets')[sessionId]
  if (!b64) return null
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

export function hasSecret(sessionId: string): boolean {
  return Boolean(store.get('secrets')[sessionId])
}

export function deleteSecret(sessionId: string): void {
  const secrets = { ...store.get('secrets') }
  delete secrets[sessionId]
  store.set('secrets', secrets)
}
