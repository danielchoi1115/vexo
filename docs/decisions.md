# Decisions

깨면 회귀하기 쉬운 것만. 새 결정은 짧게 추가.

1. **자격증명 키** — 비밀번호는 `sessionId + username` 계정 단위. 레거시 단일 키는 migrate.
2. **export 비밀** — 포함 시 일회 암호로 파일 암호화 (AES-GCM). 암호 분실 = 복구 불가.
3. **import** — 현재는 replace. 파일 선택 후, 암호화된 경우만 암호 요청.
4. **host key** — 설정 `accept-new` | `strict` | `ignore` + `knownHostsStore`.
5. **비밀번호 저장 정책** — 세션별 `ask` | `always` | `never`. ask면 인증 성공 후·셸 전에 다이얼로그.
6. **셸 vs SFTP 순서** — interactive shell 먼저, 그 다음 SFTP·통합 스크립트.
7. **Follow CWD** — 2026-08-13 사용자 요청으로 비활성화.
8. **터미널 수명** — 스플릿/탭 이동 시 xterm을 dispose하지 않고 유지(캐시 park/attach).
9. **브로드캐스트** — 보이는(leaf active) 연결 탭에 입력 복제. 히스토리는 main store.
10. **copyOnSelect** — 켜면 선택 즉시 복사, 터미널 Ctrl+C/V 클립보드 단축 비활성.
11. **여러 줄 붙여넣기** — 셸이 떠 있으면 줄 단위로 보내고 출력 quiet를 기다림. password/passphrase 프롬프트에서는 큐를 멈추고 사용자 입력을 기다린 뒤 재개. 줄바꿈은 CR. 클립보드에 개행 없는 마지막 조각은 Enter 없이 삽입. auth 중에는 한꺼번에 전송.
12. **네이티브 메뉴** — Windows/Linux는 `setMenu(null)`. `autoHideMenuBar`는 Alt가 숨은 메뉴로 포커스를 가져감. macOS 앱 메뉴는 유지. Alt 삼키기·포커스 폴링 금지.
