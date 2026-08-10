# AGENTS

AI 작업 시 **이 파일을 먼저** 보고, 표에 해당하는 docs만 읽은 뒤 수정한다.  
장문 스펙·초기 시드(`ssh-client-starter-prompt.md`)는 현재 코드와 다를 수 있으니 따르지 않는다.

## 한 줄

Vexo = Electron SSH 클라이언트. 저장 세션 · 멀티 탭/스플릿 터미널 · 같은 연결 SFTP · 브로드캐스트.

## 경계 (항상)

| 층 | 경로 | 역할 |
|----|------|------|
| main | `src/main/` | SSH, SFTP, 디스크 store, dialog |
| preload | `src/preload/` | `window.api` 노출 |
| renderer | `src/renderer/` | UI, xterm, 레이아웃 |
| shared | `src/shared/` | types, i18n, themes |

- Node/SSH는 main만. renderer는 `window.api`만.
- IPC 추가·변경: **`src/shared/types.ts` → `src/preload/index.ts` → `src/main/ipc.ts`** 세 곳.
- 시크릿(비밀번호 등)을 로그·UI 기본 노출·평문 store 키에 넣지 말 것.
- 검증: `npm run typecheck` (관련 시 UI는 en+ko i18n).

## 작업 라우팅

| 작업 | 읽을 docs | 주요 코드 |
|------|-----------|-----------|
| 어디부터 손댈지 모를 때 | `docs/overview.md`, `docs/architecture.md` | `src/` |
| 세션/폴더/폼/export·import/비밀번호 저장 | `docs/domains/data.md`, `docs/decisions.md` | `sessionStore`, `credentialStore`, `sessionCrypto`, `SessionForm`, `SessionTree`, export/import dialogs |
| 연결·인증·끊김·인코딩·host key | `docs/domains/connection.md`, `docs/decisions.md` | `SshManager`, `knownHostsStore` |
| SFTP·전송·Follow 폴더 | `docs/domains/connection.md` | `SftpBrowser`, SFTP IPC, `cwdOsc`, `shellIntegration` |
| 스플릿·탭·포커스·스크롤백·단축키·브로드캐스트 | `docs/domains/workspace.md` | `layoutOps`, `terminalCache`, `EditorPane`, `appStore`, `useAppShortcuts`, `BroadcastBar` |
| 설정·테마·문구 | `docs/domains/workspace.md` (설정 절) | `settingsStore`, `SettingsModal`, `i18n/*` |
| 규칙·IPC 패턴 | `docs/conventions.md` | types / preload / ipc |
| 빌드·아이콘 | `docs/overview.md` | `package.json`, `electron-builder.yml`, `resources/icon.png` |

제약·금지: `docs/decisions.md`.
