import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'

/**
 * Map browser keyboard events to terminal byte sequences for broadcast.
 */
function keyToTerminalData(e: KeyboardEvent): string | null {
  if (e.nativeEvent.isComposing) return null

  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase()
    if (k.length === 1 && k >= 'a' && k <= 'z') {
      return String.fromCharCode(k.charCodeAt(0) - 96) // Ctrl+A .. Ctrl+Z
    }
    return null
  }
  if (e.altKey) return null

  switch (e.key) {
    case 'Enter':
      return '\r'
    case 'Backspace':
      return '\x7f'
    case 'Tab':
      return '\t'
    case 'Escape':
      return '\x1b'
    case 'ArrowUp':
      return '\x1b[A'
    case 'ArrowDown':
      return '\x1b[B'
    case 'ArrowRight':
      return '\x1b[C'
    case 'ArrowLeft':
      return '\x1b[D'
    case 'Home':
      return '\x1b[H'
    case 'End':
      return '\x1b[F'
    case 'Delete':
      return '\x1b[3~'
    case 'Insert':
      return '\x1b[2~'
    case 'PageUp':
      return '\x1b[5~'
    case 'PageDown':
      return '\x1b[6~'
    default:
      if (e.key.length === 1) return e.key
      return null
  }
}

export function BroadcastBar(): React.JSX.Element | null {
  const t = useSettingsStore((s) => s.t)
  const activeSessions = useAppStore((s) => s.activeSessions)
  const layout = useAppStore((s) => s.layout)
  const broadcastEnabled = useAppStore((s) => s.broadcastEnabled)
  const setBroadcastEnabled = useAppStore((s) => s.setBroadcastEnabled)
  const getBroadcastTargets = useAppStore((s) => s.getBroadcastTargets)
  const broadcastWrite = useAppStore((s) => s.broadcastWrite)

  const [value, setValue] = useState('')
  const composingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Recompute when layout / sessions change
  const targets = useMemo(
    () => getBroadcastTargets(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, activeSessions, getBroadcastTargets, broadcastEnabled]
  )

  if (activeSessions.length === 0) return null

  const targetNames = targets.map((s) => s.name).join(', ')
  const canType = broadcastEnabled && targets.length > 0

  const send = (data: string): void => {
    if (!broadcastEnabled || !data) return
    if (targets.length === 0) return
    broadcastWrite(data)
  }

  return (
    <div
      className={`broadcast-bar ${broadcastEnabled ? 'broadcast-on' : ''}`}
      role="region"
      aria-label={t('broadcast.title')}
    >
      {broadcastEnabled && <div className="broadcast-on-stripe" aria-hidden />}

      <div className="broadcast-bar-row">
        <label className={`broadcast-toggle ${broadcastEnabled ? 'on' : ''}`}>
          <input
            type="checkbox"
            checked={broadcastEnabled}
            onChange={(e) => setBroadcastEnabled(e.target.checked)}
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

      <div className="broadcast-input-row">
        <input
          ref={inputRef}
          className="broadcast-input"
          type="text"
          value={value}
          disabled={!canType}
          placeholder={
            !broadcastEnabled
              ? t('broadcast.placeholderOff')
              : targets.length === 0
                ? t('broadcast.placeholderNoTargets')
                : t('broadcast.placeholderOn')
          }
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            // Controlled for display only; keys are sent in keydown (except IME)
            if (composingRef.current) {
              setValue(e.target.value)
            }
          }}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false
            const text = e.data
            if (text && canType) {
              send(text)
              setValue((v) => v + text)
            }
          }}
          onKeyDown={(e) => {
            if (!canType) return
            if (e.nativeEvent.isComposing || composingRef.current) return

            const data = keyToTerminalData(e)
            if (data === null) return

            e.preventDefault()
            send(data)

            if (e.key === 'Enter') {
              setValue('')
              return
            }
            if (e.key === 'Backspace') {
              setValue((v) => v.slice(0, -1))
              return
            }
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              setValue((v) => v + e.key)
            }
          }}
          onPaste={(e) => {
            if (!canType) return
            e.preventDefault()
            const text = e.clipboardData.getData('text/plain')
            if (!text) return
            send(text)
            setValue((v) => v + text)
          }}
        />
      </div>
    </div>
  )
}
