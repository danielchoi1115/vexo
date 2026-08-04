import Store from 'electron-store'
import type { SessionConfig, SessionInput } from '../shared/types'
import { deleteSecret, hasSecret, setSecret } from './credentialStore'

interface SessionSchema {
  sessions: SessionConfig[]
}

const store = new Store<SessionSchema>({
  name: 'sessions',
  defaults: { sessions: [] }
})

function stripSecrets(s: SessionConfig): SessionConfig {
  return {
    ...s,
    hasCredential: hasSecret(s.id)
  }
}

export function listSessions(): SessionConfig[] {
  return store.get('sessions').map(stripSecrets)
}

export function getSession(id: string): SessionConfig | undefined {
  const s = store.get('sessions').find((x) => x.id === id)
  return s ? stripSecrets(s) : undefined
}

export function saveSession(input: SessionInput & { id?: string }): SessionConfig {
  const sessions = store.get('sessions')
  const id = input.id ?? crypto.randomUUID()
  const existing = sessions.find((s) => s.id === id)

  const next: SessionConfig = {
    id,
    name: input.name,
    host: input.host,
    port: input.port || 22,
    username: input.username,
    authMethod: input.authMethod,
    privateKeyPath: input.privateKeyPath,
    group: input.group,
    color: input.color,
    tags: input.tags,
    favorite: input.favorite ?? existing?.favorite ?? false,
    lastConnectedAt: existing?.lastConnectedAt
  }

  if (input.password) {
    setSecret(id, input.password)
  }
  if (input.passphrase) {
    setSecret(`${id}:passphrase`, input.passphrase)
  }

  const idx = sessions.findIndex((s) => s.id === id)
  if (idx >= 0) {
    sessions[idx] = next
  } else {
    sessions.push(next)
  }
  store.set('sessions', sessions)
  return stripSecrets(next)
}

export function deleteSession(id: string): void {
  const sessions = store.get('sessions').filter((s) => s.id !== id)
  store.set('sessions', sessions)
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
