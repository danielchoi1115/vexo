import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { useSettingsStore } from '../stores/settingsStore'
import type { ITheme } from '@xterm/xterm'

interface Props {
  activeSessionId: string
  active: boolean
}

function toXtermTheme(t: {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
}): ITheme {
  return {
    background: t.background,
    foreground: t.foreground,
    cursor: t.cursor,
    selectionBackground: t.selectionBackground,
    black: t.black,
    red: t.red,
    green: t.green,
    yellow: t.yellow,
    blue: t.blue,
    magenta: t.magenta,
    cyan: t.cyan,
    white: t.white,
    brightBlack: t.brightBlack,
    brightRed: t.brightRed,
    brightGreen: t.brightGreen,
    brightYellow: t.brightYellow,
    brightBlue: t.brightBlue,
    brightMagenta: t.brightMagenta,
    brightCyan: t.brightCyan,
    brightWhite: t.brightWhite
  }
}

export function TerminalView({ activeSessionId, active }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const pendingRef = useRef<string[]>([])
  const activeRef = useRef(active)

  const fontFamily = useSettingsStore((s) => s.fontFamily)
  const fontSize = useSettingsStore((s) => s.fontSize)
  const theme = useSettingsStore((s) => s.theme)
  const pasteOnRightClick = useSettingsStore((s) => s.pasteOnRightClick)
  const updateSettings = useSettingsStore((s) => s.update)

  useEffect(() => {
    activeRef.current = active
    if (active && termRef.current) {
      for (const chunk of pendingRef.current) termRef.current.write(chunk)
      pendingRef.current = []
      fitRef.current?.fit()
      termRef.current.focus()
    }
  }, [active])

  // Apply live settings
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = fontFamily
    term.options.fontSize = fontSize
    term.options.theme = toXtermTheme(theme)
    fitRef.current?.fit()
    void window.api.ssh.resize(activeSessionId, term.cols, term.rows)
  }, [fontFamily, fontSize, theme, activeSessionId])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily,
      fontSize,
      scrollback: 8000,
      theme: toXtermTheme(theme),
      allowProposedApi: true,
      rightClickSelectsWord: !pasteOnRightClick
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.open(el)

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      /* canvas fallback */
    }

    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const unsubData = window.api.ssh.onData((id, b64) => {
      if (id !== activeSessionId) return
      const text = atob(b64)
      const bytes = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)

      if (!activeRef.current) {
        pendingRef.current.push(decoded)
        if (pendingRef.current.length > 200) {
          pendingRef.current = pendingRef.current.slice(-100)
        }
        return
      }
      term.write(decoded)
    })

    const dataDisp = term.onData((data) => {
      void window.api.ssh.write(activeSessionId, data)
    })

    const resize = (): void => {
      fit.fit()
      void window.api.ssh.resize(activeSessionId, term.cols, term.rows)
    }
    resize()

    const ro = new ResizeObserver(() => {
      if (activeRef.current) resize()
    })
    ro.observe(el)

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? -1 : 1
      const next = Math.min(28, Math.max(10, (useSettingsStore.getState().fontSize || 14) + delta))
      void updateSettings({ fontSize: next })
    }
    el.addEventListener('wheel', onWheel, { passive: false })

    const onContext = (e: MouseEvent): void => {
      if (!useSettingsStore.getState().pasteOnRightClick) return
      e.preventDefault()
      void navigator.clipboard.readText().then((text) => {
        if (text) void window.api.ssh.write(activeSessionId, text)
      })
    }
    el.addEventListener('contextmenu', onContext)

    return () => {
      unsubData()
      dataDisp.dispose()
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', onContext)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId])

  return <div className="terminal-host" ref={containerRef} data-active={active} />
}
