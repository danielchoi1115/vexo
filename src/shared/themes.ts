import type { ColorSchemeId } from './types'

export interface TerminalTheme {
  id: ColorSchemeId
  name: string
  background: string
  foreground: string
  cursor: string
  cursorAccent?: string
  selectionBackground: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
  /** App chrome (sidebar/UI) accents derived from scheme */
  uiBg: string
  uiSidebar: string
  uiElevated: string
  uiBorder: string
  uiAccent: string
  uiMuted: string
}

export const COLOR_SCHEMES: Record<ColorSchemeId, TerminalTheme> = {
  'github-dark': {
    id: 'github-dark',
    name: 'GitHub Dark',
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#58a6ff',
    selectionBackground: '#264f78',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
    uiBg: '#0d1117',
    uiSidebar: '#010409',
    uiElevated: '#161b22',
    uiBorder: '#30363d',
    uiAccent: '#238636',
    uiMuted: '#8b949e'
  },
  dracula: {
    id: 'dracula',
    name: 'Dracula',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selectionBackground: '#44475a',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
    uiBg: '#282a36',
    uiSidebar: '#21222c',
    uiElevated: '#343746',
    uiBorder: '#44475a',
    uiAccent: '#bd93f9',
    uiMuted: '#6272a4'
  },
  monokai: {
    id: 'monokai',
    name: 'Monokai',
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    selectionBackground: '#49483e',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
    uiBg: '#272822',
    uiSidebar: '#1e1f1c',
    uiElevated: '#3e3d32',
    uiBorder: '#49483e',
    uiAccent: '#a6e22e',
    uiMuted: '#75715e'
  },
  'solarized-dark': {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
    uiBg: '#002b36',
    uiSidebar: '#001f27',
    uiElevated: '#073642',
    uiBorder: '#094352',
    uiAccent: '#268bd2',
    uiMuted: '#586e75'
  },
  nord: {
    id: 'nord',
    name: 'Nord',
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    selectionBackground: '#434c5e',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4',
    uiBg: '#2e3440',
    uiSidebar: '#242933',
    uiElevated: '#3b4252',
    uiBorder: '#4c566a',
    uiAccent: '#88c0d0',
    uiMuted: '#7b88a1'
  },
  'one-dark': {
    id: 'one-dark',
    name: 'One Dark',
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    selectionBackground: '#3e4451',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
    uiBg: '#282c34',
    uiSidebar: '#21252b',
    uiElevated: '#2c313a',
    uiBorder: '#181a1f',
    uiAccent: '#61afef',
    uiMuted: '#5c6370'
  }
}

export const DEFAULT_SETTINGS = {
  fontFamily: 'Consolas, "Cascadia Code", "Courier New", monospace',
  fontSize: 14,
  colorScheme: 'github-dark' as ColorSchemeId,
  pasteOnRightClick: true,
  remoteMonitoring: false
}
