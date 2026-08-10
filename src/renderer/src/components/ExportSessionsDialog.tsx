import { useState } from 'react'
import { useDraggableModal } from '../hooks/useDraggableModal'
import { useSettingsStore } from '../stores/settingsStore'

interface Props {
  onClose: () => void
  onDone: (path: string) => void
}

export function ExportSessionsDialog({ onClose, onDone }: Props): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { modalRef, modalStyle, dragHandleProps } = useDraggableModal()

  const submit = async (): Promise<void> => {
    setError(null)
    if (includeSecrets) {
      if (!password) {
        setError(t('export.passwordRequired'))
        return
      }
      if (password !== password2) {
        setError(t('export.passwordMismatch'))
        return
      }
    }
    setBusy(true)
    try {
      const r = await window.api.sessions.export({
        includeSecrets,
        password: includeSecrets ? password : undefined
      })
      // Save dialog canceled → stay open
      if ('canceled' in r && r.canceled) return
      if ('ok' in r && r.ok) onDone(r.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        ref={modalRef as React.RefObject<HTMLDivElement | null>}
        className="modal export-modal"
        style={modalStyle}
      >
        <div className="modal-header modal-drag-handle" {...dragHandleProps}>
          <h3>{t('session.export')}</h3>
          <button
            type="button"
            className="btn icon-btn modal-close-btn"
            onClick={onClose}
            aria-label={t('common.cancel')}
          >
            <span className="icon-btn-glyph icon-btn-close" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="export-modal-body">
          {error && <div className="banner error">{error}</div>}

          <label className="check-row settings-check">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
            />
            <span>
              <strong>{t('export.includeSecrets')}</strong>
              <span className="settings-hint">{t('export.includeSecretsHint')}</span>
            </span>
          </label>

          {includeSecrets && (
            <>
              <p className="settings-hint export-crypto-note">{t('export.cryptoNote')}</p>
              <label className="settings-field">
                <span className="settings-label">{t('export.password')}</span>
                <input
                  className="settings-control"
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label className="settings-field">
                <span className="settings-label">{t('export.passwordConfirm')}</span>
                <input
                  className="settings-control"
                  type="password"
                  value={password2}
                  autoComplete="new-password"
                  onChange={(e) => setPassword2(e.target.value)}
                />
              </label>
            </>
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? '…' : t('session.export')}
          </button>
        </div>
      </div>
    </div>
  )
}
