import { useEffect, useState } from 'react'
import { COLOR_SCHEMES } from '../../../shared/themes'
import type { ColorSchemeId } from '../../../shared/types'
import { useSettingsStore } from '../stores/settingsStore'

interface Props {
  onClose: () => void
}

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

export function SettingsModal({ onClose }: Props): React.JSX.Element {
  const settings = useSettingsStore()
  const schemes = Object.values(COLOR_SCHEMES)
  const [fonts, setFonts] = useState<string[]>(PREFERRED_FONTS)

  useEffect(() => {
    void window.api.settings.listFonts().then((list) => {
      if (list.length === 0) return
      // Prefer mono/coding fonts at top, then rest alphabetically
      const preferred = PREFERRED_FONTS.filter((f) =>
        list.some((x) => x.toLowerCase() === f.toLowerCase())
      )
      const preferredSet = new Set(preferred.map((f) => f.toLowerCase()))
      const rest = list.filter((f) => !preferredSet.has(f.toLowerCase()))
      setFonts([...preferred, ...rest])
    })
  }, [])

  // Ensure current font is selectable even if list is still loading
  const fontOptions =
    settings.fontFamily && !fonts.includes(settings.fontFamily)
      ? [settings.fontFamily, ...fonts]
      : fonts

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="btn ghost sm" onClick={onClose}>
            ×
          </button>
        </div>

        <label>
          Font family
          <select
            value={settings.fontFamily}
            onChange={(e) => void settings.update({ fontFamily: e.target.value })}
            style={{ fontFamily: settings.fontFamily }}
          >
            {fontOptions.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <label>
          Font size ({settings.fontSize}px)
          <input
            type="range"
            min={10}
            max={28}
            value={settings.fontSize}
            onChange={(e) => void settings.update({ fontSize: Number(e.target.value) })}
          />
        </label>

        <label>
          Color scheme
          <select
            value={settings.colorScheme}
            onChange={(e) =>
              void settings.update({ colorScheme: e.target.value as ColorSchemeId })
            }
          >
            <optgroup label="Dark">
              {schemes
                .filter((s) => !s.id.includes('light') && s.id !== 'paper' && s.id !== 'catppuccin-latte')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Light">
              {schemes
                .filter(
                  (s) => s.id.includes('light') || s.id === 'paper' || s.id === 'catppuccin-latte'
                )
                .map((s) => (
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
              className={`scheme-swatch ${settings.colorScheme === s.id ? 'active' : ''}`}
              style={{ background: s.background, borderColor: s.uiBorder, color: s.foreground }}
              title={s.name}
              onClick={() => void settings.update({ colorScheme: s.id })}
            >
              <span style={{ color: s.red }}>A</span>
              <span style={{ color: s.green }}>A</span>
              <span style={{ color: s.blue }}>A</span>
            </button>
          ))}
        </div>

        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.pasteOnRightClick}
            onChange={(e) => void settings.update({ pasteOnRightClick: e.target.checked })}
          />
          Paste using right-click
        </label>

        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.remoteMonitoring}
            onChange={(e) => void settings.update({ remoteMonitoring: e.target.checked })}
          />
          Remote monitoring (hostname, CPU, memory, network, uptime, storage)
        </label>

        <div className="form-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
