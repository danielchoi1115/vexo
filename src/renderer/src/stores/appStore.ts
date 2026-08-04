import { create } from 'zustand'
import type { ActiveSessionInfo, SessionConfig, TransferProgress } from '../../../shared/types'

export type MainPanel = 'terminal' | 'sftp'

interface AppState {
  sessions: SessionConfig[]
  activeSessions: ActiveSessionInfo[]
  focusedActiveId: string | null
  panel: MainPanel
  transfers: TransferProgress[]
  connecting: boolean
  error: string | null

  loadSessions: () => Promise<void>
  setPanel: (panel: MainPanel) => void
  setFocused: (id: string | null) => void
  setError: (msg: string | null) => void
  connectSession: (sessionConfigId: string, password?: string, passphrase?: string) => Promise<void>
  disconnectSession: (activeId: string) => Promise<void>
  upsertActive: (info: ActiveSessionInfo) => void
  removeActive: (id: string) => void
  updateTransfer: (p: TransferProgress) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  activeSessions: [],
  focusedActiveId: null,
  panel: 'terminal',
  transfers: [],
  connecting: false,
  error: null,

  loadSessions: async () => {
    const sessions = await window.api.sessions.list()
    set({ sessions })
  },

  setPanel: (panel) => set({ panel }),
  setFocused: (id) => set({ focusedActiveId: id }),
  setError: (msg) => set({ error: msg }),

  connectSession: async (sessionConfigId, password, passphrase) => {
    set({ connecting: true, error: null })
    try {
      const info = await window.api.ssh.connect({ sessionConfigId, password, passphrase })
      set((s) => ({
        activeSessions: [...s.activeSessions.filter((a) => a.id !== info.id), info],
        focusedActiveId: info.id,
        panel: 'terminal',
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

  upsertActive: (info) => {
    set((s) => {
      const idx = s.activeSessions.findIndex((a) => a.id === info.id)
      const activeSessions = [...s.activeSessions]
      if (idx >= 0) activeSessions[idx] = info
      else activeSessions.push(info)

      // drop fully disconnected from tabs after status update (optional keep for history)
      const filtered =
        info.status === 'disconnected' || info.status === 'error'
          ? activeSessions.filter((a) => a.id !== info.id)
          : activeSessions

      const focusedActiveId =
        s.focusedActiveId === info.id &&
        (info.status === 'disconnected' || info.status === 'error')
          ? (filtered[filtered.length - 1]?.id ?? null)
          : s.focusedActiveId

      return { activeSessions: filtered, focusedActiveId }
    })
  },

  removeActive: (id) => {
    set((s) => ({
      activeSessions: s.activeSessions.filter((a) => a.id !== id),
      focusedActiveId: s.focusedActiveId === id ? null : s.focusedActiveId
    }))
  },

  updateTransfer: (p) => {
    set((s) => {
      const others = s.transfers.filter((t) => t.transferId !== p.transferId)
      const transfers = p.done && !p.error ? others : [...others, p]
      // keep completed errors briefly
      if (p.done && p.error) {
        return { transfers: [...others, p] }
      }
      return { transfers }
    })
  }
}))
