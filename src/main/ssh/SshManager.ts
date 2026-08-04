import { Client, type ConnectConfig, type SFTPWrapper, type ClientChannel } from 'ssh2'
import { readFileSync } from 'fs'
import { basename, join } from 'path'
import { BrowserWindow, dialog } from 'electron'
import type {
  ActiveSessionInfo,
  ConnectOptions,
  ConnectionStatus,
  SftpEntry,
  TransferProgress
} from '../../shared/types'
import { getSecret } from '../credentialStore'
import { getSession, touchLastConnected } from '../sessionStore'
import { DataBatcher } from './DataBatcher'

interface LiveSession {
  info: ActiveSessionInfo
  client: Client
  stream?: ClientChannel
  sftp?: SFTPWrapper
  batcher: DataBatcher
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

  async connect(options: ConnectOptions): Promise<ActiveSessionInfo> {
    const config = getSession(options.sessionConfigId)
    if (!config) throw new Error('Session not found')

    const activeId = crypto.randomUUID()
    const client = new Client()

    const batcher = new DataBatcher(BATCH_MS, (buf) => {
      const win = this.getWindow()
      if (!win) return
      // base64 avoids binary corruption across IPC
      win.webContents.send('ssh:data', activeId, buf.toString('base64'))
    })

    const live: LiveSession = {
      info: {
        id: activeId,
        sessionConfigId: config.id,
        name: config.name,
        status: 'connecting'
      },
      client,
      batcher
    }
    this.sessions.set(activeId, live)
    this.emitStatus(live.info)

    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 20000,
      // agent support when available
      ...(config.authMethod === 'agent'
        ? { agent: process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? 'pageant' : undefined) }
        : {})
    }

    if (config.authMethod === 'password') {
      const password = options.password ?? getSecret(config.id)
      if (!password) {
        this.cleanup(activeId)
        throw new Error('Password required')
      }
      connectConfig.password = password
    } else if (config.authMethod === 'privateKey') {
      if (!config.privateKeyPath) {
        this.cleanup(activeId)
        throw new Error('Private key path required')
      }
      try {
        connectConfig.privateKey = readFileSync(config.privateKeyPath)
      } catch {
        this.cleanup(activeId)
        throw new Error(`Cannot read private key: ${config.privateKeyPath}`)
      }
      const passphrase = options.passphrase ?? getSecret(`${config.id}:passphrase`)
      if (passphrase) connectConfig.passphrase = passphrase
    }

    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        cleanupListeners()
        resolve()
      }
      const onError = (err: Error): void => {
        cleanupListeners()
        reject(err)
      }
      const cleanupListeners = (): void => {
        client.off('ready', onReady)
        client.off('error', onError)
      }
      client.once('ready', onReady)
      client.once('error', onError)
      client.connect(connectConfig)
    }).catch((err: Error) => {
      this.cleanup(activeId)
      throw err
    })

    // shell channel
    const stream = await new Promise<ClientChannel>((resolve, reject) => {
      client.shell({ term: 'xterm-256color' }, (err, s) => {
        if (err) reject(err)
        else resolve(s)
      })
    }).catch((err: Error) => {
      this.cleanup(activeId)
      throw err
    })

    live.stream = stream
    stream.on('data', (data: Buffer) => batcher.push(data))
    stream.stderr?.on('data', (data: Buffer) => batcher.push(data))
    stream.on('close', () => {
      batcher.dispose()
      this.setStatus(live, 'disconnected')
      this.cleanup(activeId, false)
    })

    client.on('error', (err) => {
      this.setStatus(live, 'error', err.message)
    })
    client.on('close', () => {
      if (this.sessions.has(activeId)) {
        this.setStatus(live, 'disconnected')
        this.cleanup(activeId, false)
      }
    })

    // Open SFTP on the same connection (no re-auth)
    try {
      live.sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((err, sftp) => {
          if (err) reject(err)
          else resolve(sftp)
        })
      })
    } catch {
      // SFTP optional for terminal-only use
    }

    touchLastConnected(config.id)
    this.setStatus(live, 'connected')
    return { ...live.info }
  }

  write(activeSessionId: string, data: string): void {
    const live = this.sessions.get(activeSessionId)
    if (!live?.stream || live.info.status !== 'connected') return
    live.stream.write(data)
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

  async listDir(activeSessionId: string, remotePath: string): Promise<SftpEntry[]> {
    const live = this.getLive(activeSessionId)
    const sftp = this.ensureSftp(live)
    const list = await new Promise<import('ssh2').FileEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) reject(err)
        else resolve(list)
      })
    })

    return list
      .map((item) => {
        const attrs = item.attrs
        // S_IFMT bits (same as node fs.constants)
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
        const rights = {
          user: ((mode >> 6) & 7).toString(),
          group: ((mode >> 3) & 7).toString(),
          other: (mode & 7).toString()
        }

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
          rights,
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
        defaultPath: basename(remotePath)
      })
      if (result.canceled || !result.filePath) throw new Error('Save cancelled')
      dest = result.filePath
    }

    const transferId = crypto.randomUUID()
    const filename = basename(remotePath)

    // size for progress
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
        dest!,
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
    const remoteFile = remotePath.endsWith('/')
      ? join(remotePath, filename).replace(/\\/g, '/')
      : remotePath

    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(
        localPath,
        remoteFile,
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

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.cleanup(id)
    }
  }
}
