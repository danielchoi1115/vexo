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
  firstLeaf,
  moveTab,
  removeTab,
  resizeSplit,
  setLeafActiveTab
} from '../layout/layoutOps'
import { createLeaf, MAX_SESSIONS, type DropZone, type LayoutNode } from '../layout/types'
import { useSettingsStore } from './settingsStore'

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
  followTerminalFolder: boolean
  remoteCwd: Record<string, string>
  metrics: Record<string, RemoteMetrics>
  settingsOpen: boolean
  selectedFolderId: string | null
  newSessionRequestId: number

  loadSessions: () => Promise<void>
  setSidebarTab: (tab: SidebarTab) => void
  setFocused: (id: string | null, leafId?: string | null) => void
  setFocusedLeaf: (leafId: string | null) => void
  setError: (msg: string | null) => void
  setFollowTerminalFolder: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  setSelectedFolderId: (id: string | null) => void
  requestNewSession: () => void
  connectSession: (sessionConfigId: string) => Promise<void>
  disconnectSession: (activeId: string) => Promise<void>
  disconnectAll: () => Promise<void>
  disconnectOthers: (keepId: string) => Promise<void>
  disconnectDisconnected: () => Promise<void>
  upsertActive: (info: ActiveSessionInfo) => void
  setRemoteCwd: (activeId: string, cwd: string) => void
  setMetrics: (m: RemoteMetrics) => void
  updateTransfer: (p: TransferProgress) => void
  /** Drag-drop tab move / split */
  dropTab: (tabId: string, targetLeafId: string, zone: DropZone) => void
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
  followTerminalFolder: false,
  remoteCwd: {},
  metrics: {},
  settingsOpen: false,
  selectedFolderId: null,
  newSessionRequestId: 0,

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
  setFollowTerminalFolder: (v) => set({ followTerminalFolder: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setSelectedFolderId: (id) => set({ selectedFolderId: id }),
  requestNewSession: () => {
    set((s) => ({
      sidebarTab: 'sessions',
      newSessionRequestId: s.newSessionRequestId + 1
    }))
  },

  connectSession: async (sessionConfigId) => {
    const { activeSessions } = get()
    if (activeSessions.length >= MAX_SESSIONS) {
      set({
        error: useSettingsStore.getState().t('app.maxSessions', { max: MAX_SESSIONS })
      })
      return
    }
    set({ connecting: true, error: null })
    try {
      const info = await window.api.ssh.connect({ sessionConfigId })
      set((s) => {
        const nextSessions = [...s.activeSessions.filter((a) => a.id !== info.id), info]
        let layout = s.layout
        let focusedLeafId = s.focusedLeafId

        if (!layout) {
          layout = createLeaf([info.id], info.id)
          focusedLeafId = layout.id
        } else {
          const fl = firstLeaf(layout)
          const targetLeafId =
            focusedLeafId && leafExists(layout, focusedLeafId)
              ? focusedLeafId
              : fl.type === 'leaf'
                ? fl.id
                : null
          if (targetLeafId) {
            layout = addTabToLeaf(layout, targetLeafId, info.id, true)
            focusedLeafId = targetLeafId
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

  disconnectAll: async () => {
    const ids = get().activeSessions.map((a) => a.id)
    await Promise.all(ids.map((id) => window.api.ssh.disconnect(id)))
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
      const activeSessions = [...s.activeSessions]
      if (idx >= 0) activeSessions[idx] = { ...activeSessions[idx], ...info }
      else activeSessions.push(info)
      return { activeSessions }
    })
  },

  setRemoteCwd: (activeId, cwd) => {
    set((s) => ({ remoteCwd: { ...s.remoteCwd, [activeId]: cwd } }))
  },

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
