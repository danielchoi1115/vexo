import { Client, type ConnectConfig, type SFTPWrapper, type ClientChannel } from 'ssh2'
import {
  readFileSync,
  createReadStream,
  createWriteStream,
  unlink,
  statSync
} from 'fs'
import { basename, join } from 'path'
import { app, BrowserWindow, dialog } from 'electron'
import iconv from 'iconv-lite'
import type {
  ActiveSessionInfo,
  ConnectOptions,
  ConnectionStatus,
  RemoteMetrics,
  SftpEntry,
  TerminalEncoding,
  TermType,
  TransferProgress
} from '../../shared/types'
import {
  getPassword,
  getPassphrase,
  hasPassword,
  setPassword
} from '../credentialStore'
import { getKnownHostKey, setKnownHostKey } from '../knownHostsStore'
import { getSession, touchLastConnected, updatePasswordSavePolicy } from '../sessionStore'
import { getSettings } from '../settingsStore'
import { DataBatcher } from './DataBatcher'
// 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
// import { extractCwdsFromOscBuffer } from './cwdOsc'
// import {
//   BASH_ZSH_INTEGRATION,
//   FISH_INTEGRATION,
//   buildSourceCommand,
//   remoteIntegrationPaths,
//   shellKindFromPath,
//   type RemoteShellInfo
// } from './shellIntegration'

/** Result of a terminal auth line prompt. */
type AuthLineResult = { cancelled: true } | { cancelled: false; value: string }

/** Collect a line of auth input from the terminal before shell is ready. */
class AuthInput {
  private buffer = ''
  private resolve: ((result: AuthLineResult) => void) | null = null
  private echo = true

  get active(): boolean {
    return this.resolve !== null
  }

  ask(prompt: string, echo: boolean, write: (s: string) => void): Promise<AuthLineResult> {
    this.echo = echo
    this.buffer = ''
    write(prompt)
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  /** @returns true if consumed as auth input */
  feed(data: string, write: (s: string) => void): boolean {
    if (!this.resolve) return false
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        write('\r\n')
        const line = this.buffer
        this.buffer = ''
        const r = this.resolve
        this.resolve = null
        // Empty Enter is a valid empty password attempt — not cancel
        r({ cancelled: false, value: line })
        return true
      }
      // Backspace / Delete — erase buffer and always erase the visual glyph
      // (plain char when echo, or '*' when password mode).
      if (ch === '\x7f' || ch === '\b') {
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1)
          write('\b \b')
        }
        continue
      }
      if (ch === '\x03') {
        write('^C\r\n')
        const r = this.resolve
        this.resolve = null
        this.buffer = ''
        r({ cancelled: true })
        return true
      }
      // Ignore other control chars; accept printable + tab
      if (ch >= ' ' || ch === '\t') {
        this.buffer += ch
        write(this.echo ? ch : '*')
      }
    }
    return true
  }
}

/**
 * Connection lifecycle phases — critical for not treating auth failures as
 * "session ended", and for not cleaning up mid-retry.
 *
 * - auth: handshake / password retries (no shell yet)
 * - shell: interactive session is up
 * - ended: terminal exit hints shown; waiting for UI close/restart
 */
type SessionPhase = 'auth' | 'shell' | 'ended'

interface LiveSession {
  info: ActiveSessionInfo
  client: Client
  stream?: ClientChannel
  sftp?: SFTPWrapper
  batcher: DataBatcher
  auth: AuthInput
  backspaceSendsCtrlH: boolean
  encoding: TerminalEncoding
  // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
  // oscBuf: string
  // shellIntegrationReady?: boolean
  // siEchoFilterUntil?: number
  /** Last data activity (for waiting until MOTD settles) */
  lastStreamAt?: number
  /** Total bytes received on the interactive shell stream */
  streamBytes?: number
  metricsTimer?: ReturnType<typeof setInterval>
  lastNet?: { rx: number; tx: number; at: number }
  phase: SessionPhase
  /** Avoid double "session ended" prompts */
  endedHintsShown?: boolean
  /** Latest size from renderer (kept even before shell stream exists) */
  pendingCols?: number
  pendingRows?: number
  /** Last size actually applied to the PTY */
  lastPtyCols?: number
  lastPtyRows?: number
  /**
   * Bumps on every Client replace so late error/close from the old Client
   * cannot touch the new handshake (generation mismatch → ignore).
   */
  clientGen: number
  /**
   * While waiting for client.ready. Errors/close go here; they must NOT
   * trigger session-ended cleanup (auth may retry on a new Client).
   */
  connectWaiter?: {
    resolve: () => void
    reject: (err: Error) => void
    gen: number
  } | null
  /** Password used for the successful auth (for save prompt); null if from store already */
  authPasswordPlain?: string | null
  /** True if password was loaded from credential store (no save prompt) */
  authPasswordFromStore?: boolean
  passwordSaveWaiter?: {
    resolve: () => void
  } | null
  /** Username used for the successful password auth */
  lastAuthUsername?: string
}

const BATCH_MS = 12

export class SshManager {
  private sessions = new Map<string, LiveSession>()

  constructor(private getWindow: () => BrowserWindow | null) {}

  listActive(): ActiveSessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }))
  }

  private emitStatus(info: ActiveSessionInfo): void {
    this.getWindow()?.webContents.send('ssh:status', info)
  }

  private setStatus(live: LiveSession, status: ConnectionStatus, error?: string): void {
    live.info = { ...live.info, status, error }
    this.emitStatus(live.info)
  }

  private termWrite(live: LiveSession, text: string): void {
    // Local UI messages are always Unicode → UTF-8 to renderer
    live.batcher.push(Buffer.from(text, 'utf8'))
  }

  /** Decode remote PTY bytes → UTF-8 for the renderer */
  private decodeRemote(live: LiveSession, buf: Buffer): Buffer {
    if (live.encoding === 'utf-8' || live.encoding === 'latin1') {
      if (live.encoding === 'utf-8') return buf
      return Buffer.from(buf.toString('latin1'), 'utf8')
    }
    try {
      const text = iconv.decode(buf, live.encoding === 'euc-kr' ? 'euc-kr' : live.encoding)
      return Buffer.from(text, 'utf8')
    } catch {
      return buf
    }
  }

  /** Encode renderer text → remote PTY bytes */
  private encodeRemote(live: LiveSession, text: string): Buffer | string {
    if (live.encoding === 'utf-8') return text
    if (live.encoding === 'latin1') return Buffer.from(text, 'latin1')
    try {
      return iconv.encode(text, live.encoding === 'euc-kr' ? 'euc-kr' : live.encoding)
    } catch {
      return text
    }
  }

  /**
   * Final UI after a *real* interactive session ends (remote close, kill, etc.).
   * Not used for Access denied / mid-auth handshake failures.
   */
  private writeSessionEndedHints(live: LiveSession): void {
    if (live.endedHintsShown) return
    live.endedHintsShown = true
    live.phase = 'ended'
    this.termWrite(
      live,
      '\r\n' +
        '\x1b[33mSession ended.\x1b[0m\r\n' +
        '\x1b[90mPress <return> to exit tab\x1b[0m\r\n' +
        '\x1b[90mPress R to restart session\x1b[0m\r\n'
    )
  }

  /** Exit/restart hints after connect failed before shell (no "Session ended"). */
  private writeConnectFailedHints(live: LiveSession): void {
    if (live.endedHintsShown) return
    live.endedHintsShown = true
    live.phase = 'ended'
    this.termWrite(
      live,
      '\x1b[90mPress <return> to exit tab\x1b[0m\r\n' +
        '\x1b[90mPress R to restart session\x1b[0m\r\n'
    )
  }

  /**
   * Permanent error/close handlers per Client.
   * Generation check ignores events from replaced clients during auth retries.
   */
  private bindClient(live: LiveSession, client: Client, gen: number): void {
    client.on('error', (err: Error) => {
      try {
        this.onClientError(live, client, gen, err)
      } catch {
        /* never rethrow from error handler */
      }
    })
    client.on('close', () => {
      try {
        this.onClientClose(live, client, gen)
      } catch {
        /* ignore */
      }
    })
    // sshd Banner (e.g. Banner /etc/issue.net) — pre-auth, not on the shell stream
    client.on('banner', (message: string) => {
      try {
        if (live.clientGen !== gen || live.client !== client) return
        this.writeSshBanner(live, message)
      } catch {
        /* ignore */
      }
    })
  }

  /** Display OpenSSH-style pre-auth banner in the terminal. */
  private writeSshBanner(live: LiveSession, message: string): void {
    if (!message) return
    let text = message.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (!text.endsWith('\n')) text += '\n'
    this.termWrite(live, text.replace(/\n/g, '\r\n'))
  }

  private onClientError(live: LiveSession, client: Client, gen: number, err: Error): void {
    // Replaced during auth retry — ignore stale socket noise (often ECONNRESET after end)
    if (live.clientGen !== gen || live.client !== client) return
    if (live.phase === 'ended') return

    // Auth / handshake wait: only reject the waiter. Do NOT end the session UI.
    if (live.phase === 'auth') {
      if (live.connectWaiter && live.connectWaiter.gen === gen) {
        const waiter = live.connectWaiter
        live.connectWaiter = null
        waiter.reject(err)
      }
      return
    }

    // Live shell: real connection loss
    if (live.phase === 'shell') {
      if (!this.sessions.has(live.info.id)) return
      this.termWrite(live, `\r\n\x1b[31m${err.message}\x1b[0m\r\n`)
      this.writeSessionEndedHints(live)
      this.setStatus(live, 'error', err.message)
    }
  }

  private onClientClose(live: LiveSession, client: Client, gen: number): void {
    if (live.clientGen !== gen || live.client !== client) return
    if (live.phase === 'ended') return

    // Auth phase close = failed handshake/auth attempt, not "session ended"
    if (live.phase === 'auth') {
      if (live.connectWaiter && live.connectWaiter.gen === gen) {
        const waiter = live.connectWaiter
        live.connectWaiter = null
        waiter.reject(new Error('Connection closed before ready'))
      }
      return
    }

    // Shell closed (remote exit, network drop, etc.)
    if (live.phase === 'shell' && this.sessions.has(live.info.id)) {
      this.writeSessionEndedHints(live)
      this.setStatus(live, 'disconnected')
      this.cleanup(live.info.id, false)
    }
  }

  private replaceClient(live: LiveSession): Client {
    const old = live.client
    const oldGen = live.clientGen
    // Invalidate old generation so end()/close cannot touch auth state
    live.clientGen = oldGen + 1
    live.connectWaiter = null
    try {
      old.end()
    } catch {
      /* ignore */
    }

    const client = new Client()
    live.client = client
    this.bindClient(live, client, live.clientGen)
    return client
  }

  private waitClientReady(
    live: LiveSession,
    client: Client,
    connectConfig: ConnectConfig
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (live.client !== client) {
        reject(new Error('Client was replaced'))
        return
      }
      const gen = live.clientGen
      let settled = false
      const settleResolve = (): void => {
        if (settled) return
        settled = true
        if (live.connectWaiter?.gen === gen) live.connectWaiter = null
        resolve()
      }
      const settleReject = (err: Error): void => {
        if (settled) return
        settled = true
        if (live.connectWaiter?.gen === gen) live.connectWaiter = null
        reject(err)
      }

      live.connectWaiter = {
        resolve: settleResolve,
        reject: settleReject,
        gen
      }

      client.once('ready', () => {
        if (live.clientGen !== gen) return
        settleResolve()
      })

      try {
        client.connect(connectConfig)
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /**
   * Returns immediately with a connecting session so the terminal can show prompts.
   * Auth continues asynchronously (optional user/pass typed in the terminal).
   */
  async connect(options: ConnectOptions): Promise<ActiveSessionInfo> {
    const config = getSession(options.sessionConfigId)
    if (!config) throw new Error('Session not found')

    const activeId = crypto.randomUUID()
    const client = new Client()
    const auth = new AuthInput()
    const settings = getSettings()
    const encoding: TerminalEncoding = config.encoding || settings.defaultEncoding || 'utf-8'

    const batcher = new DataBatcher(BATCH_MS, (buf) => {
      const win = this.getWindow()
      if (!win) return
      // Always deliver UTF-8 to renderer (encoding applied in onStreamData path via live)
      win.webContents.send('ssh:data', activeId, buf.toString('base64'))
    })

    const backspaceSendsCtrlH = config.backspaceSendsCtrlH !== false
    const live: LiveSession = {
      info: {
        id: activeId,
        sessionConfigId: config.id,
        name: config.name,
        status: 'connecting',
        backspaceSendsCtrlH,
        encoding
      },
      client,
      batcher,
      auth,
      backspaceSendsCtrlH,
      encoding,
      // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
      // oscBuf: '',
      phase: 'auth',
      clientGen: 0,
      connectWaiter: null
    }
    this.sessions.set(activeId, live)
    this.bindClient(live, client, 0)
    this.emitStatus(live.info)

    void this.runConnect(live, options).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      try {
        // Never got a shell — connection failed, not "session ended"
        if (live.phase === 'auth' || live.phase === 'ended') {
          if (!live.endedHintsShown) {
            this.termWrite(live, `\r\n\x1b[31mConnection failed: ${message}\x1b[0m\r\n`)
            this.writeConnectFailedHints(live)
          }
          this.setStatus(live, 'error', message)
          // Keep session entry for Enter/R; tear down only the socket
          this.teardownClient(live)
        }
      } catch {
        /* session may already be gone */
      }
    })

    return { ...live.info }
  }

  private async runConnect(live: LiveSession, options: ConnectOptions): Promise<void> {
    const config = getSession(options.sessionConfigId)
    if (!config) throw new Error('Session not found')

    const write = (s: string): void => this.termWrite(live, s)
    write(`\x1b[90mConnecting to ${config.host}:${config.port}…\x1b[0m\r\n`)

    // Collect credentials BEFORE client.connect so readyTimeout only covers network/auth,
    // not waiting for the user to type in the terminal.
    let username = (config.username || '').trim()
    if (!username) {
      const userLine = await live.auth.ask('login as: ', true, write)
      if (userLine.cancelled) throw new Error('Authentication cancelled')
      username = userLine.value.trim()
      if (!username) throw new Error('Username is required')
    }

    let password: string | undefined
    let privateKey: Buffer | undefined
    let passphrase: string | undefined
    /** True when first attempt used a stored secret (may need re-prompt on failure) */
    let usedStoredPassword = false

    live.authPasswordPlain = null
    live.authPasswordFromStore = false
    live.lastAuthUsername = username

    if (config.authMethod === 'password') {
      const stored = getPassword(config.id, username)
      password = options.password ?? stored ?? undefined
      if (password && stored && password === stored && !options.password) {
        usedStoredPassword = true
        live.authPasswordFromStore = true
      } else if (!password) {
        const passLine = await live.auth.ask(
          `${username}@${config.host}'s password: `,
          false,
          write
        )
        if (passLine.cancelled) throw new Error('Authentication cancelled')
        password = passLine.value
        live.authPasswordPlain = password
        live.authPasswordFromStore = false
      } else {
        // Typed via options or differs from store — treat as new plain for save offer
        live.authPasswordPlain = password
        live.authPasswordFromStore = Boolean(stored && password === stored)
      }
    } else if (config.authMethod === 'privateKey') {
      if (!config.privateKeyPath) throw new Error('Private key path required')
      try {
        privateKey = readFileSync(config.privateKeyPath)
      } catch {
        throw new Error(`Cannot read private key: ${config.privateKeyPath}`)
      }
      passphrase = options.passphrase ?? getPassphrase(config.id) ?? undefined
    }

    const MAX_PASSWORD_ATTEMPTS = 5
    let lastAuthError: Error | null = null

    for (let attempt = 0; attempt < MAX_PASSWORD_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        if (config.authMethod !== 'password') {
          throw lastAuthError ?? new Error('Authentication failed')
        }
        write('\x1b[31mAccess denied\x1b[0m\r\n')
        // Drop the dead Client before prompting so socket close noise cannot
        // race with the new password line (especially after stored-password fail).
        this.replaceClient(live)

        const passLine = await live.auth.ask(
          `${username}@${config.host}'s password: `,
          false,
          write
        )
        // Only Ctrl+C cancels — empty Enter is a valid (empty) password attempt
        if (passLine.cancelled) throw new Error('Authentication cancelled')
        password = passLine.value
        usedStoredPassword = false
        live.authPasswordPlain = password
        live.authPasswordFromStore = false
      }

      const settings = getSettings()
      const keepAliveMs =
        settings.keepAliveIntervalSec > 0 ? settings.keepAliveIntervalSec * 1000 : 0

      const connectConfig: ConnectConfig & { compress?: boolean } = {
        host: config.host,
        port: config.port,
        username,
        readyTimeout: 30000,
        tryKeyboard: true,
        compress: config.compression !== false,
        keepaliveInterval: keepAliveMs,
        keepaliveCountMax: keepAliveMs > 0 ? 3 : 0,
        hostHash: 'sha256',
        hostVerifier: (keyHash: string) =>
          this.verifyHostKey(config.host, config.port, keyHash, settings.hostKeyPolicy),
        ...(config.x11Forwarding !== false ? { x11: true } : {}),
        ...(config.authMethod === 'agent'
          ? {
              agent:
                process.env.SSH_AUTH_SOCK ||
                (process.platform === 'win32' ? 'pageant' : undefined)
            }
          : {}),
        // Always send password string when using password auth (including empty)
        ...(config.authMethod === 'password' ? { password: password ?? '' } : {}),
        ...(config.authMethod === 'privateKey' && privateKey
          ? { privateKey, ...(passphrase ? { passphrase } : {}) }
          : {})
      }

      const client = live.client

      client.on('keyboard-interactive', (name, instructions, _lang, prompts, finish) => {
        void (async () => {
          try {
            if (name) write(`${name}\r\n`)
            if (instructions) write(`${instructions}\r\n`)
            const answers: string[] = []
            for (const p of prompts) {
              const echo = p.echo !== false
              const line = await live.auth.ask(p.prompt, echo, write)
              answers.push(line.cancelled ? '' : line.value)
            }
            finish(answers)
          } catch {
            finish([])
          }
        })()
      })

      try {
        await this.waitClientReady(live, client, connectConfig)
        lastAuthError = null
        break
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        // Stored/wrong password → retry with interactive prompt (not connection cancel)
        if (
          config.authMethod === 'password' &&
          isAuthFailure(e) &&
          attempt < MAX_PASSWORD_ATTEMPTS - 1
        ) {
          lastAuthError = e
          // If first try used stored secret, force interactive path next
          if (usedStoredPassword) usedStoredPassword = false
          continue
        }
        throw e
      }
    }

    if (lastAuthError) throw lastAuthError

    const client = live.client
    write('\x1b[90mAuthenticated.\x1b[0m\r\n')

    // Password save prompt BEFORE shell (Moba-style) when policy asks
    await this.maybePromptPasswordSave(live, config.id, username, config.host)

    write('\x1b[90mOpening shell…\x1b[0m\r\n')

    const termType: TermType =
      config.termType || getSettings().defaultTermType || 'xterm-256color'
    // Prefer pending renderer size when available (avoids vim using 40-row default).
    // Too-small PTY cols make bash history redraw erase scrollback lines.
    const cols = live.pendingCols && live.pendingCols >= 20 ? live.pendingCols : 120
    const rows = live.pendingRows && live.pendingRows >= 5 ? live.pendingRows : 40
    const pty = { term: termType, cols, rows }

    /*
     * CRITICAL order: interactive shell FIRST, before SFTP/exec channels.
     * Opening SFTP or exec before shell can suppress/partial-print pam MOTD
     * ("Welcome to Ubuntu…") so only "Last login:" remains.
     * Attach data handlers inside the shell callback so MOTD bytes are not dropped.
     */
    live.phase = 'shell'
    // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
    // live.oscBuf = ''
    live.lastStreamAt = Date.now()
    live.streamBytes = 0

    const stream = await new Promise<ClientChannel>((resolve, reject) => {
      client.shell(pty, (err, s) => {
        if (err || !s) {
          reject(err ?? new Error('Failed to open shell'))
          return
        }
        live.stream = s
        s.on('data', (data: Buffer) => this.onStreamData(live, data))
        s.stderr?.on('data', (data: Buffer) => this.onStreamData(live, data))
        s.on('close', () => {
          if (!this.sessions.has(live.info.id)) return
          if (live.phase !== 'shell') return
          this.writeSessionEndedHints(live)
          this.setStatus(live, 'disconnected')
          this.cleanup(live.info.id, false)
        })
        s.on('error', () => {
          /* avoid uncaught stream errors */
        })
        resolve(s)
      })
    })

    live.stream = stream
    live.lastPtyCols = cols
    live.lastPtyRows = rows
    // Apply any newer fit size that arrived during shell open
    this.flushPtyResize(live)

    touchLastConnected(config.id)
    this.setStatus(live, 'connected')
    this.maybeStartMetrics(live)

    // SFTP only AFTER MOTD has been free to arrive
    void this.afterLoginShellReady(live, config)
  }

  /**
   * After the login shell is up: wait for MOTD to finish, then SFTP + startup.
   */
  private async afterLoginShellReady(
    live: LiveSession,
    config: { startupDirectory?: string; startupCommand?: string }
  ): Promise<void> {
    // Let Welcome / update-motd finish (may take seconds after Last login)
    await this.waitForStreamQuiet(live, {
      quietMs: 800,
      minWaitMs: 500,
      maxWaitMs: 12000,
      requireData: true
    })
    if (live.phase !== 'shell' || !live.stream) return

    // SFTP for file browser (safe after MOTD)
    try {
      if (!live.sftp) {
        live.sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
          live.client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
        })
      }
    } catch {
      /* SFTP optional */
    }

    // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
    // try {
    //   if (live.sftp) {
    //     const home = await new Promise<string>((resolve) => {
    //       live.sftp!.realpath('.', (err, p) => resolve(!err && p ? p : '/'))
    //     })
    //     if (home) {
    //       live.info = { ...live.info, remoteCwd: home }
    //       this.getWindow()?.webContents.send('ssh:cwd', live.info.id, home)
    //     }
    //   }
    // } catch {
    //   /* optional */
    // }
    //
    // const shellInfo = await this.detectRemoteShell(live)
    // const sourceCmd = await this.stageShellIntegrationFiles(live, shellInfo)
    //
    // if (live.phase !== 'shell' || !live.stream) return
    //
    // if (sourceCmd) {
    //   live.siEchoFilterUntil = Date.now() + 2000
    //   try {
    //     live.stream.write(this.encodeRemote(live, sourceCmd))
    //     live.shellIntegrationReady = true
    //   } catch {
    //     live.siEchoFilterUntil = undefined
    //   }
    //   await new Promise((r) => setTimeout(r, 100))
    // }

    if (live.phase !== 'shell' || !live.stream) return

    const startupDir = (config.startupDirectory || '').trim()
    const startupCmd = (config.startupCommand || '').trim()
    if (startupDir) {
      const escaped = startupDir.replace(/'/g, `'\\''`)
      live.stream.write(this.encodeRemote(live, `cd '${escaped}'\n`))
    }
    if (startupCmd) {
      live.stream.write(this.encodeRemote(live, `${startupCmd}\n`))
    }
  }

  /**
   * Resolve when outbound stream has been quiet for quietMs.
   * If requireData, do not resolve until at least one byte was received
   * (avoids injecting before MOTD starts).
   */
  private waitForStreamQuiet(
    live: LiveSession,
    opts: {
      quietMs: number
      minWaitMs: number
      maxWaitMs: number
      requireData?: boolean
    }
  ): Promise<void> {
    const started = Date.now()
    return new Promise((resolve) => {
      const tick = (): void => {
        if (live.phase !== 'shell') {
          resolve()
          return
        }
        const elapsed = Date.now() - started
        if (elapsed >= opts.maxWaitMs) {
          resolve()
          return
        }
        const gotData = (live.streamBytes ?? 0) > 0
        if (opts.requireData && !gotData) {
          setTimeout(tick, 40)
          return
        }
        const last = live.lastStreamAt ?? started
        const quietFor = Date.now() - last
        if (elapsed >= opts.minWaitMs && quietFor >= opts.quietMs) {
          resolve()
          return
        }
        setTimeout(tick, 40)
      }
      setTimeout(tick, 40)
    })
  }

  // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
  // private async detectRemoteShell(live: LiveSession): Promise<RemoteShellInfo> {
  //   return new Promise((resolve) => {
  //     let settled = false
  //     const done = (info: RemoteShellInfo): void => {
  //       if (settled) return
  //       settled = true
  //       resolve(info)
  //     }
  //     try {
  //       live.client.exec('printf %s "${SHELL:-}"', (err, ch) => {
  //         if (err || !ch) {
  //           done({ kind: 'unknown', path: '' })
  //           return
  //         }
  //         let out = ''
  //         const finish = (): void => {
  //           const path = out.trim()
  //           done({ kind: shellKindFromPath(path), path })
  //         }
  //         ch.on('data', (d: Buffer) => {
  //           out += d.toString('utf8')
  //         })
  //         ch.stderr?.on('data', () => {
  //           /* ignore */
  //         })
  //         ch.on('close', finish)
  //         ch.on('end', finish)
  //         setTimeout(finish, 3000)
  //       })
  //     } catch {
  //       done({ kind: 'unknown', path: '' })
  //     }
  //   })
  // }
  //
  // private writeSftpText(sftp: SFTPWrapper, remotePath: string, text: string): Promise<void> {
  //   return new Promise((resolve, reject) => {
  //     const ws = sftp.createWriteStream(remotePath)
  //     ws.on('error', reject)
  //     ws.on('close', () => resolve())
  //     ws.end(Buffer.from(text, 'utf8'))
  //   })
  // }
  //
  // private async stageShellIntegrationFiles(
  //   live: LiveSession,
  //   shellInfo: RemoteShellInfo
  // ): Promise<string | null> {
  //   if (!live.sftp) return null
  //   const paths = remoteIntegrationPaths(live.info.id)
  //   try {
  //     await this.writeSftpText(live.sftp, paths.sh, BASH_ZSH_INTEGRATION)
  //     await this.writeSftpText(live.sftp, paths.fish, FISH_INTEGRATION)
  //     return buildSourceCommand(shellInfo.kind, paths.sh, paths.fish)
  //   } catch {
  //     return null
  //   }
  // }

  private verifyHostKey(
    host: string,
    port: number,
    keyHash: string,
    policy: ReturnType<typeof getSettings>['hostKeyPolicy']
  ): boolean {
    if (policy === 'ignore') return true
    const known = getKnownHostKey(host, port)
    if (!known) {
      if (policy === 'strict') return false
      // accept-new
      setKnownHostKey(host, port, keyHash)
      return true
    }
    return known === keyHash
  }

  /**
   * After auth success, before shell: optional password-save UI.
   */
  private async maybePromptPasswordSave(
    live: LiveSession,
    sessionConfigId: string,
    username: string,
    host: string
  ): Promise<void> {
    const config = getSession(sessionConfigId)
    if (!config || config.authMethod !== 'password') return
    const user = username.trim()
    if (!user) return

    const policy = config.passwordSavePolicy ?? 'ask'
    const plain = live.authPasswordPlain
    const fromStore = live.authPasswordFromStore
    const alreadyStored = hasPassword(sessionConfigId, user)

    if (policy === 'never') return

    if (policy === 'always') {
      // Save password used this session if we have a plain value
      const toSave = plain ?? (fromStore ? getPassword(sessionConfigId, user) : null)
      if (toSave) setPassword(sessionConfigId, user, toSave)
      return
    }

    // ask: only if not already stored for this account and we have a newly entered password
    if (alreadyStored || fromStore || !plain) return

    const win = this.getWindow()
    if (!win) {
      // No UI — skip save
      return
    }

    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        if (live.passwordSaveWaiter) {
          live.passwordSaveWaiter = null
          resolve()
        }
      }, 120000)
      live.passwordSaveWaiter = {
        resolve: () => {
          clearTimeout(t)
          resolve()
        }
      }
      win.webContents.send('ssh:askPasswordSave', {
        activeSessionId: live.info.id,
        sessionConfigId,
        username: user,
        host
      })
    })
  }

  /**
   * Renderer answer to password-save dialog.
   * save: Yes; dontAskAgain: checkbox "do not show again"
   */
  answerPasswordSave(
    activeSessionId: string,
    save: boolean,
    dontAskAgain: boolean
  ): void {
    const live = this.sessions.get(activeSessionId)
    if (!live) return

    const config = getSession(live.info.sessionConfigId)
    const username = live.lastAuthUsername

    if (config && username) {
      if (dontAskAgain) {
        updatePasswordSavePolicy(config.id, save ? 'always' : 'never')
      }
      if (save && live.authPasswordPlain) {
        setPassword(config.id, username, live.authPasswordPlain)
      }
    }

    const w = live.passwordSaveWaiter
    live.passwordSaveWaiter = null
    w?.resolve()
  }

  // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
  // private publishCwd(live: LiveSession, cwd: string): void {
  //   if (!cwd || cwd === live.info.remoteCwd) return
  //   live.info = { ...live.info, remoteCwd: cwd }
  //   this.getWindow()?.webContents.send('ssh:cwd', live.info.id, cwd)
  // }

  private onStreamData(live: LiveSession, data: Buffer): void {
    const decoded = this.decodeRemote(live, data)
    live.lastStreamAt = Date.now()
    live.streamBytes = (live.streamBytes ?? 0) + decoded.length

    // 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
    // const asText = decoded.toString('utf8')
    // live.oscBuf += asText
    // if (live.oscBuf.length > 16384) live.oscBuf = live.oscBuf.slice(-8192)
    //
    // const { hits, remainder } = extractCwdsFromOscBuffer(live.oscBuf)
    // live.oscBuf = remainder
    // if (hits.length > 0) {
    //   const last = hits[hits.length - 1]!
    //   this.publishCwd(live, last.path)
    // }
    //
    // if (live.siEchoFilterUntil && Date.now() < live.siEchoFilterUntil) {
    //   const filtered = filterShellIntegrationEcho(asText)
    //   if (filtered.length > 0) {
    //     live.batcher.push(Buffer.from(filtered, 'utf8'))
    //   }
    //   return
    // }
    // live.siEchoFilterUntil = undefined

    live.batcher.push(decoded)
  }

  write(activeSessionId: string, data: string): void {
    const live = this.sessions.get(activeSessionId)
    if (!live) return
    // Password / login prompts — always consume (do not require shell)
    if (live.auth.active) {
      live.auth.feed(data, (s) => this.termWrite(live, s))
      return
    }
    if (live.phase !== 'shell' || !live.stream) return
    let payload = data
    if (live.backspaceSendsCtrlH) {
      // Map DEL (0x7f) → BS (^H, 0x08) for hosts that expect it
      payload = payload.replace(/\x7f/g, '\x08')
    }
    live.stream.write(this.encodeRemote(live, payload))
  }

  /**
   * Renderer fit size. Stored even before the shell stream exists so the first
   * client.shell() and a post-open flush match the real pane (fixes vim height).
   */
  resize(activeSessionId: string, cols: number, rows: number): void {
    const live = this.sessions.get(activeSessionId)
    if (!live) return
    if (cols < 20 || rows < 5) return
    live.pendingCols = cols
    live.pendingRows = rows
    this.flushPtyResize(live)
  }

  private flushPtyResize(live: LiveSession): void {
    if (!live.stream) return
    if (live.phase !== 'shell' && live.info.status !== 'connected') return
    const cols = live.pendingCols
    const rows = live.pendingRows
    if (cols == null || rows == null || cols < 20 || rows < 5) return
    if (live.lastPtyCols === cols && live.lastPtyRows === rows) return
    try {
      live.stream.setWindow(rows, cols, 0, 0)
      live.lastPtyCols = cols
      live.lastPtyRows = rows
    } catch {
      /* stream may be closing */
    }
  }

  async disconnect(activeSessionId: string): Promise<void> {
    this.cleanup(activeSessionId)
  }

  /** Close sockets only; keep LiveSession for error UI / restart until disconnectSession. */
  private teardownClient(live: LiveSession): void {
    this.cancelTransfersForSession(live.info.id)
    live.connectWaiter = null
    live.phase = live.phase === 'shell' ? 'ended' : live.phase === 'auth' ? 'ended' : live.phase
    if (live.metricsTimer) {
      clearInterval(live.metricsTimer)
      live.metricsTimer = undefined
    }
    try {
      live.stream?.close()
    } catch {
      /* ignore */
    }
    live.stream = undefined
    live.sftp = undefined
    // Bump gen so late socket events are ignored
    live.clientGen += 1
    try {
      live.client.end()
    } catch {
      /* ignore */
    }
  }

  private cleanup(activeSessionId: string, endClient = true): void {
    const live = this.sessions.get(activeSessionId)
    if (!live) return
    // Remove first so late error/close handlers no-op
    this.sessions.delete(activeSessionId)
    this.cancelTransfersForSession(activeSessionId)
    live.connectWaiter = null
    live.phase = 'ended'
    if (live.metricsTimer) clearInterval(live.metricsTimer)
    live.batcher.dispose()
    try {
      live.stream?.close()
    } catch {
      /* ignore */
    }
    if (endClient) {
      live.clientGen += 1
      try {
        live.client.end()
      } catch {
        /* ignore */
      }
    }
  }

  private getLive(activeSessionId: string): LiveSession {
    const live = this.sessions.get(activeSessionId)
    if (!live) throw new Error('Active session not found')
    if (live.info.status !== 'connected') throw new Error('Session not connected')
    return live
  }

  private ensureSftp(live: LiveSession): SFTPWrapper {
    if (!live.sftp) throw new Error('SFTP not available on this session')
    return live.sftp
  }

  async homeDir(activeSessionId: string): Promise<string> {
    const live = this.getLive(activeSessionId)
    const sftp = this.ensureSftp(live)
    return new Promise((resolve) => {
      // SFTP realpath of '.' is usually the login home directory
      sftp.realpath('.', (err, p) => {
        if (err || !p) {
          resolve('/')
          return
        }
        resolve(p)
      })
    })
  }

  async listDir(activeSessionId: string, remotePath: string): Promise<SftpEntry[]> {
    const live = this.getLive(activeSessionId)
    const sftp = this.ensureSftp(live)
    const list = await new Promise<import('ssh2').FileEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => (err ? reject(err) : resolve(list)))
    })

    return list
      .filter((item) => item.filename !== '.' && item.filename !== '..')
      .map((item) => {
        const attrs = item.attrs
        const S_IFMT = 0o170000
        const S_IFDIR = 0o040000
        const S_IFREG = 0o100000
        const S_IFLNK = 0o120000
        const fileType = (attrs.mode ?? 0) & S_IFMT
        let type: SftpEntry['type'] = 'other'
        if (fileType === S_IFDIR) type = 'directory'
        else if (fileType === S_IFREG) type = 'file'
        else if (fileType === S_IFLNK) type = 'symlink'

        const mode = (attrs.mode ?? 0) & 0o777
        return {
          name: item.filename,
          path:
            remotePath === '/'
              ? `/${item.filename}`
              : `${remotePath.replace(/\/$/, '')}/${item.filename}`,
          type,
          size: attrs.size ?? 0,
          modifyTime: attrs.mtime ? attrs.mtime * 1000 : 0,
          accessTime: attrs.atime ? attrs.atime * 1000 : 0,
          mode: attrs.mode,
          rights: {
            user: ((mode >> 6) & 7).toString(),
            group: ((mode >> 3) & 7).toString(),
            other: (mode & 7).toString()
          },
          owner: attrs.uid,
          group: attrs.gid
        } satisfies SftpEntry
      })
      .sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })
  }

  async mkdir(activeSessionId: string, remotePath: string): Promise<void> {
    const sftp = this.ensureSftp(this.getLive(activeSessionId))
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => (err ? reject(err) : resolve()))
    })
  }

  async rename(activeSessionId: string, from: string, to: string): Promise<void> {
    const sftp = this.ensureSftp(this.getLive(activeSessionId))
    await new Promise<void>((resolve, reject) => {
      sftp.rename(from, to, (err) => (err ? reject(err) : resolve()))
    })
  }

  async remove(activeSessionId: string, remotePath: string, isDir: boolean): Promise<void> {
    const sftp = this.ensureSftp(this.getLive(activeSessionId))
    await new Promise<void>((resolve, reject) => {
      const cb = (err: Error | undefined | null): void => (err ? reject(err) : resolve())
      if (isDir) sftp.rmdir(remotePath, cb)
      else sftp.unlink(remotePath, cb)
    })
  }

  async chmod(activeSessionId: string, remotePath: string, mode: string): Promise<void> {
    const sftp = this.ensureSftp(this.getLive(activeSessionId))
    const modeNum = parseInt(mode, 8)
    if (Number.isNaN(modeNum)) throw new Error('Invalid mode')
    await new Promise<void>((resolve, reject) => {
      sftp.chmod(remotePath, modeNum, (err) => (err ? reject(err) : resolve()))
    })
  }

  /** In-flight SFTP transfers (download/upload) for cancel + cleanup */
  private transfers = new Map<
    string,
    { activeSessionId: string; cancel: () => void }
  >()
  private progressLastAt = new Map<string, number>()

  private emitProgress(progress: TransferProgress): void {
    // Throttle mid-transfer IPC so shell stays responsive on the same connection
    if (!progress.done) {
      const last = this.progressLastAt.get(progress.transferId)
      const now = Date.now()
      if (last != null && now - last < 120 && progress.transferred > 0) return
      this.progressLastAt.set(progress.transferId, now)
    } else {
      this.progressLastAt.delete(progress.transferId)
    }
    this.getWindow()?.webContents.send('sftp:progress', progress)
  }

  cancelTransfer(transferId: string): boolean {
    const t = this.transfers.get(transferId)
    if (!t) return false
    t.cancel()
    return true
  }

  private cancelTransfersForSession(activeSessionId: string): void {
    for (const [id, t] of [...this.transfers]) {
      if (t.activeSessionId === activeSessionId) {
        t.cancel()
        this.transfers.delete(id)
      }
    }
  }

  async download(
    activeSessionId: string,
    remotePath: string,
    localPath?: string
  ): Promise<{ transferId: string; localPath: string }> {
    const live = this.getLive(activeSessionId)
    const sftp = this.ensureSftp(live)
    const win = this.getWindow()

    let dest = localPath
    if (!dest) {
      const result = await dialog.showSaveDialog(win!, {
        defaultPath: join(app.getPath('desktop'), basename(remotePath))
      })
      if (result.canceled || !result.filePath) {
        const err = new Error('CANCELLED')
        err.name = 'CancelledError'
        throw err
      }
      dest = result.filePath
    }

    return this.streamDownload(sftp, activeSessionId, remotePath, dest)
  }

  async downloadToDesktop(
    activeSessionId: string,
    remotePath: string
  ): Promise<{ transferId: string; localPath: string }> {
    const dest = join(app.getPath('desktop'), basename(remotePath))
    return this.download(activeSessionId, remotePath, dest)
  }

  /**
   * Multi-file download: one destination choice, single transfer job with 1/N progress.
   * - mode `ask` + 1 file → save dialog (same as download)
   * - mode `ask` + many → pick folder once
   * - mode `desktop` → all files to desktop (no prompts)
   */
  async downloadBatch(
    activeSessionId: string,
    remotePaths: string[],
    mode: 'ask' | 'desktop'
  ): Promise<{ transferId: string }> {
    const paths = remotePaths.filter(Boolean)
    if (paths.length === 0) throw new Error('No files to download')

    if (paths.length === 1) {
      if (mode === 'desktop') {
        const r = await this.downloadToDesktop(activeSessionId, paths[0]!)
        return { transferId: r.transferId }
      }
      const r = await this.download(activeSessionId, paths[0]!)
      return { transferId: r.transferId }
    }

    const win = this.getWindow()
    let destDir: string
    if (mode === 'desktop') {
      destDir = app.getPath('desktop')
    } else {
      const result = await dialog.showOpenDialog(win!, {
        title: 'Save downloads to…',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: app.getPath('desktop')
      })
      if (result.canceled || !result.filePaths[0]) {
        const err = new Error('CANCELLED')
        err.name = 'CancelledError'
        throw err
      }
      destDir = result.filePaths[0]
    }

    const live = this.getLive(activeSessionId)
    const sftp = this.ensureSftp(live)
    const transferId = crypto.randomUUID()
    const batchTotal = paths.length
    let batchCancelled = false
    let fileCancel: (() => void) | null = null

    this.transfers.set(transferId, {
      activeSessionId,
      cancel: () => {
        batchCancelled = true
        fileCancel?.()
      }
    })

    try {
      for (let i = 0; i < paths.length; i++) {
        if (batchCancelled) {
          this.emitProgress({
            transferId,
            activeSessionId,
            filename: basename(paths[i]!),
            direction: 'download',
            transferred: 0,
            total: 0,
            done: true,
            error: 'Cancelled',
            batchIndex: i + 1,
            batchTotal
          })
          const err = new Error('CANCELLED')
          err.name = 'CancelledError'
          throw err
        }

        const remotePath = paths[i]!
        const dest = join(destDir, basename(remotePath))
        await this.streamDownload(sftp, activeSessionId, remotePath, dest, {
          transferId,
          batchIndex: i + 1,
          batchTotal,
          ownTransferSlot: false,
          emitDoneOnComplete: false,
          onRegisterCancel: (fn) => {
            fileCancel = fn
          }
        })
        fileCancel = null

        // File finished — show N/N step (still running if more remain)
        const last = i === paths.length - 1
        this.emitProgress({
          transferId,
          activeSessionId,
          filename: basename(remotePath),
          direction: 'download',
          transferred: 1,
          total: 1,
          done: last,
          batchIndex: i + 1,
          batchTotal
        })
      }
    } catch (err) {
      const cancelled =
        batchCancelled ||
        (err instanceof Error &&
          (err.name === 'CancelledError' || /cancel/i.test(err.message || '')))
      if (!cancelled) {
        this.emitProgress({
          transferId,
          activeSessionId,
          filename: '',
          direction: 'download',
          transferred: 0,
          total: 0,
          done: true,
          error: err instanceof Error ? err.message : String(err),
          batchTotal
        })
      }
      throw err
    } finally {
      this.transfers.delete(transferId)
    }

    return { transferId }
  }

  /**
   * Stream download (single-stream) so the shared SSH connection stays usable
   * for the interactive shell, and so cancel can destroy the streams.
   */
  private async streamDownload(
    sftp: SFTPWrapper,
    activeSessionId: string,
    remotePath: string,
    dest: string,
    opts?: {
      transferId?: string
      batchIndex?: number
      batchTotal?: number
      /** When false, outer batch owns transfers map entry */
      ownTransferSlot?: boolean
      /** When false, batch emits final done after all files */
      emitDoneOnComplete?: boolean
      onRegisterCancel?: (cancel: () => void) => void
    }
  ): Promise<{ transferId: string; localPath: string }> {
    const transferId = opts?.transferId ?? crypto.randomUUID()
    const ownSlot = opts?.ownTransferSlot !== false
    const emitDone = opts?.emitDoneOnComplete !== false
    const batchIndex = opts?.batchIndex
    const batchTotal = opts?.batchTotal
    const filename = basename(remotePath)
    let total = 0
    try {
      const stats = await new Promise<{ size: number }>((resolve, reject) => {
        sftp.stat(remotePath, (err, st) => (err ? reject(err) : resolve(st)))
      })
      total = stats.size
    } catch {
      total = 0
    }

    const baseProgress = (): Pick<
      TransferProgress,
      'transferId' | 'activeSessionId' | 'filename' | 'direction' | 'batchIndex' | 'batchTotal'
    > => ({
      transferId,
      activeSessionId,
      filename,
      direction: 'download',
      batchIndex,
      batchTotal
    })

    let transferred = 0
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        let userCancelled = false
        const rs = sftp.createReadStream(remotePath, { highWaterMark: 64 * 1024 })
        const ws = createWriteStream(dest)

        const settle = (err?: Error): void => {
          if (settled) return
          settled = true
          if (ownSlot) this.transfers.delete(transferId)
          if (err) {
            try {
              unlink(dest, () => {})
            } catch {
              /* ignore */
            }
            const cancelled =
              userCancelled ||
              err.name === 'CancelledError' ||
              /cancel/i.test(err.message || '')
            this.emitProgress({
              ...baseProgress(),
              transferred,
              total,
              done: true,
              error: cancelled ? 'Cancelled' : err.message || 'Download failed'
            })
            const out = cancelled
              ? Object.assign(new Error('CANCELLED'), { name: 'CancelledError' })
              : err
            reject(out)
          } else {
            if (emitDone) {
              this.emitProgress({
                ...baseProgress(),
                transferred: total || transferred,
                total: total || transferred,
                done: true
              })
            } else {
              this.emitProgress({
                ...baseProgress(),
                transferred: total || transferred,
                total: total || transferred,
                done: false
              })
            }
            resolve()
          }
        }

        const cancelFn = (): void => {
          userCancelled = true
          try {
            rs.destroy()
          } catch {
            /* ignore */
          }
          try {
            ws.destroy()
          } catch {
            /* ignore */
          }
          const err = new Error('CANCELLED')
          err.name = 'CancelledError'
          settle(err)
        }

        if (ownSlot) {
          this.transfers.set(transferId, {
            activeSessionId,
            cancel: cancelFn
          })
        }
        opts?.onRegisterCancel?.(cancelFn)

        this.emitProgress({
          ...baseProgress(),
          transferred: 0,
          total,
          done: false
        })

        rs.on('data', (chunk: Buffer | string) => {
          transferred += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
          this.emitProgress({
            ...baseProgress(),
            transferred,
            total,
            done: false
          })
        })
        rs.on('error', (err: Error) => settle(err))
        ws.on('error', (err: Error) => settle(err))
        ws.on('finish', () => settle())
        ws.on('close', () => {
          if (!settled) {
            settle(
              userCancelled
                ? Object.assign(new Error('CANCELLED'), { name: 'CancelledError' })
                : new Error('Download interrupted')
            )
          }
        })
        rs.pipe(ws)
      })
    } catch (err) {
      if (ownSlot && this.transfers.has(transferId)) {
        this.transfers.delete(transferId)
        const cancelled =
          err instanceof Error &&
          (err.name === 'CancelledError' || /cancel/i.test(err.message || ''))
        this.emitProgress({
          ...baseProgress(),
          transferred,
          total,
          done: true,
          error: cancelled
            ? 'Cancelled'
            : err instanceof Error
              ? err.message
              : String(err)
        })
      }
      throw err
    }

    return { transferId, localPath: dest }
  }

  async upload(
    activeSessionId: string,
    localPath: string,
    remotePath: string
  ): Promise<{ transferId: string }> {
    const live = this.getLive(activeSessionId)
    const sftp = this.ensureSftp(live)
    const transferId = crypto.randomUUID()
    const filename = basename(localPath)

    let finalRemote = remotePath
    // If remotePath is a directory, append filename
    try {
      const st = await new Promise<{ mode: number }>((resolve, reject) => {
        sftp.stat(remotePath, (err, st) => (err ? reject(err) : resolve(st)))
      })
      if ((st.mode & 0o170000) === 0o040000) {
        finalRemote = `${remotePath.replace(/\/$/, '')}/${filename}`
      }
    } catch {
      if (remotePath.endsWith('/')) {
        finalRemote = `${remotePath}${filename}`
      }
    }

    let total = 0
    try {
      total = statSync(localPath).size
    } catch {
      total = 0
    }

    let transferred = 0
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let userCancelled = false
      const rs = createReadStream(localPath, { highWaterMark: 64 * 1024 })
      const ws = sftp.createWriteStream(finalRemote)

      const settle = (err?: Error): void => {
        if (settled) return
        settled = true
        this.transfers.delete(transferId)
        if (err) {
          const cancelled =
            userCancelled ||
            err.name === 'CancelledError' ||
            /cancel/i.test(err.message || '')
          this.emitProgress({
            transferId,
            activeSessionId,
            filename,
            direction: 'upload',
            transferred,
            total,
            done: true,
            error: cancelled ? 'Cancelled' : err.message || 'Upload failed'
          })
          const out = cancelled
            ? Object.assign(new Error('CANCELLED'), { name: 'CancelledError' })
            : err
          reject(out)
        } else {
          this.emitProgress({
            transferId,
            activeSessionId,
            filename,
            direction: 'upload',
            transferred: total || transferred,
            total: total || transferred,
            done: true
          })
          resolve()
        }
      }

      this.transfers.set(transferId, {
        activeSessionId,
        cancel: () => {
          // Mark first so destroy()-driven stream errors are not shown as failures
          userCancelled = true
          try {
            rs.destroy()
          } catch {
            /* ignore */
          }
          try {
            ws.destroy()
          } catch {
            /* ignore */
          }
          const err = new Error('CANCELLED')
          err.name = 'CancelledError'
          settle(err)
        }
      })

      this.emitProgress({
        transferId,
        activeSessionId,
        filename,
        direction: 'upload',
        transferred: 0,
        total,
        done: false
      })

      rs.on('data', (chunk: string | Buffer) => {
        transferred += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
        this.emitProgress({
          transferId,
          activeSessionId,
          filename,
          direction: 'upload',
          transferred,
          total,
          done: false
        })
      })
      rs.on('error', (err: Error) => settle(err))
      ws.on('error', (err: Error) => settle(err))
      // SFTP write streams typically complete on 'close'
      ws.on('close', () => {
        if (!settled) {
          settle(
            userCancelled
              ? Object.assign(new Error('CANCELLED'), { name: 'CancelledError' })
              : undefined
          )
        }
      })
      rs.pipe(ws)
    })

    return { transferId }
  }

  /** Start / stop remote metrics for all sessions based on settings */
  refreshMetricsPreference(): void {
    for (const live of this.sessions.values()) {
      if (live.info.status === 'connected') this.maybeStartMetrics(live)
    }
  }

  private maybeStartMetrics(live: LiveSession): void {
    if (live.metricsTimer) {
      clearInterval(live.metricsTimer)
      live.metricsTimer = undefined
    }
    if (!getSettings().remoteMonitoring) return
    if (live.info.status !== 'connected') return

    const poll = (): void => {
      void this.pollMetrics(live)
    }
    poll()
    live.metricsTimer = setInterval(poll, 3000)
  }

  private async pollMetrics(live: LiveSession): Promise<void> {
    if (!this.sessions.has(live.info.id) || live.info.status !== 'connected') return
    const script = [
      'hostname',
      'uptime -p 2>/dev/null || uptime',
      // CPU: 1-second sample approx via /proc/stat idle ratio (instant snapshot)
      "grep 'cpu ' /proc/stat 2>/dev/null | awk '{u=$2+$4; t=$2+$4+$5; if(t>0) printf \"%.0f%%\", u*100/t; else print \"n/a\"}'",
      // Memory
      "free -m 2>/dev/null | awk '/Mem:/{printf \"%s/%sMB (%.0f%%)\", $3,$2, $3*100/$2}'",
      // Network totals
      "cat /proc/net/dev 2>/dev/null | awk 'NR>2{rx+=$2;tx+=$10}END{printf \"%d %d\", rx,tx}'",
      // Root disk
      "df -h / 2>/dev/null | awk 'NR==2{print $5\" used of \"$2}'"
    ].join('; echo __VEXO__; ')

    try {
      const out = await this.exec(live, script)
      const parts = out.split('__VEXO__').map((s) => s.trim())
      const hostname = parts[0] || '—'
      const uptime = parts[1] || '—'
      const cpu = parts[2] || '—'
      const memory = parts[3] || '—'
      const netRaw = parts[4] || '0 0'
      const storage = parts[5] || '—'
      const [rxS, txS] = netRaw.split(/\s+/)
      const rx = Number(rxS) || 0
      const tx = Number(txS) || 0
      let network = '—'
      const now = Date.now()
      if (live.lastNet) {
        const dt = (now - live.lastNet.at) / 1000
        if (dt > 0) {
          const dr = (rx - live.lastNet.rx) / dt
          const dtb = (tx - live.lastNet.tx) / dt
          network = `↓${formatRate(dr)} ↑${formatRate(dtb)}`
        }
      }
      live.lastNet = { rx, tx, at: now }

      const metrics: RemoteMetrics = {
        activeSessionId: live.info.id,
        hostname,
        cpu,
        memory,
        network,
        uptime,
        storage
      }
      this.getWindow()?.webContents.send('ssh:metrics', metrics)
    } catch (e) {
      const metrics: RemoteMetrics = {
        activeSessionId: live.info.id,
        hostname: '—',
        cpu: '—',
        memory: '—',
        network: '—',
        uptime: '—',
        storage: '—',
        error: e instanceof Error ? e.message : String(e)
      }
      this.getWindow()?.webContents.send('ssh:metrics', metrics)
    }
  }

  private exec(live: LiveSession, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      live.client.exec(command, (err, stream) => {
        if (err) return reject(err)
        let out = ''
        stream.on('data', (d: Buffer) => {
          out += d.toString('utf8')
        })
        stream.stderr.on('data', (d: Buffer) => {
          out += d.toString('utf8')
        })
        stream.on('close', () => resolve(out.trim()))
      })
    })
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.cleanup(id)
    }
  }
}

// 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
// function filterShellIntegrationEcho(text: string): string {
//   const parts = text.split(/(\r\n|\n|\r)/)
//   let out = ''
//   for (const p of parts) {
//     if (p === '\n' || p === '\r' || p === '\r\n') {
//       out += p
//       continue
//     }
//     if (
//       /\.vexo-si-/i.test(p) ||
//       /stty\s+-echo/i.test(p) ||
//       /stty\s+echo/i.test(p) ||
//       /set\s+\+o\s+history/i.test(p) ||
//       /set\s+-o\s+history/i.test(p) ||
//       /^\s*\.\s+\/tmp\//i.test(p) ||
//       /source\s+\/tmp\/\.vexo/i.test(p)
//     ) {
//       continue
//     }
//     out += p
//   }
//   return out
// }

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)}B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)}KB/s`
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)}MB/s`
}

/** True when the failure is wrong password / auth rejected (retryable). */
function isAuthFailure(err: Error): boolean {
  const level = (err as Error & { level?: string }).level
  if (level === 'client-authentication') return true
  const msg = err.message || ''
  return (
    /all configured authentication methods failed/i.test(msg) ||
    /authentication failed/i.test(msg) ||
    /permission denied/i.test(msg) ||
    /access denied/i.test(msg) ||
    // ssh2 may emit close before the auth-failure error; treat as retryable
    /connection closed before ready/i.test(msg)
  )
}


