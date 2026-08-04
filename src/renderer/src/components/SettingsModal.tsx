import { useEffect, useMemo, useRef, useState } from 'react'
import { COLOR_SCHEMES } from '../../../shared/themes'
import type { AppSettings, ColorSchemeId, LocaleId } from '../../../shared/types'
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
  'Segoe UI',
  'D2Coding',
  'NanumGothicCoding',
  'Malgun Gothic',
  'JetBrains Mono',
  'Fira Code',
  'Source Code Pro'
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
    const onDoc = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    // capture phase so we always see outside clicks
    document.addEventListener('pointerdown', onDoc, true)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc, true)
      document.removeEventListener('keydown', onKey)
    }
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
        className={`settings-control font-picker-trigger ${open ? 'open' : ''}`}
        style={{ fontFamily: value }}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <span className="font-picker-value">{value}</span>
        <span className="font-picker-caret">▾</span>
      </button>
      {open && (
        <div
          className="font-picker-list"
          ref={listRef}
          role="listbox"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {options.map((f) => (
            <button
              key={f}
              type="button"
              role="option"
              data-active={f === value ? 'true' : 'false'}
              aria-selected={f === value}
              className={`font-picker-item ${f === value ? 'active' : ''}`}
              style={{ fontFamily: f }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
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
  const t = useSettingsStore((s) => s.t)
  const schemes = Object.values(COLOR_SCHEMES)
  const [tab, setTab] = useState<SettingsTab>('general')
  const [fonts, setFonts] = useState<string[]>(PREFERRED_FONTS)

  const [draft, setDraft] = useState<AppSettings>({
    locale: settings.locale,
    terminalFontFamily: settings.terminalFontFamily,
    terminalFontSize: settings.terminalFontSize,
    uiFontFamily: settings.uiFontFamily,
    uiFontSize: settings.uiFontSize,
    colorScheme: settings.colorScheme,
    pasteOnRightClick: settings.pasteOnRightClick,
    remoteMonitoring: settings.remoteMonitoring
  })

  useEffect(() => {
    setDraft({
      locale: settings.locale,
      terminalFontFamily: settings.terminalFontFamily,
      terminalFontSize: settings.terminalFontSize,
      uiFontFamily: settings.uiFontFamily,
      uiFontSize: settings.uiFontSize,
      colorScheme: settings.colorScheme,
      pasteOnRightClick: settings.pasteOnRightClick,
      remoteMonitoring: settings.remoteMonitoring
    })
  }, [
    settings.locale,
    settings.terminalFontFamily,
    settings.terminalFontSize,
    settings.uiFontFamily,
    settings.uiFontSize,
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
      draft.locale !== settings.locale ||
      draft.terminalFontFamily !== settings.terminalFontFamily ||
      draft.terminalFontSize !== settings.terminalFontSize ||
      draft.uiFontFamily !== settings.uiFontFamily ||
      draft.uiFontSize !== settings.uiFontSize ||
      draft.colorScheme !== settings.colorScheme ||
      draft.pasteOnRightClick !== settings.pasteOnRightClick ||
      draft.remoteMonitoring !== settings.remoteMonitoring
    )
  }, [draft, settings])

  const ensureFont = (family: string): string[] =>
    family && !fonts.includes(family) ? [family, ...fonts] : fonts

  const terminalFontOptions = ensureFont(draft.terminalFontFamily)
  const uiFontOptions = ensureFont(draft.uiFontFamily)

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

  const darkSchemes = schemes.filter((s) => !isLightScheme(s.id))
  const lightSchemes = schemes.filter((s) => isLightScheme(s.id))

  const previewT = (key: string, vars?: Record<string, string | number>): string => t(key, vars)

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{previewT('settings.title')}</h3>
          <button type="button" className="btn ghost sm" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            <button
              type="button"
              className={`settings-nav-item ${tab === 'general' ? 'active' : ''}`}
              onClick={() => setTab('general')}
            >
              {previewT('settings.general')}
            </button>
            <button
              type="button"
              className={`settings-nav-item ${tab === 'appearance' ? 'active' : ''}`}
              onClick={() => setTab('appearance')}
            >
              {previewT('settings.appearance')}
            </button>
          </nav>

          <div className="settings-content">
            {tab === 'general' && (
              <section className="settings-section">
                <h4 className="settings-section-title">{previewT('settings.general')}</h4>
                <p className="settings-section-desc">{previewT('settings.generalDesc')}</p>

                <div className="settings-field">
                  <span className="settings-label">{previewT('settings.language')}</span>
                  <select
                    className="settings-control"
                    value={draft.locale}
                    onChange={(e) => patch({ locale: e.target.value as LocaleId })}
                  >
                    <option value="en">{previewT('locale.en')}</option>
                    <option value="ko">{previewT('locale.ko')}</option>
                  </select>
                </div>

                <label className="check-row settings-check">
                  <input
                    type="checkbox"
                    checked={draft.pasteOnRightClick}
                    onChange={(e) => patch({ pasteOnRightClick: e.target.checked })}
                  />
                  <span>
                    <strong>{previewT('settings.pasteRightClick')}</strong>
                    <span className="settings-hint">{previewT('settings.pasteRightClickHint')}</span>
                  </span>
                </label>

                <label className="check-row settings-check">
                  <input
                    type="checkbox"
                    checked={draft.remoteMonitoring}
                    onChange={(e) => patch({ remoteMonitoring: e.target.checked })}
                  />
                  <span>
                    <strong>{previewT('settings.remoteMonitoring')}</strong>
                    <span className="settings-hint">
                      {previewT('settings.remoteMonitoringHint')}
                    </span>
                  </span>
                </label>
              </section>
            )}

            {tab === 'appearance' && (
              <section className="settings-section">
                <h4 className="settings-section-title">{previewT('settings.appearance')}</h4>
                <p className="settings-section-desc">{previewT('settings.appearanceDesc')}</p>

                <div className="settings-field">
                  <span className="settings-label">{previewT('settings.terminalFont')}</span>
                  <FontPicker
                    value={draft.terminalFontFamily}
                    options={terminalFontOptions}
                    onChange={(f) => patch({ terminalFontFamily: f })}
                  />
                </div>

                <div className="settings-field">
                  <span className="settings-label">
                    {previewT('settings.terminalFontSize', { size: draft.terminalFontSize })}
                  </span>
                  <input
                    className="settings-control"
                    type="range"
                    min={10}
                    max={28}
                    value={draft.terminalFontSize}
                    onChange={(e) => patch({ terminalFontSize: Number(e.target.value) })}
                  />
                </div>

                <div className="settings-field">
                  <span className="settings-label">{previewT('settings.uiFont')}</span>
                  <FontPicker
                    value={draft.uiFontFamily}
                    options={uiFontOptions}
                    onChange={(f) => patch({ uiFontFamily: f })}
                  />
                </div>

                <div className="settings-field">
                  <span className="settings-label">
                    {previewT('settings.uiFontSize', { size: draft.uiFontSize })}
                  </span>
                  <input
                    className="settings-control"
                    type="range"
                    min={11}
                    max={18}
                    value={draft.uiFontSize}
                    onChange={(e) => patch({ uiFontSize: Number(e.target.value) })}
                  />
                </div>

                <div className="settings-field">
                  <span className="settings-label">{previewT('settings.theme')}</span>
                  <select
                    className="settings-control"
                    value={draft.colorScheme}
                    onChange={(e) => patch({ colorScheme: e.target.value as ColorSchemeId })}
                  >
                    <optgroup label={previewT('settings.dark')}>
                      {darkSchemes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label={previewT('settings.light')}>
                      {lightSchemes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>

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
            {previewT('common.ok')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {previewT('common.cancel')}
          </button>
          <button type="button" className="btn" disabled={!dirty} onClick={() => void apply()}>
            {previewT('common.apply')}
          </button>
        </div>
      </div>
    </div>
  )
}
