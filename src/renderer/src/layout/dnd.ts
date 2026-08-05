/** Active terminal tab drag (within workspace) */
export const TAB_MIME = 'application/x-vexo-tab'

/** Saved session from sidebar — drop to connect */
export const SESSION_CONFIG_MIME = 'application/x-vexo-session-config'

/** Sidebar tree reorder (sessions/folders) */
export const TREE_MIME = 'application/x-vexo-tree'

export function hasDragType(e: React.DragEvent, mime: string): boolean {
  return e.dataTransfer.types.includes(mime)
}
