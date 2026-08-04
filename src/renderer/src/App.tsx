import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { useAppStore } from './stores/appStore'

function App(): React.JSX.Element {
  const loadSessions = useAppStore((s) => s.loadSessions)
  const upsertActive = useAppStore((s) => s.upsertActive)
  const error = useAppStore((s) => s.error)
  const setError = useAppStore((s) => s.setError)
  const connecting = useAppStore((s) => s.connecting)

  useEffect(() => {
    void loadSessions()
    const off = window.api.ssh.onStatus((info) => {
      upsertActive(info)
    })
    return off
  }, [loadSessions, upsertActive])

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main">
        {(error || connecting) && (
          <div className={`top-banner ${error ? 'error' : 'info'}`}>
            {connecting ? 'Connecting…' : error}
            {error && (
              <button className="btn ghost sm" onClick={() => setError(null)}>
                Dismiss
              </button>
            )}
          </div>
        )}
        <Workspace />
      </main>
    </div>
  )
}

export default App
