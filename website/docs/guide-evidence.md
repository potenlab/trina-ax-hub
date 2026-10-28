# 가이드 확인 기록

확인 대상: 읽기 전용 `trina-app/trina-ax` **5c15812**, 제품 **0.2.2**.
확인일: 2026-10-28. 다른 버전의 기능이나 예정된 기능을 섞지 않음.

본문은 `src/content/guides.ts`, 공개 경로는 `/ko/guide/<slug>`.
각 항목의 `sources`는 문구 검토에 사용한 소스 경로이며 방문자 화면에는 출력하지 않음.
기존 문서와 현재 UI가 다르면 `web/src/i18n/ko.ts` 및 실제 컴포넌트·서버 권한 검사를 우선함.

| 페이지 | 확인한 동작 / 근거 |
|---|---|
| hosting | 승인된 사이트의 호스팅 범위, `web/src/pages/admin/AdminLayout.tsx`의 메뉴 |
| folder-permissions | `docs/PERMISSIONS.md`, `web/src/pages/admin/Folders.tsx`: 폴더 선택, 규칙, 누가 무엇을 보나, 저장, 상속·과거 답변의 한계 |
| invite | `web/src/pages/admin/Members.tsx`, `server/src/auth/accounts.ts`: 1회 초대 링크, 수동 전달, 관리자 초대는 팀장만 |
| ai-connection | `web/src/pages/admin/Credentials.tsx`, `server/src/credentials/resolve.ts`: 회사 연결 추가·변경은 팀장만, 관리자는 조회·확인. https, API 키, 개인→사람→그룹→전체 순서 |
| usage-limits | `web/src/pages/admin/{Usage,Engines}.tsx`, `server/src/admin/budgets.ts`: 사람·한 달, 토큰 및 API 키 금액, 경고/차단. 구독 금액 추정을 쓰는 옛 설명서 문구는 채택하지 않음 |
| review-skills | `web/src/pages/Skills.tsx`, `web/src/components/SuggestSkillDialog.tsx`: 폴더 담당자의 검토·편집·등록/거절, 제안은 즉시 공개되지 않음 |
| backup | `web/src/pages/admin/System.tsx`, `server/src/{routes/system,system/backup}.ts`: 팀장만, 수동은 전체 백업. 화면의 복원은 DB 복원이며 팀 파일은 그대로임 |
| restore-file | `web/src/pages/Files.tsx`, `web/src/i18n/ko.ts`의 files.history/restore: 파일별 기록, 되돌리기 전 내용도 새 버전으로 남음 |
| first-question | `web/src/pages/Chat.tsx`, `web/src/i18n/ko.ts`: 새 채팅, 볼 수 있는 폴더, 보내기/답변 멈추기 |
| team-files | `web/src/components/chat`, ko.ts의 composer/picker: 팀 파일에서 추가→첨부, 현재 파일 접근 권한. `docs/PERMISSIONS.md`: 더 넓은 공개 범위 저장 확인 |
| use-skills | `web/src/components/chat/SkillMenu.tsx`: /로 읽을 수 있는 스킬만 조회, Enter/방향키/Esc. SuggestSkillDialog의 필드·제안 절차 |
| schedules | `web/src/components/settings/ScheduleTemplates.tsx`, `server/src/chat/{schedule-templates,schedules}.ts`: 주간 요약, 내 폴더의 새 Markdown 보고서, 실행 시간·시간대·개인 연결·한도. Word 예약은 아래 별도 채팅 요청 사례 |
| external-services | `docs/INTEGRATIONS.md`, ko.ts의 integrations: 종류·주소·인증·쓰기 정책, 개인/팀 범위, 모바일 로그인 제한. `docs/GOOGLE-DRIVE.md`: 검색·목록·읽기만, Drive 쓰기 없음 |
| desktop-app | `web/src/pages/Settings.tsx` Apps, ko.ts의 apps, `docs/OFFICE.md`: 서버에 등록된 다운로드만 표시, 맥/윈도우. 옛 guide.html의 “윈도우 준비 중”은 현재 코드와 달라 채택하지 않음 |
| phone-app | Settings.tsx Apps, ko.ts의 apps, `docs/guide/guide.html`: 브라우저 홈 화면 추가. 앱스토어·네이티브 로그인 검증을 주장하지 않음 |
| use-cases/weekly-report | `server/src/tools/schedules.ts`: 채팅에서 생성하는 예약은 자체 완결 요청으로 새 채팅 실행. `make-file.ts`: Word 생성. 확인이 필요한 작업은 무인 실행에서 진행되지 않음 |
| use-cases/sales-quote | `server/src/tools/make-file.ts` xlsx: CSV/Markdown 표로 새 통합 문서를 만듦. 기존 XLSX 서식·수식 복제 기능이라고 설명하지 않음 |
| use-cases/expense-summary | `make-file.ts`: Markdown 표별 시트 생성. 영수증 유무는 근거 자료 필요, 확인 불가와 없음 구분 |
| use-cases/official-letter | `docs/OFFICE.md`, `server/src/tools/{index,make-file}.ts`: HWP/HWPX 읽기, 암호·배포용 제한, 결과는 DOCX. 예시 날짜·인원은 실제 결과가 아님 |

## 화면 출처

`public/images/guide/*.webp`는 이 Mac의 **localhost:19590** 테스트 팀에서 Playwright로 직접 캡처함.
회사와 계정은 초기 QA 가상 데이터만 사용. `data-testid="dev-banner"` 요소만 화면에서 제거한 뒤 캡처함.
제품 파일·데이터·권한·스킬·예약·외부 연결을 새로 만들거나 수정하지 않음. 비밀번호·토큰·키는 화면과 커밋에 포함하지 않음.

| 이미지 | 실제 위치 |
|---|---|
| ai-connection | `/admin/credentials` |
| skills | `/skills` |
| schedules | `/settings/schedules` (기본 작업 선택 화면) |
| integrations | `/settings/integrations` |
| apps | `/settings/apps` (설치 파일 미등록 상태) |
| first-question | `/` (팀장 계정의 첫 화면) |
| team-files | `/files` |
| usage-limits | `/admin/engines`, 한도 추가 창만 열고 저장하지 않음 |

캡처 후 테스트 서버가 503/연결 실패 상태가 됨. 재시작하지 않았고, 이후 오류 화면은 삭제했음.
따라서 첨부 선택기·슬래시 메뉴·실제 설치 완료 화면은 새로 확보하지 못함. 해당 가이드는 확인된 코드와 정상 캡처만 사용함.
외부 서비스 인증·결제·실제 메일 발송·네이티브 앱 설치·서버 복원은 이번 작업에서 수행하지 않음.

2026-10-29 배포 전 검토에서 `folder-permissions`, `invite`, `file-history` 화면은 내렸음. QA 테스트용 폴더·파일·계정 이름(`QA-2026-10-28`, `-QA` 파일, `QA 외부2` 등)이 화면 대부분을 채워서임. 같은 검토에서 5c15812와 다른 문장을 고쳤음: 수동 백업의 증분 표시, 팀 스킬 최근 변경 탭(팀장·관리자만), 등록 직후 스킬의 되돌리기, 버전 목록에 보이는 항목, 첫 화면 폴더 안내(첫 채팅 전만), 외부 서비스 인증 방식(OAuth는 MCP만), 데스크톱 앱 버튼·첫 화면 이름, 예약 실행 실패 확인 위치.

## 유지보수

- 활용 사례 가이드의 기존 요청·결과물은 `ko.roles.items`와 `RoleDocument.astro`를 사용함. 홈페이지 팀별 예시는 `src/content/teams.ts`에 별도로 두고, 관련 가이드로 연결함. 근거는 `team-showcase-evidence.md` 참조.
- 새 글은 `GUIDES`에 추가하면 한국어 허브, 정적 경로, 사이트맵, llms.txt에 들어감. 준비된 영어 본문이 없으면 영문 허브에 링크하지 않음.
- 한글 글꼴은 `python3 scripts/build-pretendard.py <PretendardVariable.woff2>`로 다시 생성함. 라이선스는 기존 OFL 파일을 유지함.
- 총 한국어 가이드 글은 기존 첫 주 안내를 포함해 20개. 승인 계획의 20개 초과 시 문서 도구 전환 검토는 다음 글 추가 때 판단할 수 있음.

## English completion — 2026-10-29

The same 19 task guides are now published in English at `/guide/<slug>` (also available through `/en/guide/<slug>` aliases). English content lives in `src/content/guides-en.ts`; it shares the Korean article identities and evidence paths but omits Korean UI screenshots. Labels were checked against `web/src/i18n/en.ts` at product commit `5c15812`; desktop connection labels also match `desktop/src/common/i18n.ts`. English and Korean articles now point to each other in navigation and hreflang. English role requests and result examples come from `en.roles.items`.

The English guides retain the corrections above: owner-only company connection creation and backup/restore, manual invite-link delivery, API-only cost estimates, database-only system restore, read-only Drive, new XLSX tables rather than workbook duplication, and HWP/HWPX input with DOCX reply output. See [the English hand-off](site-en-2026-10-29.md) for validation and remaining decisions.
