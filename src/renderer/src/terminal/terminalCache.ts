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
  hostEl: HTMLDivElement
  focused: boolean
  dispose: () => void
}

const cache = new Map<string, CachedTerminal>()
/** SSH data that arrived before the terminal instance existed */
const earlyBuffer = new Map<string, string[]>()

let park: HTMLDivElement | null = null
let globalDataHooked = false

/** Registered from App so we avoid circular imports with appStore */
export interface EndedSessionHooks {
  isEnded: (sessionId: string) => boolean
  onExit: (sessionId: string) => void
  onRestart: (sessionId: string) => void
}

let endedHooks: EndedSessionHooks | null = null

export function registerEndedSessionHooks(hooks: EndedSessionHooks): void {
  endedHooks = hooks
}

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

function decodeB64(b64: string): string {
  const text = atob(b64)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
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

/** Call once at app start so no SSH bytes are lost before TerminalView mounts */
export function initTerminalDataRouter(): void {
  if (globalDataHooked) return
  if (typeof window === 'undefined' || !window.api?.ssh?.onData) return
  globalDataHooked = true

  window.api.ssh.onData((id, b64) => {
    const text = decodeB64(b64)
    const entry = cache.get(id)
    if (entry) {
      entry.term.write(text)
      return
    }
    const buf = earlyBuffer.get(id) ?? []
    buf.push(text)
    // Cap early buffer (~keep last chunks)
    if (buf.length > 400) buf.splice(0, buf.length - 200)
    earlyBuffer.set(id, buf)
  })
}

/** Minimum viewport before we allow fit() — smaller sizes reflow-destroy long lines. */
const MIN_FIT_WIDTH = 80
const MIN_FIT_HEIGHT = 48
const MIN_FIT_COLS = 20

/**
 * Fit xterm to its container when the size is trustworthy.
 * Skipping tiny/hidden containers is critical: display:none or mid-split layouts
 * report ~0 width and fit() reflows buffer lines into a few columns, permanently
 * truncating prompts like "user@host's password:".
 */
function fitAndResize(entry: CachedTerminal): boolean {
  try {
    const host = entry.hostEl
    // Prefer the React container; fall back to host itself
    const box = host.parentElement ?? host
    const rect = box.getBoundingClientRect()
    const w = rect.width
    const h = rect.height

    // Hidden (display:none), parked off-flow with no size, or mid-layout collapse
    if (w < MIN_FIT_WIDTH || h < MIN_FIT_HEIGHT) {
      return false
    }
    // Also skip if host itself is not laid out (e.g. still display:none)
    if (host.offsetParent === null && getComputedStyle(host).position !== 'fixed') {
      // Park uses position:fixed — allow that path when dimensions are ok
      const park = host.closest('#vexo-terminal-park')
      if (!park) return false
    }

    const prevCols = entry.term.cols
    const prevRows = entry.term.rows
    entry.fit.fit()
    const cols = entry.term.cols
    const rows = entry.term.rows

    // Guard against pathological fit results
    if (cols < MIN_FIT_COLS) {
      if (prevCols >= MIN_FIT_COLS) {
        try {
          entry.term.resize(prevCols, Math.max(prevRows, 10))
        } catch {
          /* ignore */
        }
      }
      return false
    }

    // Skip no-op resizes: thrashing reflow eats scrollback lines (↑ history symptom)
    if (cols === prevCols && rows === prevRows) {
      return true
    }

    void window.api.ssh.resize(entry.sessionId, cols, rows)
    return true
  } catch {
    return false
  }
}

/** Debounced fit — layout thrash must not reflow on every key/frame. */
const fitTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleFitWhenReady(entry: CachedTerminal, attempts = 12): void {
  const existing = fitTimers.get(entry.sessionId)
  if (existing) clearTimeout(existing)

  const run = (left: number): void => {
    if (fitAndResize(entry)) {
      fitTimers.delete(entry.sessionId)
      return
    }
    if (left <= 0) {
      fitTimers.delete(entry.sessionId)
      return
    }
    const t = setTimeout(() => run(left - 1), 40)
    fitTimers.set(entry.sessionId, t)
  }

  // First try next frame, then debounced retries
  requestAnimationFrame(() => {
    if (fitAndResize(entry)) {
      fitTimers.delete(entry.sessionId)
      return
    }
    run(attempts)
  })
}

export function acquireTerminal(sessionId: string): CachedTerminal {
  initTerminalDataRouter()
  const existing = cache.get(sessionId)
  if (existing) return existing

  const settings = useSettingsStore.getState()
  const hostEl = document.createElement('div')
  hostEl.className = 'terminal-host terminal-host-cached'
  hostEl.dataset.sessionId = sessionId
  hostEl.style.cssText = 'width:100%;height:100%;min-height:0;flex:1;'
  getPark().appendChild(hostEl)

  const term = new Terminal({
    cursorBlink: settings.cursorBlink !== false,
    cursorStyle: settings.cursorStyle || 'block',
    fontFamily: settings.terminalFontFamily,
    fontSize: settings.terminalFontSize,
    scrollback: Math.min(100000, Math.max(100, settings.scrollback || 8000)),
    theme: toXtermTheme(settings.theme),
    allowProposedApi: true,
    rightClickSelectsWord: !settings.pasteOnRightClick
  })
  // Always wrap (DECAWM on) — no user toggle
  applyLineWrap(term, true)
  // xterm v6: no bellStyle option — handle via onBell
  term.onBell(() => {
    const style = useSettingsStore.getState().bellStyle
    if (style === 'none') return
    if (style === 'sound') {
      try {
        // short system beep via Web Audio (no asset required)
        const ctx = new AudioContext()
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.connect(g)
        g.connect(ctx.destination)
        o.frequency.value = 880
        g.gain.value = 0.05
        o.start()
        o.stop(ctx.currentTime + 0.08)
        void ctx.close()
      } catch {
        /* ignore */
      }
      return
    }
    // visual: flash host border briefly
    hostEl.classList.add('terminal-bell-flash')
    window.setTimeout(() => hostEl.classList.remove('terminal-bell-flash'), 120)
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

  // Flush anything that arrived before this terminal existed
  const early = earlyBuffer.get(sessionId)
  if (early?.length) {
    for (const chunk of early) term.write(chunk)
    earlyBuffer.delete(sessionId)
  }

  const dataDisp = term.onData((data) => {
    // After session ends: Enter closes tab, R restarts (see SshManager hints)
    if (endedHooks?.isEnded(sessionId)) {
      if (data === '\r' || data === '\n' || data === '\r\n') {
        endedHooks.onExit(sessionId)
        return
      }
      if (data === 'r' || data === 'R') {
        endedHooks.onRestart(sessionId)
        return
      }
      return
    }
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

    if (endedHooks?.isEnded(sessionId)) {
      // Let printable Enter/R flow through onData; block everything else
      if (ev.key === 'Enter' || ev.key === 'r' || ev.key === 'R') return true
      if (ev.key === 'Shift' || ev.key === 'Control' || ev.key === 'Alt' || ev.key === 'Meta') {
        return true
      }
      return false
    }

    const mod = ev.ctrlKey || ev.metaKey
    if (!mod) return true

    // App shortcuts — handled on window capture; do not send to PTY
    const k = ev.key
    const lower = k.length === 1 ? k.toLowerCase() : k
    if (
      lower === 'w' ||
      k === 'Tab' ||
      k === 'ArrowLeft' ||
      k === 'ArrowRight' ||
      k === 'Left' ||
      k === 'Right' ||
      k === ',' ||
      k === 'Comma' ||
      (ev.shiftKey && lower === 'b')
    ) {
      return false
    }

    if (useSettingsStore.getState().copyOnSelect) return true

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

    if (ev.key === 'v' || ev.key === 'V') return false
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

  // Capture phase so Ctrl+wheel never reaches xterm scroll first
  const onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    const delta = e.deltaY > 0 ? -1 : 1
    const cur = useSettingsStore.getState().terminalFontSize || 14
    void useSettingsStore.getState().update({
      terminalFontSize: Math.min(28, Math.max(6, cur + delta))
    })
  }
  hostEl.addEventListener('wheel', onWheel, { passive: false, capture: true })

  const onContext = (e: MouseEvent): void => {
    if (!useSettingsStore.getState().pasteOnRightClick) return
    e.preventDefault()
    void navigator.clipboard.readText().then((text) => {
      if (text) void window.api.ssh.write(sessionId, text)
    })
  }
  hostEl.addEventListener('contextmenu', onContext)

  const dispose = (): void => {
    dataDisp.dispose()
    selDisp.dispose()
    hostEl.removeEventListener('paste', onPaste)
    hostEl.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
    hostEl.removeEventListener('contextmenu', onContext)
    term.dispose()
    hostEl.remove()
    earlyBuffer.delete(sessionId)
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

export function attachTerminal(sessionId: string, container: HTMLElement, focused: boolean): void {
  const entry = acquireTerminal(sessionId)
  entry.hostEl.style.cssText = 'width:100%;height:100%;min-height:0;flex:1;'
  if (entry.hostEl.parentElement !== container) {
    container.appendChild(entry.hostEl)
  }
  entry.focused = focused
  // Wait for layout (split/pane move) so we never fit to a collapsed width
  scheduleFitWhenReady(entry)
  if (entry.focused) {
    requestAnimationFrame(() => {
      try {
        entry.term.focus()
      } catch {
        /* ignore */
      }
    })
  }
}

export function parkTerminal(sessionId: string): void {
  const entry = cache.get(sessionId)
  if (!entry) return
  entry.focused = false
  // Do NOT fit while parking — park geometry must not reflow the buffer
  getPark().appendChild(entry.hostEl)
}

export function setTerminalFocused(sessionId: string, focused: boolean): void {
  const entry = cache.get(sessionId)
  if (!entry) return
  entry.focused = focused
  if (focused) {
    scheduleFitWhenReady(entry)
    try {
      entry.term.focus()
    } catch {
      /* ignore */
    }
  }
}

function applyLineWrap(term: Terminal, wrap: boolean): void {
  // DECAWM: ?7h enable wrap, ?7l disable
  try {
    term.write(wrap ? '\x1b[?7h' : '\x1b[?7l')
  } catch {
    /* ignore */
  }
}

export function applyTerminalSettings(sessionId: string): void {
  const entry = cache.get(sessionId)
  if (!entry) return
  const s = useSettingsStore.getState()
  entry.term.options.fontFamily = s.terminalFontFamily
  entry.term.options.fontSize = s.terminalFontSize
  entry.term.options.theme = toXtermTheme(s.theme)
  entry.term.options.scrollback = Math.min(100000, Math.max(100, s.scrollback || 8000))
  entry.term.options.cursorBlink = s.cursorBlink !== false
  entry.term.options.cursorStyle = s.cursorStyle || 'block'
  applyLineWrap(entry.term, true)
  // Only fit if currently visible with a real size
  scheduleFitWhenReady(entry)
}

/** Apply appearance settings to every open terminal (after settings save). */
export function applyTerminalSettingsToAll(): void {
  for (const id of cache.keys()) applyTerminalSettings(id)
}

/** Refit after container size changes (pane drag / split / window resize). */
export function notifyTerminalContainerResized(sessionId: string): void {
  const entry = cache.get(sessionId)
  if (!entry) return
  scheduleFitWhenReady(entry)
}

export function disposeTerminal(sessionId: string): void {
  cache.get(sessionId)?.dispose()
  earlyBuffer.delete(sessionId)
}

export function disposeAllTerminals(): void {
  for (const id of [...cache.keys()]) disposeTerminal(id)
  earlyBuffer.clear()
}

/**
 * Create terminal as soon as a session id is known (before React paints),
 * so "Connecting…" / login prompts are never missed.
 */
export function preloadTerminal(sessionId: string): void {
  initTerminalDataRouter()
  acquireTerminal(sessionId)
}
