import { useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useSettingsStore } from '../stores/settingsStore'
import {
  applyTerminalSettings,
  attachTerminal,
  setTerminalActive
} from '../terminal/terminalCache'

interface Props {
  activeSessionId: string
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

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    attachTerminal(activeSessionId, el, active)
    // On unmount: leave terminal in cache (still attached or orphaned under hostEl).
    // Detach from this container only if still parented here — keep hostEl alive.
    return () => {
      const host = el.querySelector('.terminal-host-cached') as HTMLElement | null
      // Keep node; optional detach so React can clear container
      if (host && host.parentElement === el) {
        // Move to document body off-screen park so xterm DOM is not destroyed
        host.style.position = 'fixed'
        host.style.left = '-10000px'
        host.style.top = '0'
        host.style.width = '800px'
        host.style.height = '400px'
        document.body.appendChild(host)
      }
    }
  }, [activeSessionId])

  useEffect(() => {
    setTerminalActive(activeSessionId, active)
  }, [active, activeSessionId])

  useEffect(() => {
    applyTerminalSettings(activeSessionId)
  }, [fontFamily, fontSize, themeId, activeSessionId])

  // ResizeObserver on React container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (active) applyTerminalSettings(activeSessionId)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeSessionId, active])

  return <div className="terminal-host-slot" ref={containerRef} data-active={active} />
}
