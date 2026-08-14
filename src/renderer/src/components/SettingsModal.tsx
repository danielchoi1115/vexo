import { useEffect, useMemo, useState } from 'react'
import { COLOR_SCHEMES, DEFAULT_SETTINGS } from '../../../shared/themes'
import type {
  AppSettings,
  BellStyle,
  ColorSchemeId,
  CursorStyle,
  HostKeyPolicy,
  LocaleId,
  TermType,
  TerminalEncoding
} from '../../../shared/types'
import { useDraggableModal } from '../hooks/useDraggableModal'
import { useSettingsStore } from '../stores/settingsStore'
import { applyTerminalSettingsToAll } from '../terminal/terminalCache'
import { AboutModal } from './AboutModal'
import { Select } from './Select'

function pickSettings(s: AppSettings): AppSettings {
  return {
    locale: s.locale,
    terminalFontFamily: s.terminalFontFamily,
    terminalFontSize: s.terminalFontSize,
    uiFontFamily: s.uiFontFamily,
    uiFontSize: s.uiFontSize,
    colorScheme: s.colorScheme,
    pasteOnRightClick: s.pasteOnRightClick,
    remoteMonitoring: s.remoteMonitoring,
    copyOnSelect: s.copyOnSelect,
    keepAliveIntervalSec: s.keepAliveIntervalSec ?? DEFAULT_SETTINGS.keepAliveIntervalSec,
    scrollback: s.scrollback ?? DEFAULT_SETTINGS.scrollback,
    cursorStyle: s.cursorStyle ?? DEFAULT_SETTINGS.cursorStyle,
    cursorBlink: s.cursorBlink ?? DEFAULT_SETTINGS.cursorBlink,
    bellStyle: s.bellStyle ?? DEFAULT_SETTINGS.bellStyle,
    defaultEncoding: s.defaultEncoding ?? DEFAULT_SETTINGS.defaultEncoding,
    defaultTermType: s.defaultTermType ?? DEFAULT_SETTINGS.defaultTermType,
    hostKeyPolicy: s.hostKeyPolicy ?? DEFAULT_SETTINGS.hostKeyPolicy
  }
}

interface Props {
  onClose: () => void
}

type SettingsTab = 'general' | 'appearance' | 'shortcuts'

const SHORTCUT_ROWS: { descKey: string; keys: string[] }[] = [
  { descKey: 'settings.shortcutCloseTab', keys: ['Ctrl', 'W'] },
  { descKey: 'settings.shortcutNextTab', keys: ['Ctrl', 'Tab'] },
  { descKey: 'settings.shortcutNextTab', keys: ['Ctrl', '→'] },
  { descKey: 'settings.shortcutPrevTab', keys: ['Ctrl', 'Shift', 'Tab'] },
  { descKey: 'settings.shortcutPrevTab', keys: ['Ctrl', '←'] },
  { descKey: 'settings.shortcutToggleSidebar', keys: ['Ctrl', 'B'] },
  { descKey: 'settings.shortcutSettings', keys: ['Ctrl', ','] },
  { descKey: 'settings.shortcutZoom', keys: ['Ctrl', 'Scroll'] },
  { descKey: 'settings.shortcutEndedExit', keys: ['Enter'] },
  { descKey: 'settings.shortcutEndedRestart', keys: ['R'] }
]

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
  const [aboutOpen, setAboutOpen] = useState(false)
  const { modalRef, modalStyle, dragHandleProps } = useDraggableModal()

  const [draft, setDraft] = useState<AppSettings>(() => pickSettings(settings))

  useEffect(() => {
    setDraft(pickSettings(settings))
  }, [settings])

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
    const a = pickSettings(settings)
    return (Object.keys(a) as (keyof AppSettings)[]).some((k) => draft[k] !== a[k])
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
    applyTerminalSettingsToAll()
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
      <div
        ref={modalRef as React.RefObject<HTMLDivElement | null>}
        className="modal settings-modal"
        style={modalStyle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header modal-drag-handle" {...dragHandleProps}>
          <h3>{t('settings.title')}</h3>
          <button
            type="button"
            className="btn icon-btn modal-close-btn"
            onClick={onClose}
            aria-label={t('common.cancel')}
            title={t('common.cancel')}
          >
            <span className="icon-btn-glyph icon-btn-close" aria-hidden>
              ×
            </span>
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
            <button
              type="button"
              className={`settings-nav-item ${tab === 'shortcuts' ? 'active' : ''}`}
              onClick={() => setTab('shortcuts')}
            >
              {t('settings.shortcuts')}
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
                    {t('settings.pasteRightClickHint') ? (
                      <span className="settings-hint">{t('settings.pasteRightClickHint')}</span>
                    ) : null}
                  </span>
                </label>

                <label className="check-row settings-check">
                  <input
                    type="checkbox"
                    checked={draft.copyOnSelect}
                    onChange={(e) => patch({ copyOnSelect: e.target.checked })}
                  />
                  <span>
                    <strong>{t('settings.copyOnSelect')}</strong>
                    <span className="settings-hint">{t('settings.copyOnSelectHint')}</span>
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

                <div className="settings-field">
                  <span className="settings-label">{t('settings.keepAlive')}</span>
                  <input
                    className="settings-control"
                    type="number"
                    min={0}
                    max={600}
                    value={draft.keepAliveIntervalSec}
                    onChange={(e) => patch({ keepAliveIntervalSec: Number(e.target.value) || 0 })}
                  />
                  <span className="settings-hint">{t('settings.keepAliveHint')}</span>
                </div>

                <div className="settings-field">
                  <span className="settings-label">{t('settings.hostKeyPolicy')}</span>
                  <Select
                    value={draft.hostKeyPolicy}
                    onChange={(v) => patch({ hostKeyPolicy: v as HostKeyPolicy })}
                    options={[
                      { value: 'accept-new', label: t('settings.hostKeyAcceptNew') },
                      { value: 'strict', label: t('settings.hostKeyStrict') },
                      { value: 'ignore', label: t('settings.hostKeyIgnore') }
                    ]}
                  />
                  <span className="settings-hint">{t('settings.hostKeyHint')}</span>
                </div>

                <div className="settings-field">
                  <span className="settings-label">{t('settings.defaultEncoding')}</span>
                  <Select
                    value={draft.defaultEncoding}
                    onChange={(v) => patch({ defaultEncoding: v as TerminalEncoding })}
                    options={[
                      { value: 'utf-8', label: 'UTF-8' },
                      { value: 'euc-kr', label: 'EUC-KR' },
                      { value: 'cp949', label: 'CP949' },
                      { value: 'gbk', label: 'GBK' },
                      { value: 'latin1', label: 'Latin-1' }
                    ]}
                  />
                </div>

                <div className="settings-field">
                  <span className="settings-label">{t('settings.defaultTermType')}</span>
                  <Select
                    value={draft.defaultTermType}
                    onChange={(v) => patch({ defaultTermType: v as TermType })}
                    options={[
                      { value: 'xterm-256color', label: 'xterm-256color' },
                      { value: 'xterm', label: 'xterm' },
                      { value: 'vt100', label: 'vt100' }
                    ]}
                  />
                </div>
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
                    min={6}
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
                  <span className="settings-label">{t('settings.scrollback')}</span>
                  <input
                    className="settings-control"
                    type="number"
                    min={100}
                    max={100000}
                    step={500}
                    value={draft.scrollback}
                    onChange={(e) => patch({ scrollback: Number(e.target.value) || 1000 })}
                  />
                </div>

                <div className="settings-field">
                  <span className="settings-label">{t('settings.cursorStyle')}</span>
                  <Select
                    value={draft.cursorStyle}
                    onChange={(v) => patch({ cursorStyle: v as CursorStyle })}
                    options={[
                      { value: 'block', label: t('settings.cursorBlock') },
                      { value: 'underline', label: t('settings.cursorUnderline') },
                      { value: 'bar', label: t('settings.cursorBar') }
                    ]}
                  />
                </div>

                <label className="check-row settings-check">
                  <input
                    type="checkbox"
                    checked={draft.cursorBlink}
                    onChange={(e) => patch({ cursorBlink: e.target.checked })}
                  />
                  <span>
                    <strong>{t('settings.cursorBlink')}</strong>
                  </span>
                </label>

                <div className="settings-field">
                  <span className="settings-label">{t('settings.bellStyle')}</span>
                  <Select
                    value={draft.bellStyle}
                    onChange={(v) => patch({ bellStyle: v as BellStyle })}
                    options={[
                      { value: 'none', label: t('settings.bellNone') },
                      { value: 'visual', label: t('settings.bellVisual') },
                      { value: 'sound', label: t('settings.bellSound') }
                    ]}
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

            {tab === 'shortcuts' && (
              <section className="settings-section">
                <p className="settings-hint" style={{ marginTop: 0 }}>
                  {t('settings.shortcutsDesc')}
                </p>
                <div className="shortcuts-list">
                  {SHORTCUT_ROWS.map((row, i) => (
                    <div key={`${row.descKey}-${row.keys.join('+')}-${i}`} className="shortcut-row">
                      <span className="shortcut-desc">{t(row.descKey)}</span>
                      <span className="shortcut-keys">
                        {row.keys.map((k) => (
                          <kbd key={k}>{k}</kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
                {t('settings.shortcutsNote') ? (
                  <p className="shortcut-note">{t('settings.shortcutsNote')}</p>
                ) : null}
              </section>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button
            type="button"
            className="settings-about-link"
            onClick={() => setAboutOpen(true)}
          >
            {t('settings.about')}
          </button>
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

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  )
}
