import { useAppStore } from '../stores/appStore'
import { SessionTree } from './SessionTree'
import { SftpBrowser } from './SftpBrowser'

export function Sidebar(): React.JSX.Element {
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const setSidebarTab = useAppStore((s) => s.setSidebarTab)
  const focusedActiveId = useAppStore((s) => s.focusedActiveId)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const activeSessions = useAppStore((s) => s.activeSessions)
  const hasConnected = activeSessions.some((a) => a.status === 'connected')

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="brand">Vexo</span>
        <button className="btn ghost sm" title="Settings" onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
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
          onClick={() => setSidebarTab('sftp')}
          disabled={!hasConnected && !focusedActiveId}
          title={!focusedActiveId ? 'Connect a session first' : 'SFTP browser'}
        >
          SFTP
        </button>
      </div>

      <div className="sidebar-body">
        {sidebarTab === 'sessions' ? (
          <SessionTree />
        ) : (
          <SftpBrowser activeSessionId={focusedActiveId} />
        )}
      </div>
    </aside>
  )
}
