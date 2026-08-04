/** Drop target within a pane (VS Code-style edges vs center) */
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'

/** Binary layout tree for split editors */
export type LayoutNode =
  | {
      type: 'leaf'
      id: string
      /** Active session tab ids in this pane */
      tabIds: string[]
      activeTabId: string | null
    }
  | {
      type: 'split'
      id: string
      /** row = left|right, col = top|bottom */
      direction: 'row' | 'col'
      children: [LayoutNode, LayoutNode]
      /** Relative sizes, sum ≈ 1 */
      sizes: [number, number]
    }

export const MAX_SESSIONS = 20

export function newId(): string {
  return crypto.randomUUID()
}

export function createLeaf(tabIds: string[] = [], activeTabId: string | null = null): LayoutNode {
  return {
    type: 'leaf',
    id: newId(),
    tabIds: [...tabIds],
    activeTabId: activeTabId ?? tabIds[tabIds.length - 1] ?? null
  }
}

export function emptyLayout(): LayoutNode {
  return createLeaf([])
}
