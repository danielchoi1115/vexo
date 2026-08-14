import { useCallback, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SessionTree } from './SessionTree'
import { SftpBrowser } from './SftpBrowser'

const SIDEBAR_WIDTH_MIN = 200
const SIDEBAR_WIDTH_MAX = 560

export function clampSidebarWidth(px: number): number {
  const max = Math.min(SIDEBAR_WIDTH_MAX, Math.floor(window.innerWidth * 0.5))
  return Math.min(Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)), Math.max(SIDEBAR_WIDTH_MIN, max))
}

interface Props {
  onWidthDrag: (width: number) => void
  onWidthDragEnd: (width: number) => void
}

export function Sidebar({ onWidthDrag, onWidthDragEnd }: Props): React.JSX.Element {
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

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const handle = e.currentTarget
      handle.setPointerCapture(e.pointerId)
      let last = clampSidebarWidth(e.clientX)

      const onMove = (ev: PointerEvent): void => {
        last = clampSidebarWidth(ev.clientX)
        onWidthDrag(last)
      }
      const onUp = (ev: PointerEvent): void => {
        handle.releasePointerCapture(ev.pointerId)
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        onWidthDragEnd(clampSidebarWidth(ev.clientX || last))
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
    },
    [onWidthDrag, onWidthDragEnd]
  )

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
            className="btn icon-btn"
            title={t('sidebar.newSession')}
            onClick={() => requestNewSession()}
            aria-label={t('sidebar.newSession')}
          >
            <span className="icon-btn-glyph" aria-hidden>
              +
            </span>
          </button>
          <button
            type="button"
            className="btn icon-btn"
            title={t('common.settings')}
            onClick={() => setSettingsOpen(true)}
            aria-label={t('common.settings')}
          >
            <span className="icon-btn-glyph icon-btn-gear" aria-hidden>
              ⚙
            </span>
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
      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('sidebar.resize')}
        onPointerDown={onResizePointerDown}
      />
    </aside>
  )
}
