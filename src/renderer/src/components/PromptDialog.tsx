import { useEffect, useRef, useState, type FormEvent } from 'react'

interface Props {
  title: string
  label?: string
  defaultValue?: string
  confirmLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

/** Electron-safe replacement for window.prompt */
export function PromptDialog({
  title,
  label,
  defaultValue = '',
  confirmLabel = 'OK',
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const v = value.trim()
    if (!v) return
    onSubmit(v)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal prompt-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h3>{title}</h3>
        {label && <p className="muted">{label}</p>}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
          }}
        />
        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
