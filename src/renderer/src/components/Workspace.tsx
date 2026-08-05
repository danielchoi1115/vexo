import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SESSION_CONFIG_MIME } from '../layout/dnd'
import type { DropZone } from '../layout/types'
import { SplitLayout } from './workspace/SplitLayout'
import { DropOverlay } from './workspace/DropOverlay'

export function Workspace(): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const activeSessions = useAppStore((s) => s.activeSessions)
  const focusedActiveId = useAppStore((s) => s.focusedActiveId)
  const sessions = useAppStore((s) => s.sessions)
  const layout = useAppStore((s) => s.layout)
  const connectSession = useAppStore((s) => s.connectSession)

  const emptyRef = useRef<HTMLDivElement>(null)
  const [emptyDropZone, setEmptyDropZone] = useState<DropZone | null>(null)

  // Window title: Vexo | name (host)
  useEffect(() => {
    if (!focusedActiveId || activeSessions.length === 0) {
      void window.api.window.setTitle('Vexo')
      document.title = 'Vexo'
      return
    }
    const active = activeSessions.find((a) => a.id === focusedActiveId)
    if (!active) {
      void window.api.window.setTitle('Vexo')
      document.title = 'Vexo'
      return
    }
    const cfg = sessions.find((s) => s.id === active.sessionConfigId)
    const host = cfg?.host ?? ''
    const title = host ? `${active.name} (${host})` : active.name
    void window.api.window.setTitle(title)
    document.title = title
  }, [focusedActiveId, activeSessions, sessions])

  if (activeSessions.length === 0) {
    return (
      <div
        className="workspace empty-workspace"
        ref={emptyRef}
        onDragOver={(e) => {
          const types = [...e.dataTransfer.types]
          if (!types.includes(SESSION_CONFIG_MIME)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (emptyRef.current) {
            // Empty workspace: always open as single pane (center)
            setEmptyDropZone('center')
          }
        }}
        onDragLeave={(e) => {
          if (!emptyRef.current?.contains(e.relatedTarget as Node)) {
            setEmptyDropZone(null)
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          setEmptyDropZone(null)
          const configId = e.dataTransfer.getData(SESSION_CONFIG_MIME)
          if (configId) void connectSession(configId, { zone: 'center' })
        }}
      >
        <DropOverlay zone={emptyDropZone} />
        <div className="welcome">
          <h2>{t('app.welcomeTitle')}</h2>
          <p>{t('app.welcomeBody')}</p>
          <p className="muted">{t('app.welcomeHint')}</p>
          <p className="muted drop-hint-text">
            Drag a session from the left to open it here
          </p>
        </div>
      </div>
    )
  }

  if (!layout) {
    return (
      <div className="workspace empty-workspace">
        <div className="welcome">
          <p className="muted">Preparing terminal…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="workspace split-workspace">
      <SplitLayout node={layout} sessions={activeSessions} />
    </div>
  )
}
