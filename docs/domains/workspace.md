# Domain: workspace

## 파일

| 경로 | 역할 |
|------|------|
| `src/renderer/.../layout/types.ts` | LayoutNode, MAX_SESSIONS |
| `src/renderer/.../layout/layoutOps.ts` | 탭 이동·순서, 스플릿, 사이클 |
| `src/renderer/.../stores/appStore.ts` | 레이아웃·포커스·connect/disconnect |
| `src/renderer/.../terminal/terminalCache.ts` | xterm 캐시, park/attach, 데이터 라우팅 |
| `src/renderer/.../workspace/EditorPane.tsx` | 탭 바, 드롭존, pane 메뉴 |
| `src/renderer/.../Workspace.tsx` | 레이아웃 루트 |
| `src/renderer/.../BroadcastBar.tsx` | 브로드캐스트 입력 |
| `src/renderer/.../hooks/useAppShortcuts.ts` | Ctrl+W/Tab/방향 등 |
| `src/renderer/.../hooks/useDraggableModal.ts` | 모달 드래그 |
| `src/main/index.ts` | Ctrl+Arrow IPC, 줌 고정 |
| `src/renderer/.../SettingsModal.tsx` | 설정 UI |
| `src/renderer/.../AboutModal.tsx` | About |
| `src/shared/i18n/*` | 문구 |

## 레이아웃

- leaf: `tabIds` + `activeTabId`  
- split: `direction` + `children` + `sizes`  
- 사이드바 세션을 pane에 드롭 → connect + zone(center/edge 스플릿)

## 터미널

- 세션당 캐시 1개. attach 시 컨테이너에 붙이고 fit.  
- `active` prop으로 포커스 시 `term.focus()`.  
- 설정(폰트/테마/scrollback)은 캐시에 반영.  
- 여러 줄 붙여넣기: `pasteQueue` — 줄 단위 + quiet 대기 + secret 프롬프트에서 정지 (`decisions.md` 11).

## 브로드캐스트

- 켜면 하단 입력이 보이는 연결 탭들로 write.  
- 히스토리: main `broadcastHistoryStore`.

## 설정

- locale, 폰트, 테마, copyOnSelect, pasteOnRightClick, hostKeyPolicy, 인코딩 기본값 등.  
- main store가 권위, renderer는 로드/업데이트.  
- About은 설정 하단 링크.

## 손댈 때

- 탭/스플릿 변경 시 terminalCache dispose 남용 금지.  
- 단축키가 폼 입력과 xterm helper textarea를 구분하는지 확인 (`useAppShortcuts`).
