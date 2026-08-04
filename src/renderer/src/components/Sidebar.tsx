import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SessionTree } from './SessionTree'
import { SftpBrowser } from './SftpBrowser'

export function Sidebar(): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const locale = useSettingsStore((s) => s.locale)
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
        <span className="brand">{t('app.brand')}</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="btn header-icon"
            title={t('sidebar.newSession')}
            onClick={() => requestNewSession()}
          >
            +
          </button>
          <button
            type="button"
            className="btn header-icon"
            title={t('common.settings')}
            onClick={() => setSettingsOpen(true)}
          >
            ⚙
          </button>
        </div>
      </div>

      <div className="sidebar-tabs" key={locale}>
        <button
          className={`sidebar-tab ${sidebarTab === 'sessions' ? 'active' : ''}`}
          onClick={() => setSidebarTab('sessions')}
        >
          {t('sidebar.sessions')}
        </button>
        <button
          className={`sidebar-tab ${sidebarTab === 'sftp' ? 'active' : ''}`}
          onClick={() => {
            if (focusedConnected) setSidebarTab('sftp')
          }}
          disabled={!focusedConnected}
          title={focusedConnected ? t('sidebar.sftp') : t('sidebar.connectFirst')}
        >
          {t('sidebar.sftp')}
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
              <p className="muted">{t('sidebar.sftpNeedConnect')}</p>
            </div>
          ))}
      </div>
    </aside>
  )
}
