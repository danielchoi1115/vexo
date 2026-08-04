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
  /** Signal SessionTree to open new-session form */
  newSessionRequestId: number

  loadSessions: () => Promise<void>
  setSidebarTab: (tab: SidebarTab) => void
  setFocused: (id: string | null) => void
  setError: (msg: string | null) => void
  setFollowTerminalFolder: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  requestNewSession: () => void
  connectSession: (sessionConfigId: string) => Promise<void>
  disconnectSession: (activeId: string) => Promise<void>
  disconnectAll: () => Promise<void>
  disconnectOthers: (keepId: string) => Promise<void>
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
  newSessionRequestId: 0,

  loadSessions: async () => {
    const [sessions, folders] = await Promise.all([
      window.api.sessions.list(),
      window.api.sessions.listFolders()
    ])
    set({ sessions, folders })
  },

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setFocused: (id) => set({ focusedActiveId: id }),
  setError: (msg) => set({ error: msg }),
  setFollowTerminalFolder: (v) => set({ followTerminalFolder: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
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

  upsertActive: (info) => {
    set((s) => {
      const idx = s.activeSessions.findIndex((a) => a.id === info.id)
      let activeSessions = [...s.activeSessions]
      if (idx >= 0) activeSessions[idx] = { ...activeSessions[idx], ...info }
      else activeSessions.push(info)

      if (info.status === 'disconnected' || info.status === 'error') {
        // keep error tabs briefly only for disconnected remove
        if (info.status === 'disconnected') {
          activeSessions = activeSessions.filter((a) => a.id !== info.id)
        }
      }

      const focusedActiveId =
        s.focusedActiveId === info.id && info.status === 'disconnected'
          ? (activeSessions[activeSessions.length - 1]?.id ?? null)
          : s.focusedActiveId

      return { activeSessions, focusedActiveId }
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
