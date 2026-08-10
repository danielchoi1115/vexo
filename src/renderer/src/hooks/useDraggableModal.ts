import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'

/** Ignore pointer-down on interactive controls inside the drag handle */
const NO_DRAG_SEL = 'button, a, input, select, textarea, label, [role="button"]'

export interface DraggableModalApi {
  /** Modal shell (.modal) — div or form */
  modalRef: RefObject<HTMLElement | null>
  /** Apply to the modal shell (.modal) */
  modalStyle: CSSProperties
  /** Spread onto the header / drag region */
  dragHandleProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
  }
}

/**
 * Drag a centered modal by its header via CSS transform.
 * Clamps so the drag handle (header strip) stays fully on-screen —
 * never leave the user with an off-screen grab target.
 */
export function useDraggableModal(): DraggableModalApi {
  const modalRef = useRef<HTMLElement | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const posRef = useRef(pos)
  posRef.current = pos

  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)

  /**
   * Map desired transform (x,y) so the modal header stays inside the viewport.
   * Uses live getBoundingClientRect + current transform to recover base position.
   */
  const clamp = useCallback((x: number, y: number): { x: number; y: number } => {
    const el = modalRef.current
    if (!el) return { x, y }

    const cur = posRef.current
    const rect = el.getBoundingClientRect()
    // Undo current translate to get layout (centered) origin
    const baseLeft = rect.left - cur.x
    const baseTop = rect.top - cur.y
    const w = rect.width
    const h = rect.height
    if (w < 1 || h < 1) return { x, y }

    const handle =
      el.querySelector('.modal-drag-handle') ?? el.querySelector('.modal-header')
    const headerH = Math.min(
      Math.max(handle?.getBoundingClientRect().height ?? 44, 36),
      h
    )

    const margin = 8
    // Keep full header band on-screen vertically
    let ny = y
    const top = baseTop + ny
    if (top < margin) ny = margin - baseTop
    const bottom = baseTop + ny + headerH
    if (bottom > window.innerHeight - margin) {
      ny = window.innerHeight - margin - headerH - baseTop
    }

    // Keep enough horizontal width of the header grab area on-screen
    const minVisible = Math.min(120, Math.max(64, w * 0.35))
    let nx = x
    const left = baseLeft + nx
    const right = left + w
    if (right < minVisible) nx = minVisible - w - baseLeft
    if (baseLeft + nx > window.innerWidth - minVisible) {
      nx = window.innerWidth - minVisible - baseLeft
    }

    return { x: nx, y: ny }
  }, [])

  const endDrag = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest(NO_DRAG_SEL)) return
    e.preventDefault()
    const { x, y } = posRef.current
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: x,
      origY: y
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      const next = clamp(
        d.origX + (e.clientX - d.startX),
        d.origY + (e.clientY - d.startY)
      )
      setPos(next)
    },
    [clamp]
  )

  return {
    modalRef,
    modalStyle: {
      transform: `translate(${pos.x}px, ${pos.y}px)`
    },
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag
    }
  }
}
