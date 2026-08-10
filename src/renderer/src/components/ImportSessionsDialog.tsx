import { useState } from 'react'
import { useDraggableModal } from '../hooks/useDraggableModal'
import { useSettingsStore } from '../stores/settingsStore'

interface Props {
  onClose: () => void
  onDone: (stats: { sessions: number; folders: number }) => void
}

type Phase = 'ready' | 'needPassword'

export function ImportSessionsDialog({ onClose, onDone }: Props): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const [phase, setPhase] = useState<Phase>('ready')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { modalRef, modalStyle, dragHandleProps } = useDraggableModal()

  const runImport = async (path: string, filePassword?: string): Promise<void> => {
    const r = await window.api.sessions.importFile(path, filePassword)
    onDone({ sessions: r.sessions, folders: r.folders })
  }

  /** Primary: choose file first; only then ask for password if the file is encrypted. */
  const onPrimary = async (): Promise<void> => {
    setError(null)

    if (phase === 'needPassword' && filePath) {
      if (!password) {
        setError(t('export.passwordRequired'))
        return
      }
      setBusy(true)
      try {
        await runImport(filePath, password)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
      return
    }

    setBusy(true)
    try {
      const pick = await window.api.sessions.pickImportFile()
      // OS file dialog canceled — leave this modal open
      if ('canceled' in pick) return

      if (pick.encrypted) {
        setFilePath(pick.path)
        setPhase('needPassword')
        setPassword('')
        return
      }

      await runImport(pick.path)
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
          <h3>{t('session.import')}</h3>
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
          <div className="banner warning import-warn">{t('session.importReplaceWarning')}</div>

          {phase === 'needPassword' && (
            <label className="settings-field">
              <span className="settings-label">{t('export.importPassword')}</span>
              <input
                className="settings-control"
                type="password"
                value={password}
                autoComplete="off"
                autoFocus
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onPrimary()
                }}
              />
              <span className="settings-hint">{t('export.importPasswordHint')}</span>
            </label>
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void onPrimary()}
            disabled={busy}
          >
            {busy
              ? '…'
              : phase === 'needPassword'
                ? t('session.import')
                : t('session.importChooseFile')}
          </button>
        </div>
      </div>
    </div>
  )
}
