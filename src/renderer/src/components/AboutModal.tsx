import { useEffect, useState } from 'react'
import { useDraggableModal } from '../hooks/useDraggableModal'
import { useSettingsStore } from '../stores/settingsStore'
// Packaged via Vite; same asset as main window icon source
import appIcon from '../../../../resources/icon.png'

interface Props {
  onClose: () => void
}

export function AboutModal({ onClose }: Props): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const [version, setVersion] = useState('')
  const { modalRef, modalStyle, dragHandleProps } = useDraggableModal()

  useEffect(() => {
    void window.api.app.getInfo().then((info) => {
      setVersion(info.version || '')
    })
  }, [])

  const year = new Date().getFullYear()

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={modalRef as React.RefObject<HTMLDivElement | null>}
        className="modal about-modal"
        style={modalStyle}
        role="dialog"
        aria-labelledby="about-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="about-body modal-drag-handle" {...dragHandleProps}>
          <img className="about-icon" src={appIcon} alt="" width={72} height={72} />
          <h2 id="about-title" className="about-name">
            {t('app.brand')}
          </h2>
          <p className="about-version muted">
            {version
              ? t('about.version', { version })
              : t('about.version', { version: '…' })}
          </p>
          <p className="about-meta muted">{t('about.copyright', { year })}</p>
          <p className="about-meta muted">{t('about.license')}</p>
        </div>
        <div className="form-actions about-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            {t('about.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
