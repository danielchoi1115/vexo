import type { DropZone } from '../../layout/types'

interface Props {
  zone: DropZone | null
}

/** VS Code-style drop feedback: edge half-panels vs center inset */
export function DropOverlay({ zone }: Props): React.JSX.Element | null {
  if (!zone) return null
  return (
    <div className="split-drop-overlay" aria-hidden>
      <div className={`split-drop-region zone-${zone}`} />
    </div>
  )
}

export function zoneFromPoint(
  el: HTMLElement,
  clientX: number,
  clientY: number
): DropZone {
  const r = el.getBoundingClientRect()
  const x = (clientX - r.left) / r.width
  const y = (clientY - r.top) / r.height
  const edge = 0.22 // 22% edge hot zones

  if (x < edge) return 'left'
  if (x > 1 - edge) return 'right'
  if (y < edge) return 'top'
  if (y > 1 - edge) return 'bottom'
  return 'center'
}
