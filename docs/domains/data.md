# Domain: data

## 파일

| 경로 | 역할 |
|------|------|
| `src/main/sessionStore.ts` | 세션·폴더 CRUD, reorder, export/import 데이터 |
| `src/main/credentialStore.ts` | 비밀번호/패스프레이즈 (safeStorage) |
| `src/main/sessionCrypto.ts` | export 파일 암·복호 |
| `src/main/settingsStore.ts` | 앱 설정 |
| `src/renderer/.../SessionForm.tsx` | 세션 편집 |
| `src/renderer/.../SessionTree.tsx` | 트리, export/import 진입 |
| `src/renderer/.../ExportSessionsDialog.tsx` | 내보내기 UI |
| `src/renderer/.../ImportSessionsDialog.tsx` | 가져오기 UI |
| `src/renderer/.../PasswordSaveDialog.tsx` | 로그인 후 저장 여부 |

## 흐름

- 저장 세션 메타는 JSON store. 비밀은 별도 암호화 blob.
- export: 메타 ± 비밀 → (비밀 있으면) 암호화 JSON 파일.
- import: 파일 선택 → 암호 필요 시만 입력 → 기존 세션 **교체**.

## 손댈 때

- 새 세션 필드: `SessionConfig` / `SessionInput` + form + i18n + store 기본값/migrate.
- 비밀 키 형식 변경 시 migrate와 export/import 경로 함께.
