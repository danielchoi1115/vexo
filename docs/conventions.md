# Conventions

## IPC

1. `src/shared/types.ts` — `VexoApi` 등 타입  
2. `src/preload/index.ts` — `invoke` / `on`  
3. `src/main/ipc.ts` — `ipcMain.handle` / 이벤트 송신  

세 곳이 어긋나면 typecheck 또는 런타임 깨짐.

## UI / i18n

- 사용자 문구: `src/shared/i18n/en.ts` + `ko.ts` (키 동기화)
- 설정·모달 패턴: 기존 `SettingsModal` / session form 스크롤 셸 참고
- 모달 드래그: `useDraggableModal` (헤더 핸들, 화면 안 clamp)

## 상태

- 앱 UI·레이아웃·활성 탭: `appStore` (renderer)
- 설정: main `settingsStore` + renderer `settingsStore` 미러
- 세션 트리·비밀: main only

## 수정 시

- 요청 범위 밖 리팩터·무관 파일 정리 금지
- 네트워크/SSH 오류로 프로세스 전체가 죽지 않게 (main에 방어 있음 — 제거하지 말 것)
- 완료 후 `npm run typecheck`
