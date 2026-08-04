import { useMemo, useState } from 'react'
import type { SessionConfig } from '../../../shared/types'
import { useAppStore } from '../stores/appStore'
import { SessionForm } from './SessionForm'

export function Sidebar(): React.JSX.Element {
  const sessions = useAppStore((s) => s.sessions)
  const loadSessions = useAppStore((s) => s.loadSessions)
  const connectSession = useAppStore((s) => s.connectSession)
  const connecting = useAppStore((s) => s.connecting)
  const setError = useAppStore((s) => s.setError)

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<SessionConfig | null | 'new'>(null)
  const [passwordPrompt, setPasswordPrompt] = useState<SessionConfig | null>(null)
  const [tempPassword, setTempPassword] = useState('')
  const [menuId, setMenuId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = [...sessions]
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.host.toLowerCase().includes(q) ||
          (s.group ?? '').toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      return (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0)
    })
  }, [sessions, query])

  const groups = useMemo(() => {
    const map = new Map<string, SessionConfig[]>()
    for (const s of filtered) {
      const g = s.group || 'Ungrouped'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(s)
    }
    return [...map.entries()]
  }, [filtered])

  const tryConnect = async (session: SessionConfig, password?: string): Promise<void> => {
    try {
      if (session.authMethod === 'password' && !session.hasCredential && !password) {
        setPasswordPrompt(session)
        return
      }
      await connectSession(session.id, password)
      setPasswordPrompt(null)
      setTempPassword('')
    } catch {
      /* store sets error */
    }
  }

  const onContext = (e: React.MouseEvent, session: SessionConfig): void => {
    e.preventDefault()
    setMenuId(session.id)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="brand">Vexo</span>
        <button className="btn icon" title="New session" onClick={() => setEditing('new')}>
          +
        </button>
      </div>

      <input
        className="search"
        placeholder="Search sessions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="session-list">
        {groups.map(([group, items]) => (
          <div key={group} className="session-group">
            <div className="group-title">{group}</div>
            {items.map((session) => (
              <div
                key={session.id}
                className="session-item"
                onDoubleClick={() => void tryConnect(session)}
                onContextMenu={(e) => onContext(e, session)}
                style={session.color ? { borderLeftColor: session.color } : undefined}
              >
                <div className="session-item-main">
                  <span className="session-name">
                    {session.favorite ? '★ ' : ''}
                    {session.name}
                  </span>
                  <span className="session-meta">
                    {session.username}@{session.host}:{session.port}
                  </span>
                </div>
                <button
                  className="btn ghost sm"
                  disabled={connecting}
                  onClick={() => void tryConnect(session)}
                >
                  Connect
                </button>
                {menuId === session.id && (
                  <div className="context-menu" onMouseLeave={() => setMenuId(null)}>
                    <button
                      onClick={() => {
                        setMenuId(null)
                        void tryConnect(session)
                      }}
                    >
                      Connect
                    </button>
                    <button
                      onClick={() => {
                        setMenuId(null)
                        setEditing(session)
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        setMenuId(null)
                        void window.api.sessions
                          .setFavorite(session.id, !session.favorite)
                          .then(loadSessions)
                      }}
                    >
                      {session.favorite ? 'Unfavorite' : 'Favorite'}
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        setMenuId(null)
                        if (confirm(`Delete session "${session.name}"?`)) {
                          void window.api.sessions.delete(session.id).then(loadSessions)
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        {filtered.length === 0 && <div className="empty">No sessions yet. Click + to add one.</div>}
      </div>

      {editing && (
        <div className="modal-backdrop">
          <div className="modal">
            <SessionForm
              initial={editing === 'new' ? null : editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null)
                void loadSessions()
              }}
            />
          </div>
        </div>
      )}

      {passwordPrompt && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>Password for {passwordPrompt.name}</h3>
            <input
              type="password"
              autoFocus
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              placeholder="Password"
            />
            <div className="form-actions">
              <button
                className="btn ghost"
                onClick={() => {
                  setPasswordPrompt(null)
                  setTempPassword('')
                  setError(null)
                }}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!tempPassword}
                onClick={() => void tryConnect(passwordPrompt, tempPassword)}
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
