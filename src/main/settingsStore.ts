import Store from 'electron-store'
import { DEFAULT_SETTINGS } from '../shared/themes'
import type {
  AppSettings,
  BellStyle,
  CursorStyle,
  HostKeyPolicy,
  LocaleId,
  TermType,
  TerminalEncoding
} from '../shared/types'

type StoredSettings = AppSettings & {
  fontFamily?: string
  fontSize?: number
}

const store = new Store<StoredSettings>({
  name: 'settings',
  defaults: { ...DEFAULT_SETTINGS }
})

const ENCODINGS: TerminalEncoding[] = ['utf-8', 'euc-kr', 'cp949', 'gbk', 'latin1']
const CURSORS: CursorStyle[] = ['block', 'underline', 'bar']
const BELLS: BellStyle[] = ['none', 'visual', 'sound']
const TERMS: TermType[] = ['xterm-256color', 'xterm', 'vt100']
const HOST_POLICIES: HostKeyPolicy[] = ['accept-new', 'strict', 'ignore']

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function getSettings(): AppSettings {
  const data = store.store as StoredSettings
  const terminalFontFamily =
    data.terminalFontFamily && data.terminalFontFamily !== DEFAULT_SETTINGS.terminalFontFamily
      ? data.terminalFontFamily
      : data.fontFamily || data.terminalFontFamily || DEFAULT_SETTINGS.terminalFontFamily
  const terminalFontSize =
    data.terminalFontSize && data.terminalFontSize !== DEFAULT_SETTINGS.terminalFontSize
      ? data.terminalFontSize
      : data.fontSize || data.terminalFontSize || DEFAULT_SETTINGS.terminalFontSize

  const locale = (data.locale || DEFAULT_SETTINGS.locale) as LocaleId
  const encoding = ENCODINGS.includes(data.defaultEncoding as TerminalEncoding)
    ? (data.defaultEncoding as TerminalEncoding)
    : DEFAULT_SETTINGS.defaultEncoding
  const termType = TERMS.includes(data.defaultTermType as TermType)
    ? (data.defaultTermType as TermType)
    : DEFAULT_SETTINGS.defaultTermType
  const cursorStyle = CURSORS.includes(data.cursorStyle as CursorStyle)
    ? (data.cursorStyle as CursorStyle)
    : DEFAULT_SETTINGS.cursorStyle
  const bellStyle = BELLS.includes(data.bellStyle as BellStyle)
    ? (data.bellStyle as BellStyle)
    : DEFAULT_SETTINGS.bellStyle
  const hostKeyPolicy = HOST_POLICIES.includes(data.hostKeyPolicy as HostKeyPolicy)
    ? (data.hostKeyPolicy as HostKeyPolicy)
    : DEFAULT_SETTINGS.hostKeyPolicy

  return {
    locale: locale === 'ko' ? 'ko' : 'en',
    terminalFontFamily,
    terminalFontSize,
    uiFontFamily: data.uiFontFamily || DEFAULT_SETTINGS.uiFontFamily,
    uiFontSize: data.uiFontSize || DEFAULT_SETTINGS.uiFontSize,
    colorScheme: data.colorScheme || DEFAULT_SETTINGS.colorScheme,
    pasteOnRightClick: data.pasteOnRightClick ?? DEFAULT_SETTINGS.pasteOnRightClick,
    remoteMonitoring: data.remoteMonitoring ?? DEFAULT_SETTINGS.remoteMonitoring,
    copyOnSelect: data.copyOnSelect ?? DEFAULT_SETTINGS.copyOnSelect,
    keepAliveIntervalSec: clamp(
      Number(data.keepAliveIntervalSec ?? DEFAULT_SETTINGS.keepAliveIntervalSec) || 0,
      0,
      600
    ),
    scrollback: clamp(Number(data.scrollback ?? DEFAULT_SETTINGS.scrollback) || 1000, 100, 100000),
    cursorStyle,
    cursorBlink: data.cursorBlink ?? DEFAULT_SETTINGS.cursorBlink,
    bellStyle,
    defaultEncoding: encoding,
    defaultTermType: termType,
    hostKeyPolicy,
    sidebarWidth: clamp(
      Number(data.sidebarWidth ?? DEFAULT_SETTINGS.sidebarWidth) || DEFAULT_SETTINGS.sidebarWidth,
      200,
      560
    )
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
    'remoteMonitoring',
    'copyOnSelect',
    'keepAliveIntervalSec',
    'scrollback',
    'cursorStyle',
    'cursorBlink',
    'bellStyle',
    'defaultEncoding',
    'defaultTermType',
    'hostKeyPolicy',
    'sidebarWidth'
  ]
  for (const key of allowed) {
    const v = partial[key]
    if (v !== undefined) store.set(key, v as never)
  }
  return getSettings()
}
