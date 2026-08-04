/**
 * Batches outbound terminal data and flushes on a short interval (~1 frame)
 * to avoid Electron IPC structural-clone overhead on every ssh2 data chunk.
 */
export class DataBatcher {
  private chunks: Buffer[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(
    private readonly flushIntervalMs: number,
    private readonly onFlush: (data: Buffer) => void
  ) {}

  push(data: Buffer | string): void {
    if (this.closed) return
    this.chunks.push(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs)
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.chunks.length === 0) return
    const combined = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks)
    this.chunks = []
    this.onFlush(combined)
  }

  dispose(): void {
    this.closed = true
    this.flush()
  }
}
