import { useState, type FormEvent } from 'react'
import type { AuthMethod, SessionConfig, SessionInput } from '../../../shared/types'

interface Props {
  initial?: SessionConfig | null
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

export function SessionForm({ initial, onSaved, onCancel }: Props): React.JSX.Element {
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
          group: initial.group,
          color: initial.color
        }
      : {})
  })
  const [password, setPassword] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof SessionInput>(key: K, value: SessionInput[K]): void => {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await window.api.sessions.save({
        ...form,
        id: initial?.id,
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
        Username
        <input
          required
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
          placeholder="root"
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
          Password {initial?.hasCredential ? '(stored — leave blank to keep)' : ''}
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
            <input
              required={!initial}
              value={form.privateKeyPath ?? ''}
              onChange={(e) => set('privateKeyPath', e.target.value)}
              placeholder="C:\Users\you\.ssh\id_rsa"
            />
          </label>
          <label>
            Passphrase {initial?.hasCredential ? '(stored — leave blank to keep)' : '(optional)'}
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
        Group
        <input
          value={form.group ?? ''}
          onChange={(e) => set('group', e.target.value || undefined)}
          placeholder="Production"
        />
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
