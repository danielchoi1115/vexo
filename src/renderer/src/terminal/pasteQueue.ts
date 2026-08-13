/**
 * Sequential multi-line paste: one line at a time, wait for the remote to go
 * quiet, and pause the remaining lines when a password prompt appears.
 *
 * Newlines become CR (same as xterm / BroadcastBar). A final fragment with no
 * trailing newline is inserted without Enter.
 */

export interface PasteLine {
  text: string
  /** Send CR after this fragment (clipboard had a newline here). */
  submit: boolean
}

/** After our SI OSC (shell is back at PS1). Short settle so PS1 can finish printing. */
const PASTE_OSC_SETTLE_MS = 40
/** No SI (fish / unknown): last output stayed quiet this long → assume ready. */
const PASTE_FALLBACK_QUIET_MS = 280
/** Secret prompt must sit unchanged this long (avoids `echo password:` false hits). */
const PASTE_SECRET_HOLD_MS = 80
const PASTE_MIN_WAIT_MS = 50
const PASTE_MAX_WAIT_MS = 8000

/** Last non-empty line looks like a secret prompt — do not typeahead the next command. */
const SECRET_PROMPT_RE =
  /(?:password|passphrase|암호|비밀번호|verification code|one[-\s]?time(?:\s+password)?|\botp\b|authentication code)[^\n]*:\s*$/i

export function toPtyNewlines(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r')
}

export function splitPasteLines(raw: string): PasteLine[] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!text) return []
  const parts = text.split('\n')
  const trailingNl = text.endsWith('\n')
  const count = trailingNl ? parts.length - 1 : parts.length
  const lines: PasteLine[] = []
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1
    lines.push({ text: parts[i] ?? '', submit: !isLast || trailingNl })
  }
  return lines
}

export function stripAnsi(text: string): string {
  /* eslint-disable no-control-regex -- ESC / BEL / C0 in terminal streams */
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b./g, '')
  /* eslint-enable no-control-regex */
}

/** PROMPT_COMMAND / precmd cwd report — command finished, shell is reading again. */
export function sawShellReadyMarker(chunk: string): boolean {
  return chunk.includes('\x1b]633;P;Cwd=') || chunk.includes('\x1b]7;file://')
}

export function looksLikeSecretPrompt(chunk: string): boolean {
  const visible = stripAnsi(chunk)
    .replace(/\r/g, '\n')
    // eslint-disable-next-line no-control-regex -- drop leftover C0
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
  const lines = visible.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? '').replace(/[ \t]+$/g, '')
    if (!line) continue
    return SECRET_PROMPT_RE.test(line)
  }
  return false
}

export interface SessionPasteOptions {
  isAlive: () => boolean
  /** False during auth so user\\npassword is not split by the sudo pause rule. */
  isShellReady: () => boolean
  write: (data: string) => Promise<void>
}

type SubmitWaiter = (result: 'submit' | 'aborted') => void

export class SessionPaste {
  private run: AbortController | null = null
  private submitWaiter: SubmitWaiter | null = null
  private waitingForSubmit = false
  private tail = ''
  private waitGotData = false
  private waitLastDataAt = 0
  private collecting = false

  constructor(private readonly opts: SessionPasteOptions) {}

  onRemoteData(text: string): void {
    if (!this.collecting || !text) return
    this.waitGotData = true
    this.waitLastDataAt = Date.now()
    this.tail = (this.tail + text).slice(-1200)
  }

  /** Local keystrokes: Ctrl+C aborts remaining lines; Enter resumes after a secret prompt. */
  onLocalData(data: string): void {
    if (data.includes('\x03')) {
      this.cancel()
      return
    }
    if (this.waitingForSubmit && (data.includes('\r') || data.includes('\n'))) {
      this.finishSubmit('submit')
    }
  }

  cancel(): void {
    this.run?.abort()
    this.run = null
    this.collecting = false
    this.finishSubmit('aborted')
  }

  dispose(): void {
    this.cancel()
  }

  async paste(raw: string): Promise<void> {
    if (!raw) return
    if (!this.opts.isAlive()) return

    // Filling a password — insert into the PTY, do not replace the remaining queue.
    if (this.waitingForSubmit) {
      const text = toPtyNewlines(raw)
      if (text) await this.opts.write(text)
      if (text.includes('\r')) this.finishSubmit('submit')
      return
    }

    // Auth / not-yet-shell: dump with CR so login user\\npass still works.
    if (!this.opts.isShellReady()) {
      const text = toPtyNewlines(raw)
      if (text) await this.opts.write(text)
      return
    }

    const lines = splitPasteLines(raw)
    if (lines.length === 0) return

    this.cancel()
    const ac = new AbortController()
    this.run = ac
    try {
      await this.runLines(lines, ac.signal)
    } finally {
      if (this.run === ac) this.run = null
      this.collecting = false
    }
  }

  private async runLines(lines: PasteLine[], signal: AbortSignal): Promise<void> {
    for (let i = 0; i < lines.length; i++) {
      if (signal.aborted || !this.opts.isAlive()) return
      const line = lines[i]!
      if (line.text) await this.opts.write(line.text)
      if (!line.submit) continue
      await this.opts.write('\r')

      const more = lines.slice(i + 1).some((l) => l.text.length > 0 || l.submit)
      if (!more) return
      if ((await this.afterLine(signal)) === 'aborted') return
    }
  }

  private async afterLine(signal: AbortSignal): Promise<'ok' | 'aborted'> {
    while (!signal.aborted && this.opts.isAlive()) {
      const r = await this.waitAfterLine(signal)
      if (r === 'aborted') return 'aborted'
      if (r === 'ready') return 'ok'
      if ((await this.waitLocalSubmit(signal)) === 'aborted') return 'aborted'
    }
    return 'aborted'
  }

  private waitAfterLine(signal: AbortSignal): Promise<'ready' | 'secret' | 'aborted'> {
    this.tail = ''
    this.waitGotData = false
    this.waitLastDataAt = Date.now()
    this.collecting = true
    const started = Date.now()

    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = (r: 'ready' | 'secret' | 'aborted'): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(r)
      }
      const onAbort = (): void => done('aborted')
      signal.addEventListener('abort', onAbort)
      const tick = (): void => {
        if (signal.aborted || !this.opts.isAlive()) {
          done('aborted')
          return
        }
        const now = Date.now()
        const quietFor = now - this.waitLastDataAt
        if (
          looksLikeSecretPrompt(this.tail) &&
          quietFor >= PASTE_SECRET_HOLD_MS &&
          now - started >= PASTE_MIN_WAIT_MS
        ) {
          done('secret')
          return
        }
        if (now - started >= PASTE_MAX_WAIT_MS) {
          done(looksLikeSecretPrompt(this.tail) ? 'secret' : 'ready')
          return
        }
        if (
          sawShellReadyMarker(this.tail) &&
          quietFor >= PASTE_OSC_SETTLE_MS &&
          now - started >= PASTE_MIN_WAIT_MS
        ) {
          done('ready')
          return
        }
        if (
          this.waitGotData &&
          !sawShellReadyMarker(this.tail) &&
          quietFor >= PASTE_FALLBACK_QUIET_MS &&
          now - started >= PASTE_FALLBACK_QUIET_MS
        ) {
          done('ready')
          return
        }
        timer = setTimeout(tick, 25)
      }
      timer = setTimeout(tick, 25)
    })
  }

  private waitLocalSubmit(signal: AbortSignal): Promise<'submit' | 'aborted'> {
    if (signal.aborted) return Promise.resolve('aborted')
    this.waitingForSubmit = true
    return new Promise((resolve) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort)
        this.finishSubmit('aborted')
      }
      signal.addEventListener('abort', onAbort)
      this.submitWaiter = (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      }
    })
  }

  private finishSubmit(result: 'submit' | 'aborted'): void {
    if (!this.waitingForSubmit && !this.submitWaiter) return
    this.waitingForSubmit = false
    const w = this.submitWaiter
    this.submitWaiter = null
    w?.(result)
  }
}
