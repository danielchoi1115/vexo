import { useLayoutEffect, useEffect, useRef, useState } from 'react'

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

function flatten(
  options: SelectOption[],
  groups?: { label: string; options: SelectOption[] }[]
): SelectOption[] {
  if (groups?.length) return groups.flatMap((g) => g.options)
  return options
}

/**
 * Unified rounded select. Opens upward when there isn't enough space below
 * so parent scroll areas don't grow.
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
  const [listPos, setListPos] = useState<React.CSSProperties>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const all = flatten(options, groups)
  const selected = all.find((o) => o.value === value) ?? all[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        // Fixed list is portaled visually but still under rootRef in DOM
        const list = listRef.current
        if (list && list.contains(e.target as Node)) return
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

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return

    const place = (): void => {
      const trigger = rootRef.current!.getBoundingClientRect()
      const listEl = listRef.current
      const listH = listEl
        ? Math.min(listEl.scrollHeight, LIST_MAX_H)
        : LIST_MAX_H
      const gap = 4
      const spaceBelow = window.innerHeight - trigger.bottom - gap
      const spaceAbove = trigger.top - gap
      const openUp = spaceBelow < Math.min(listH, 120) && spaceAbove > spaceBelow

      setPlacement(openUp ? 'top' : 'bottom')
      setListPos({
        position: 'fixed',
        left: trigger.left,
        width: trigger.width,
        maxHeight: LIST_MAX_H,
        zIndex: 1000,
        ...(openUp
          ? { bottom: window.innerHeight - trigger.top + gap, top: 'auto' }
          : { top: trigger.bottom + gap, bottom: 'auto' })
      })

      // Scroll active item inside list only (never scrollIntoView — expands parents)
      if (listEl) {
        const active = listEl.querySelector('[data-active="true"]') as HTMLElement | null
        if (active) {
          const top = active.offsetTop
          const bottom = top + active.offsetHeight
          if (top < listEl.scrollTop) listEl.scrollTop = top
          else if (bottom > listEl.scrollTop + listEl.clientHeight) {
            listEl.scrollTop = bottom - listEl.clientHeight
          }
        }
      }
    }

    place()
    // remeasure after paint when list is measured
    requestAnimationFrame(place)

    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, value, options, groups])

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
        setOpen(false)
      }}
    >
      {o.label}
    </button>
  )

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
          {placement === 'top' && open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
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
        </div>
      )}
    </div>
  )
}
