import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

interface Props {
  activeSessionId: string
  /** When false, skip paint (inactive tab optimization) */
  active: boolean
}

export function TerminalView({ activeSessionId, active }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const pendingRef = useRef<string[]>([])
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
    if (active && termRef.current) {
      // flush deferred writes when tab becomes active
      for (const chunk of pendingRef.current) {
        termRef.current.write(chunk)
      }
      pendingRef.current = []
      fitRef.current?.fit()
      termRef.current.focus()
    }
  }, [active])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, "Cascadia Code", "Courier New", monospace',
      fontSize: 14,
      scrollback: 8000,
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78'
      },
      allowProposedApi: true
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.open(el)

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
      })
      term.loadAddon(webgl)
    } catch {
      // WebGL unavailable — fall back to canvas/DOM renderer
    }

    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const unsubData = window.api.ssh.onData((id, b64) => {
      if (id !== activeSessionId) return
      const text = atob(b64)
      // decode binary-safe base64 → binary string → write
      const bytes = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)

      if (!activeRef.current) {
        pendingRef.current.push(decoded)
        // cap pending buffer roughly
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

    return () => {
      unsubData()
      dataDisp.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [activeSessionId])

  return <div className="terminal-host" ref={containerRef} data-active={active} />
}
