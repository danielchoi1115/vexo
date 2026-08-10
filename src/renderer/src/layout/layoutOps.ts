import {
  createLeaf,
  newId,
  type DropZone,
  type LayoutNode
} from './types'

export function cloneLayout(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') {
    return {
      type: 'leaf',
      id: node.id,
      tabIds: [...node.tabIds],
      activeTabId: node.activeTabId
    }
  }
  return {
    type: 'split',
    id: node.id,
    direction: node.direction,
    sizes: [...node.sizes] as [number, number],
    children: [cloneLayout(node.children[0]), cloneLayout(node.children[1])]
  }
}

export function findLeaf(node: LayoutNode, leafId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.id === leafId ? node : null
  return findLeaf(node.children[0], leafId) ?? findLeaf(node.children[1], leafId)
}

export function findLeafContainingTab(node: LayoutNode, tabId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.tabIds.includes(tabId) ? node : null
  return (
    findLeafContainingTab(node.children[0], tabId) ??
    findLeafContainingTab(node.children[1], tabId)
  )
}

export function firstLeaf(node: LayoutNode): LayoutNode {
  if (node.type === 'leaf') return node
  return firstLeaf(node.children[0])
}

export function collectLeaves(node: LayoutNode): LayoutNode[] {
  if (node.type === 'leaf') return [node]
  return [...collectLeaves(node.children[0]), ...collectLeaves(node.children[1])]
}

/** Active tab id of each leaf pane (currently visible terminal per split) */
export function getVisibleActiveTabIds(node: LayoutNode | null): string[] {
  if (!node) return []
  return collectLeaves(node)
    .filter((l): l is Extract<LayoutNode, { type: 'leaf' }> => l.type === 'leaf')
    .map((l) => l.activeTabId)
    .filter((id): id is string => Boolean(id))
}

export function countTabs(node: LayoutNode): number {
  if (node.type === 'leaf') return node.tabIds.length
  return countTabs(node.children[0]) + countTabs(node.children[1])
}

/** Update a leaf by id immutably */
function mapLeaf(
  node: LayoutNode,
  leafId: string,
  fn: (leaf: Extract<LayoutNode, { type: 'leaf' }>) => LayoutNode
): LayoutNode {
  if (node.type === 'leaf') {
    return node.id === leafId ? fn(node) : node
  }
  return {
    ...node,
    children: [
      mapLeaf(node.children[0], leafId, fn),
      mapLeaf(node.children[1], leafId, fn)
    ]
  }
}

/** Remove empty leaves and collapse single-child splits */
export function normalize(node: LayoutNode): LayoutNode | null {
  if (node.type === 'leaf') {
    if (node.tabIds.length === 0) return null
    const activeTabId =
      node.activeTabId && node.tabIds.includes(node.activeTabId)
        ? node.activeTabId
        : (node.tabIds[node.tabIds.length - 1] ?? null)
    return { ...node, activeTabId }
  }

  const left = normalize(node.children[0])
  const right = normalize(node.children[1])
  if (!left && !right) return null
  if (!left) return right
  if (!right) return left
  return {
    ...node,
    children: [left, right]
  }
}

/** Replace a tab id everywhere it appears (used when restarting a session). */
export function replaceTabId(node: LayoutNode, oldId: string, newId: string): LayoutNode {
  if (node.type === 'leaf') {
    if (!node.tabIds.includes(oldId)) return node
    return {
      ...node,
      tabIds: node.tabIds.map((id) => (id === oldId ? newId : id)),
      activeTabId: node.activeTabId === oldId ? newId : node.activeTabId
    }
  }
  return {
    ...node,
    children: [
      replaceTabId(node.children[0], oldId, newId),
      replaceTabId(node.children[1], oldId, newId)
    ]
  }
}

export function removeTab(node: LayoutNode, tabId: string): LayoutNode | null {
  const walk = (n: LayoutNode): LayoutNode => {
    if (n.type === 'leaf') {
      if (!n.tabIds.includes(tabId)) return n
      const tabIds = n.tabIds.filter((id) => id !== tabId)
      let activeTabId = n.activeTabId
      if (activeTabId === tabId) {
        activeTabId = tabIds[tabIds.length - 1] ?? null
      }
      return { ...n, tabIds, activeTabId }
    }
    return {
      ...n,
      children: [walk(n.children[0]), walk(n.children[1])]
    }
  }
  return normalize(walk(node))
}

export function addTabToLeaf(
  node: LayoutNode,
  leafId: string,
  tabId: string,
  activate = true
): LayoutNode {
  return mapLeaf(node, leafId, (leaf) => {
    if (leaf.tabIds.includes(tabId)) {
      return activate ? { ...leaf, activeTabId: tabId } : leaf
    }
    return {
      ...leaf,
      tabIds: [...leaf.tabIds, tabId],
      activeTabId: activate ? tabId : leaf.activeTabId
    }
  })
}

export function setLeafActiveTab(
  node: LayoutNode,
  leafId: string,
  tabId: string
): LayoutNode {
  return mapLeaf(node, leafId, (leaf) =>
    leaf.tabIds.includes(tabId) ? { ...leaf, activeTabId: tabId } : leaf
  )
}

/** Normalized geometry of a leaf pane in the workspace (0–1). */
export interface LeafRect {
  id: string
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
  tabIds: string[]
}

/** Compute leaf rectangles from the split tree (relative unit square). */
export function collectLeafRects(
  node: LayoutNode,
  x = 0,
  y = 0,
  w = 1,
  h = 1
): LeafRect[] {
  if (node.type === 'leaf') {
    return [
      {
        id: node.id,
        x,
        y,
        w,
        h,
        cx: x + w / 2,
        cy: y + h / 2,
        tabIds: [...node.tabIds]
      }
    ]
  }
  const [s0, s1] = node.sizes
  if (node.direction === 'row') {
    // left | right
    return [
      ...collectLeafRects(node.children[0], x, y, w * s0, h),
      ...collectLeafRects(node.children[1], x + w * s0, y, w * s1, h)
    ]
  }
  // top / bottom
  return [
    ...collectLeafRects(node.children[0], x, y, w, h * s0),
    ...collectLeafRects(node.children[1], x, y + h * s0, w, h * s1)
  ]
}

/**
 * All tabs in visual reading order (VS Code-like):
 * panes top→bottom, left→right; within each pane, tab bar order.
 */
export function getTabsInVisualOrder(
  root: LayoutNode
): { leafId: string; tabId: string }[] {
  const leaves = collectLeafRects(root).sort((a, b) => {
    // Top to bottom first, then left to right
    if (Math.abs(a.cy - b.cy) > 1e-6) return a.cy - b.cy
    return a.cx - b.cx
  })
  const out: { leafId: string; tabId: string }[] = []
  for (const leaf of leaves) {
    for (const tabId of leaf.tabIds) {
      out.push({ leafId: leaf.id, tabId })
    }
  }
  return out
}

/**
 * Cycle focus across all tabs in visual order (wraps).
 * Returns updated layout + focused leaf/tab, or null if nothing to do.
 */
export function cycleTabsVisual(
  root: LayoutNode,
  currentTabId: string | null,
  delta: 1 | -1
): { layout: LayoutNode; leafId: string; tabId: string } | null {
  const order = getTabsInVisualOrder(root)
  if (order.length === 0) return null
  if (order.length === 1) {
    const only = order[0]!
    return {
      layout: setLeafActiveTab(root, only.leafId, only.tabId),
      leafId: only.leafId,
      tabId: only.tabId
    }
  }

  let idx = currentTabId ? order.findIndex((t) => t.tabId === currentTabId) : -1
  if (idx < 0) idx = 0
  const next = order[(idx + delta + order.length) % order.length]!
  return {
    layout: setLeafActiveTab(root, next.leafId, next.tabId),
    leafId: next.leafId,
    tabId: next.tabId
  }
}

/**
 * Reorder a tab within the same leaf. `toIndex` is the insert-before index
 * in the list *before* removing the dragged tab (drop-target index).
 */
export function reorderTabInLeaf(
  root: LayoutNode,
  leafId: string,
  tabId: string,
  toIndex: number
): LayoutNode {
  const map = (node: LayoutNode): LayoutNode => {
    if (node.type === 'leaf') {
      if (node.id !== leafId) return node
      const from = node.tabIds.indexOf(tabId)
      if (from < 0) return node
      const tabIds = [...node.tabIds]
      tabIds.splice(from, 1)
      let idx = Math.max(0, Math.min(toIndex, tabIds.length + 1))
      if (from < idx) idx -= 1
      idx = Math.max(0, Math.min(idx, tabIds.length))
      if (from === idx) return node
      tabIds.splice(idx, 0, tabId)
      return { ...node, tabIds, activeTabId: tabId }
    }
    return {
      ...node,
      children: [map(node.children[0]!), map(node.children[1]!)]
    }
  }
  return map(root)
}

/**
 * Move tab into target leaf. zone=center adds as tab;
 * edge zones split the target leaf.
 */
export function moveTab(
  root: LayoutNode,
  tabId: string,
  targetLeafId: string,
  zone: DropZone
): LayoutNode | null {
  // Detach first
  let layout = removeTab(root, tabId)
  if (!layout) {
    // Was the only tab — rebuild as new leaf
    if (zone === 'center') {
      return createLeaf([tabId], tabId)
    }
    layout = createLeaf([])
  }

  const target = findLeaf(layout, targetLeafId)
  if (!target || target.type !== 'leaf') {
    // Target vanished; put in first leaf
    const fl = firstLeaf(layout)
    if (fl.type !== 'leaf') return createLeaf([tabId], tabId)
    return addTabToLeaf(layout, fl.id, tabId)
  }

  if (zone === 'center') {
    return addTabToLeaf(layout, targetLeafId, tabId)
  }

  const newLeaf = createLeaf([tabId], tabId)
  const direction: 'row' | 'col' =
    zone === 'left' || zone === 'right' ? 'row' : 'col'
  const children: [LayoutNode, LayoutNode] =
    zone === 'left' || zone === 'top'
      ? [newLeaf, { ...target }]
      : [{ ...target }, newLeaf]

  const splitNode: LayoutNode = {
    type: 'split',
    id: newId(),
    direction,
    children,
    sizes: [0.5, 0.5]
  }

  // Replace target leaf with split
  const replace = (n: LayoutNode): LayoutNode => {
    if (n.type === 'leaf') {
      return n.id === targetLeafId ? splitNode : n
    }
    return {
      ...n,
      children: [replace(n.children[0]), replace(n.children[1])]
    }
  }

  return normalize(replace(layout)) ?? createLeaf([tabId], tabId)
}

/** Resize a split node by id */
export function resizeSplit(
  node: LayoutNode,
  splitId: string,
  sizes: [number, number]
): LayoutNode {
  if (node.type === 'leaf') return node
  if (node.id === splitId) {
    const a = Math.min(0.85, Math.max(0.15, sizes[0]))
    return { ...node, sizes: [a, 1 - a] }
  }
  return {
    ...node,
    children: [
      resizeSplit(node.children[0], splitId, sizes),
      resizeSplit(node.children[1], splitId, sizes)
    ]
  }
}

/** Which leaf currently shows focused tab (for SFTP etc.) */
export function leafIdForTab(node: LayoutNode, tabId: string): string | null {
  const leaf = findLeafContainingTab(node, tabId)
  return leaf?.type === 'leaf' ? leaf.id : null
}
