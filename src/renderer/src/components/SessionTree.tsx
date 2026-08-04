import { useMemo, useState } from 'react'
import type { SessionConfig, SessionFolder } from '../../../shared/types'
import { useAppStore } from '../stores/appStore'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { SessionForm } from './SessionForm'

type Ctx =
  | { kind: 'blank'; x: number; y: number }
  | { kind: 'session'; x: number; y: number; session: SessionConfig }
  | { kind: 'folder'; x: number; y: number; folder: SessionFolder }

export function SessionTree(): React.JSX.Element {
  const sessions = useAppStore((s) => s.sessions)
  const folders = useAppStore((s) => s.folders)
  const loadSessions = useAppStore((s) => s.loadSessions)
  const connectSession = useAppStore((s) => s.connectSession)
  const connecting = useAppStore((s) => s.connecting)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<SessionConfig | null | 'new'>(null)
  const [defaultFolderId, setDefaultFolderId] = useState<string | null>(null)
  const [menu, setMenu] = useState<Ctx | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        (s.username || '').toLowerCase().includes(q)
    )
  }, [sessions, query])

  const rootSessions = useMemo(
    () =>
      filteredSessions
        .filter((s) => !s.folderId)
        .sort((a, b) => a.order - b.order),
    [filteredSessions]
  )

  const sessionsByFolder = useMemo(() => {
    const map = new Map<string, SessionConfig[]>()
    for (const s of filteredSessions) {
      if (!s.folderId) continue
      if (!map.has(s.folderId)) map.set(s.folderId, [])
      map.get(s.folderId)!.push(s)
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [filteredSessions])

  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.order - b.order),
    [folders]
  )

  const tryConnect = (session: SessionConfig): void => {
    void connectSession(session.id)
  }

  const openNewSession = (folderId: string | null = null): void => {
    setDefaultFolderId(folderId)
    setEditing('new')
  }

  const openNewFolder = async (): Promise<void> => {
    const name = prompt('Folder name', 'New folder')
    if (!name) return
    await window.api.sessions.createFolder(name)
    await loadSessions()
  }

  const blankMenu = (): MenuItem[] => [
    { label: 'New Session', onClick: () => openNewSession(null) },
    { label: 'New Folder', onClick: () => void openNewFolder() },
    { separator: true, label: '', onClick: () => {} },
    { label: 'Settings', onClick: () => setSettingsOpen(true) }
  ]

  const sessionMenu = (session: SessionConfig): MenuItem[] => [
    { label: 'Connect', onClick: () => tryConnect(session) },
    { label: 'Edit', onClick: () => setEditing(session) },
    {
      label: session.favorite ? 'Unfavorite' : 'Favorite',
      onClick: () =>
        void window.api.sessions.setFavorite(session.id, !session.favorite).then(loadSessions)
    },
    {
      label: 'Delete',
      danger: true,
      onClick: () => {
        if (confirm(`Delete session "${session.name}"?`)) {
          void window.api.sessions.delete(session.id).then(loadSessions)
        }
      }
    }
  ]

  const folderMenu = (folder: SessionFolder): MenuItem[] => [
    { label: 'New Session here', onClick: () => openNewSession(folder.id) },
    {
      label: folder.collapsed ? 'Expand' : 'Collapse',
      onClick: () =>
        void window.api.sessions
          .setFolderCollapsed(folder.id, !folder.collapsed)
          .then(loadSessions)
    },
    {
      label: 'Rename',
      onClick: () => {
        const name = prompt('Folder name', folder.name)
        if (name) void window.api.sessions.renameFolder(folder.id, name).then(loadSessions)
      }
    },
    {
      label: 'Delete folder',
      danger: true,
      onClick: () => {
        if (confirm(`Delete folder "${folder.name}"? Sessions move to root.`)) {
          void window.api.sessions.deleteFolder(folder.id).then(loadSessions)
        }
      }
    }
  ]

  const onDragStart = (e: React.DragEvent, type: 'session' | 'folder', id: string): void => {
    e.dataTransfer.setData('application/x-vexo-tree', JSON.stringify({ type, id }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDropOnFolder = async (
    e: React.DragEvent,
    folderId: string | null,
    index: number
  ): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(null)
    const raw = e.dataTransfer.getData('application/x-vexo-tree')
    if (!raw) return
    try {
      const { type, id } = JSON.parse(raw) as { type: 'session' | 'folder'; id: string }
      if (type === 'folder' && folderId !== null) return // folders stay at root level for MVP
      await window.api.sessions.reorder({
        dragId: id,
        dragType: type,
        targetFolderId: type === 'folder' ? null : folderId,
        targetIndex: index
      })
      await loadSessions()
    } catch {
      /* ignore */
    }
  }

  const renderSession = (session: SessionConfig, folderId: string | null, index: number): React.JSX.Element => (
    <div
      key={session.id}
      className="tree-item session"
      draggable
      onDragStart={(e) => onDragStart(e, 'session', session.id)}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(`s:${session.id}`)
      }}
      onDrop={(e) => void onDropOnFolder(e, folderId, index)}
      onDoubleClick={() => tryConnect(session)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ kind: 'session', x: e.clientX, y: e.clientY, session })
      }}
      style={session.color ? { borderLeftColor: session.color } : undefined}
    >
      <span className="tree-icon">💻</span>
      <div className="tree-text">
        <span className="session-name">
          {session.favorite ? '★ ' : ''}
          {session.name}
        </span>
        <span className="session-meta">
          {session.username ? `${session.username}@` : ''}
          {session.host}:{session.port}
        </span>
      </div>
      <button
        className="btn ghost sm"
        disabled={connecting}
        onClick={(e) => {
          e.stopPropagation()
          tryConnect(session)
        }}
      >
        ▶
      </button>
    </div>
  )

  return (
    <div
      className="session-tree"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ kind: 'blank', x: e.clientX, y: e.clientY })
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDropOnFolder(e, null, rootSessions.length)}
    >
      <div className="sidebar-toolbar">
        <input
          className="search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      <div className="tree-scroll">
        {sortedFolders.map((folder, fi) => {
          const kids = sessionsByFolder.get(folder.id) ?? []
          return (
            <div
              key={folder.id}
              className={`tree-folder ${dragOver === `f:${folder.id}` ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(`f:${folder.id}`)
              }}
              onDrop={(e) => void onDropOnFolder(e, folder.id, kids.length)}
              onDragStart={(e) => onDragStart(e, 'folder', folder.id)}
              draggable
            >
              <div
                className="tree-item folder"
                onClick={() =>
                  void window.api.sessions
                    .setFolderCollapsed(folder.id, !folder.collapsed)
                    .then(loadSessions)
                }
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu({ kind: 'folder', x: e.clientX, y: e.clientY, folder })
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(`f:${folder.id}`)
                }}
                onDrop={(e) => void onDropOnFolder(e, folder.id, 0)}
              >
                <span className="tree-icon">{folder.collapsed ? '▶' : '▼'}</span>
                <span className="tree-icon">📂</span>
                <span className="folder-name">{folder.name}</span>
                <span className="muted count">{kids.length}</span>
              </div>
              {!folder.collapsed && (
                <div className="tree-children">
                  {kids.map((s, i) => renderSession(s, folder.id, i))}
                  {kids.length === 0 && (
                    <div
                      className="drop-hint"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => void onDropOnFolder(e, folder.id, 0)}
                    >
                      Drop sessions here
                    </div>
                  )}
                </div>
              )}
              {/* reorder folders among themselves */}
              <div
                className="folder-drop-line"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => void onDropOnFolder(e, null, fi)}
              />
            </div>
          )
        })}

        <div className="tree-root-sessions">
          {rootSessions.map((s, i) => renderSession(s, null, i))}
        </div>

        {filteredSessions.length === 0 && (
          <div className="empty">Right-click for New Session / New Folder</div>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={
            menu.kind === 'blank'
              ? blankMenu()
              : menu.kind === 'session'
                ? sessionMenu(menu.session)
                : folderMenu(menu.folder)
          }
          onClose={() => setMenu(null)}
        />
      )}

      {editing && (
        <div className="modal-backdrop">
          <div className="modal">
            <SessionForm
              initial={editing === 'new' ? null : editing}
              folders={folders}
              defaultFolderId={defaultFolderId}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null)
                void loadSessions()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
