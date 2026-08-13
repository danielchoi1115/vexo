# Architecture

## 프로세스

```
renderer  --invoke/on-->  preload (window.api)  --ipc-->  main
                              ↑
                         shared/types
```

SSH 소켓·SFTP·파일 대화상자는 main. 터미널 표시·레이아웃은 renderer.

## 세 가지 “세션” (혼동 금지)

| 개념 | 설명 | 어디 |
|------|------|------|
| 저장 세션 | 호스트/유저/옵션 메타 | `sessionStore` |
| 활성 연결 | 연결된 SSH (`activeSessionId`) | `SshManager` |
| 레이아웃 탭 | 어떤 pane에 어떤 활성 id가 열려 있는지 | `layout` + `appStore` |

저장 세션 id ≠ 활성 id. 연결 시 새 `activeSessionId` 발급.

## 연결 생명주기 (main)

`auth` → (비밀번호 저장 질문 가능) → `shell` → `ended`  
`shell` 이전 실패는 “세션 종료 힌트”가 아니라 연결 실패로 취급.  
로그인 직후 채널 순서·CWD 추적 방식 등 깨지기 쉬운 결정은 `docs/decisions.md`.

## 워크스페이스 (renderer)

- `LayoutNode`: `leaf` (탭 목록) | `split` (가로/세로, sizes)
- 최대 동시 세션: `MAX_SESSIONS` (20)
- 포커스: `focusedLeafId` + leaf의 `activeTabId` → `focusedActiveId`

## 터미널

xterm 인스턴스는 `terminalCache`에 세션별 캐시.  
레이아웃 변경 시 세션 터미널을 함부로 dispose하지 않는다 (상세는 decisions).  
SSH 데이터는 마운트 전 early buffer 가능.

## SFTP

활성 SSH의 서브시스템. Follow 폴더는 2026-08-13 사용자 요청으로 비활성화.
