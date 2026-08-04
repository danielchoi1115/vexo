import { useState, type FormEvent } from 'react'
import type { AuthMethod, SessionConfig, SessionInput } from '../../../shared/types'
import { useSettingsStore } from '../stores/settingsStore'
import { Select } from './Select'

interface Props {
  initial?: SessionConfig | null
  /** Target folder for new sessions (from sidebar selection) */
  defaultFolderId?: string | null
  onSaved: () => void
  onCancel: () => void
}

const empty: SessionInput = {
  name: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  x11Forwarding: true,
  compression: true,
  backspaceSendsCtrlH: true
}

export function SessionForm({
  initial,
  defaultFolderId,
  onSaved,
  onCancel
}: Props): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
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
          color: initial.color,
          x11Forwarding: initial.x11Forwarding !== false,
          compression: initial.compression !== false,
          backspaceSendsCtrlH: initial.backspaceSendsCtrlH !== false
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
        folderId: initial ? form.folderId : (defaultFolderId ?? null),
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
      <h3>{initial ? t('session.editSession') : t('session.newSession')}</h3>
      {error && <div className="banner error">{error}</div>}

      <label>
        {t('session.name')}
        <input required value={form.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      <label>
        {t('session.host')}
        <input
          required
          value={form.host}
          onChange={(e) => set('host', e.target.value)}
          placeholder="192.168.1.10"
        />
      </label>
      <label>
        {t('session.port')}
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
        <span className="field-label">
          {t('session.username')} <span className="optional">{t('common.optional')}</span>
        </span>
        <input
          value={form.username ?? ''}
          onChange={(e) => set('username', e.target.value)}
          placeholder={t('session.leaveEmptyUsername')}
        />
      </label>
      <div className="settings-field session-auth-field">
        <span className="settings-label-sm">{t('session.auth')}</span>
        <Select
          value={form.authMethod}
          onChange={(v) => set('authMethod', v as AuthMethod)}
          options={[
            { value: 'password', label: t('session.password') },
            { value: 'privateKey', label: t('session.privateKey') },
            { value: 'agent', label: t('session.agent') }
          ]}
        />
      </div>

      {form.authMethod === 'password' && (
        <label>
          <span className="field-label">
            {t('session.password')} <span className="optional">{t('common.optional')}</span>
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
          <label className="span-2">
            {t('session.privateKeyPath')}
            <div className="path-row">
              <input
                value={form.privateKeyPath ?? ''}
                onChange={(e) => set('privateKeyPath', e.target.value)}
                placeholder={t('session.selectKey')}
              />
              <button type="button" className="btn sm control-btn" onClick={() => void browseKey()}>
                {t('session.browse')}
              </button>
            </div>
          </label>
          <label>
            <span className="field-label">
              {t('session.passphrase')} <span className="optional">{t('common.optional')}</span>
            </span>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="off"
            />
          </label>
        </>
      )}

      <div className="session-options">
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.x11Forwarding !== false}
            onChange={(e) => set('x11Forwarding', e.target.checked)}
          />
          {t('session.x11')}
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.compression !== false}
            onChange={(e) => set('compression', e.target.checked)}
          />
          {t('session.compression')}
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.backspaceSendsCtrlH !== false}
            onChange={(e) => set('backspaceSendsCtrlH', e.target.checked)}
          />
          {t('session.backspace')}
        </label>
      </div>

      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? '…' : t('common.ok')}
        </button>
      </div>
    </form>
  )
}
