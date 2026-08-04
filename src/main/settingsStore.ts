import Store from 'electron-store'
import { DEFAULT_SETTINGS } from '../shared/themes'
import type { AppSettings } from '../shared/types'

const store = new Store<AppSettings>({
  name: 'settings',
  defaults: { ...DEFAULT_SETTINGS }
})

export function getSettings(): AppSettings {
  return {
    fontFamily: store.get('fontFamily'),
    fontSize: store.get('fontSize'),
    colorScheme: store.get('colorScheme'),
    pasteOnRightClick: store.get('pasteOnRightClick'),
    remoteMonitoring: store.get('remoteMonitoring')
  }
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) store.set(k as keyof AppSettings, v as never)
  }
  return getSettings()
}
