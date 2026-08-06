import { useCallback, useEffect, useRef, useState } from 'react'
import type { SftpEntry, TransferProgress } from '../../../shared/types'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
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

function isCancelled(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if (e.name === 'CancelledError') return true
  return /cancel/i.test(e.message)
}

export function SftpBrowser({ activeSessionId }: Props): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const [path, setPath] = useState('/')
  const [pathInput, setPathInput] = useState('/')
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

  const pathRef = useRef(path)
  pathRef.current = path
  const followRef = useRef(follow)
  followRef.current = follow
  /** Ignore follow-cwd updates until user navigates settles */
  const skipFollowRef = useRef(false)
  /** Debounce timer for shell-integration cwdChanged → list */
  const followTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followGenRef = useRef(0)

  const refresh = useCallback(
    async (p: string, opts?: { quiet?: boolean }) => {
      if (!activeSessionId) return
      const normalized = p.trim() || '/'
      const quiet = opts?.quiet === true
      if (!quiet) {
        setLoading(true)
        setError(null)
      }
      try {
        const list = await window.api.sftp.list(activeSessionId, normalized)
        setEntries(list)
        setPath(normalized)
        setPathInput(normalized)
        setSelected(null)
        if (quiet) setError(null)
      } catch (e) {
        // Follow-driven navigations: keep current listing; soft notice only
        if (quiet) {
          setPathInput(pathRef.current)
          const msg = e instanceof Error ? e.message : String(e)
          const soft =
            /no such file|ENOENT|permission denied|EACCES/i.test(msg)
              ? t('sftp.followPathUnavailable')
              : null
          if (soft) setError(soft)
          return
        }
        setError(e instanceof Error ? e.message : String(e))
        setPathInput(pathRef.current)
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [activeSessionId, t]
  )

  /** User navigated manually — turn off follow terminal folder */
  const navigateUser = useCallback(
    (p: string) => {
      skipFollowRef.current = true
      if (followTimerRef.current) {
        clearTimeout(followTimerRef.current)
        followTimerRef.current = null
      }
      if (followRef.current) setFollow(false)
      void refresh(p).finally(() => {
        skipFollowRef.current = false
      })
    },
    [setFollow, refresh]
  )

  const submitPath = (): void => {
    const next = pathInput.trim() || '/'
    if (next === pathRef.current) {
      void refresh(next)
      return
    }
    navigateUser(next)
  }

  // Load home only when the active session changes — not when refresh identity changes
  useEffect(() => {
    if (!activeSessionId) {
      setEntries([])
      setPath('/')
      setPathInput('/')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const home = await window.api.sftp.home(activeSessionId)
        if (cancelled) return
        await refresh(home || '/')
      } catch {
        if (!cancelled) await refresh('/')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on session switch
  }, [activeSessionId])

  /**
   * Shell-integration cwdChanged (ssh:cwd / remoteCwd): debounce 200ms,
   * only list when path actually differs. Missing/denied paths stay quiet.
   */
  useEffect(() => {
    if (!follow || !activeSessionId || skipFollowRef.current) return
    const cwd = remoteCwd[activeSessionId]
    if (!cwd || cwd === pathRef.current) return

    if (followTimerRef.current) clearTimeout(followTimerRef.current)
    const gen = ++followGenRef.current
    followTimerRef.current = setTimeout(() => {
      followTimerRef.current = null
      if (gen !== followGenRef.current) return
      if (!followRef.current || skipFollowRef.current) return
      if (cwd === pathRef.current) return
      void refresh(cwd, { quiet: true })
    }, 200)

    return () => {
      if (followTimerRef.current) {
        clearTimeout(followTimerRef.current)
        followTimerRef.current = null
      }
    }
  }, [follow, activeSessionId, remoteCwd, refresh])

  useEffect(() => {
    return window.api.sftp.onProgress((p: TransferProgress) => {
      updateTransfer(p)
      if (p.done && !p.error && activeSessionId === p.activeSessionId && p.direction === 'upload') {
        void refresh(path)
      }
    })
  }, [activeSessionId, path, refresh, updateTransfer])

  const openEntry = (entry: SftpEntry): void => {
    if (entry.type === 'directory' || entry.type === 'symlink') navigateUser(entry.path)
  }

  const goUp = (): void => {
    navigateUser(parentPath(path))
  }

  const download = async (entry: SftpEntry, toDesktop = false): Promise<void> => {
    if (!activeSessionId) return
    try {
      if (toDesktop) await window.api.sftp.downloadToDesktop(activeSessionId, entry.path)
      else await window.api.sftp.download(activeSessionId, entry.path)
    } catch (e) {
      if (isCancelled(e)) return
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
    if (!window.confirm(t('sftp.deleteConfirm', { name: entry.name }))) return
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
    if (droppedHere) return
    if (entry.type === 'directory') return
    if (e.dataTransfer.dropEffect === 'none' || e.dataTransfer.dropEffect === 'copy') {
      void download(entry, true)
    }
  }

  const menuItems = (entry: SftpEntry): MenuItem[] => [
    {
      label: t('sftp.open'),
      onClick: () => openEntry(entry),
      disabled: entry.type !== 'directory' && entry.type !== 'symlink'
    },
    {
      label: t('sftp.download'),
      onClick: () => void download(entry, false),
      disabled: entry.type === 'directory'
    },
    {
      label: t('sftp.downloadDesktop'),
      onClick: () => void download(entry, true),
      disabled: entry.type === 'directory'
    },
    { label: t('sftp.delete'), onClick: () => void remove(entry), danger: true },
    { label: t('sftp.rename'), onClick: () => setPrompt({ kind: 'rename', entry }) },
    {
      label: t('sftp.copyPath'),
      onClick: () => void window.api.clipboard.writeText(entry.path)
    },
    { separator: true, label: '', onClick: () => {} },
    { label: t('sftp.properties'), onClick: () => properties(entry) },
    { label: t('sftp.permissions'), onClick: () => setPrompt({ kind: 'chmod', entry }) }
  ]

  const sessionTransfers = activeSessionId
    ? transfers.filter((tr) => tr.activeSessionId === activeSessionId)
    : []

  if (!activeSessionId) {
    return (
      <div className="sftp-browser empty-sftp">
        <p className="muted">{t('sftp.connectToBrowse')}</p>
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
      <div className="sftp-toolbar">
        <button
          type="button"
          className="btn icon-btn sftp-refresh"
          title={t('sftp.refresh')}
          disabled={loading}
          onClick={() => void refresh(path)}
          aria-label={t('sftp.refresh')}
        >
          <span className="icon-btn-glyph" aria-hidden>
            ↻
          </span>
        </button>
      </div>
      <div className="sftp-path-row">
        <input
          className="sftp-path-input"
          value={pathInput}
          title={pathInput}
          spellCheck={false}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submitPath()
            }
            if (e.key === 'Escape') {
              setPathInput(path)
            }
          }}
          onBlur={() => {
            // Keep typed path until Enter; restore only if empty
            if (!pathInput.trim()) setPathInput(path)
          }}
        />
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
          <div className="empty muted">{t('sftp.empty')}</div>
        )}
      </div>

      {error && <div className="banner error compact">{error}</div>}

      <div className="sftp-footer">
        <label className="check-row compact" title={t('sftp.followFolderHint')}>
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => {
              const on = e.target.checked
              setFollow(on)
              // Turning on: immediately sync to last known shell/SFTP cwd
              if (on && activeSessionId) {
                const cwd = remoteCwd[activeSessionId]
                if (cwd) void refresh(cwd, { quiet: true })
              }
            }}
          />
          {t('sftp.followFolder')}
        </label>

        {sessionTransfers.length > 0 && (
          <div className="transfer-bar">
            {sessionTransfers.map((tr) => {
              const pct = tr.total
                ? Math.round((tr.transferred / tr.total) * 100)
                : tr.done
                  ? 100
                  : 0
              return (
                <div key={tr.transferId} className="transfer-item">
                  <span>
                    {tr.direction === 'upload' ? '↑' : '↓'} {tr.filename}
                    {tr.error ? ` — ${tr.error}` : tr.done ? ' — done' : ` — ${pct}%`}
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
          title={t('sftp.rename')}
          defaultValue={prompt.entry.name}
          confirmLabel={t('common.rename')}
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
          title={t('sftp.permissions')}
          label={t('sftp.chmodLabel')}
          defaultValue={modeString(prompt.entry.mode)}
          confirmLabel={t('common.apply')}
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
