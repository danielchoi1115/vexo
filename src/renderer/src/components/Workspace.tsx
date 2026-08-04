import { useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { TerminalView } from './TerminalView'
import { ContextMenu, type MenuItem } from './ContextMenu'

export function Workspace(): React.JSX.Element {
  const activeSessions = useAppStore((s) => s.activeSessions)
  const focusedActiveId = useAppStore((s) => s.focusedActiveId)
  const setFocused = useAppStore((s) => s.setFocused)
  const disconnectSession = useAppStore((s) => s.disconnectSession)
  const disconnectAll = useAppStore((s) => s.disconnectAll)
  const disconnectOthers = useAppStore((s) => s.disconnectOthers)
  const metrics = useAppStore((s) => s.metrics)
  const remoteMonitoring = useSettingsStore((s) => s.remoteMonitoring)

  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null)

  const tabMenuItems = (id: string): MenuItem[] => [
    {
      label: 'Close tab',
      onClick: () => void disconnectSession(id)
    },
    {
      label: 'Close all except this tab',
      onClick: () => void disconnectOthers(id),
      disabled: activeSessions.length <= 1
    },
    {
      label: 'Close all tabs',
      onClick: () => void disconnectAll(),
      danger: true
    }
  ]

  if (activeSessions.length === 0) {
    return (
      <div className="workspace empty-workspace">
        <div className="welcome">
          <h2>Welcome to Vexo</h2>
          <p>Double-click a saved session on the left to connect.</p>
          <p className="muted">Right-click the session list for New Session / New Folder.</p>
        </div>
      </div>
    )
  }

  const focusedMetrics = focusedActiveId ? metrics[focusedActiveId] : undefined

  return (
    <div className="workspace">
      <div className="tab-bar">
        {activeSessions.map((s) => (
          <div
            key={s.id}
            className={`tab ${s.id === focusedActiveId ? 'active' : ''}`}
            onClick={() => setFocused(s.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setFocused(s.id)
              setTabMenu({ x: e.clientX, y: e.clientY, id: s.id })
            }}
          >
            <span className={`status-dot ${s.status}`} />
            <span className="tab-label">{s.name}</span>
            <button
              className="tab-close"
              title="Close"
              onClick={(e) => {
                e.stopPropagation()
                void disconnectSession(s.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="tab-bar-spacer" />
      </div>

      {remoteMonitoring && focusedMetrics && (
        <div className="metrics-bar" title={focusedMetrics.error || undefined}>
          <span>
            <b>Host</b> {focusedMetrics.hostname}
          </span>
          <span>
            <b>CPU</b> {focusedMetrics.cpu}
          </span>
          <span>
            <b>Mem</b> {focusedMetrics.memory}
          </span>
          <span>
            <b>Net</b> {focusedMetrics.network}
          </span>
          <span>
            <b>Up</b> {focusedMetrics.uptime}
          </span>
          <span>
            <b>Disk</b> {focusedMetrics.storage}
          </span>
        </div>
      )}

      <div className="workspace-body">
        {activeSessions.map((s) => {
          const isFocused = s.id === focusedActiveId
          return (
            <div
              key={s.id}
              className="session-pane"
              style={{ display: isFocused ? 'flex' : 'none' }}
            >
              <TerminalView activeSessionId={s.id} active={isFocused} />
            </div>
          )
        })}
      </div>

      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={tabMenuItems(tabMenu.id)}
          onClose={() => setTabMenu(null)}
        />
      )}
    </div>
  )
}
