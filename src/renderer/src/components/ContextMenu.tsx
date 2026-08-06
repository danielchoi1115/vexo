import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

/**
 * Portaled to document.body so pane opacity/stacking contexts cannot bury the menu.
 */
export function ContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // capture so we close before other handlers
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 4
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 4
    el.style.left = `${Math.max(4, left)}px`
    el.style.top = `${Math.max(4, top)}px`
  }, [x, y])

  return createPortal(
    <div className="context-menu fixed-menu" ref={ref} style={{ left: x, top: y }}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            type="button"
            disabled={item.disabled}
            className={item.danger ? 'danger' : undefined}
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              onClose()
            }}
          >
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
