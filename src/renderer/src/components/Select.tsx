import { useEffect, useRef, useState } from 'react'

export interface SelectOption {
  value: string
  label: string
  /** Optional style for the option label (e.g. font-family preview) */
  style?: React.CSSProperties
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Optional groups: { label, options } — when set, options prop is ignored if groups provided */
  groups?: { label: string; options: SelectOption[] }[]
  className?: string
  /** Apply style on the closed trigger (e.g. selected font) */
  triggerStyle?: React.CSSProperties
  disabled?: boolean
  'aria-label'?: string
}

function flatten(
  options: SelectOption[],
  groups?: { label: string; options: SelectOption[] }[]
): SelectOption[] {
  if (groups?.length) return groups.flatMap((g) => g.options)
  return options
}

/**
 * Unified rounded select — same UX as the terminal font picker.
 * Replaces native <select> for consistent arrows and list styling.
 */
export function Select({
  value,
  options,
  onChange,
  groups,
  className = '',
  triggerStyle,
  disabled,
  'aria-label': ariaLabel
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const all = flatten(options, groups)
  const selected = all.find((o) => o.value === value) ?? all[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDoc, true)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    const active = listRef.current.querySelector('[data-active="true"]') as HTMLElement | null
    active?.scrollIntoView({ block: 'nearest' })
  }, [open, value])

  return (
    <div className={`ui-select ${className}`} ref={rootRef}>
      <button
        type="button"
        className={`ui-select-trigger ${open ? 'open' : ''}`}
        style={triggerStyle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!disabled) setOpen((o) => !o)
        }}
      >
        <span className="ui-select-value" style={selected?.style}>
          {selected?.label ?? value}
        </span>
        <span className="ui-select-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          className="ui-select-list"
          ref={listRef}
          role="listbox"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {groups?.length
            ? groups.map((g) => (
                <div key={g.label} className="ui-select-group">
                  <div className="ui-select-group-label">{g.label}</div>
                  {g.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      role="option"
                      data-active={o.value === value ? 'true' : 'false'}
                      aria-selected={o.value === value}
                      className={`ui-select-item ${o.value === value ? 'active' : ''}`}
                      style={o.style}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onChange(o.value)
                        setOpen(false)
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ))
            : options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  data-active={o.value === value ? 'true' : 'false'}
                  aria-selected={o.value === value}
                  className={`ui-select-item ${o.value === value ? 'active' : ''}`}
                  style={o.style}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onChange(o.value)
                    setOpen(false)
                  }}
                >
                  {o.label}
                </button>
              ))}
        </div>
      )}
    </div>
  )
}
