import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { BroadcastBar } from './components/BroadcastBar'
import { SettingsModal } from './components/SettingsModal'
import { useAppStore } from './stores/appStore'
import { useSettingsStore } from './stores/settingsStore'
import { initTerminalDataRouter } from './terminal/terminalCache'

function App(): React.JSX.Element {
  const loadSessions = useAppStore((s) => s.loadSessions)
  const upsertActive = useAppStore((s) => s.upsertActive)
  const setRemoteCwd = useAppStore((s) => s.setRemoteCwd)
  const setMetrics = useAppStore((s) => s.setMetrics)
  const error = useAppStore((s) => s.error)
  const setError = useAppStore((s) => s.setError)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const loadSettings = useSettingsStore((s) => s.load)
  const t = useSettingsStore((s) => s.t)

  useEffect(() => {
    initTerminalDataRouter()
    void loadSettings()
    void loadSessions()

    const offStatus = window.api.ssh.onStatus((info) => {
      upsertActive(info)
    })
    const offCwd = window.api.ssh.onCwd((id, cwd) => {
      setRemoteCwd(id, cwd)
    })
    const offMetrics = window.api.ssh.onMetrics((m) => {
      setMetrics(m)
    })
    return () => {
      offStatus()
      offCwd()
      offMetrics()
    }
  }, [loadSessions, loadSettings, upsertActive, setRemoteCwd, setMetrics])

  return (
    <div className="app-shell">
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
    </div>
  )
}

export default App
