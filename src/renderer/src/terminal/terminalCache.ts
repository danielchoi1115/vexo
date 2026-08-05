import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { useSettingsStore } from '../stores/settingsStore'
import type { TerminalTheme } from '../../../shared/themes'

export interface CachedTerminal {
  sessionId: string
  term: Terminal
  fit: FitAddon
  /** Detached wrapper moved between React hosts without disposing xterm */
  hostEl: HTMLDivElement
  /** Whether this terminal currently has focus (fit/focus only — data always writes) */
  focused: boolean
  dispose: () => void
}

const cache = new Map<string, CachedTerminal>()

/** Off-screen park so React unmount never destroys xterm DOM */
let park: HTMLDivElement | null = null
function getPark(): HTMLDivElement {
  if (!park) {
    park = document.createElement('div')
    park.id = 'vexo-terminal-park'
    park.setAttribute('aria-hidden', 'true')
    park.style.cssText =
      'position:fixed;left:-10000px;top:0;width:800px;height:480px;overflow:hidden;opacity:0;pointer-events:none;'
    document.body.appendChild(park)
  }
  return park
}

function toXtermTheme(t: TerminalTheme): ITheme {
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

function decodeB64(b64: string): string {
  const text = atob(b64)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function fitAndResize(entry: CachedTerminal): void {
  try {
    entry.fit.fit()
    void window.api.ssh.resize(entry.sessionId, entry.term.cols, entry.term.rows)
  } catch {
    /* not measurable yet */
  }
}

/**
 * Get or create a long-lived terminal for a session.
 * Survives React remounts (split layout) so scrollback is preserved.
 */
export function acquireTerminal(sessionId: string): CachedTerminal {
  const existing = cache.get(sessionId)
  if (existing) return existing

  const settings = useSettingsStore.getState()
  const hostEl = document.createElement('div')
  hostEl.className = 'terminal-host terminal-host-cached'
  hostEl.dataset.sessionId = sessionId
  hostEl.style.cssText = 'width:100%;height:100%;min-height:0;flex:1;'

  // Park first so open() has a real document parent (helps some renderers)
  getPark().appendChild(hostEl)

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: settings.terminalFontFamily,
    fontSize: settings.terminalFontSize,
    scrollback: 8000,
    theme: toXtermTheme(settings.theme),
    allowProposedApi: true,
    rightClickSelectsWord: !settings.pasteOnRightClick
  })

  const fit = new FitAddon()
  const search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.open(hostEl)

  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
  } catch {
    /* canvas fallback */
  }

  // Always write SSH data — never drop login prompts while React is mounting
  const unsubData = window.api.ssh.onData((id, b64) => {
    if (id !== sessionId) return
    const entry = cache.get(sessionId)
    if (!entry) return
    entry.term.write(decodeB64(b64))
  })

  const dataDisp = term.onData((data) => {
    void window.api.ssh.write(sessionId, data)
  })

  const selDisp = term.onSelectionChange(() => {
    if (!useSettingsStore.getState().copyOnSelect) return
    if (!term.hasSelection()) return
    const sel = term.getSelection()
    if (sel) void navigator.clipboard.writeText(sel)
  })

  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true
    const mod = ev.ctrlKey || ev.metaKey
    if (!mod) return true

    if (useSettingsStore.getState().copyOnSelect) {
      return true
    }

    if (ev.key === 'c' || ev.key === 'C') {
      if (term.hasSelection()) {
        const sel = term.getSelection()
        if (sel) {
          void navigator.clipboard.writeText(sel)
          term.clearSelection()
          return false
        }
      }
      return true
    }

    if (ev.key === 'v' || ev.key === 'V') {
      return false
    }

    return true
  })

  const onPaste = (e: ClipboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (useSettingsStore.getState().copyOnSelect) return
    const text = e.clipboardData?.getData('text/plain')
    if (text) void window.api.ssh.write(sessionId, text)
  }
  hostEl.addEventListener('paste', onPaste)

  const onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? -1 : 1
    const cur = useSettingsStore.getState().terminalFontSize || 14
    const next = Math.min(28, Math.max(10, cur + delta))
    void useSettingsStore.getState().update({ terminalFontSize: next })
  }
  hostEl.addEventListener('wheel', onWheel, { passive: false })

  const onContext = (e: MouseEvent): void => {
    if (!useSettingsStore.getState().pasteOnRightClick) return
    e.preventDefault()
    void navigator.clipboard.readText().then((text) => {
      if (text) void window.api.ssh.write(sessionId, text)
    })
  }
  hostEl.addEventListener('contextmenu', onContext)

  const dispose = (): void => {
    unsubData()
    dataDisp.dispose()
    selDisp.dispose()
    hostEl.removeEventListener('paste', onPaste)
    hostEl.removeEventListener('wheel', onWheel)
    hostEl.removeEventListener('contextmenu', onContext)
    term.dispose()
    hostEl.remove()
    cache.delete(sessionId)
  }

  const entry: CachedTerminal = {
    sessionId,
    term,
    fit,
    hostEl,
    focused: false,
    dispose
  }
  cache.set(sessionId, entry)
  return entry
}

/** Attach (or re-attach) terminal host into a React container */
export function attachTerminal(sessionId: string, container: HTMLElement, focused: boolean): void {
  const entry = acquireTerminal(sessionId)
  // Reset park styles when reattaching to visible UI
  entry.hostEl.style.position = ''
  entry.hostEl.style.left = ''
  entry.hostEl.style.top = ''
  entry.hostEl.style.width = '100%'
  entry.hostEl.style.height = '100%'
  entry.hostEl.style.opacity = ''
  entry.hostEl.style.pointerEvents = ''

  if (entry.hostEl.parentElement !== container) {
    container.appendChild(entry.hostEl)
  }
  entry.focused = focused
  // Double rAF: wait for layout after append
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      fitAndResize(entry)
      if (entry.focused) {
        try {
          entry.term.focus()
        } catch {
          /* ignore */
        }
      }
    })
  })
}

/** Park terminal off-screen without destroying it (React unmount / split) */
export function parkTerminal(sessionId: string): void {
  const entry = cache.get(sessionId)
  if (!entry) return
  entry.focused = false
  getPark().appendChild(entry.hostEl)
}

export function setTerminalFocused(sessionId: string, focused: boolean): void {
  const entry = cache.get(sessionId)
  if (!entry) return
  entry.focused = focused
  if (focused) {
    fitAndResize(entry)
    try {
      entry.term.focus()
    } catch {
      /* ignore */
    }
  }
}

export function applyTerminalSettings(sessionId: string): void {
  const entry = cache.get(sessionId)
  if (!entry) return
  const s = useSettingsStore.getState()
  entry.term.options.fontFamily = s.terminalFontFamily
  entry.term.options.fontSize = s.terminalFontSize
  entry.term.options.theme = toXtermTheme(s.theme)
  fitAndResize(entry)
}

export function disposeTerminal(sessionId: string): void {
  cache.get(sessionId)?.dispose()
}

export function disposeAllTerminals(): void {
  for (const id of [...cache.keys()]) disposeTerminal(id)
}
