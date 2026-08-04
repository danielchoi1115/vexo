import { create } from 'zustand'
import { COLOR_SCHEMES, DEFAULT_SETTINGS } from '../../../shared/themes'
import type { AppSettings, ColorSchemeId } from '../../../shared/types'

interface SettingsState extends AppSettings {
  loaded: boolean
  load: () => Promise<void>
  update: (partial: Partial<AppSettings>) => Promise<void>
  theme: (typeof COLOR_SCHEMES)[ColorSchemeId]
  applyCssVars: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  theme: COLOR_SCHEMES[DEFAULT_SETTINGS.colorScheme],

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
    const { theme, fontFamily, fontSize, colorScheme } = get()
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
    root.style.setProperty('--term-font', fontFamily)
    root.style.setProperty('--term-font-size', `${fontSize}px`)
  }
}))
