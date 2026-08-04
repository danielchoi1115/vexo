import { useEffect, useMemo, useState } from 'react'
import { COLOR_SCHEMES } from '../../../shared/themes'
import type { AppSettings, ColorSchemeId, LocaleId } from '../../../shared/types'
import { useSettingsStore } from '../stores/settingsStore'
import { Select } from './Select'

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

  const fontOptions = (family: string): { value: string; label: string; style: React.CSSProperties }[] =>
    ensureFont(family).map((f) => ({
      value: f,
      label: f,
      style: { fontFamily: f }
    }))

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

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t('settings.title')}</h3>
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
              {t('settings.general')}
            </button>
            <button
              type="button"
              className={`settings-nav-item ${tab === 'appearance' ? 'active' : ''}`}
              onClick={() => setTab('appearance')}
            >
              {t('settings.appearance')}
            </button>
          </nav>

          <div className="settings-content">
            {tab === 'general' && (
              <section className="settings-section">
                <div className="settings-field">
                  <span className="settings-label">{t('settings.language')}</span>
                  <Select
                    value={draft.locale}
                    onChange={(v) => patch({ locale: v as LocaleId })}
                    options={[
                      { value: 'en', label: t('locale.en') },
                      { value: 'ko', label: t('locale.ko') }
                    ]}
                  />
                </div>

                <label className="check-row settings-check">
                  <input
                    type="checkbox"
                    checked={draft.pasteOnRightClick}
                    onChange={(e) => patch({ pasteOnRightClick: e.target.checked })}
                  />
                  <span>
                    <strong>{t('settings.pasteRightClick')}</strong>
                    <span className="settings-hint">{t('settings.pasteRightClickHint')}</span>
                  </span>
                </label>

                <label className="check-row settings-check">
                  <input
                    type="checkbox"
                    checked={draft.remoteMonitoring}
                    onChange={(e) => patch({ remoteMonitoring: e.target.checked })}
                  />
                  <span>
                    <strong>{t('settings.remoteMonitoring')}</strong>
                    <span className="settings-hint">{t('settings.remoteMonitoringHint')}</span>
                  </span>
                </label>
              </section>
            )}

            {tab === 'appearance' && (
              <section className="settings-section">
                <div className="settings-field">
                  <span className="settings-label">{t('settings.terminalFont')}</span>
                  <Select
                    value={draft.terminalFontFamily}
                    onChange={(f) => patch({ terminalFontFamily: f })}
                    options={fontOptions(draft.terminalFontFamily)}
                    triggerStyle={{ fontFamily: draft.terminalFontFamily }}
                  />
                </div>

                <div className="settings-field">
                  <span className="settings-label">
                    {t('settings.terminalFontSize', { size: draft.terminalFontSize })}
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
                  <span className="settings-label">{t('settings.uiFont')}</span>
                  <Select
                    value={draft.uiFontFamily}
                    onChange={(f) => patch({ uiFontFamily: f })}
                    options={fontOptions(draft.uiFontFamily)}
                    triggerStyle={{ fontFamily: draft.uiFontFamily }}
                  />
                </div>

                <div className="settings-field">
                  <span className="settings-label">
                    {t('settings.uiFontSize', { size: draft.uiFontSize })}
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
                  <span className="settings-label">{t('settings.theme')}</span>
                  <Select
                    value={draft.colorScheme}
                    onChange={(v) => patch({ colorScheme: v as ColorSchemeId })}
                    groups={[
                      {
                        label: t('settings.dark'),
                        options: darkSchemes.map((s) => ({ value: s.id, label: s.name }))
                      },
                      {
                        label: t('settings.light'),
                        options: lightSchemes.map((s) => ({ value: s.id, label: s.name }))
                      }
                    ]}
                    options={[]}
                  />
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
            {t('common.ok')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn" disabled={!dirty} onClick={() => void apply()}>
            {t('common.apply')}
          </button>
        </div>
      </div>
    </div>
  )
}
