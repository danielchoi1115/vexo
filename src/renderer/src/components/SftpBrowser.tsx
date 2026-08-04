import { useCallback, useEffect, useState } from 'react'
import type { SftpEntry, TransferProgress } from '../../../shared/types'
import { useAppStore } from '../stores/appStore'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { PromptDialog } from './PromptDialog'

interface Props {
  activeSessionId: string | null
}

function parentPath(path: string): string {
  if (path === '/' || !path) return '/'
  const parts = path.replace(/\/$/, '').split('/')
  parts.pop()
  return parts.join('/') || '/'
}

function modeString(mode?: number): string {
  if (mode == null) return '—'
  const perm = mode & 0o777
  return perm.toString(8).padStart(3, '0')
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function SftpBrowser({ activeSessionId }: Props): React.JSX.Element {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: SftpEntry | null } | null>(null)
  const [droppedHere, setDroppedHere] = useState(false)
  const [prompt, setPrompt] = useState<
    | { kind: 'rename'; entry: SftpEntry }
    | { kind: 'chmod'; entry: SftpEntry }
    | null
  >(null)

  const follow = useAppStore((s) => s.followTerminalFolder)
  const setFollow = useAppStore((s) => s.setFollowTerminalFolder)
  const remoteCwd = useAppStore((s) => s.remoteCwd)
  const transfers = useAppStore((s) => s.transfers)
  const updateTransfer = useAppStore((s) => s.updateTransfer)

  const refresh = useCallback(
    async (p: string) => {
      if (!activeSessionId) return
      setLoading(true)
      setError(null)
      try {
        const list = await window.api.sftp.list(activeSessionId, p)
        setEntries(list)
        setPath(p)
        setSelected(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [activeSessionId]
  )

  useEffect(() => {
    if (!activeSessionId) {
      setEntries([])
      setPath('/')
      return
    }
    // Open at remote home directory
    void (async () => {
      try {
        const home = await window.api.sftp.home(activeSessionId)
        await refresh(home || '/')
      } catch {
        await refresh('/')
      }
    })()
  }, [activeSessionId, refresh])

  // Follow terminal folder
  useEffect(() => {
    if (!follow || !activeSessionId) return
    const cwd = remoteCwd[activeSessionId]
    if (cwd && cwd !== path) void refresh(cwd)
  }, [follow, activeSessionId, remoteCwd, path, refresh])

  useEffect(() => {
    return window.api.sftp.onProgress((p: TransferProgress) => {
      updateTransfer(p)
      if (p.done && !p.error && activeSessionId === p.activeSessionId && p.direction === 'upload') {
        void refresh(path)
      }
    })
  }, [activeSessionId, path, refresh, updateTransfer])

  const openEntry = (entry: SftpEntry): void => {
    if (entry.type === 'directory' || entry.type === 'symlink') void refresh(entry.path)
  }

  const goUp = (): void => {
    void refresh(parentPath(path))
  }

  const download = async (entry: SftpEntry, toDesktop = false): Promise<void> => {
    if (!activeSessionId) return
    try {
      if (toDesktop) await window.api.sftp.downloadToDesktop(activeSessionId, entry.path)
      else await window.api.sftp.download(activeSessionId, entry.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const doRename = async (entry: SftpEntry, name: string): Promise<void> => {
    if (!activeSessionId || !name || name === entry.name) return
    const to = `${parentPath(entry.path).replace(/\/$/, '')}/${name}`.replace(/\/+/g, '/')
    try {
      await window.api.sftp.rename(activeSessionId, entry.path, to)
      await refresh(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (entry: SftpEntry): Promise<void> => {
    if (!activeSessionId) return
    if (!window.confirm(`Delete ${entry.name}?`)) return
    try {
      await window.api.sftp.remove(activeSessionId, entry.path, entry.type === 'directory')
      await refresh(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const doChmod = async (entry: SftpEntry, mode: string): Promise<void> => {
    if (!activeSessionId || !mode) return
    try {
      await window.api.sftp.chmod(activeSessionId, entry.path, mode)
      await refresh(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const properties = (entry: SftpEntry): void => {
    window.alert(
      [
        `Name: ${entry.name}`,
        `Path: ${entry.path}`,
        `Type: ${entry.type}`,
        `Size: ${formatSize(entry.size)}`,
        `Modified: ${entry.modifyTime ? new Date(entry.modifyTime).toLocaleString() : '—'}`,
        `Permissions: ${modeString(entry.mode)}`,
        `Owner UID: ${entry.owner ?? '—'}`,
        `Group GID: ${entry.group ?? '—'}`
      ].join('\n')
    )
  }

  const onDropUpload = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDroppedHere(true)
    if (!activeSessionId) return
    const files = [...e.dataTransfer.files]
    try {
      for (const file of files) {
        const local = window.api.path.getPathForFile(file)
        if (!local) continue
        const remote = path === '/' ? `/${file.name}` : `${path.replace(/\/$/, '')}/${file.name}`
        await window.api.sftp.upload(activeSessionId, local, remote)
      }
      await refresh(path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onDragStartFile = (e: React.DragEvent, entry: SftpEntry): void => {
    if (entry.type === 'directory') {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('application/x-vexo-remote', entry.path)
    e.dataTransfer.setData('text/plain', entry.path)
    e.dataTransfer.effectAllowed = 'copy'
    setDroppedHere(false)
  }

  const onDragEndFile = (e: React.DragEvent, entry: SftpEntry): void => {
    // If not dropped onto our panel, download to desktop (drag-out)
    if (droppedHere) return
    if (entry.type === 'directory') return
    // dropEffect 'none' often means cancelled or external OS drop
    if (e.dataTransfer.dropEffect === 'none' || e.dataTransfer.dropEffect === 'copy') {
      void download(entry, true)
    }
  }

  const menuItems = (entry: SftpEntry): MenuItem[] => [
    {
      label: 'Open',
      onClick: () => openEntry(entry),
      disabled: entry.type !== 'directory' && entry.type !== 'symlink'
    },
    {
      label: 'Download',
      onClick: () => void download(entry, false),
      disabled: entry.type === 'directory'
    },
    {
      label: 'Download to Desktop',
      onClick: () => void download(entry, true),
      disabled: entry.type === 'directory'
    },
    { label: 'Delete', onClick: () => void remove(entry), danger: true },
    { label: 'Rename', onClick: () => setPrompt({ kind: 'rename', entry }) },
    {
      label: 'Copy file path',
      onClick: () => void window.api.clipboard.writeText(entry.path)
    },
    { separator: true, label: '', onClick: () => {} },
    { label: 'Properties', onClick: () => properties(entry) },
    { label: 'Permissions', onClick: () => setPrompt({ kind: 'chmod', entry }) }
  ]

  const sessionTransfers = activeSessionId
    ? transfers.filter((t) => t.activeSessionId === activeSessionId)
    : []

  if (!activeSessionId) {
    return (
      <div className="sftp-browser empty-sftp">
        <p className="muted">Connect a session to browse files.</p>
      </div>
    )
  }

  return (
    <div
      className="sftp-browser"
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        setDroppedHere(true)
        void onDropUpload(e)
      }}
    >
      <div className="sftp-path" title={path}>
        {path}
      </div>

      <div className="sftp-list">
        {path !== '/' && (
          <div
            className="sftp-row"
            onDoubleClick={goUp}
            onClick={() => setSelected('..')}
          >
            <span className="file-icon">📁</span>
            <span className="file-name">..</span>
          </div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.path}
            className={`sftp-row ${selected === entry.path ? 'selected' : ''}`}
            draggable={entry.type !== 'directory'}
            onDragStart={(e) => onDragStartFile(e, entry)}
            onDragEnd={(e) => onDragEndFile(e, entry)}
            onClick={() => setSelected(entry.path)}
            onDoubleClick={() => openEntry(entry)}
            onContextMenu={(e) => {
              e.preventDefault()
              setSelected(entry.path)
              setMenu({ x: e.clientX, y: e.clientY, entry })
            }}
          >
            <span className="file-icon">
              {entry.type === 'directory' ? '📁' : entry.type === 'symlink' ? '🔗' : '📄'}
            </span>
            <span className="file-name">{entry.name}</span>
          </div>
        ))}
        {!loading && entries.length === 0 && (
          <div className="empty muted">Empty — drop files to upload</div>
        )}
      </div>

      {error && <div className="banner error compact">{error}</div>}

      <div className="sftp-footer">
        <label className="check-row compact">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow terminal folder
        </label>

        {sessionTransfers.length > 0 && (
          <div className="transfer-bar">
            {sessionTransfers.map((t) => {
              const pct = t.total
                ? Math.round((t.transferred / t.total) * 100)
                : t.done
                  ? 100
                  : 0
              return (
                <div key={t.transferId} className="transfer-item">
                  <span>
                    {t.direction === 'upload' ? '↑' : '↓'} {t.filename}
                    {t.error ? ` — ${t.error}` : t.done ? ' — done' : ` — ${pct}%`}
                  </span>
                  <div className="progress">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {menu?.entry && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}

      {prompt?.kind === 'rename' && (
        <PromptDialog
          title="Rename"
          defaultValue={prompt.entry.name}
          confirmLabel="Rename"
          onCancel={() => setPrompt(null)}
          onSubmit={(name) => {
            const entry = prompt.entry
            setPrompt(null)
            void doRename(entry, name)
          }}
        />
      )}

      {prompt?.kind === 'chmod' && (
        <PromptDialog
          title="Permissions"
          label="Octal mode (e.g. 755)"
          defaultValue={modeString(prompt.entry.mode)}
          confirmLabel="Apply"
          onCancel={() => setPrompt(null)}
          onSubmit={(mode) => {
            const entry = prompt.entry
            setPrompt(null)
            void doChmod(entry, mode)
          }}
        />
      )}
    </div>
  )
}
