# Domain: connection

## 파일

| 경로 | 역할 |
|------|------|
| `src/main/ssh/SshManager.ts` | 연결, auth, shell, SFTP, 메트릭, CWD |
| `src/main/ssh/cwdOsc.ts` | OSC에서 경로 추출 |
| `src/main/ssh/shellIntegration.ts` | 원격 SI 스크립트·source 한 줄 |
| `src/main/ssh/DataBatcher.ts` | 터미널 데이터 배치 IPC |
| `src/main/knownHostsStore.ts` | 호스트 키 지문 |
| `src/renderer/.../SftpBrowser.tsx` | SFTP UI, Follow |
| `src/renderer/.../TerminalView.tsx` | xterm 호스트 |

## 흐름

1. `connect` → auth (비번/키/에이전트, 터미널 프롬프트 가능)  
2. 정책에 따라 password-save 질문  
3. `client.shell` (PTY) — 로그인 출력 수신  
4. 출력이 잠잠해진 뒤 SFTP + SI 스크립트 stage + source  
5. 스트림 → OSC 파싱 → `ssh:cwd` / 데이터 → renderer  

SFTP list/upload/download는 동일 클라이언트 서브시스템.

## Follow

- UI 토글 → `remoteCwd` 변경 시 디바운스 후 list.  
- 경로 오류 시 목록 유지.  
- CWD 소스는 OSC(+세션 SI). 입력 cd 추적 없음.

## 손댈 때

- 연결 직후 채널 순서를 바꾸면 로그인 UX 회귀하기 쉬움 (`decisions.md`).  
- phase(`auth`/`shell`/`ended`) 의미를 유지할 것.
