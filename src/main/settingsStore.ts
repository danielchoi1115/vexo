import Store from 'electron-store'
import { DEFAULT_SETTINGS } from '../shared/themes'
import type { AppSettings, LocaleId } from '../shared/types'

type StoredSettings = AppSettings & {
  fontFamily?: string
  fontSize?: number
}

const store = new Store<StoredSettings>({
  name: 'settings',
  defaults: { ...DEFAULT_SETTINGS }
})

export function getSettings(): AppSettings {
  const data = store.store as StoredSettings
  // Migrate legacy single font settings once
  if (data.fontFamily && data.terminalFontFamily === DEFAULT_SETTINGS.terminalFontFamily) {
    // keep explicit terminal if user already changed it; only fill from legacy when still default
  }
  const terminalFontFamily =
    data.terminalFontFamily && data.terminalFontFamily !== DEFAULT_SETTINGS.terminalFontFamily
      ? data.terminalFontFamily
      : data.fontFamily || data.terminalFontFamily || DEFAULT_SETTINGS.terminalFontFamily
  const terminalFontSize =
    data.terminalFontSize && data.terminalFontSize !== DEFAULT_SETTINGS.terminalFontSize
      ? data.terminalFontSize
      : data.fontSize || data.terminalFontSize || DEFAULT_SETTINGS.terminalFontSize

  const locale = (data.locale || DEFAULT_SETTINGS.locale) as LocaleId
  return {
    locale: locale === 'ko' ? 'ko' : 'en',
    terminalFontFamily,
    terminalFontSize,
    uiFontFamily: data.uiFontFamily || DEFAULT_SETTINGS.uiFontFamily,
    uiFontSize: data.uiFontSize || DEFAULT_SETTINGS.uiFontSize,
    colorScheme: data.colorScheme || DEFAULT_SETTINGS.colorScheme,
    pasteOnRightClick: data.pasteOnRightClick ?? DEFAULT_SETTINGS.pasteOnRightClick,
    remoteMonitoring: data.remoteMonitoring ?? DEFAULT_SETTINGS.remoteMonitoring
  }
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const allowed: (keyof AppSettings)[] = [
    'locale',
    'terminalFontFamily',
    'terminalFontSize',
    'uiFontFamily',
    'uiFontSize',
    'colorScheme',
    'pasteOnRightClick',
    'remoteMonitoring'
  ]
  for (const key of allowed) {
    const v = partial[key]
    if (v !== undefined) store.set(key, v as never)
  }
  return getSettings()
}
