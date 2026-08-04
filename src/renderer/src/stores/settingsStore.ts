import { create } from 'zustand'
import { COLOR_SCHEMES, DEFAULT_SETTINGS } from '../../../shared/themes'
import { t as translate } from '../../../shared/i18n'
import type { AppSettings, ColorSchemeId, LocaleId } from '../../../shared/types'

interface SettingsState extends AppSettings {
  loaded: boolean
  load: () => Promise<void>
  update: (partial: Partial<AppSettings>) => Promise<void>
  theme: (typeof COLOR_SCHEMES)[ColorSchemeId]
  applyCssVars: () => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  theme: COLOR_SCHEMES[DEFAULT_SETTINGS.colorScheme],

  t: (key, vars) => translate(get().locale as LocaleId, key, vars),

  load: async () => {
    const s = await window.api.settings.get()
    const theme = COLOR_SCHEMES[s.colorScheme] ?? COLOR_SCHEMES['github-dark']
    set({ ...s, loaded: true, theme })
    get().applyCssVars()
  },

  update: async (partial) => {
    const s = await window.api.settings.set(partial)
    const theme = COLOR_SCHEMES[s.colorScheme] ?? COLOR_SCHEMES['github-dark']
    set({ ...s, theme })
    get().applyCssVars()
  },

  applyCssVars: () => {
    const {
      theme,
      terminalFontFamily,
      terminalFontSize,
      uiFontFamily,
      uiFontSize,
      colorScheme
    } = get()
    const root = document.documentElement
    const light =
      colorScheme.includes('light') ||
      colorScheme === 'paper' ||
      colorScheme === 'catppuccin-latte'
    root.style.colorScheme = light ? 'light' : 'dark'
    root.style.setProperty('--bg', theme.uiBg)
    root.style.setProperty('--bg-elevated', theme.uiElevated)
    root.style.setProperty('--bg-sidebar', theme.uiSidebar)
    root.style.setProperty('--border', theme.uiBorder)
    root.style.setProperty('--text', theme.foreground)
    root.style.setProperty('--muted', theme.uiMuted)
    root.style.setProperty('--accent', theme.uiAccent)
    root.style.setProperty('--focus', theme.cursor || theme.blue || theme.uiAccent)
    root.style.setProperty('--term-font', terminalFontFamily)
    root.style.setProperty('--term-font-size', `${terminalFontSize}px`)
    root.style.setProperty('--ui-font', uiFontFamily)
    root.style.setProperty('--ui-font-size', `${uiFontSize}px`)
    document.body.style.fontFamily = `${uiFontFamily}, "Segoe UI", system-ui, sans-serif`
    document.body.style.fontSize = `${uiFontSize}px`
  }
}))
