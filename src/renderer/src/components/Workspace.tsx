import { useAppStore } from '../stores/appStore'
import { TerminalView } from './TerminalView'
import { SftpPanel } from './SftpPanel'

export function Workspace(): React.JSX.Element {
  const activeSessions = useAppStore((s) => s.activeSessions)
  const focusedActiveId = useAppStore((s) => s.focusedActiveId)
  const setFocused = useAppStore((s) => s.setFocused)
  const disconnectSession = useAppStore((s) => s.disconnectSession)
  const panel = useAppStore((s) => s.panel)
  const setPanel = useAppStore((s) => s.setPanel)

  if (activeSessions.length === 0) {
    return (
      <div className="workspace empty-workspace">
        <div className="welcome">
          <h2>Welcome to Vexo</h2>
          <p>Double-click a saved session on the left to connect.</p>
          <p className="muted">Terminal + SFTP share the same SSH connection.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="workspace">
      <div className="tab-bar">
        {activeSessions.map((s) => (
          <div
            key={s.id}
            className={`tab ${s.id === focusedActiveId ? 'active' : ''}`}
            onClick={() => setFocused(s.id)}
          >
            <span className={`status-dot ${s.status}`} />
            <span className="tab-label">{s.name}</span>
            <button
              className="tab-close"
              title="Disconnect"
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
        <div className="panel-toggle">
          <button
            className={`btn sm ${panel === 'terminal' ? 'primary' : 'ghost'}`}
            onClick={() => setPanel('terminal')}
          >
            Terminal
          </button>
          <button
            className={`btn sm ${panel === 'sftp' ? 'primary' : 'ghost'}`}
            onClick={() => setPanel('sftp')}
          >
            SFTP
          </button>
        </div>
      </div>

      <div className="workspace-body">
        {activeSessions.map((s) => {
          const isFocused = s.id === focusedActiveId
          // Keep xterm mounted (hidden when not focused/terminal) to preserve buffer
          return (
            <div
              key={s.id}
              className="session-pane"
              style={{ display: isFocused ? 'flex' : 'none' }}
            >
              <div
                className="terminal-pane"
                style={{ display: panel === 'terminal' ? 'flex' : 'none', flex: 1, minHeight: 0 }}
              >
                <TerminalView
                  activeSessionId={s.id}
                  active={isFocused && panel === 'terminal'}
                />
              </div>
              {panel === 'sftp' && isFocused && <SftpPanel activeSessionId={s.id} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
