import { create } from 'zustand'
import type {
  ActiveSessionInfo,
  RemoteMetrics,
  SessionConfig,
  SessionFolder,
  TransferProgress
} from '../../../shared/types'

export type SidebarTab = 'sessions' | 'sftp'

interface AppState {
  sessions: SessionConfig[]
  folders: SessionFolder[]
  activeSessions: ActiveSessionInfo[]
  focusedActiveId: string | null
  sidebarTab: SidebarTab
  transfers: TransferProgress[]
  connecting: boolean
  error: string | null
  followTerminalFolder: boolean
  remoteCwd: Record<string, string>
  metrics: Record<string, RemoteMetrics>
  settingsOpen: boolean
  /** Selected folder in session tree (null = root) */
  selectedFolderId: string | null
  /** Signal SessionTree to open new-session form */
  newSessionRequestId: number

  loadSessions: () => Promise<void>
  setSidebarTab: (tab: SidebarTab) => void
  setFocused: (id: string | null) => void
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
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  folders: [],
  activeSessions: [],
  focusedActiveId: null,
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
      // Clear selection if folder was deleted
      const selectedFolderId =
        s.selectedFolderId && folders.some((f) => f.id === s.selectedFolderId)
          ? s.selectedFolderId
          : null
      return { sessions, folders, selectedFolderId }
    })
  },

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setFocused: (id) => set({ focusedActiveId: id }),
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
    set({ connecting: true, error: null })
    try {
      const info = await window.api.ssh.connect({ sessionConfigId })
      set((s) => ({
        activeSessions: [...s.activeSessions.filter((a) => a.id !== info.id), info],
        focusedActiveId: info.id,
        connecting: false
      }))
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
      const focusedActiveId =
        s.focusedActiveId === activeId
          ? (activeSessions[activeSessions.length - 1]?.id ?? null)
          : s.focusedActiveId
      return { activeSessions, focusedActiveId }
    })
  },

  disconnectAll: async () => {
    const ids = get().activeSessions.map((a) => a.id)
    await Promise.all(ids.map((id) => window.api.ssh.disconnect(id)))
    set({ activeSessions: [], focusedActiveId: null })
  },

  disconnectOthers: async (keepId) => {
    const others = get().activeSessions.filter((a) => a.id !== keepId)
    await Promise.all(others.map((a) => window.api.ssh.disconnect(a.id)))
    set((s) => ({
      activeSessions: s.activeSessions.filter((a) => a.id === keepId),
      focusedActiveId: keepId
    }))
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
      const activeSessions = s.activeSessions.filter(
        (a) => a.status !== 'disconnected' && a.status !== 'error'
      )
      const focusedActiveId = activeSessions.some((a) => a.id === s.focusedActiveId)
        ? s.focusedActiveId
        : (activeSessions[activeSessions.length - 1]?.id ?? null)
      return { activeSessions, focusedActiveId }
    })
  },

  upsertActive: (info) => {
    set((s) => {
      const idx = s.activeSessions.findIndex((a) => a.id === info.id)
      const activeSessions = [...s.activeSessions]
      if (idx >= 0) activeSessions[idx] = { ...activeSessions[idx], ...info }
      else activeSessions.push(info)
      // Keep disconnected/error tabs so user can close them via menu
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
      // Remove finished transfers immediately (including success)
      if (p.done) {
        return { transfers: others }
      }
      return { transfers: [...others, p] }
    })
  }
}))
