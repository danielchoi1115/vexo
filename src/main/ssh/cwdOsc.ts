/**
 * Shell-integration CWD extraction from OSC sequences.
 *
 * 2026-08-13: 터미널 폴더 따라가기 비활성화 (사용자 요청)
 *
 * Priority (first match wins per complete OSC):
 *  1. OSC 633 ; P ; Cwd=<path>     — VS Code / Electerm
 *  2. OSC 7 ; file://…             — standard
 *  3. OSC 1337 ; CurrentDir=<path> — iTerm2
 *
 * BEL (\x07) or ST (ESC \) terminate OSC.
 */

const BEL = '\x07'
const ESC = '\x1b'

export interface OscCwdHit {
  path: string
  /** Which sequence produced the path */
  source: 'osc633' | 'osc7' | 'osc1337'
}

/**
 * Scan a rolling buffer for complete OSC sequences that carry CWD.
 * Returns every valid path in order (caller usually uses the last).
 * Incomplete trailing OSC is left in the returned remainder.
 */
export function extractCwdsFromOscBuffer(buf: string): {
  hits: OscCwdHit[]
  remainder: string
} {
  const hits: OscCwdHit[] = []
  let i = 0
  let keepFrom = 0

  while (i < buf.length) {
    // Find ESC ]
    const esc = buf.indexOf(ESC + ']', i)
    if (esc < 0) break

    const bodyStart = esc + 2
    // Find terminator BEL or ST (ESC \)
    let term = -1
    let termLen = 0
    for (let j = bodyStart; j < buf.length; j++) {
      if (buf[j] === BEL) {
        term = j
        termLen = 1
        break
      }
      if (buf[j] === ESC && buf[j + 1] === '\\') {
        term = j
        termLen = 2
        break
      }
      // Cap single OSC body length to avoid unbounded scan
      if (j - bodyStart > 8192) {
        term = j
        termLen = 0
        break
      }
    }

    if (term < 0) {
      // Incomplete OSC — keep from this ESC for next chunk
      keepFrom = esc
      return { hits, remainder: buf.slice(keepFrom) }
    }

    if (termLen === 0) {
      // Aborted oversized OSC — skip past ESC
      i = esc + 1
      keepFrom = i
      continue
    }

    const body = buf.slice(bodyStart, term)
    const hit = parseOscBody(body)
    if (hit) hits.push(hit)

    i = term + termLen
    keepFrom = i
  }

  // Drop consumed prefix; keep a small tail in case ESC is split across chunks
  // (if no open ESC, remainder can be empty / last few bytes)
  let remainder = buf.slice(keepFrom)
  if (remainder.length > 64) {
    // Keep only possible partial ESC at end
    const partial = remainder.lastIndexOf(ESC)
    remainder = partial >= 0 ? remainder.slice(partial) : ''
  }
  return { hits, remainder }
}

function parseOscBody(body: string): OscCwdHit | null {
  // OSC 633 ; P ; Cwd=<path>   (also allow Ps-style "633;P;Cwd=…")
  if (body.startsWith('633;')) {
    const rest = body.slice(4)
    // Property form: P;Cwd=path  or  P;Cwd=path;…
    // Some emitters: 633;P;Cwd=%2Fhome%2F…
    const parts = rest.split(';')
    for (const part of parts) {
      const m = /^Cwd=(.*)$/i.exec(part)
      if (m) {
        const path = decodePathCandidate(m[1] ?? '')
        if (path) return { path, source: 'osc633' }
      }
      // Single segment "P;Cwd=..." already split — handle "P" then next is Cwd=
    }
    // VS Code also uses: 633;P;Cwd=<path> as one body after 633;
    const m2 = /(?:^|;)P;Cwd=([^;]*)/i.exec(rest)
    if (m2) {
      const path = decodePathCandidate(m2[1] ?? '')
      if (path) return { path, source: 'osc633' }
    }
    return null
  }

  // OSC 7 ; file://host/path
  if (body.startsWith('7;')) {
    const payload = body.slice(2)
    const path = parseOsc7Payload(payload)
    if (path) return { path, source: 'osc7' }
    return null
  }

  // OSC 1337 ; CurrentDir=path  (may include other key=value pairs)
  if (body.startsWith('1337;')) {
    const rest = body.slice(5)
    const m = /(?:^|;)CurrentDir=([^;\x07]*)/i.exec(rest)
    if (m) {
      const path = decodePathCandidate(m[1] ?? '')
      if (path) return { path, source: 'osc1337' }
    }
    return null
  }

  return null
}

function parseOsc7Payload(payload: string): string | null {
  const raw = payload.trim()
  if (!raw) return null

  // file://hostname/path or file:///path
  if (/^file:/i.test(raw)) {
    try {
      // URL parser needs a base for odd forms; normalize file://
      let urlStr = raw
      // file://localhost/home → ok; file:///home → ok; file://hostname/home → ok
      const u = new URL(urlStr)
      if (u.protocol !== 'file:') return null
      // Reject obviously wrong schemes already handled
      let path = decodeURIComponent(u.pathname || '')
      // Windows file URL: /C:/Users → strip leading slash before drive
      if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1)
      // file://host/path → pathname is /path; host is separate (multi-hop: accept any host)
      if (!path) return null
      return sanitizeRemotePath(path)
    } catch {
      // Fallback: file://host/path manual parse
      const m = /^file:\/\/([^/]*)(\/.*)$/i.exec(raw)
      if (!m) return null
      try {
        const path = decodeURIComponent(m[2] ?? '')
        return sanitizeRemotePath(path)
      } catch {
        return null
      }
    }
  }

  // Bare absolute path (some emitters omit file://)
  return sanitizeRemotePath(raw)
}

function decodePathCandidate(s: string): string | null {
  let v = s.trim()
  if (!v) return null
  // Strip surrounding quotes
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1)
  }
  try {
    // Percent-encoding (VS Code sometimes encodes)
    if (/%[0-9A-Fa-f]{2}/.test(v)) {
      v = decodeURIComponent(v)
    }
  } catch {
    /* keep raw */
  }
  // file:// form inside Cwd=
  if (/^file:/i.test(v)) {
    return parseOsc7Payload(v)
  }
  return sanitizeRemotePath(v)
}

/**
 * Normalize and reject abnormal paths.
 * Accepts Unix absolute paths; converts to collapsed form.
 */
export function sanitizeRemotePath(p: string): string | null {
  if (!p) return null
  // Control chars / NUL
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(p)) return null
  let s = p.replace(/\\/g, '/').trim()
  if (!s) return null

  // Windows drive paths kept as-is for local; SFTP remote is usually Unix
  const isWin = /^[A-Za-z]:\//.test(s)
  if (!s.startsWith('/') && !isWin) return null

  // Collapse . / .. and duplicate slashes
  const parts = s.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    // Reject path segments that look like injection garbage
    if (part.includes('\0')) return null
    out.push(part)
  }

  if (isWin) {
    // First segment is drive letter
    if (out.length === 0) return null
    return out[0] + '/' + out.slice(1).join('/')
  }

  const normalized = '/' + out.join('/')
  // Extremely long paths — ignore
  if (normalized.length > 4096) return null
  return normalized
}
