import { useState, type FormEvent } from 'react'
import type { AuthMethod, SessionConfig, SessionFolder, SessionInput } from '../../../shared/types'

interface Props {
  initial?: SessionConfig | null
  folders: SessionFolder[]
  defaultFolderId?: string | null
  onSaved: () => void
  onCancel: () => void
}

const empty: SessionInput = {
  name: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password'
}

export function SessionForm({
  initial,
  folders,
  defaultFolderId,
  onSaved,
  onCancel
}: Props): React.JSX.Element {
  const [form, setForm] = useState<SessionInput>({
    ...empty,
    ...(initial
      ? {
          name: initial.name,
          host: initial.host,
          port: initial.port,
          username: initial.username,
          authMethod: initial.authMethod,
          privateKeyPath: initial.privateKeyPath,
          folderId: initial.folderId ?? null,
          color: initial.color
        }
      : { folderId: defaultFolderId ?? null })
  })
  const [password, setPassword] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof SessionInput>(key: K, value: SessionInput[K]): void => {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const browseKey = async (): Promise<void> => {
    const path = await window.api.dialog.pickPrivateKey()
    if (path) set('privateKeyPath', path)
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await window.api.sessions.save({
        ...form,
        id: initial?.id,
        username: form.username || '',
        password: password || undefined,
        passphrase: passphrase || undefined
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="session-form" onSubmit={submit}>
      <h3>{initial ? 'Edit session' : 'New session'}</h3>
      {error && <div className="banner error">{error}</div>}

      <label>
        Name
        <input
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="prod-api"
        />
      </label>
      <label>
        Host
        <input
          required
          value={form.host}
          onChange={(e) => set('host', e.target.value)}
          placeholder="192.168.1.10"
        />
      </label>
      <label>
        Port
        <input
          type="number"
          required
          min={1}
          max={65535}
          value={form.port}
          onChange={(e) => set('port', Number(e.target.value))}
        />
      </label>
      <label>
        Username <span className="optional">(optional — prompt in terminal)</span>
        <input
          value={form.username ?? ''}
          onChange={(e) => set('username', e.target.value)}
          placeholder="Leave empty to type at connect"
        />
      </label>
      <label>
        Auth
        <select
          value={form.authMethod}
          onChange={(e) => set('authMethod', e.target.value as AuthMethod)}
        >
          <option value="password">Password</option>
          <option value="privateKey">Private key</option>
          <option value="agent">SSH agent</option>
        </select>
      </label>

      {form.authMethod === 'password' && (
        <label>
          Password{' '}
          <span className="optional">
            {initial?.hasCredential
              ? '(stored — leave blank to keep)'
              : '(optional — prompt in terminal)'}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        </label>
      )}

      {form.authMethod === 'privateKey' && (
        <>
          <label>
            Private key path
            <div className="path-row">
              <input
                value={form.privateKeyPath ?? ''}
                onChange={(e) => set('privateKeyPath', e.target.value)}
                placeholder="Select key file…"
              />
              <button type="button" className="btn sm" onClick={() => void browseKey()}>
                Browse…
              </button>
            </div>
          </label>
          <label>
            Passphrase <span className="optional">(optional)</span>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="off"
            />
          </label>
        </>
      )}

      <label>
        Folder
        <select
          value={form.folderId ?? ''}
          onChange={(e) => set('folderId', e.target.value || null)}
        >
          <option value="">(root)</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
