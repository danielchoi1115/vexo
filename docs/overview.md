# Overview

## 제품

저장한 SSH 세션으로 연결하고, 탭·스플릿 터미널과 사이드 SFTP를 쓰는 데스크톱 앱.  
버전 `0.3.0`.

## 스택

Electron + electron-vite + React + TypeScript · xterm.js · ssh2 · Zustand · electron-store · safeStorage

## 디렉터리

```
src/main/          # 프로세스, SSH/SFTP, stores, IPC 핸들러
src/main/ssh/      # SshManager, OSC, shell integration, batcher
src/preload/       # window.api
src/renderer/      # UI, layout, terminalCache, stores
src/shared/        # types, i18n (en/ko), themes
```

## 스크립트

| 명령 | 용도 |
|------|------|
| `npm run dev` | 개발 실행 |
| `npm run typecheck` | TS 검사 |
| `npm run build` | typecheck + 빌드 |
| `npm run build:win` 등 | 인스톨러 |
| `npm run icons` | `resources/icon.png` → build 아이콘 (+ resources 갱신) |

## 로컬 데이터

electron-store 이름: `sessions`, settings, credentials, known hosts, broadcast history.  
비밀번호/패스프레이즈는 safeStorage로 암호화된 값만 저장.  
세션 백업: 앱 내 export/import (비밀 포함 시 파일 암호).
