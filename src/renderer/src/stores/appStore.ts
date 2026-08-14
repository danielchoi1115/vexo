import { create } from 'zustand'
import type {
  ActiveSessionInfo,
  RemoteMetrics,
  SessionConfig,
  SessionFolder,
  TransferProgress
} from '../../../shared/types'
import {
  addTabToLeaf,
  cycleTabsVisual,
  firstLeaf,
  getVisibleActiveTabIds,
  moveTab,
  removeTab,
  reorderTabInLeaf,
  replaceTabId,
  resizeSplit,
  setLeafActiveTab
} from '../layout/layoutOps'
import { createLeaf, MAX_SESSIONS, type DropZone, type LayoutNode } from '../layout/types'
import { useSettingsStore } from './settingsStore'
import {
  disposeAllTerminals,
  disposeTerminal,
  initTerminalDataRouter,
  preloadTerminal
} from '../terminal/terminalCache'

function leafExists(node: LayoutNode, leafId: string): boolean {
  if (node.type === 'leaf') return node.id === leafId
  return leafExists(node.children[0], leafId) || leafExists(node.children[1], leafId)
}

export type SidebarTab = 'sessions' | 'sftp'

interface AppState {
  sessions: SessionConfig[]
  folders: SessionFolder[]
  activeSessions: ActiveSessionInfo[]
  focusedActiveId: string | null
  /** Focused leaf pane (for drops / new tabs) */
  focusedLeafId: string | null
  layout: LayoutNode | null
  sidebarTab: SidebarTab
  transfers: TransferProgress[]
  connecting: boolean
  error: string | null
  // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
  // followTerminalFolder: boolean
  // remoteCwd: Record<string, string>
  metrics: Record<string, RemoteMetrics>
  settingsOpen: boolean
  /** Hide the left sidebar (Ctrl+Shift+B) */
  sidebarCollapsed: boolean
  selectedFolderId: string | null
  newSessionRequestId: number
  /** Broadcast mode: keys from bottom input go to all visible connected tabs */
  broadcastEnabled: boolean

  loadSessions: () => Promise<void>
  setBroadcastEnabled: (v: boolean) => void
  /** Visible (per-pane active) + connected session ids */
  getBroadcastTargets: () => ActiveSessionInfo[]
  /** Write raw terminal data to all broadcast targets */
  broadcastWrite: (data: string) => void
  setSidebarTab: (tab: SidebarTab) => void
  setFocused: (id: string | null, leafId?: string | null) => void
  setFocusedLeaf: (leafId: string | null) => void
  setError: (msg: string | null) => void
  // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
  // setFollowTerminalFolder: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  toggleSidebar: () => void
  setSelectedFolderId: (id: string | null) => void
  setFolderCollapsed: (id: string, collapsed: boolean) => void
  requestNewSession: () => void
  /** Next/prev tab across all panes (visual order: top→bottom, left→right) */
  cycleTab: (direction: 'next' | 'prev') => void
  /** Close the focused tab (Ctrl+W) */
  closeFocusedTab: () => Promise<void>
  /**
   * Connect a saved session. Optional leafId/zone place the new tab
   * (center = add to pane, edges = split like VS Code).
   */
  connectSession: (
    sessionConfigId: string,
    opts?: { leafId?: string; zone?: DropZone }
  ) => Promise<void>
  disconnectSession: (activeId: string) => Promise<void>
  disconnectAll: () => Promise<void>
  disconnectOthers: (keepId: string) => Promise<void>
  disconnectDisconnected: () => Promise<void>
  /** Close a finished tab (Enter after session end) */
  exitEndedSession: (activeId: string) => Promise<void>
  /** Reconnect using the same session config (R after session end) */
  restartSession: (activeId: string) => Promise<void>
  upsertActive: (info: ActiveSessionInfo) => void
  // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
  // setRemoteCwd: (activeId: string, cwd: string) => void
  setMetrics: (m: RemoteMetrics) => void
  updateTransfer: (p: TransferProgress) => void
  /** Drag-drop tab move / split */
  dropTab: (tabId: string, targetLeafId: string, zone: DropZone) => void
  /** Reorder tabs within one pane (same leaf) */
  reorderPaneTab: (leafId: string, tabId: string, toIndex: number) => void
  setLeafActive: (leafId: string, tabId: string) => void
  resizeLayoutSplit: (splitId: string, sizes: [number, number]) => void
}

function syncFocusFromLayout(
  layout: LayoutNode | null,
  preferredTabId: string | null
): { focusedActiveId: string | null; focusedLeafId: string | null } {
  if (!layout) return { focusedActiveId: null, focusedLeafId: null }
  const leaf = firstLeaf(layout)
  if (leaf.type !== 'leaf') return { focusedActiveId: null, focusedLeafId: null }
  const tab =
    preferredTabId && leaf.tabIds.includes(preferredTabId)
      ? preferredTabId
      : leaf.activeTabId
  return { focusedActiveId: tab, focusedLeafId: leaf.id }
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  folders: [],
  activeSessions: [],
  focusedActiveId: null,
  focusedLeafId: null,
  layout: null,
  sidebarTab: 'sessions',
  transfers: [],
  connecting: false,
  error: null,
  // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
  // followTerminalFolder: false,
  // remoteCwd: {},
  metrics: {},
  settingsOpen: false,
  sidebarCollapsed: false,
  selectedFolderId: null,
  newSessionRequestId: 0,
  broadcastEnabled: false,

  loadSessions: async () => {
    const [sessions, folders] = await Promise.all([
      window.api.sessions.list(),
      window.api.sessions.listFolders()
    ])
    set((s) => {
      const selectedFolderId =
        s.selectedFolderId && folders.some((f) => f.id === s.selectedFolderId)
          ? s.selectedFolderId
          : null
      return { sessions, folders, selectedFolderId }
    })
  },

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setFocused: (id, leafId) =>
    set((s) => ({
      focusedActiveId: id,
      focusedLeafId: leafId !== undefined ? leafId : s.focusedLeafId
    })),
  setFocusedLeaf: (leafId) => set({ focusedLeafId: leafId }),
  setError: (msg) => set({ error: msg }),
  // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
  // setFollowTerminalFolder: (v) => set({ followTerminalFolder: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSelectedFolderId: (id) => set({ selectedFolderId: id }),
  setFolderCollapsed: (id, collapsed) =>
    set((s) => ({
      folders: s.folders.map((f) => (f.id === id ? { ...f, collapsed } : f))
    })),
  setBroadcastEnabled: (v) => set({ broadcastEnabled: v }),

  cycleTab: (direction) => {
    const { layout, focusedActiveId } = get()
    if (!layout) return

    const result = cycleTabsVisual(
      layout,
      focusedActiveId,
      direction === 'next' ? 1 : -1
    )
    if (!result) return
    set({
      layout: result.layout,
      focusedActiveId: result.tabId,
      focusedLeafId: result.leafId
    })
  },

  closeFocusedTab: async () => {
    const id = get().focusedActiveId
    if (!id) return
    await get().disconnectSession(id)
  },
  getBroadcastTargets: () => {
    const { layout, activeSessions } = get()
    const visible = new Set(getVisibleActiveTabIds(layout))
    return activeSessions.filter((s) => visible.has(s.id) && s.status === 'connected')
  },
  broadcastWrite: (data) => {
    if (!data) return
    const targets = get().getBroadcastTargets()
    for (const s of targets) {
      void window.api.ssh.write(s.id, data)
    }
  },
  requestNewSession: () => {
    set((s) => ({
      sidebarTab: 'sessions',
      newSessionRequestId: s.newSessionRequestId + 1
    }))
  },

  connectSession: async (sessionConfigId, opts) => {
    const { activeSessions } = get()
    if (activeSessions.length >= MAX_SESSIONS) {
      set({
        error: useSettingsStore.getState().t('app.maxSessions', { max: MAX_SESSIONS })
      })
      return
    }
    set({ connecting: true, error: null })
    try {
      initTerminalDataRouter()
      const info = await window.api.ssh.connect({ sessionConfigId })
      preloadTerminal(info.id)
      set((s) => {
        const nextSessions = [...s.activeSessions.filter((a) => a.id !== info.id), info]
        let layout = s.layout
        let focusedLeafId = s.focusedLeafId
        const zone = opts?.zone ?? 'center'
        const preferLeaf = opts?.leafId

        if (!layout) {
          layout = createLeaf([info.id], info.id)
          focusedLeafId = layout.id
        } else {
          const fl = firstLeaf(layout)
          const targetLeafId =
            preferLeaf && leafExists(layout, preferLeaf)
              ? preferLeaf
              : focusedLeafId && leafExists(layout, focusedLeafId)
                ? focusedLeafId
                : fl.type === 'leaf'
                  ? fl.id
                  : null

          if (targetLeafId) {
            if (zone === 'center') {
              layout = addTabToLeaf(layout, targetLeafId, info.id, true)
              focusedLeafId = targetLeafId
            } else {
              // Split target pane and put the new session on the new side
              const split = moveTab(layout, info.id, targetLeafId, zone)
              layout = split ?? createLeaf([info.id], info.id)
              const find = (n: LayoutNode): string | null => {
                if (n.type === 'leaf') return n.tabIds.includes(info.id) ? n.id : null
                return find(n.children[0]) ?? find(n.children[1])
              }
              focusedLeafId = find(layout) ?? targetLeafId
            }
          } else {
            layout = createLeaf([info.id], info.id)
            focusedLeafId = layout.id
          }
        }

        return {
          activeSessions: nextSessions,
          focusedActiveId: info.id,
          focusedLeafId,
          layout,
          connecting: false
        }
      })
      await get().loadSessions()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ connecting: false, error: msg })
      throw e
    }
  },

  disconnectSession: async (activeId) => {
    await window.api.ssh.disconnect(activeId)
    disposeTerminal(activeId)
    set((s) => {
      const activeSessions = s.activeSessions.filter((a) => a.id !== activeId)
      let layout = s.layout ? removeTab(s.layout, activeId) : null
      if (activeSessions.length === 0) layout = null
      const focus = syncFocusFromLayout(
        layout,
        s.focusedActiveId === activeId ? null : s.focusedActiveId
      )
      // Prefer remaining focus in same leaf if possible
      let focusedActiveId = focus.focusedActiveId
      let focusedLeafId = focus.focusedLeafId
      if (layout && s.focusedActiveId !== activeId && s.focusedActiveId) {
        focusedActiveId = s.focusedActiveId
        focusedLeafId = s.focusedLeafId
      } else if (layout) {
        const fl = firstLeaf(layout)
        if (fl.type === 'leaf') {
          focusedLeafId = fl.id
          focusedActiveId = fl.activeTabId
        }
      }
      return { activeSessions, layout, focusedActiveId, focusedLeafId }
    })
  },

  exitEndedSession: async (activeId) => {
    await get().disconnectSession(activeId)
  },

  restartSession: async (activeId) => {
    const old = get().activeSessions.find((a) => a.id === activeId)
    if (!old) return
    const configId = old.sessionConfigId
    set({ connecting: true, error: null })
    try {
      try {
        await window.api.ssh.disconnect(activeId)
      } catch {
        /* already closed on server side */
      }
      disposeTerminal(activeId)
      initTerminalDataRouter()
      const info = await window.api.ssh.connect({ sessionConfigId: configId })
      preloadTerminal(info.id)
      set((s) => {
        const activeSessions = s.activeSessions.map((a) => (a.id === activeId ? info : a))
        const layout = s.layout
          ? replaceTabId(s.layout, activeId, info.id)
          : createLeaf([info.id], info.id)
        return {
          activeSessions,
          layout,
          focusedActiveId: s.focusedActiveId === activeId ? info.id : s.focusedActiveId,
          connecting: false
        }
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ connecting: false, error: msg })
    }
  },

  disconnectAll: async () => {
    const ids = get().activeSessions.map((a) => a.id)
    await Promise.all(ids.map((id) => window.api.ssh.disconnect(id)))
    disposeAllTerminals()
    set({
      activeSessions: [],
      focusedActiveId: null,
      focusedLeafId: null,
      layout: null
    })
  },

  disconnectOthers: async (keepId) => {
    const others = get().activeSessions.filter((a) => a.id !== keepId)
    await Promise.all(others.map((a) => window.api.ssh.disconnect(a.id)))
    for (const a of others) disposeTerminal(a.id)
    set((s) => {
      const activeSessions = s.activeSessions.filter((a) => a.id === keepId)
      const layout = createLeaf([keepId], keepId)
      return {
        activeSessions,
        layout,
        focusedActiveId: keepId,
        focusedLeafId: layout.id
      }
    })
  },

  disconnectDisconnected: async () => {
    const ids = get()
      .activeSessions.filter((a) => a.status === 'disconnected' || a.status === 'error')
      .map((a) => a.id)
    await Promise.all(
      ids.map(async (id) => {
        try {
          await window.api.ssh.disconnect(id)
        } catch {
          /* already gone */
        }
        disposeTerminal(id)
      })
    )
    set((s) => {
      let layout = s.layout
      for (const id of ids) {
        if (layout) layout = removeTab(layout, id)
      }
      const activeSessions = s.activeSessions.filter(
        (a) => a.status !== 'disconnected' && a.status !== 'error'
      )
      if (activeSessions.length === 0) layout = null
      const focus = syncFocusFromLayout(layout, s.focusedActiveId)
      return {
        activeSessions,
        layout,
        focusedActiveId: focus.focusedActiveId,
        focusedLeafId: focus.focusedLeafId
      }
    })
  },

  upsertActive: (info) => {
    set((s) => {
      const idx = s.activeSessions.findIndex((a) => a.id === info.id)
      // Only update sessions we already track (connectSession owns creation + layout).
      // Avoid status events inserting sessions without a layout (blank UI).
      if (idx < 0) return s
      const activeSessions = [...s.activeSessions]
      activeSessions[idx] = { ...activeSessions[idx], ...info }
      return { activeSessions }
    })
  },

  // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
  // setRemoteCwd: (activeId, cwd) => {
  //   set((s) => ({ remoteCwd: { ...s.remoteCwd, [activeId]: cwd } }))
  // },

  setMetrics: (m) => {
    set((s) => ({ metrics: { ...s.metrics, [m.activeSessionId]: m } }))
  },

  updateTransfer: (p) => {
    set((s) => {
      const others = s.transfers.filter((t) => t.transferId !== p.transferId)
      if (p.done) {
        return { transfers: others }
      }
      return { transfers: [...others, p] }
    })
  },

  dropTab: (tabId, targetLeafId, zone) => {
    set((s) => {
      if (!s.layout) return s
      const layout = moveTab(s.layout, tabId, targetLeafId, zone)
      if (!layout) {
        return {
          layout: createLeaf([tabId], tabId),
          focusedActiveId: tabId,
          focusedLeafId: null
        }
      }
      // Focus moved tab
      const fl = firstLeaf(layout)
      let focusedLeafId = s.focusedLeafId
      // Find leaf containing tab
      const find = (n: LayoutNode): string | null => {
        if (n.type === 'leaf') return n.tabIds.includes(tabId) ? n.id : null
        return find(n.children[0]) ?? find(n.children[1])
      }
      focusedLeafId = find(layout) ?? (fl.type === 'leaf' ? fl.id : null)
      return {
        layout,
        focusedActiveId: tabId,
        focusedLeafId
      }
    })
  },

  reorderPaneTab: (leafId, tabId, toIndex) => {
    set((s) => {
      if (!s.layout) return s
      return {
        layout: reorderTabInLeaf(s.layout, leafId, tabId, toIndex),
        focusedActiveId: tabId,
        focusedLeafId: leafId
      }
    })
  },

  setLeafActive: (leafId, tabId) => {
    set((s) => {
      if (!s.layout) return s
      return {
        layout: setLeafActiveTab(s.layout, leafId, tabId),
        focusedActiveId: tabId,
        focusedLeafId: leafId
      }
    })
  },

  resizeLayoutSplit: (splitId, sizes) => {
    set((s) => {
      if (!s.layout) return s
      return { layout: resizeSplit(s.layout, splitId, sizes) }
    })
  }
}))

export { MAX_SESSIONS }
export type { DropZone, LayoutNode }
