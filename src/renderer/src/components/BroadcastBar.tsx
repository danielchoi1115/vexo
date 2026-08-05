import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'

/** SSH PTY line ending (usual) */
const LINE_END = '\r'

export function BroadcastBar(): React.JSX.Element | null {
  const t = useSettingsStore((s) => s.t)
  const activeSessions = useAppStore((s) => s.activeSessions)
  const layout = useAppStore((s) => s.layout)
  const broadcastEnabled = useAppStore((s) => s.broadcastEnabled)
  const setBroadcastEnabled = useAppStore((s) => s.setBroadcastEnabled)
  const getBroadcastTargets = useAppStore((s) => s.getBroadcastTargets)
  const broadcastWrite = useAppStore((s) => s.broadcastWrite)

  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>([])
  /** -1 = editing new line; 0..n-1 = index from newest when navigating */
  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftRef = useRef('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void window.api.broadcast.getHistory().then(setHistory)
  }, [])

  const targets = useMemo(
    () => getBroadcastTargets(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, activeSessions, getBroadcastTargets, broadcastEnabled]
  )

  if (activeSessions.length === 0) return null

  const targetNames = targets.map((s) => s.name).join(', ')
  const canSend = broadcastEnabled && targets.length > 0

  const sendRaw = (data: string): void => {
    if (!broadcastEnabled || !data) return
    if (targets.length === 0) return
    broadcastWrite(data)
  }

  const sendLine = async (): Promise<void> => {
    if (!canSend) return
    const line = value
    // Allow empty Enter to send just CR (like pressing enter in terminal)
    sendRaw(line + LINE_END)
    if (line.trim().length > 0) {
      const next = await window.api.broadcast.pushHistory(line)
      setHistory(next)
    }
    setValue('')
    setHistoryIndex(-1)
    draftRef.current = ''
  }

  const sendCtrlC = (): void => {
    if (!canSend) return
    sendRaw('\x03')
  }

  const sendCtrlD = (): void => {
    if (!canSend) return
    sendRaw('\x04')
  }

  const sendCtrlL = (): void => {
    if (!canSend) return
    sendRaw('\x0c')
  }

  const navigateHistory = (dir: 'up' | 'down'): void => {
    if (history.length === 0) return
    if (dir === 'up') {
      if (historyIndex === -1) {
        draftRef.current = value
        const idx = history.length - 1
        setHistoryIndex(idx)
        setValue(history[idx] ?? '')
      } else if (historyIndex > 0) {
        const idx = historyIndex - 1
        setHistoryIndex(idx)
        setValue(history[idx] ?? '')
      }
      return
    }
    // down
    if (historyIndex === -1) return
    if (historyIndex < history.length - 1) {
      const idx = historyIndex + 1
      setHistoryIndex(idx)
      setValue(history[idx] ?? '')
    } else {
      setHistoryIndex(-1)
      setValue(draftRef.current)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return

    if (e.key === 'Enter') {
      e.preventDefault()
      void sendLine()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      navigateHistory('up')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      navigateHistory('down')
      return
    }
  }

  return (
    <div
      className={`broadcast-bar ${broadcastEnabled ? 'broadcast-on' : 'broadcast-off'}`}
      role="region"
      aria-label={t('broadcast.title')}
    >
      {broadcastEnabled && <div className="broadcast-on-stripe" aria-hidden />}

      <div className="broadcast-bar-row">
        <label className={`broadcast-toggle ${broadcastEnabled ? 'on' : ''}`}>
          <input
            type="checkbox"
            checked={broadcastEnabled}
            onChange={(e) => {
              setBroadcastEnabled(e.target.checked)
              if (e.target.checked) {
                requestAnimationFrame(() => inputRef.current?.focus())
              }
            }}
          />
          <span className="broadcast-toggle-dot" aria-hidden />
          <span className="broadcast-toggle-label">
            {broadcastEnabled ? t('broadcast.on') : t('broadcast.off')}
          </span>
        </label>

        <div className="broadcast-targets" title={targetNames || t('broadcast.noTargets')}>
          {broadcastEnabled ? (
            targets.length > 0 ? (
              <span>
                {t('broadcast.targeting', { count: targets.length })}
                <span className="broadcast-target-names"> — {targetNames}</span>
              </span>
            ) : (
              <span className="broadcast-warn">{t('broadcast.noTargets')}</span>
            )
          ) : (
            <span className="broadcast-hint">{t('broadcast.hint')}</span>
          )}
        </div>
      </div>

      {broadcastEnabled && (
        <>
          <div className="broadcast-input-row">
            <input
              ref={inputRef}
              className="broadcast-input"
              type="text"
              value={value}
              disabled={!canSend}
              placeholder={
                targets.length === 0
                  ? t('broadcast.placeholderNoTargets')
                  : t('broadcast.placeholderOn')
              }
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setValue(e.target.value)
                if (historyIndex === -1) draftRef.current = e.target.value
              }}
              onKeyDown={onKeyDown}
            />
            <button
              type="button"
              className="btn primary broadcast-send-btn"
              disabled={!canSend}
              onClick={() => void sendLine()}
            >
              {t('broadcast.send')}
            </button>
          </div>

          <div className="broadcast-special-row">
            <span className="broadcast-special-label">{t('broadcast.special')}</span>
            <button
              type="button"
              className="btn sm broadcast-special-btn"
              disabled={!canSend}
              title="Ctrl+C"
              onClick={sendCtrlC}
            >
              Ctrl+C
            </button>
            <button
              type="button"
              className="btn sm broadcast-special-btn"
              disabled={!canSend}
              title="Ctrl+D"
              onClick={sendCtrlD}
            >
              Ctrl+D
            </button>
            <button
              type="button"
              className="btn sm broadcast-special-btn"
              disabled={!canSend}
              title="Ctrl+L"
              onClick={sendCtrlL}
            >
              Ctrl+L
            </button>
            <button
              type="button"
              className="btn sm ghost broadcast-special-btn"
              disabled={history.length === 0}
              title={t('broadcast.clearHistory')}
              onClick={() => {
                void window.api.broadcast.clearHistory().then(setHistory)
                setHistoryIndex(-1)
              }}
            >
              {t('broadcast.clearHistory')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
