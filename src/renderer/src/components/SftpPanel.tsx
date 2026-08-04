import { useCallback, useEffect, useState } from 'react'
import type { SftpEntry, TransferProgress } from '../../../shared/types'
import { useAppStore } from '../stores/appStore'

interface Props {
  activeSessionId: string
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function SftpPanel({ activeSessionId }: Props): React.JSX.Element {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const transfers = useAppStore((s) => s.transfers)
  const updateTransfer = useAppStore((s) => s.updateTransfer)

  const refresh = useCallback(async (p = path) => {
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
  }, [activeSessionId, path])

  useEffect(() => {
    void refresh('/')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId])

  useEffect(() => {
    return window.api.sftp.onProgress((p: TransferProgress) => {
      if (p.activeSessionId === activeSessionId) updateTransfer(p)
      if (p.done && !p.error && p.direction === 'upload') void refresh()
    })
  }, [activeSessionId, updateTransfer, refresh])

  const goUp = (): void => {
    if (path === '/') return
    const parts = path.replace(/\/$/, '').split('/')
    parts.pop()
    const parent = parts.join('/') || '/'
    void refresh(parent)
  }

  const openEntry = (entry: SftpEntry): void => {
    if (entry.type === 'directory') void refresh(entry.path)
    else setSelected(entry.path)
  }

  const download = async (entry: SftpEntry): Promise<void> => {
    try {
      await window.api.sftp.download(activeSessionId, entry.path)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const upload = async (): Promise<void> => {
    try {
      const files = await window.api.sftp.pickLocalFiles()
      for (const local of files) {
        const name = local.replace(/\\/g, '/').split('/').pop()!
        const remote = path === '/' ? `/${name}` : `${path.replace(/\/$/, '')}/${name}`
        await window.api.sftp.upload(activeSessionId, local, remote)
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    const files = [...e.dataTransfer.files]
    try {
      for (const file of files) {
        const local = window.api.path.getPathForFile(file)
        if (!local) continue
        const remote = path === '/' ? `/${file.name}` : `${path.replace(/\/$/, '')}/${file.name}`
        await window.api.sftp.upload(activeSessionId, local, remote)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const mkdir = async (): Promise<void> => {
    const name = prompt('Folder name')
    if (!name) return
    const remote = path === '/' ? `/${name}` : `${path.replace(/\/$/, '')}/${name}`
    try {
      await window.api.sftp.mkdir(activeSessionId, remote)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const rename = async (entry: SftpEntry): Promise<void> => {
    const name = prompt('New name', entry.name)
    if (!name || name === entry.name) return
    const parent = path === '/' ? '' : path.replace(/\/$/, '')
    const to = `${parent}/${name}`.replace(/\/+/g, '/')
    try {
      await window.api.sftp.rename(activeSessionId, entry.path, to)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const remove = async (entry: SftpEntry): Promise<void> => {
    if (!confirm(`Delete ${entry.name}?`)) return
    try {
      await window.api.sftp.remove(activeSessionId, entry.path, entry.type === 'directory')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const chmod = async (entry: SftpEntry): Promise<void> => {
    const mode = prompt('chmod mode (octal)', '755')
    if (!mode) return
    try {
      await window.api.sftp.chmod(activeSessionId, entry.path, mode)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const sessionTransfers = transfers.filter((t) => t.activeSessionId === activeSessionId)

  return (
    <div
      className="sftp-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="sftp-toolbar">
        <button className="btn ghost sm" onClick={goUp} disabled={path === '/'}>
          ↑ Up
        </button>
        <button className="btn ghost sm" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
        <button className="btn ghost sm" onClick={() => void mkdir()}>
          New folder
        </button>
        <button className="btn primary sm" onClick={() => void upload()}>
          Upload
        </button>
        <input className="path-input" value={path} readOnly title={path} />
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="sftp-table-wrap">
        <table className="sftp-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Modified</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={entry.path}
                className={selected === entry.path ? 'selected' : ''}
                onDoubleClick={() => openEntry(entry)}
                onClick={() => setSelected(entry.path)}
              >
                <td>
                  <span className="file-icon">{entry.type === 'directory' ? '📁' : '📄'}</span>
                  {entry.name}
                </td>
                <td>{entry.type === 'directory' ? '—' : formatSize(entry.size)}</td>
                <td>
                  {entry.modifyTime
                    ? new Date(entry.modifyTime).toLocaleString()
                    : '—'}
                </td>
                <td className="actions">
                  {entry.type !== 'directory' && (
                    <button className="btn ghost sm" onClick={() => void download(entry)}>
                      Download
                    </button>
                  )}
                  <button className="btn ghost sm" onClick={() => void rename(entry)}>
                    Rename
                  </button>
                  <button className="btn ghost sm" onClick={() => void chmod(entry)}>
                    chmod
                  </button>
                  <button className="btn ghost sm danger" onClick={() => void remove(entry)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  Empty directory — drop files here to upload
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sessionTransfers.length > 0 && (
        <div className="transfer-bar">
          {sessionTransfers.map((t) => {
            const pct = t.total ? Math.round((t.transferred / t.total) * 100) : t.done ? 100 : 0
            return (
              <div key={t.transferId} className="transfer-item">
                <span>
                  {t.direction === 'upload' ? '↑' : '↓'} {t.filename}
                  {t.error ? ` — ${t.error}` : ` — ${pct}%`}
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
  )
}
