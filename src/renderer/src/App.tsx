import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { BroadcastBar } from './components/BroadcastBar'
import { SettingsModal } from './components/SettingsModal'
import { PasswordSaveDialog } from './components/PasswordSaveDialog'
import { useAppShortcuts } from './hooks/useAppShortcuts'
import { useAppStore } from './stores/appStore'
import { useSettingsStore } from './stores/settingsStore'
import { initTerminalDataRouter, registerEndedSessionHooks } from './terminal/terminalCache'

function App(): React.JSX.Element {
  const loadSessions = useAppStore((s) => s.loadSessions)
  const upsertActive = useAppStore((s) => s.upsertActive)
  const setRemoteCwd = useAppStore((s) => s.setRemoteCwd)
  const setMetrics = useAppStore((s) => s.setMetrics)
  const error = useAppStore((s) => s.error)
  const setError = useAppStore((s) => s.setError)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const loadSettings = useSettingsStore((s) => s.load)
  const t = useSettingsStore((s) => s.t)
  const [passwordSave, setPasswordSave] = useState<{
    activeSessionId: string
    username: string
    host: string
  } | null>(null)

  useAppShortcuts()

  useEffect(() => {
    initTerminalDataRouter()
    void loadSettings()
    void loadSessions()

    registerEndedSessionHooks({
      isEnded: (id) => {
        const s = useAppStore.getState().activeSessions.find((a) => a.id === id)
        return s?.status === 'disconnected' || s?.status === 'error'
      },
      onExit: (id) => {
        void useAppStore.getState().exitEndedSession(id)
      },
      onRestart: (id) => {
        void useAppStore.getState().restartSession(id)
      }
    })

    const offStatus = window.api.ssh.onStatus((info) => {
      upsertActive(info)
    })
    const offCwd = window.api.ssh.onCwd((id, cwd) => {
      setRemoteCwd(id, cwd)
    })
    const offMetrics = window.api.ssh.onMetrics((m) => {
      setMetrics(m)
    })
    const offPwd = window.api.ssh.onAskPasswordSave((payload) => {
      setPasswordSave({
        activeSessionId: payload.activeSessionId,
        username: payload.username,
        host: payload.host
      })
    })
    return () => {
      offStatus()
      offCwd()
      offMetrics()
      offPwd()
    }
  }, [loadSessions, loadSettings, upsertActive, setRemoteCwd, setMetrics])

  return (
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar />
      <main className="main">
        {/* Reserve banner slot only for errors — avoid layout jump on Connecting */}
        {error && (
          <div className="top-banner error">
            {error}
            <button className="btn ghost sm" onClick={() => setError(null)}>
              {t('common.dismiss')}
            </button>
          </div>
        )}
        <Workspace />
        <BroadcastBar />
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {passwordSave && (
        <PasswordSaveDialog
          username={passwordSave.username}
          host={passwordSave.host}
          onAnswer={(save, dontAskAgain) => {
            const id = passwordSave.activeSessionId
            setPasswordSave(null)
            void window.api.ssh.answerPasswordSave(id, save, dontAskAgain)
            void loadSessions()
          }}
        />
      )}
    </div>
  )
}

export default App
