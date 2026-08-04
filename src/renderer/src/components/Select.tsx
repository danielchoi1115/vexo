import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface SelectOption {
  value: string
  label: string
  style?: React.CSSProperties
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  groups?: { label: string; options: SelectOption[] }[]
  className?: string
  triggerStyle?: React.CSSProperties
  disabled?: boolean
  'aria-label'?: string
}

const LIST_MAX_H = 220
const GAP = 4

function flatten(
  options: SelectOption[],
  groups?: { label: string; options: SelectOption[] }[]
): SelectOption[] {
  if (groups?.length) return groups.flatMap((g) => g.options)
  return options
}

function computePlacement(trigger: DOMRect): {
  placement: 'top' | 'bottom'
  style: React.CSSProperties
} {
  const spaceBelow = window.innerHeight - trigger.bottom - GAP
  const spaceAbove = trigger.top - GAP
  // Prefer opening above when the space below can't fit a useful portion of the list
  const openUp = spaceBelow < Math.min(LIST_MAX_H, 180) && spaceAbove > spaceBelow

  if (openUp) {
    return {
      placement: 'top',
      style: {
        position: 'fixed',
        left: trigger.left,
        width: trigger.width,
        maxHeight: Math.min(LIST_MAX_H, Math.max(120, spaceAbove)),
        bottom: window.innerHeight - trigger.top + GAP,
        top: 'auto',
        zIndex: 10000
      }
    }
  }

  return {
    placement: 'bottom',
    style: {
      position: 'fixed',
      left: trigger.left,
      width: trigger.width,
      maxHeight: Math.min(LIST_MAX_H, Math.max(120, spaceBelow)),
      top: trigger.bottom + GAP,
      bottom: 'auto',
      zIndex: 10000
    }
  }
}

/**
 * Unified rounded select.
 * List is portaled to document.body and positioned with fixed coords
 * so it opens above (y-axis) when needed without growing parent scroll.
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
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom')
  const [listPos, setListPos] = useState<React.CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const all = flatten(options, groups)
  const selected = all.find((o) => o.value === value) ?? all[0]

  const openMenu = (): void => {
    if (disabled || !rootRef.current) return
    const trigger = rootRef.current.getBoundingClientRect()
    const { placement: p, style } = computePlacement(trigger)
    setPlacement(p)
    setListPos(style)
    setOpen(true)
  }

  const closeMenu = (): void => {
    setOpen(false)
    setListPos(null)
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent): void => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (listRef.current?.contains(t)) return
      closeMenu()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeMenu()
    }
    const onReposition = (): void => {
      if (!rootRef.current) return
      const trigger = rootRef.current.getBoundingClientRect()
      const { placement: p, style } = computePlacement(trigger)
      setPlacement(p)
      setListPos(style)
    }
    document.addEventListener('pointerdown', onDoc, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    // Only window scroll — not capture on every nested scroll (avoids jitter)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('pointerdown', onDoc, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  const renderItem = (o: SelectOption): React.JSX.Element => (
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
        closeMenu()
      }}
    >
      {o.label}
    </button>
  )

  const list =
    open && listPos
      ? createPortal(
          <div
            className={`ui-select-list placement-${placement}`}
            ref={listRef}
            role="listbox"
            style={listPos}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {groups?.length
              ? groups.map((g) => (
                  <div key={g.label} className="ui-select-group">
                    <div className="ui-select-group-label">{g.label}</div>
                    {g.options.map(renderItem)}
                  </div>
                ))
              : options.map(renderItem)}
          </div>,
          document.body
        )
      : null

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
          if (open) closeMenu()
          else openMenu()
        }}
      >
        <span className="ui-select-value" style={selected?.style}>
          {selected?.label ?? value}
        </span>
        <span className="ui-select-caret" aria-hidden>
          {open && placement === 'top' ? '▴' : '▾'}
        </span>
      </button>
      {list}
    </div>
  )
}
