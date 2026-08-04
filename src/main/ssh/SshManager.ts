import { Client, type ConnectConfig, type SFTPWrapper, type ClientChannel } from 'ssh2'
import { readFileSync, mkdirSync, existsSync } from 'fs'
import { basename, join } from 'path'
import { app, BrowserWindow, dialog } from 'electron'
import type {
  ActiveSessionInfo,
  ConnectOptions,
  ConnectionStatus,
  RemoteMetrics,
  SftpEntry,
  TransferProgress
} from '../../shared/types'
import { getSecret } from '../credentialStore'
import { getSession, touchLastConnected } from '../sessionStore'
import { getSettings } from '../settingsStore'
import { DataBatcher } from './DataBatcher'

/** Collect a line of auth input from the terminal before shell is ready. */
class AuthInput {
  private buffer = ''
  private resolve: ((line: string) => void) | null = null
  private echo = true

  get active(): boolean {
    return this.resolve !== null
  }

  ask(prompt: string, echo: boolean, write: (s: string) => void): Promise<string> {
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
        r(line)
        return true
      }
      if (ch === '\x7f' || ch === '\b') {
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1)
          if (this.echo) write('\b \b')
        }
        continue
      }
      if (ch === '\x03') {
        write('^C\r\n')
        const r = this.resolve
        this.resolve = null
        this.buffer = ''
        r('')
        return true
      }
      if (ch >= ' ' || ch === '\t') {
        this.buffer += ch
        write(this.echo ? ch : '*')
      }
    }
    return true
  }
}

interface LiveSession {
  info: ActiveSessionInfo
  client: Client
  stream?: ClientChannel
  sftp?: SFTPWrapper
  batcher: DataBatcher
  auth: AuthInput
  backspaceSendsCtrlH: boolean
  /** Raw stream buffer for OSC 7 cwd parsing */
  oscBuf: string
  metricsTimer?: ReturnType<typeof setInterval>
  lastNet?: { rx: number; tx: number; at: number }
}

const BATCH_MS = 12
const OSC7_RE = /\x1b\]7;([^\x07\x1b]*)(?:\x07|\x1b\\)/g

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
    live.batcher.push(Buffer.from(text, 'utf8'))
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

    const batcher = new DataBatcher(BATCH_MS, (buf) => {
      const win = this.getWindow()
      if (!win) return
      win.webContents.send('ssh:data', activeId, buf.toString('base64'))
    })

    const backspaceSendsCtrlH = config.backspaceSendsCtrlH !== false
    const live: LiveSession = {
      info: {
        id: activeId,
        sessionConfigId: config.id,
        name: config.name,
        status: 'connecting',
        backspaceSendsCtrlH
      },
      client,
      batcher,
      auth,
      backspaceSendsCtrlH,
      oscBuf: ''
    }
    this.sessions.set(activeId, live)
    this.emitStatus(live.info)

    void this.runConnect(live, options).catch((err: Error) => {
      this.termWrite(live, `\r\n\x1b[31mConnection failed: ${err.message}\x1b[0m\r\n`)
      this.setStatus(live, 'error', err.message)
      this.cleanup(activeId, true)
    })

    return { ...live.info }
  }

  private async runConnect(live: LiveSession, options: ConnectOptions): Promise<void> {
    const config = getSession(options.sessionConfigId)
    if (!config) throw new Error('Session not found')

    const write = (s: string): void => this.termWrite(live, s)
    write(`\x1b[90mConnecting to ${config.host}:${config.port}…\x1b[0m\r\n`)

    let username = (config.username || '').trim()
    if (!username) {
      username = (await live.auth.ask('login as: ', true, write)).trim()
      if (!username) throw new Error('Username is required')
    }

    const connectConfig: ConnectConfig & { compress?: boolean } = {
      host: config.host,
      port: config.port,
      username,
      readyTimeout: 30000,
      tryKeyboard: true,
      compress: config.compression !== false,
      ...(config.x11Forwarding !== false ? { x11: true } : {}),
      ...(config.authMethod === 'agent'
        ? {
            agent:
              process.env.SSH_AUTH_SOCK ||
              (process.platform === 'win32' ? 'pageant' : undefined)
          }
        : {})
    }

    if (config.authMethod === 'password') {
      let password = options.password ?? getSecret(config.id) ?? ''
      if (!password) {
        password = await live.auth.ask(`${username}@${config.host}'s password: `, false, write)
      }
      if (password) connectConfig.password = password
    } else if (config.authMethod === 'privateKey') {
      if (!config.privateKeyPath) throw new Error('Private key path required')
      try {
        connectConfig.privateKey = readFileSync(config.privateKeyPath)
      } catch {
        throw new Error(`Cannot read private key: ${config.privateKeyPath}`)
      }
      const passphrase = options.passphrase ?? getSecret(`${config.id}:passphrase`)
      if (passphrase) connectConfig.passphrase = passphrase
    }

    const client = live.client

    client.on('keyboard-interactive', (name, instructions, _lang, prompts, finish) => {
      void (async () => {
        if (name) write(`${name}\r\n`)
        if (instructions) write(`${instructions}\r\n`)
        const answers: string[] = []
        for (const p of prompts) {
          const echo = p.echo !== false
          const ans = await live.auth.ask(p.prompt, echo, write)
          answers.push(ans)
        }
        finish(answers)
      })()
    })

    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        cleanup()
        resolve()
      }
      const onError = (err: Error): void => {
        cleanup()
        reject(err)
      }
      const cleanup = (): void => {
        client.off('ready', onReady)
        client.off('error', onError)
      }
      client.once('ready', onReady)
      client.once('error', onError)
      client.connect(connectConfig)
    })

    write('\x1b[90mAuthenticated. Opening shell…\x1b[0m\r\n')

    const stream = await new Promise<ClientChannel>((resolve, reject) => {
      client.shell({ term: 'xterm-256color' }, (err, s) => {
        if (err) reject(err)
        else resolve(s)
      })
    })

    live.stream = stream
    stream.on('data', (data: Buffer) => this.onStreamData(live, data))
    stream.stderr?.on('data', (data: Buffer) => this.onStreamData(live, data))
    stream.on('close', () => {
      live.batcher.dispose()
      this.setStatus(live, 'disconnected')
      this.cleanup(live.info.id, false)
    })

    client.on('error', (err) => {
      this.setStatus(live, 'error', err.message)
    })
    client.on('close', () => {
      if (this.sessions.has(live.info.id)) {
        this.setStatus(live, 'disconnected')
        this.cleanup(live.info.id, false)
      }
    })

    try {
      live.sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)))
      })
    } catch {
      /* SFTP optional */
    }

    // Enable OSC 7 cwd reporting for follow-folder (best-effort)
    stream.write(
      `export PROMPT_COMMAND='printf "\\033]7;%s\\007" "$(pwd)"; '"\${PROMPT_COMMAND:-}"\n` +
        `printf "\\033]7;%s\\007" "$(pwd)"\n`
    )

    touchLastConnected(config.id)
    this.setStatus(live, 'connected')
    this.maybeStartMetrics(live)
  }

  private onStreamData(live: LiveSession, data: Buffer): void {
    // Parse OSC 7 for remote cwd without fully stripping (xterm ignores unknown OSC mostly)
    live.oscBuf += data.toString('utf8')
    if (live.oscBuf.length > 8192) live.oscBuf = live.oscBuf.slice(-4096)

    let match: RegExpExecArray | null
    OSC7_RE.lastIndex = 0
    while ((match = OSC7_RE.exec(live.oscBuf)) !== null) {
      const raw = match[1]
      // formats: file://host/path  or just /path
      let cwd = raw
      try {
        if (raw.startsWith('file://')) {
          const u = new URL(raw)
          cwd = decodeURIComponent(u.pathname)
          // Windows-style path from URL may start with /C:/
          if (/^\/[A-Za-z]:\//.test(cwd)) cwd = cwd.slice(1)
        }
      } catch {
        /* keep raw */
      }
      if (cwd && cwd !== live.info.remoteCwd) {
        live.info = { ...live.info, remoteCwd: cwd }
        this.getWindow()?.webContents.send('ssh:cwd', live.info.id, cwd)
      }
    }
    // trim processed portion loosely
    const last = live.oscBuf.lastIndexOf('\x1b]7;')
    if (last > 0) live.oscBuf = live.oscBuf.slice(last)

    live.batcher.push(data)
  }

  write(activeSessionId: string, data: string): void {
    const live = this.sessions.get(activeSessionId)
    if (!live) return
    if (live.auth.active) {
      live.auth.feed(data, (s) => this.termWrite(live, s))
      return
    }
    if (!live.stream || live.info.status === 'error') return
    if (live.info.status === 'connecting' && !live.stream) {
      live.auth.feed(data, (s) => this.termWrite(live, s))
      return
    }
    let payload = data
    if (live.backspaceSendsCtrlH) {
      // Map DEL (0x7f) → BS (^H, 0x08) for hosts that expect it
      payload = payload.replace(/\x7f/g, '\x08')
    }
    live.stream?.write(payload)
  }

  resize(activeSessionId: string, cols: number, rows: number): void {
    const live = this.sessions.get(activeSessionId)
    if (!live?.stream || live.info.status !== 'connected') return
    live.stream.setWindow(rows, cols, 0, 0)
  }

  async disconnect(activeSessionId: string): Promise<void> {
    this.cleanup(activeSessionId)
  }

  private cleanup(activeSessionId: string, endClient = true): void {
    const live = this.sessions.get(activeSessionId)
    if (!live) return
    if (live.metricsTimer) clearInterval(live.metricsTimer)
    live.batcher.dispose()
    try {
      live.stream?.close()
    } catch {
      /* ignore */
    }
    if (endClient) {
      try {
        live.client.end()
      } catch {
        /* ignore */
      }
    }
    this.sessions.delete(activeSessionId)
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

  private emitProgress(progress: TransferProgress): void {
    this.getWindow()?.webContents.send('sftp:progress', progress)
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
      if (result.canceled || !result.filePath) throw new Error('Save cancelled')
      dest = result.filePath
    }

    return this.fastGet(sftp, activeSessionId, remotePath, dest)
  }

  async downloadToDesktop(
    activeSessionId: string,
    remotePath: string
  ): Promise<{ transferId: string; localPath: string }> {
    const dest = join(app.getPath('desktop'), basename(remotePath))
    return this.download(activeSessionId, remotePath, dest)
  }

  /** Download to temp for native drag-out */
  async downloadToTemp(
    activeSessionId: string,
    remotePath: string
  ): Promise<{ transferId: string; localPath: string }> {
    const dir = join(app.getPath('temp'), 'vexo-drag')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const dest = join(dir, basename(remotePath))
    return this.download(activeSessionId, remotePath, dest)
  }

  private async fastGet(
    sftp: SFTPWrapper,
    activeSessionId: string,
    remotePath: string,
    dest: string
  ): Promise<{ transferId: string; localPath: string }> {
    const transferId = crypto.randomUUID()
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

    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(
        remotePath,
        dest,
        {
          step: (transferred: number, _chunk: number, t: number) => {
            this.emitProgress({
              transferId,
              activeSessionId,
              filename,
              direction: 'download',
              transferred,
              total: t || total,
              done: false
            })
          }
        },
        (err) => {
          if (err) {
            this.emitProgress({
              transferId,
              activeSessionId,
              filename,
              direction: 'download',
              transferred: 0,
              total,
              done: true,
              error: err.message
            })
            reject(err)
          } else {
            this.emitProgress({
              transferId,
              activeSessionId,
              filename,
              direction: 'download',
              transferred: total,
              total,
              done: true
            })
            resolve()
          }
        }
      )
    })

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

    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(
        localPath,
        finalRemote,
        {
          step: (transferred: number, _chunk: number, total: number) => {
            this.emitProgress({
              transferId,
              activeSessionId,
              filename,
              direction: 'upload',
              transferred,
              total,
              done: false
            })
          }
        },
        (err) => {
          if (err) {
            this.emitProgress({
              transferId,
              activeSessionId,
              filename,
              direction: 'upload',
              transferred: 0,
              total: 0,
              done: true,
              error: err.message
            })
            reject(err)
          } else {
            this.emitProgress({
              transferId,
              activeSessionId,
              filename,
              direction: 'upload',
              transferred: 1,
              total: 1,
              done: true
            })
            resolve()
          }
        }
      )
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

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)}B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)}KB/s`
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)}MB/s`
}
