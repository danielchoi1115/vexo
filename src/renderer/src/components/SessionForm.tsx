import { useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type {
  AuthMethod,
  PasswordSavePolicy,
  SessionConfig,
  SessionInput,
  TermType,
  TerminalEncoding
} from '../../../shared/types'
import { useSettingsStore } from '../stores/settingsStore'
import { Select } from './Select'

type DragHandleProps = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
}

interface Props {
  initial?: SessionConfig | null
  /** Target folder for new sessions (from sidebar selection) */
  defaultFolderId?: string | null
  onSaved: () => void
  onCancel: () => void
  /** Optional header drag (session modal shell) */
  dragHandleProps?: DragHandleProps
}

/** Visual dummy so the user can see a secret is already stored (never the real value). */
const STORED_DUMMY = '•'.repeat(20)

const empty: SessionInput = {
  name: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  x11Forwarding: true,
  compression: true,
  backspaceSendsCtrlH: true,
  passwordSavePolicy: 'ask'
}

export function SessionForm({
  initial,
  defaultFolderId,
  onSaved,
  onCancel,
  dragHandleProps
}: Props): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const defaultEncoding = useSettingsStore((s) => s.defaultEncoding)
  const defaultTermType = useSettingsStore((s) => s.defaultTermType)
  const [form, setForm] = useState<SessionInput>(() => {
    if (initial) {
      return {
        ...empty,
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
        backspaceSendsCtrlH: initial.backspaceSendsCtrlH !== false,
        encoding: initial.encoding || defaultEncoding || 'utf-8',
        termType: initial.termType || defaultTermType || 'xterm-256color',
        startupDirectory: initial.startupDirectory || '',
        startupCommand: initial.startupCommand || '',
        passwordSavePolicy: initial.passwordSavePolicy ?? 'ask'
      }
    }
    return {
      ...empty,
      folderId: defaultFolderId ?? null,
      encoding: defaultEncoding || 'utf-8',
      termType: defaultTermType || 'xterm-256color'
    }
  })

  const formUsername = (form.username || '').trim()
  const hasStoredPassword = Boolean(initial?.hasCredential && formUsername)
  const hasStoredPassphrase = Boolean(initial?.hasPassphrase)

  const [password, setPassword] = useState(hasStoredPassword ? STORED_DUMMY : '')
  const [passwordDirty, setPasswordDirty] = useState(false)
  const [passphrase, setPassphrase] = useState(hasStoredPassphrase ? STORED_DUMMY : '')
  const [passphraseDirty, setPassphraseDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof SessionInput>(key: K, value: SessionInput[K]): void => {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const browseKey = async (): Promise<void> => {
    const path = await window.api.dialog.pickPrivateKey()
    if (path) set('privateKeyPath', path)
  }

  const onPasswordFocus = (): void => {
    if (!passwordDirty && hasStoredPassword) {
      setPassword('')
      setPasswordDirty(true)
    }
  }

  const onPassphraseFocus = (): void => {
    if (!passphraseDirty && hasStoredPassphrase) {
      setPassphrase('')
      setPassphraseDirty(true)
    }
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const user = (form.username || '').trim()
      // Password only with non-empty username (account-scoped)
      const passwordToSave =
        user && passwordDirty && password && password !== STORED_DUMMY ? password : undefined
      const passphraseToSave =
        passphraseDirty && passphrase && passphrase !== STORED_DUMMY ? passphrase : undefined

      await window.api.sessions.save({
        ...form,
        id: initial?.id,
        username: user,
        folderId: initial ? form.folderId : (defaultFolderId ?? null),
        password: passwordToSave,
        passphrase: passphraseToSave
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
      <div
        className={`modal-header session-form-header${dragHandleProps ? ' modal-drag-handle' : ''}`}
        {...(dragHandleProps ?? {})}
      >
        <h3>{initial ? t('session.editSession') : t('session.newSession')}</h3>
        <button
          type="button"
          className="btn icon-btn modal-close-btn"
          onClick={onCancel}
          aria-label={t('common.cancel')}
          title={t('common.cancel')}
        >
          <span className="icon-btn-glyph icon-btn-close" aria-hidden>
            ×
          </span>
        </button>
      </div>
      <div className="session-form-body">
      {error && <div className="banner error">{error}</div>}

      {/* Connection target */}
      <section className="form-section">
        <h4 className="form-section-title">{t('session.sectionConnection')}</h4>
        <div className="form-section-grid">
          <label className="span-2">
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
        </div>
      </section>

      {/* Login: username + auth method + credentials together */}
      <section className="form-section">
        <h4 className="form-section-title">{t('session.sectionLogin')}</h4>
        <div className="form-section-grid">
          <label className="session-field">
            <span className="field-label">
              {t('session.username')} <span className="optional">{t('common.optional')}</span>
            </span>
            <input
              value={form.username ?? ''}
              onChange={(e) => {
                const v = e.target.value
                set('username', v)
                // Clear password when username cleared (account-scoped)
                if (!v.trim()) {
                  setPassword('')
                  setPasswordDirty(false)
                }
              }}
              placeholder={t('session.leaveEmptyUsername')}
            />
          </label>
          <div className="session-field session-auth-field">
            <span className="field-label">{t('session.auth')}</span>
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
            <label className="span-2 session-field">
              <span className="field-label">
                {t('session.password')} <span className="optional">{t('common.optional')}</span>
              </span>
              <input
                type="password"
                disabled={!formUsername}
                className={
                  hasStoredPassword && !passwordDirty ? 'secret-stored' : undefined
                }
                value={formUsername ? password : ''}
                onFocus={onPasswordFocus}
                onChange={(e) => {
                  setPasswordDirty(true)
                  setPassword(e.target.value)
                }}
                autoComplete="off"
                placeholder={
                  formUsername ? t('session.leaveEmptyPassword') : t('session.passwordNeedsUsername')
                }
                title={!formUsername ? t('session.passwordNeedsUsername') : undefined}
              />
            </label>
          )}

          {form.authMethod === 'privateKey' && (
            <>
              <label className="span-2 session-field">
                {t('session.privateKeyPath')}
                <div className="path-row">
                  <input
                    value={form.privateKeyPath ?? ''}
                    onChange={(e) => set('privateKeyPath', e.target.value)}
                    placeholder={t('session.selectKey')}
                  />
                  <button
                    type="button"
                    className="btn sm control-btn"
                    onClick={() => void browseKey()}
                  >
                    {t('session.browse')}
                  </button>
                </div>
              </label>
              <label className="span-2 session-field">
                <span className="field-label">
                  {t('session.passphrase')} <span className="optional">{t('common.optional')}</span>
                </span>
                <input
                  type="password"
                  className={
                    hasStoredPassphrase && !passphraseDirty ? 'secret-stored' : undefined
                  }
                  value={passphrase}
                  onFocus={onPassphraseFocus}
                  onChange={(e) => {
                    setPassphraseDirty(true)
                    setPassphrase(e.target.value)
                  }}
                  autoComplete="off"
                />
              </label>
            </>
          )}

          {form.authMethod === 'agent' && (
            <p className="form-section-note span-2 muted">{t('session.agentHint')}</p>
          )}
        </div>
      </section>

      {/* Terminal */}
      <section className="form-section">
        <h4 className="form-section-title">{t('session.sectionTerminal')}</h4>
        <div className="form-section-grid">
          <div className="session-field">
            <span className="field-label">{t('session.encoding')}</span>
            <Select
              value={form.encoding || 'utf-8'}
              onChange={(v) => set('encoding', v as TerminalEncoding)}
              options={[
                { value: 'utf-8', label: 'UTF-8' },
                { value: 'euc-kr', label: 'EUC-KR' },
                { value: 'cp949', label: 'CP949' },
                { value: 'gbk', label: 'GBK' },
                { value: 'latin1', label: 'Latin-1' }
              ]}
            />
          </div>
          <div className="session-field">
            <span className="field-label">{t('session.termType')}</span>
            <Select
              value={form.termType || 'xterm-256color'}
              onChange={(v) => set('termType', v as TermType)}
              options={[
                { value: 'xterm-256color', label: 'xterm-256color' },
                { value: 'xterm', label: 'xterm' },
                { value: 'vt100', label: 'vt100' }
              ]}
            />
          </div>
          <label className="span-2 session-field">
            {t('session.startupDirectory')}
            <input
              value={form.startupDirectory ?? ''}
              onChange={(e) => set('startupDirectory', e.target.value)}
              placeholder={t('session.startupDirectoryPh')}
            />
          </label>
          <label className="span-2 session-field">
            {t('session.startupCommand')}
            <input
              value={form.startupCommand ?? ''}
              onChange={(e) => set('startupCommand', e.target.value)}
              placeholder={t('session.startupCommandPh')}
            />
          </label>
        </div>
      </section>

      {/* Options */}
      <section className="form-section">
        <h4 className="form-section-title">{t('session.sectionOptions')}</h4>
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
          {form.authMethod === 'password' && (
            <div className="session-field" style={{ marginTop: 8 }}>
              <span className="field-label">{t('session.passwordSavePolicy')}</span>
              <Select
                value={form.passwordSavePolicy || 'ask'}
                onChange={(v) => set('passwordSavePolicy', v as PasswordSavePolicy)}
                options={[
                  { value: 'ask', label: t('session.passwordSaveAsk') },
                  { value: 'always', label: t('session.passwordSaveAlways') },
                  { value: 'never', label: t('session.passwordSaveNever') }
                ]}
              />
            </div>
          )}
        </div>
      </section>
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
