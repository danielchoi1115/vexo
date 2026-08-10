# Vexo

Electron SSH client: saved sessions, multi-tab/split terminals, SFTP on the same connection, broadcast input.

## Stack

Electron · React · TypeScript (electron-vite) · xterm.js · ssh2 · Zustand · electron-store + safeStorage

## Develop

```bash
npm install
npm run dev
```

| Command | Description |
|---------|-------------|
| `npm run dev` | App with HMR |
| `npm run typecheck` | TypeScript |
| `npm run build` | Typecheck + production build |
| `npm run build:win` | Windows installer |
| `npm run icons` | Generate icons from `resources/icon.png` |

## AI / contributors

- **`AGENTS.md`** — task routing for coding agents (read first).
- **`docs/`** — overview, architecture, conventions, decisions, domains.

## Security (short)

- `contextIsolation`, no Node in renderer; API via preload only.
- Passwords/passphrases via OS `safeStorage`, not plain JSON.
- Optional encrypted session export (password required; loss = unrecoverable).
