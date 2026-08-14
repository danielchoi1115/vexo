import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionConfig, SessionFolder } from '../../../shared/types'
import { useDraggableModal } from '../hooks/useDraggableModal'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { SessionForm } from './SessionForm'
import { PromptDialog } from './PromptDialog'
import { ExportSessionsDialog } from './ExportSessionsDialog'
import { ImportSessionsDialog } from './ImportSessionsDialog'

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

/** Windows default double-click interval. */
const DBLCLICK_MS = 500
/** Only to collapse native dblclick + our mouseup into one action. */
const DBLCLICK_DEDUPE_MS = 80

/** "foo (1)" → base "foo", so duplicating yields "foo (2)" not "foo (1) (1)" */
function nextDuplicateName(name: string, existingNames: string[]): string {
  const set = new Set(existingNames)
  const m = name.match(/^(.*?)(?: \((\d+)\))?$/)
  const base = (m?.[1] ?? name).trimEnd() || name
  let i = 1
  // If name already ends with (n), start from n+1
  if (m?.[2]) i = Number(m[2]) + 1
  while (set.has(`${base} (${i})`)) i++
  return `${base} (${i})`
}

/**
 * Own mount for session form so drag offset resets when closed
 * (unlike Settings which unmounts the whole modal component).
 */
function SessionEditModal({
  initial,
  defaultFolderId,
  onCancel,
  onSaved
}: {
  initial: SessionConfig | null
  defaultFolderId: string | null
  onCancel: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { modalRef, modalStyle, dragHandleProps } = useDraggableModal()
  return (
    <div className="modal-backdrop">
      <div
        ref={modalRef as React.RefObject<HTMLDivElement | null>}
        className="modal session-modal"
        style={modalStyle}
      >
        <SessionForm
          initial={initial}
          defaultFolderId={defaultFolderId}
          onCancel={onCancel}
          onSaved={onSaved}
          dragHandleProps={dragHandleProps}
        />
      </div>
    </div>
  )
}

export function SessionTree(): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
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
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const lastNewSessionReq = useRef(0)
  const lastTreeClickRef = useRef<{ key: string; at: number } | null>(null)
  const lastTreeActionRef = useRef(0)
  const pendingDoubleRef = useRef<(() => void) | null>(null)
  const setFolderCollapsed = useAppStore((s) => s.setFolderCollapsed)

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

  const toggleFolder = (folder: SessionFolder): void => {
    const collapsed = !folder.collapsed
    setFolderCollapsed(folder.id, collapsed)
    void window.api.sessions.setFolderCollapsed(folder.id, collapsed)
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
      backspaceSendsCtrlH: session.backspaceSendsCtrlH !== false,
      encoding: session.encoding,
      termType: session.termType,
      startupDirectory: session.startupDirectory,
      startupCommand: session.startupCommand,
      passwordSavePolicy: session.passwordSavePolicy
    })
    await loadSessions()
  }

  const blankMenu = (): MenuItem[] => [
    {
      label: t('session.newSession'),
      onClick: () => openNewSession(selectedFolderId)
    },
    { label: t('session.newFolder'), onClick: () => setPrompt({ kind: 'new-folder' }) },
    { separator: true, label: '', onClick: () => {} },
    {
      label: t('session.export'),
      onClick: () => setExportOpen(true)
    },
    {
      label: t('session.import'),
      onClick: () => setImportOpen(true)
    },
    { separator: true, label: '', onClick: () => {} },
    { label: t('common.settings'), onClick: () => setSettingsOpen(true) }
  ]

  const sessionMenu = (session: SessionConfig): MenuItem[] => [
    { label: t('common.connect'), onClick: () => tryConnect(session) },
    { label: t('common.edit'), onClick: () => setEditing(session) },
    {
      label: t('session.duplicate'),
      onClick: () => void duplicateSession(session)
    },
    {
      label: session.favorite ? t('session.unfavorite') : t('session.favorite'),
      onClick: () =>
        void window.api.sessions.setFavorite(session.id, !session.favorite).then(loadSessions)
    },
    {
      label: t('common.delete'),
      danger: true,
      onClick: () => {
        if (window.confirm(t('session.deleteSessionConfirm', { name: session.name }))) {
          void window.api.sessions.delete(session.id).then(loadSessions)
        }
      }
    }
  ]

  const folderMenu = (folder: SessionFolder): MenuItem[] => [
    {
      label: t('session.selectFolder'),
      onClick: () => setSelectedFolderId(folder.id)
    },
    { label: t('session.newSessionHere'), onClick: () => openNewSession(folder.id) },
    {
      label: folder.collapsed ? t('session.expand') : t('session.collapse'),
      onClick: () => toggleFolder(folder)
    },
    {
      label: t('common.rename'),
      onClick: () => setPrompt({ kind: 'rename-folder', folder })
    },
    {
      label: t('session.deleteFolder'),
      danger: true,
      onClick: () => {
        if (window.confirm(t('session.deleteFolderConfirm', { name: folder.name }))) {
          void window.api.sessions.deleteFolder(folder.id).then(loadSessions)
        }
      }
    }
  ]

  const runTreeDoubleAction = (fn: () => void): void => {
    const now = Date.now()
    if (now - lastTreeActionRef.current < DBLCLICK_DEDUPE_MS) return
    lastTreeActionRef.current = now
    fn()
  }

  /**
   * Windows Chromium starts HTML5 drag on the 2nd mousedown and drops
   * dblclick until the mouse moves. Arm the action here; run it on mouseup
   * so the row does not re-layout under a still-down pointer.
   */
  const onTreeItemMouseDown = (
    e: React.MouseEvent<HTMLElement>,
    key: string,
    onDouble: () => void
  ): void => {
    if (e.button !== 0) return
    const now = Date.now()
    const prev = lastTreeClickRef.current
    if (prev && prev.key === key && now - prev.at <= DBLCLICK_MS) {
      lastTreeClickRef.current = null
      pendingDoubleRef.current = onDouble
      e.currentTarget.draggable = false
      e.preventDefault()
      return
    }
    lastTreeClickRef.current = { key, at: now }
    pendingDoubleRef.current = null
  }

  const flushPendingDouble = (e: React.SyntheticEvent<HTMLElement>): void => {
    e.currentTarget.draggable = true
    const fn = pendingDoubleRef.current
    pendingDoubleRef.current = null
    if (fn) runTreeDoubleAction(fn)
  }

  const onDragStart = (
    e: React.DragEvent<HTMLElement>,
    type: 'session' | 'folder',
    id: string
  ): void => {
    if (pendingDoubleRef.current) {
      e.preventDefault()
      return
    }
    e.stopPropagation()
    activeDrag = { type, id }
    e.dataTransfer.setData('text/plain', `${type}:${id}`)
    e.dataTransfer.setData('application/x-vexo-tree', JSON.stringify({ type, id }))
    // Saved session can also be dropped on the workspace to connect
    if (type === 'session') {
      e.dataTransfer.setData('application/x-vexo-session-config', id)
      e.dataTransfer.effectAllowed = 'copyMove'
    } else {
      e.dataTransfer.effectAllowed = 'move'
    }
  }

  const onDragEnd = (e: React.DragEvent<HTMLElement>): void => {
    e.currentTarget.draggable = true
    pendingDoubleRef.current = null
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
    opts: {
      /** session → folder id; folder reorder ignores this */
      targetFolderId: string | null
      /** insert-before index in the current sibling list */
      targetIndex: number
      /** only accept this drag kind (default: either) */
      accept?: 'session' | 'folder'
    }
  ): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverKey(null)
    const drag = parseDrag(e)
    activeDrag = null
    if (!drag) return
    if (opts.accept && drag.type !== opts.accept) return

    if (drag.type === 'folder') {
      await window.api.sessions.reorder({
        dragId: drag.id,
        dragType: 'folder',
        targetFolderId: null,
        targetIndex: opts.targetIndex
      })
      await loadSessions()
      return
    }

    await window.api.sessions.reorder({
      dragId: drag.id,
      dragType: 'session',
      targetFolderId: opts.targetFolderId,
      targetIndex: opts.targetIndex
    })
    await loadSessions()
  }

  const allowDrop = (
    e: React.DragEvent,
    key: string,
    accept?: 'session' | 'folder'
  ): void => {
    if (accept && activeDrag && activeDrag.type !== accept) return
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
      onMouseDown={(e) =>
        onTreeItemMouseDown(e, `session:${session.id}`, () => tryConnect(session))
      }
      onMouseUp={flushPendingDouble}
      onDragStart={(e) => onDragStart(e, 'session', session.id)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => allowDrop(e, `s:${session.id}`, 'session')}
      onDrop={(e) =>
        void handleDrop(e, {
          targetFolderId: folderId,
          targetIndex: index,
          accept: 'session'
        })
      }
      onClick={() => setSelectedFolderId(folderId)}
      onDoubleClick={() => runTreeDoubleAction(() => tryConnect(session))}
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
          placeholder={t('sidebar.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
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
                onMouseDown={(e) =>
                  onTreeItemMouseDown(e, `folder:${folder.id}`, () => toggleFolder(folder))
                }
                onMouseUp={flushPendingDouble}
                onDragStart={(e) => onDragStart(e, 'folder', folder.id)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => {
                  // Folder drag → reorder before this folder; session → move into folder
                  if (activeDrag?.type === 'folder') allowDrop(e, folderDropKey, 'folder')
                  else allowDrop(e, folderDropKey, 'session')
                }}
                onDrop={(e) => {
                  if (activeDrag?.type === 'folder' || parseDrag(e)?.type === 'folder') {
                    void handleDrop(e, {
                      targetFolderId: null,
                      targetIndex: fi,
                      accept: 'folder'
                    })
                  } else {
                    void handleDrop(e, {
                      targetFolderId: folder.id,
                      targetIndex: kids.length,
                      accept: 'session'
                    })
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedFolderId(folder.id)
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  runTreeDoubleAction(() => toggleFolder(folder))
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
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFolder(folder)
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
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
                  onDragOver={(e) => allowDrop(e, `fc:${folder.id}`, 'session')}
                  onDrop={(e) =>
                    void handleDrop(e, {
                      targetFolderId: folder.id,
                      targetIndex: kids.length,
                      accept: 'session'
                    })
                  }
                >
                  {kids.map((s, i) => renderSession(s, folder.id, i))}
                </div>
              )}
              <div
                className="folder-drop-line"
                onDragOver={(e) => allowDrop(e, `fl:${folder.id}`, 'folder')}
                onDrop={(e) =>
                  void handleDrop(e, {
                    targetFolderId: null,
                    targetIndex: fi + 1,
                    accept: 'folder'
                  })
                }
              />
            </div>
          )
        })}

        <div
          className={`tree-root-sessions ${!selectedFolderId ? 'root-selected' : ''} ${dragOverKey === 'root' ? 'drag-over' : ''}`}
          onDragOver={(e) => allowDrop(e, 'root', 'session')}
          onDrop={(e) =>
            void handleDrop(e, {
              targetFolderId: null,
              targetIndex: rootSessions.length,
              accept: 'session'
            })
          }
          onClick={() => setSelectedFolderId(null)}
        >
          {rootSessions.map((s, i) => renderSession(s, null, i))}
        </div>

        {filteredSessions.length === 0 && folders.length === 0 && (
          <div className="empty">{t('sidebar.emptySessions')}</div>
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
          title={t('session.newFolder')}
          label={t('session.folderName')}
          defaultValue={t('session.newFolder')}
          confirmLabel={t('common.create')}
          onCancel={() => setPrompt(null)}
          onSubmit={(name) => {
            setPrompt(null)
            void window.api.sessions.createFolder(name).then(loadSessions)
          }}
        />
      )}

      {prompt?.kind === 'rename-folder' && (
        <PromptDialog
          title={t('common.rename')}
          label={t('session.folderName')}
          defaultValue={prompt.folder.name}
          confirmLabel={t('common.rename')}
          onCancel={() => setPrompt(null)}
          onSubmit={(name) => {
            const id = prompt.folder.id
            setPrompt(null)
            void window.api.sessions.renameFolder(id, name).then(loadSessions)
          }}
        />
      )}

      {editing && (
        <SessionEditModal
          initial={editing === 'new' ? null : editing}
          defaultFolderId={defaultFolderId}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void loadSessions()
          }}
        />
      )}

      {exportOpen && (
        <ExportSessionsDialog
          onClose={() => setExportOpen(false)}
          onDone={(path) => {
            setExportOpen(false)
            window.alert(t('session.exportedTo', { path }))
          }}
        />
      )}

      {importOpen && (
        <ImportSessionsDialog
          onClose={() => setImportOpen(false)}
          onDone={(stats) => {
            setImportOpen(false)
            void loadSessions()
            window.alert(
              t('session.replaced', { sessions: stats.sessions, folders: stats.folders })
            )
          }}
        />
      )}
    </div>
  )
}
