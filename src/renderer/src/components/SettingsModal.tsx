import { useEffect, useMemo, useRef, useState } from 'react'
import { COLOR_SCHEMES } from '../../../shared/themes'
import type { AppSettings, ColorSchemeId } from '../../../shared/types'
import { useSettingsStore } from '../stores/settingsStore'

interface Props {
  onClose: () => void
}

type SettingsTab = 'general' | 'appearance'

const PREFERRED_FONTS = [
  'Consolas',
  'Cascadia Code',
  'Cascadia Mono',
  'Courier New',
  'Lucida Console',
  'Segoe UI Mono',
  'D2Coding',
  'NanumGothicCoding',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro'
]

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' }
]

function isLightScheme(id: string): boolean {
  return id.includes('light') || id === 'paper' || id === 'catppuccin-latte'
}

function FontPicker({
  value,
  options,
  onChange
}: {
  value: string
  options: string[]
  onChange: (font: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open || !listRef.current) return
    const active = listRef.current.querySelector('[data-active="true"]') as HTMLElement | null
    active?.scrollIntoView({ block: 'nearest' })
  }, [open, value])

  return (
    <div className="font-picker" ref={rootRef}>
      <button
        type="button"
        className="settings-control font-picker-trigger"
        style={{ fontFamily: value }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="font-picker-value">{value}</span>
        <span className="font-picker-caret">▾</span>
      </button>
      {open && (
        <div className="font-picker-list" ref={listRef} role="listbox">
          {options.map((f) => (
            <button
              key={f}
              type="button"
              role="option"
              data-active={f === value ? 'true' : 'false'}
              className={`font-picker-item ${f === value ? 'active' : ''}`}
              style={{ fontFamily: f }}
              onClick={() => {
                onChange(f)
                setOpen(false)
              }}
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function SettingsModal({ onClose }: Props): React.JSX.Element {
  const settings = useSettingsStore()
  const schemes = Object.values(COLOR_SCHEMES)
  const [tab, setTab] = useState<SettingsTab>('appearance')
  const [fonts, setFonts] = useState<string[]>(PREFERRED_FONTS)

  // Draft — changes apply only on Apply / OK
  const [draft, setDraft] = useState<AppSettings>({
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    colorScheme: settings.colorScheme,
    pasteOnRightClick: settings.pasteOnRightClick,
    remoteMonitoring: settings.remoteMonitoring
  })

  useEffect(() => {
    setDraft({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      colorScheme: settings.colorScheme,
      pasteOnRightClick: settings.pasteOnRightClick,
      remoteMonitoring: settings.remoteMonitoring
    })
  }, [
    settings.fontFamily,
    settings.fontSize,
    settings.colorScheme,
    settings.pasteOnRightClick,
    settings.remoteMonitoring
  ])

  useEffect(() => {
    void window.api.settings.listFonts().then((list) => {
      if (list.length === 0) return
      const preferred = PREFERRED_FONTS.filter((f) =>
        list.some((x) => x.toLowerCase() === f.toLowerCase())
      )
      const preferredSet = new Set(preferred.map((f) => f.toLowerCase()))
      const rest = list.filter((f) => !preferredSet.has(f.toLowerCase()))
      setFonts([...preferred, ...rest])
    })
  }, [])

  const dirty = useMemo(() => {
    return (
      draft.fontFamily !== settings.fontFamily ||
      draft.fontSize !== settings.fontSize ||
      draft.colorScheme !== settings.colorScheme ||
      draft.pasteOnRightClick !== settings.pasteOnRightClick ||
      draft.remoteMonitoring !== settings.remoteMonitoring
    )
  }, [draft, settings])

  const fontOptions =
    draft.fontFamily && !fonts.includes(draft.fontFamily)
      ? [draft.fontFamily, ...fonts]
      : fonts

  const patch = (partial: Partial<AppSettings>): void => {
    setDraft((d) => ({ ...d, ...partial }))
  }

  const apply = async (): Promise<void> => {
    await settings.update(draft)
  }

  const onOk = async (): Promise<void> => {
    await apply()
    onClose()
  }

  const onCancel = (): void => {
    onClose()
  }

  const darkSchemes = schemes.filter((s) => !isLightScheme(s.id))
  const lightSchemes = schemes.filter((s) => isLightScheme(s.id))

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings</h3>
          <button type="button" className="btn ghost sm" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`settings-nav-item ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {tab === 'general' && (
              <section className="settings-section">
                <h4 className="settings-section-title">General</h4>
                <p className="settings-section-desc">Application behavior and remote tools.</p>

                <label className="check-row settings-check">
                  <input
                    type="checkbox"
                    checked={draft.pasteOnRightClick}
                    onChange={(e) => patch({ pasteOnRightClick: e.target.checked })}
                  />
                  <span>
                    <strong>Paste using right-click</strong>
                    <span className="settings-hint">Paste clipboard text into the terminal</span>
                  </span>
                </label>

                <label className="check-row settings-check">
                  <input
                    type="checkbox"
                    checked={draft.remoteMonitoring}
                    onChange={(e) => patch({ remoteMonitoring: e.target.checked })}
                  />
                  <span>
                    <strong>Remote monitoring</strong>
                    <span className="settings-hint">
                      Show hostname, CPU, memory, network, uptime, storage
                    </span>
                  </span>
                </label>
              </section>
            )}

            {tab === 'appearance' && (
              <section className="settings-section">
                <h4 className="settings-section-title">Appearance</h4>
                <p className="settings-section-desc">Terminal font and UI theme.</p>

                <label className="settings-field">
                  <span className="settings-label">Font Family</span>
                  <FontPicker
                    value={draft.fontFamily}
                    options={fontOptions}
                    onChange={(f) => patch({ fontFamily: f })}
                  />
                </label>

                <label className="settings-field">
                  <span className="settings-label">Font Size ({draft.fontSize}px)</span>
                  <input
                    className="settings-control"
                    type="range"
                    min={10}
                    max={28}
                    value={draft.fontSize}
                    onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                  />
                </label>

                <label className="settings-field">
                  <span className="settings-label">Theme</span>
                  <select
                    className="settings-control"
                    value={draft.colorScheme}
                    onChange={(e) => patch({ colorScheme: e.target.value as ColorSchemeId })}
                  >
                    <optgroup label="Dark">
                      {darkSchemes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Light">
                      {lightSchemes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>

                <div className="scheme-preview">
                  {schemes.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`scheme-swatch ${draft.colorScheme === s.id ? 'active' : ''}`}
                      style={{
                        background: s.background,
                        borderColor: s.uiBorder,
                        color: s.foreground
                      }}
                      title={s.name}
                      onClick={() => patch({ colorScheme: s.id })}
                    >
                      <span style={{ color: s.red }}>A</span>
                      <span style={{ color: s.green }}>A</span>
                      <span style={{ color: s.blue }}>A</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="form-actions settings-actions">
          <button type="button" className="btn primary" onClick={() => void onOk()}>
            OK
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={!dirty}
            onClick={() => void apply()}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
