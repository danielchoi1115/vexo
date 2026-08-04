import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { SessionTree } from './SessionTree'
import { SftpBrowser } from './SftpBrowser'

export function Sidebar(): React.JSX.Element {
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const setSidebarTab = useAppStore((s) => s.setSidebarTab)
  const focusedActiveId = useAppStore((s) => s.focusedActiveId)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const activeSessions = useAppStore((s) => s.activeSessions)
  const requestNewSession = useAppStore((s) => s.requestNewSession)

  const focusedConnected =
    !!focusedActiveId &&
    activeSessions.some((a) => a.id === focusedActiveId && a.status === 'connected')

  // Leave SFTP when focused session is not connected
  useEffect(() => {
    if (sidebarTab === 'sftp' && !focusedConnected) {
      setSidebarTab('sessions')
    }
  }, [sidebarTab, focusedConnected, setSidebarTab])

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="brand">Vexo</span>
        <div className="sidebar-header-actions">
          <button className="btn icon" title="New session" onClick={() => requestNewSession()}>
            +
          </button>
          <button className="btn ghost sm" title="Settings" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </div>
      </div>

      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${sidebarTab === 'sessions' ? 'active' : ''}`}
          onClick={() => setSidebarTab('sessions')}
        >
          Sessions
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'sftp' ? 'active' : ''}`}
          onClick={() => {
            if (focusedConnected) setSidebarTab('sftp')
          }}
          disabled={!focusedConnected}
          title={focusedConnected ? 'SFTP browser' : 'Connect a session first'}
        >
          SFTP
        </button>
      </div>

      <div className="sidebar-body">
        {/* Keep SessionTree mounted to avoid remount side-effects */}
        <div
          className="sidebar-panel"
          style={{ display: sidebarTab === 'sessions' ? 'flex' : 'none' }}
        >
          <SessionTree />
        </div>
        {sidebarTab === 'sftp' &&
          (focusedConnected && focusedActiveId ? (
            <SftpBrowser activeSessionId={focusedActiveId} />
          ) : (
            <div className="sftp-browser empty-sftp">
              <p className="muted">Connect a session to use SFTP.</p>
            </div>
          ))}
      </div>
    </aside>
  )
}
