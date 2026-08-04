# Vexo

SSH client desktop app (Electron + React + TypeScript) with multi-session terminals and integrated SFTP.

Inspired by MobaXTerm / Termius — focused MVP: save sessions, connect, terminal tabs, SFTP upload/download on the same connection.

## Stack

- Electron + Vite + React + TypeScript ([electron-vite](https://electron-vite.org/))
- [xterm.js](https://xtermjs.org/) + WebGL / fit / search addons
- [ssh2](https://github.com/mscdex/ssh2) for SSH + SFTP
- Zustand for UI state
- electron-store + Electron `safeStorage` for session metadata and encrypted credentials

## Develop

```bash
npm install
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start app with HMR |
| `npm run build` | Typecheck + production build |
| `npm run build:win` | Windows installer via electron-builder |

## Security

- `nodeIntegration: false`, `contextIsolation: true`
- Preload exposes a narrow `window.api` surface only
- Passwords/passphrases encrypted with OS `safeStorage` (never plain JSON)
