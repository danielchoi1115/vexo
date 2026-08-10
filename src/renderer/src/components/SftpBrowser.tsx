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

function formatPermissions(mode?: number, type?: SftpEntry['type']): string {
  if (mode == null) return '—'
  const kind =
    type === 'directory' ? 'd' : type === 'symlink' ? 'l' : type === 'other' ? '?' : '-'
  const rwx = (n: number): string =>
    `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`
  const p = mode & 0o777
  return `${kind}${rwx((p >> 6) & 7)}${rwx((p >> 3) & 7)}${rwx(p & 7)} (${modeString(mode)})`
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

/** Moba-style: values only, spaced in one line */
function entryTooltip(entry: SftpEntry): string {
  const modified = entry.modifyTime
    ? new Date(entry.modifyTime).toLocaleString()
    : '—'
  return [
    entry.name,
    formatSize(entry.size),
    modified,
    String(entry.owner ?? '—'),
    String(entry.group ?? '—'),
    formatPermissions(entry.mode, entry.type)
  ].join('   ')
}

function rangePaths(entries: SftpEntry[], a: string, b: string): string[] {
  const i = entries.findIndex((e) => e.path === a)
  const j = entries.findIndex((e) => e.path === b)
  if (i < 0 || j < 0) return [b]
  const lo = Math.min(i, j)
  const hi = Math.max(i, j)
  return entries.slice(lo, hi + 1).map((e) => e.path)
}

export function SftpBrowser({ activeSessionId }: Props): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const [path, setPath] = useState('/')
  const [pathInput, setPathInput] = useState('/')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Multi-select paths (never includes "..") */
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  /** Anchor for Shift+click range */
  const [anchorPath, setAnchorPath] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: SftpEntry } | null>(null)
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
  const skipFollowRef = useRef(false)
  const followTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const followGenRef = useRef(0)
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const anchorRef = useRef(anchorPath)
  anchorRef.current = anchorPath

  /** Drag-paint multi-select across rows */
  const paintRef = useRef<{
    startIndex: number
    /** Selection before this paint gesture (Ctrl+drag additive) */
    base: Set<string>
  } | null>(null)
  /** True if pointer moved across rows — skip post-drag click resetting selection */
  const paintedRef = useRef(false)

  const clearSelection = useCallback((): void => {
    setSelected(new Set())
    setAnchorPath(null)
  }, [])

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
        setSelected(new Set())
        setAnchorPath(null)
        if (quiet) setError(null)
      } catch (e) {
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

  useEffect(() => {
    if (!activeSessionId) {
      setEntries([])
      setPath('/')
      setPathInput('/')
      clearSelection()
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
      if (activeSessionId !== p.activeSessionId || !p.done) return

      const cancelled = p.error === 'Cancelled'
      if (p.error && !cancelled) setError(p.error)
      if (p.direction === 'upload') void refresh(path)
    })
  }, [activeSessionId, path, refresh, updateTransfer])

  // End drag-paint on mouseup anywhere
  useEffect(() => {
    const end = (): void => {
      paintRef.current = null
    }
    window.addEventListener('mouseup', end)
    return () => window.removeEventListener('mouseup', end)
  }, [])

  const openEntry = (entry: SftpEntry): void => {
    if (entry.type === 'directory' || entry.type === 'symlink') navigateUser(entry.path)
  }

  const goUp = (): void => {
    navigateUser(parentPath(path))
  }

  const downloadMany = async (list: SftpEntry[], toDesktop = false): Promise<void> => {
    if (!activeSessionId) return
    const files = list.filter((e) => e.type !== 'directory')
    if (files.length === 0) return
    try {
      // One prompt (or desktop), one transfer job with 1/N…N/N progress
      await window.api.sftp.downloadBatch(
        activeSessionId,
        files.map((f) => f.path),
        toDesktop ? 'desktop' : 'ask'
      )
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

  const removeMany = async (list: SftpEntry[]): Promise<void> => {
    if (!activeSessionId || list.length === 0) return
    const ok =
      list.length === 1
        ? window.confirm(t('sftp.deleteConfirm', { name: list[0]!.name }))
        : window.confirm(t('sftp.deleteConfirmMany', { count: list.length }))
    if (!ok) return
    try {
      for (const entry of list) {
        await window.api.sftp.remove(
          activeSessionId,
          entry.path,
          entry.type === 'directory'
        )
      }
      await refresh(path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await refresh(path)
    }
  }

  const selectedEntries = (): SftpEntry[] =>
    entries.filter((e) => selected.has(e.path))

  /** Delete key — all selected */
  const onListKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Delete') return
    const el = e.target as HTMLElement | null
    if (el?.closest('input, textarea, [contenteditable="true"]')) return
    if (prompt || menu) return
    const list = selectedEntries()
    if (list.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    void removeMany(list)
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
      if (isCancelled(err)) return
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const focusList = (el: HTMLElement): void => {
    const list = el.closest('.sftp-list')
    if (list instanceof HTMLElement) list.focus()
  }

  const applyRange = (fromPath: string, toPath: string, base?: Set<string>): void => {
    const paths = rangePaths(entriesRef.current, fromPath, toPath)
    if (base) {
      const next = new Set(base)
      for (const p of paths) next.add(p)
      setSelected(next)
    } else {
      setSelected(new Set(paths))
    }
  }

  const onEntryMouseDown = (e: React.MouseEvent, entry: SftpEntry, index: number): void => {
    if (e.button !== 0) return
    // Shift / Ctrl handled on click; plain drag paints a range
    if (e.shiftKey || e.ctrlKey || e.metaKey) return

    e.preventDefault()
    focusList(e.currentTarget as HTMLElement)
    paintedRef.current = false
    paintRef.current = { startIndex: index, base: new Set() }
    setSelected(new Set([entry.path]))
    setAnchorPath(entry.path)
  }

  const onEntryMouseEnter = (entry: SftpEntry, index: number): void => {
    const paint = paintRef.current
    if (!paint) return
    const list = entriesRef.current
    const startPath = list[paint.startIndex]?.path
    if (!startPath) return
    if (index !== paint.startIndex) paintedRef.current = true
    applyRange(startPath, entry.path, paint.base.size ? paint.base : undefined)
    setAnchorPath(startPath)
  }

  const onEntryClick = (e: React.MouseEvent, entry: SftpEntry): void => {
    focusList(e.currentTarget as HTMLElement)

    // Shift+click range
    if (e.shiftKey) {
      e.preventDefault()
      paintedRef.current = false
      const anchor = anchorRef.current ?? entry.path
      applyRange(anchor, entry.path)
      return
    }

    // Ctrl/Cmd+click toggle
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      paintedRef.current = false
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
      setAnchorPath(entry.path)
      return
    }

    // After drag-paint, the mouseup→click would collapse selection — keep range
    if (paintedRef.current) {
      paintedRef.current = false
      return
    }

    setSelected(new Set([entry.path]))
    setAnchorPath(entry.path)
  }

  const onEntryContextMenu = (e: React.MouseEvent, entry: SftpEntry): void => {
    e.preventDefault()
    focusList(e.currentTarget as HTMLElement)
    // Right-click outside current multi-selection → single-select that item
    if (!selectedRef.current.has(entry.path)) {
      setSelected(new Set([entry.path]))
      setAnchorPath(entry.path)
    }
    setMenu({ x: e.clientX, y: e.clientY, entry })
  }

  /**
   * Download / Delete use multi-selection when the context target is part of it.
   * Other actions always use the right-clicked entry only.
   */
  const menuItems = (entry: SftpEntry): MenuItem[] => {
    const multi =
      selected.has(entry.path) && selected.size > 1
        ? entries.filter((x) => selected.has(x.path))
        : [entry]
    const multiFiles = multi.filter((x) => x.type !== 'directory')
    const canMultiDownload = multiFiles.length > 0

    return [
      {
        label: t('sftp.open'),
        onClick: () => openEntry(entry),
        disabled: entry.type !== 'directory' && entry.type !== 'symlink'
      },
      {
        label: t('sftp.download'),
        onClick: () => void downloadMany(multi, false),
        disabled: !canMultiDownload
      },
      {
        label: t('sftp.downloadDesktop'),
        onClick: () => void downloadMany(multi, true),
        disabled: !canMultiDownload
      },
      {
        label: t('sftp.delete'),
        onClick: () => void removeMany(multi),
        danger: true
      },
      {
        label: t('sftp.rename'),
        onClick: () => setPrompt({ kind: 'rename', entry })
      },
      {
        label: t('sftp.copyPath'),
        onClick: () => void window.api.clipboard.writeText(entry.path)
      },
      { separator: true, label: '', onClick: () => {} },
      {
        label: t('sftp.properties'),
        onClick: () => properties(entry)
      },
      {
        label: t('sftp.permissions'),
        onClick: () => setPrompt({ kind: 'chmod', entry })
      }
    ]
  }

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
            if (!pathInput.trim()) setPathInput(path)
          }}
        />
      </div>

      <div
        className="sftp-list"
        tabIndex={0}
        onKeyDown={onListKeyDown}
        onMouseDown={(e) => {
          // Click empty list area → clear selection
          if (e.target === e.currentTarget) {
            clearSelection()
            e.currentTarget.focus()
          }
        }}
      >
        {path !== '/' && (
          <div
            className="sftp-row"
            onDoubleClick={goUp}
            onClick={(e) => {
              clearSelection()
              focusList(e.currentTarget)
            }}
          >
            <span className="file-icon">📁</span>
            <span className="file-name">..</span>
          </div>
        )}
        {entries.map((entry, index) => (
          <div
            key={entry.path}
            className={`sftp-row ${selected.has(entry.path) ? 'selected' : ''}`}
            title={entryTooltip(entry)}
            onMouseDown={(e) => onEntryMouseDown(e, entry, index)}
            onMouseEnter={() => onEntryMouseEnter(entry, index)}
            onClick={(e) => onEntryClick(e, entry)}
            onDoubleClick={() => openEntry(entry)}
            onContextMenu={(e) => onEntryContextMenu(e, entry)}
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
              const batch =
                tr.batchTotal && tr.batchTotal > 1 && tr.batchIndex
                  ? `${tr.batchIndex}/${tr.batchTotal}`
                  : null
              return (
                <div key={tr.transferId} className="transfer-item">
                  <span className="transfer-label">
                    {tr.direction === 'upload' ? '↑' : '↓'} {tr.filename}
                    {batch ? ` · ${batch}` : ''}
                    {tr.error
                      ? ` — ${tr.error}`
                      : tr.done
                        ? ' — done'
                        : ` — ${pct}%`}
                  </span>
                  <div className="progress">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  {!tr.done && (
                    <button
                      type="button"
                      className="btn transfer-cancel"
                      title={t('sftp.cancelTransfer')}
                      onClick={() => void window.api.sftp.cancel(tr.transferId)}
                    >
                      {t('sftp.cancelTransfer')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {menu && (
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
