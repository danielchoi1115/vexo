import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionConfig, SessionFolder } from '../../../shared/types'
import { useAppStore } from '../stores/appStore'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { SessionForm } from './SessionForm'
import { PromptDialog } from './PromptDialog'

type Ctx =
  | { kind: 'blank'; x: number; y: number }
  | { kind: 'session'; x: number; y: number; session: SessionConfig }
  | { kind: 'folder'; x: number; y: number; folder: SessionFolder }

type PromptState =
  | { kind: 'new-folder' }
  | { kind: 'rename-folder'; folder: SessionFolder }
  | null

/** Module-level drag payload — Chromium sometimes drops custom mime types on drop */
let activeDrag: { type: 'session' | 'folder'; id: string } | null = null

function nextDuplicateName(baseName: string, existingNames: string[]): string {
  const set = new Set(existingNames)
  let i = 1
  while (set.has(`${baseName} (${i})`)) i++
  return `${baseName} (${i})`
}

export function SessionTree(): React.JSX.Element {
  const sessions = useAppStore((s) => s.sessions)
  const folders = useAppStore((s) => s.folders)
  const loadSessions = useAppStore((s) => s.loadSessions)
  const connectSession = useAppStore((s) => s.connectSession)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const newSessionRequestId = useAppStore((s) => s.newSessionRequestId)
  const selectedFolderId = useAppStore((s) => s.selectedFolderId)
  const setSelectedFolderId = useAppStore((s) => s.setSelectedFolderId)

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<SessionConfig | null | 'new'>(null)
  const [defaultFolderId, setDefaultFolderId] = useState<string | null>(null)
  const [menu, setMenu] = useState<Ctx | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PromptState>(null)
  const lastNewSessionReq = useRef(0)

  // Only open New Session when + increments the request id (uses selected folder)
  useEffect(() => {
    if (newSessionRequestId > 0 && newSessionRequestId !== lastNewSessionReq.current) {
      lastNewSessionReq.current = newSessionRequestId
      setDefaultFolderId(useAppStore.getState().selectedFolderId)
      setEditing('new')
    }
  }, [newSessionRequestId])

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
    () => filteredSessions.filter((s) => !s.folderId).sort((a, b) => a.order - b.order),
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

  const duplicateSession = async (session: SessionConfig): Promise<void> => {
    const name = nextDuplicateName(
      session.name,
      sessions.map((s) => s.name)
    )
    await window.api.sessions.save({
      name,
      host: session.host,
      port: session.port,
      username: session.username,
      authMethod: session.authMethod,
      privateKeyPath: session.privateKeyPath,
      folderId: session.folderId ?? null,
      color: session.color,
      tags: session.tags,
      favorite: false,
      x11Forwarding: session.x11Forwarding !== false,
      compression: session.compression !== false,
      backspaceSendsCtrlH: session.backspaceSendsCtrlH !== false
    })
    await loadSessions()
  }

  const blankMenu = (): MenuItem[] => [
    {
      label: 'New Session',
      onClick: () => openNewSession(selectedFolderId)
    },
    { label: 'New Folder', onClick: () => setPrompt({ kind: 'new-folder' }) },
    { separator: true, label: '', onClick: () => {} },
    {
      label: 'Export sessions…',
      onClick: () => {
        void window.api.sessions.export().then((r) => {
          if (r.ok) window.alert(`Exported to:\n${r.path}`)
        })
      }
    },
    {
      label: 'Import sessions (merge)…',
      onClick: () => {
        void window.api.sessions
          .import('merge')
          .then((r) => {
            if (r.ok) {
              void loadSessions()
              window.alert(`Imported ${r.sessions} session(s), ${r.folders} folder(s).`)
            }
          })
          .catch((e: Error) => window.alert(e.message))
      }
    },
    {
      label: 'Import sessions (replace)…',
      onClick: () => {
        if (!window.confirm('Replace all current sessions and folders?')) return
        void window.api.sessions
          .import('replace')
          .then((r) => {
            if (r.ok) {
              void loadSessions()
              window.alert(`Replaced with ${r.sessions} session(s), ${r.folders} folder(s).`)
            }
          })
          .catch((e: Error) => window.alert(e.message))
      }
    },
    { separator: true, label: '', onClick: () => {} },
    { label: 'Settings', onClick: () => setSettingsOpen(true) }
  ]

  const sessionMenu = (session: SessionConfig): MenuItem[] => [
    { label: 'Connect', onClick: () => tryConnect(session) },
    { label: 'Edit', onClick: () => setEditing(session) },
    {
      label: 'Duplicate',
      onClick: () => void duplicateSession(session)
    },
    {
      label: session.favorite ? 'Unfavorite' : 'Favorite',
      onClick: () =>
        void window.api.sessions.setFavorite(session.id, !session.favorite).then(loadSessions)
    },
    {
      label: 'Delete',
      danger: true,
      onClick: () => {
        if (window.confirm(`Delete session "${session.name}"?`)) {
          void window.api.sessions.delete(session.id).then(loadSessions)
        }
      }
    }
  ]

  const folderMenu = (folder: SessionFolder): MenuItem[] => [
    {
      label: 'Select folder',
      onClick: () => setSelectedFolderId(folder.id)
    },
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
      onClick: () => setPrompt({ kind: 'rename-folder', folder })
    },
    {
      label: 'Delete folder',
      danger: true,
      onClick: () => {
        if (window.confirm(`Delete folder "${folder.name}"? Sessions move to root.`)) {
          void window.api.sessions.deleteFolder(folder.id).then(loadSessions)
        }
      }
    }
  ]

  const onDragStart = (
    e: React.DragEvent,
    type: 'session' | 'folder',
    id: string
  ): void => {
    e.stopPropagation()
    activeDrag = { type, id }
    e.dataTransfer.setData('text/plain', `${type}:${id}`)
    e.dataTransfer.setData('application/x-vexo-tree', JSON.stringify({ type, id }))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragEnd = (): void => {
    activeDrag = null
    setDragOverKey(null)
  }

  const parseDrag = (e: React.DragEvent): { type: 'session' | 'folder'; id: string } | null => {
    if (activeDrag) return activeDrag
    const raw =
      e.dataTransfer.getData('application/x-vexo-tree') || e.dataTransfer.getData('text/plain')
    if (!raw) return null
    try {
      if (raw.startsWith('{')) return JSON.parse(raw) as { type: 'session' | 'folder'; id: string }
      const [type, id] = raw.split(':')
      if ((type === 'session' || type === 'folder') && id) return { type, id }
    } catch {
      /* ignore */
    }
    return null
  }

  const handleDrop = async (
    e: React.DragEvent,
    targetFolderId: string | null,
    targetIndex: number
  ): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverKey(null)
    const drag = parseDrag(e)
    activeDrag = null
    if (!drag) return

    if (drag.type === 'folder') {
      await window.api.sessions.reorder({
        dragId: drag.id,
        dragType: 'folder',
        targetFolderId: null,
        targetIndex
      })
      await loadSessions()
      return
    }

    await window.api.sessions.reorder({
      dragId: drag.id,
      dragType: 'session',
      targetFolderId,
      targetIndex
    })
    await loadSessions()
  }

  const allowDrop = (e: React.DragEvent, key: string): void => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDragOverKey(key)
  }

  const renderSession = (
    session: SessionConfig,
    folderId: string | null,
    index: number
  ): React.JSX.Element => (
    <div
      key={session.id}
      className={`tree-item session ${dragOverKey === `s:${session.id}` ? 'drag-over' : ''}`}
      draggable
      onDragStart={(e) => onDragStart(e, 'session', session.id)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => allowDrop(e, `s:${session.id}`)}
      onDrop={(e) => void handleDrop(e, folderId, index)}
      onClick={() => setSelectedFolderId(folderId)}
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
    </div>
  )

  return (
    <div
      className="session-tree"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ kind: 'blank', x: e.clientX, y: e.clientY })
      }}
      onClick={(e) => {
        // Click empty background → root selection
        if (e.target === e.currentTarget) setSelectedFolderId(null)
      }}
    >
      <div className="sidebar-toolbar">
        <input
          className="search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
        {selectedFolderId && (
          <div className="selection-hint">
            Folder selected — + creates here
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setSelectedFolderId(null)}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div
        className="tree-scroll"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedFolderId(null)
        }}
      >
        {sortedFolders.map((folder, fi) => {
          const kids = sessionsByFolder.get(folder.id) ?? []
          const folderDropKey = `f:${folder.id}`
          const selected = selectedFolderId === folder.id
          return (
            <div key={folder.id} className="tree-folder">
              <div
                className={`tree-item folder ${selected ? 'selected' : ''} ${dragOverKey === folderDropKey ? 'drag-over' : ''}`}
                draggable
                onDragStart={(e) => onDragStart(e, 'folder', folder.id)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => allowDrop(e, folderDropKey)}
                onDrop={(e) => void handleDrop(e, folder.id, kids.length)}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedFolderId(folder.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setSelectedFolderId(folder.id)
                  setMenu({ kind: 'folder', x: e.clientX, y: e.clientY, folder })
                }}
              >
                <button
                  type="button"
                  className="tree-chevron"
                  title={folder.collapsed ? 'Expand' : 'Collapse'}
                  onClick={(e) => {
                    e.stopPropagation()
                    void window.api.sessions
                      .setFolderCollapsed(folder.id, !folder.collapsed)
                      .then(loadSessions)
                  }}
                >
                  {folder.collapsed ? '▶' : '▼'}
                </button>
                <span className="tree-icon">📂</span>
                <span className="folder-name">{folder.name}</span>
                <span className="muted count">{kids.length}</span>
              </div>
              {!folder.collapsed && (
                <div
                  className={`tree-children ${dragOverKey === `fc:${folder.id}` ? 'drag-over' : ''}`}
                  onDragOver={(e) => allowDrop(e, `fc:${folder.id}`)}
                  onDrop={(e) => void handleDrop(e, folder.id, kids.length)}
                >
                  {kids.map((s, i) => renderSession(s, folder.id, i))}
                </div>
              )}
              <div
                className="folder-drop-line"
                onDragOver={(e) => allowDrop(e, `fl:${folder.id}`)}
                onDrop={(e) => void handleDrop(e, null, fi)}
              />
            </div>
          )
        })}

        <div
          className={`tree-root-sessions ${!selectedFolderId ? 'root-selected' : ''} ${dragOverKey === 'root' ? 'drag-over' : ''}`}
          onDragOver={(e) => allowDrop(e, 'root')}
          onDrop={(e) => void handleDrop(e, null, rootSessions.length)}
          onClick={() => setSelectedFolderId(null)}
        >
          {rootSessions.map((s, i) => renderSession(s, null, i))}
        </div>

        {filteredSessions.length === 0 && folders.length === 0 && (
          <div className="empty">Click + or right-click for New Session / New Folder</div>
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

      {prompt?.kind === 'new-folder' && (
        <PromptDialog
          title="New folder"
          label="Folder name"
          defaultValue="New folder"
          confirmLabel="Create"
          onCancel={() => setPrompt(null)}
          onSubmit={(name) => {
            setPrompt(null)
            void window.api.sessions.createFolder(name).then(loadSessions)
          }}
        />
      )}

      {prompt?.kind === 'rename-folder' && (
        <PromptDialog
          title="Rename folder"
          label="Folder name"
          defaultValue={prompt.folder.name}
          confirmLabel="Rename"
          onCancel={() => setPrompt(null)}
          onSubmit={(name) => {
            const id = prompt.folder.id
            setPrompt(null)
            void window.api.sessions.renameFolder(id, name).then(loadSessions)
          }}
        />
      )}

      {editing && (
        <div className="modal-backdrop">
          <div className="modal session-modal">
            <SessionForm
              initial={editing === 'new' ? null : editing}
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
