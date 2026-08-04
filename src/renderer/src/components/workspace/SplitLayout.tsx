import { useCallback, useRef } from 'react'
import type { ActiveSessionInfo } from '../../../../shared/types'
import type { LayoutNode } from '../../layout/types'
import { useAppStore } from '../../stores/appStore'
import { EditorPane } from './EditorPane'

interface Props {
  node: LayoutNode
  sessions: ActiveSessionInfo[]
}

export function SplitLayout({ node, sessions }: Props): React.JSX.Element {
  if (node.type === 'leaf') {
    return <EditorPane leaf={node} sessions={sessions} />
  }

  return <SplitBranch node={node} sessions={sessions} />
}

function SplitBranch({
  node,
  sessions
}: {
  node: Extract<LayoutNode, { type: 'split' }>
  sessions: ActiveSessionInfo[]
}): React.JSX.Element {
  const resizeLayoutSplit = useAppStore((s) => s.resizeLayoutSplit)
  const dragging = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragging.current = true
      const el = containerRef.current
      if (!el) return
      el.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent): void => {
        if (!dragging.current || !containerRef.current) return
        const r = containerRef.current.getBoundingClientRect()
        let ratio: number
        if (node.direction === 'row') {
          ratio = (ev.clientX - r.left) / r.width
        } else {
          ratio = (ev.clientY - r.top) / r.height
        }
        ratio = Math.min(0.85, Math.max(0.15, ratio))
        resizeLayoutSplit(node.id, [ratio, 1 - ratio])
      }
      const onUp = (ev: PointerEvent): void => {
        dragging.current = false
        el.releasePointerCapture(ev.pointerId)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [node.direction, node.id, resizeLayoutSplit]
  )

  const [a, b] = node.sizes
  const isRow = node.direction === 'row'

  return (
    <div
      className={`split-branch dir-${node.direction}`}
      ref={containerRef}
      style={
        isRow
          ? { gridTemplateColumns: `${a}fr 4px ${b}fr` }
          : { gridTemplateRows: `${a}fr 4px ${b}fr` }
      }
    >
      <div className="split-child">
        <SplitLayout node={node.children[0]} sessions={sessions} />
      </div>
      <div
        className={`split-sash dir-${node.direction}`}
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation={isRow ? 'vertical' : 'horizontal'}
      />
      <div className="split-child">
        <SplitLayout node={node.children[1]} sessions={sessions} />
      </div>
    </div>
  )
}
