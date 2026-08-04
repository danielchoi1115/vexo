import { useEffect } from 'react'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { SplitLayout } from './workspace/SplitLayout'

export function Workspace(): React.JSX.Element {
  const t = useSettingsStore((s) => s.t)
  const activeSessions = useAppStore((s) => s.activeSessions)
  const focusedActiveId = useAppStore((s) => s.focusedActiveId)
  const sessions = useAppStore((s) => s.sessions)
  const layout = useAppStore((s) => s.layout)

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

  if (activeSessions.length === 0 || !layout) {
    return (
      <div className="workspace empty-workspace">
        <div className="welcome">
          <h2>{t('app.welcomeTitle')}</h2>
          <p>{t('app.welcomeBody')}</p>
          <p className="muted">{t('app.welcomeHint')}</p>
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
