import { useState } from 'react'
import { useDraggableModal } from '../hooks/useDraggableModal'
import { useSettingsStore } from '../stores/settingsStore'

interface Props {
  username: string
  host: string
  onAnswer: (save: boolean, dontAskAgain: boolean) => void
}

export function PasswordSaveDialog({ username, host, onAnswer }: Props): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const { modalRef, modalStyle, dragHandleProps } = useDraggableModal()

  return (
    <div className="modal-backdrop password-save-backdrop">
      <div
        ref={modalRef as React.RefObject<HTMLDivElement | null>}
        className="modal password-save-modal"
        style={modalStyle}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-drag-handle password-save-drag" {...dragHandleProps}>
          <h3>{t('passwordSave.title')}</h3>
        </div>
        <p className="password-save-body">
          {t('passwordSave.body', { user: username, host })}
        </p>
        <label className="check-row settings-check">
          <input
            type="checkbox"
            checked={dontAskAgain}
            onChange={(e) => setDontAskAgain(e.target.checked)}
          />
          <span>{t('passwordSave.dontAskAgain')}</span>
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => onAnswer(true, dontAskAgain)}
          >
            {t('passwordSave.yes')}
          </button>
          <button type="button" className="btn" onClick={() => onAnswer(false, dontAskAgain)}>
            {t('passwordSave.no')}
          </button>
        </div>
      </div>
    </div>
  )
}
