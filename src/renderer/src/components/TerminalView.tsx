import { useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useSettingsStore } from '../stores/settingsStore'
import {
  applyTerminalSettings,
  attachTerminal,
  parkTerminal,
  setTerminalFocused
} from '../terminal/terminalCache'

interface Props {
  activeSessionId: string
  /** Whether this terminal has keyboard focus (visible + focused pane) */
  active: boolean
}

/**
 * Thin React host for a cached xterm instance.
 * Split/layout remounts only re-attach the same terminal — scrollback stays.
 */
export function TerminalView({ activeSessionId, active }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const fontFamily = useSettingsStore((s) => s.terminalFontFamily)
  const fontSize = useSettingsStore((s) => s.terminalFontSize)
  const themeId = useSettingsStore((s) => s.colorScheme)
  const mountedId = useRef<string | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    mountedId.current = activeSessionId
    attachTerminal(activeSessionId, el, active)

    return () => {
      // Only park if this effect still owns the session (avoid racing remounts)
      if (mountedId.current === activeSessionId) {
        parkTerminal(activeSessionId)
        mountedId.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-attach only when session changes
  }, [activeSessionId])

  useEffect(() => {
    setTerminalFocused(activeSessionId, active)
  }, [active, activeSessionId])

  useEffect(() => {
    applyTerminalSettings(activeSessionId)
  }, [fontFamily, fontSize, themeId, activeSessionId])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      applyTerminalSettings(activeSessionId)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeSessionId])

  return <div className="terminal-host-slot" ref={containerRef} data-active={active} />
}
