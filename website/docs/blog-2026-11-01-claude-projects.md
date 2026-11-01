# 블로그 네 번째 글 · 앞 세 글 호스팅 문장 인수 기록 — 2026-11-01

넣을 곳: 이 저장소(`potenlab/trina-ax-hub`)의 `website/`(ax.trina.app). 이유: 앞 블로그 작업과 같은 사이트예요.

- 브랜치: `blog-claude-projects-and-free-plan`. `origin/main` `1cf5f18`(무료 요금제 PR #1 병합)에서 땄어요.
  - 라이브도 `1cf5f18` 빌드예요(라이브 `llms.txt` = 그 빌드의 `llms.txt`, 바이트 단위로 같음).
- 커밋: 구현 커밋 `342e2ee` 하나와 이 문서 커밋이에요.
- push·배포는 하지 않았어요. 「배포해」를 기다려요.
- 지시서: blog-ops `ax/handoffs/2026-11-01-claude-projects-and-free-plan-brief.md`. 앞 지시서들의 규칙을 따랐어요.
- 초안(sha256 앞 8자리)
  - 새 글 `2026-11-01-claude-projects-for-teams-files-and-access.md`: `status: fact-checked 2026-11-01`, `fd6d6d0a…`
  - `2026-10-29-share-claude-skills-with-your-team.md`: `revised: 2026-11-01`, `bb78a45d…`
  - `2026-10-30-claude-code-for-people-who-dont-code.md`: `revised: 2026-11-01`, `277ec156…`
  - `2026-10-31-claude-team-plan-seats-and-usage-limits.md`: `revised: 2026-11-01`, `54227a5a…`

## 1. 게시 직전 재확인

**모두 같음**이에요. 그래서 멈추지 않고 넣었어요. 확인 시각은 2026-11-01 11:08 KST예요. curl 로 받아 텍스트로 바꾼 뒤 본문 문장마다 대조했어요.

### 새 글 출처 [1]–[9]

| 출처 | 결과 |
| --- | --- |
| [1] What are projects? | **같음**(「Updated yesterday」). 「self-contained workspaces with their own chat histories and knowledge bases」, 무료 계정 5개, 새 버전 베타(Claude Code 부터, 일부 Pro·Max·Ultra, 기존 프로젝트 이동 시작, chat·Cowork·Team·Enterprise 는 뒤에), 「The rest of this article describes the current version」, RAG 는 유료 플랜·「up to 10x」, 공유는 Team·Enterprise, Can view·Can edit(편집자는 멤버 추가·제거), 조직 전체 공유, 소유자가 공유를 끄거나 Enterprise 에서 역할별로 끔 |
| [2] How can I create and manage projects? | **같음**(「Updated yesterday」). 문서·텍스트·코드 업로드, 모든 채팅에 쓰임, 지침, 「Context is not shared across chats … unless … project knowledge base」, 관리자가 끄지 않았으면 공유, 「Share project」, 프로젝트마다 메모리·「Use account memory」, Team·Enterprise 는 소유자가 메모리 결정, claude.ai/projects |
| [3] Manage project visibility and sharing | **같음**(「September 24, 2026」). 공개 프로젝트여도 채팅은 직접 공유 전까지 비공개, Enterprise 그룹 공유 베타·「Access follows group membership」 |
| [4] Organize your tasks with projects in Claude Cowork | **같음**(「Updated yesterday」). 처음부터·Claude 프로젝트에서·기존 폴더에서, 지침·예약 작업·컨텍스트(로컬 폴더·채팅 프로젝트·URL)·메모리, 「Cowork projects share the same way … Can view or Can edit」, 폴더와 파일은 컴퓨터에 남음, Team·Enterprise 는 Chat and Cowork unified 가 켜져야 계정에 저장, 「available on desktop on all paid plans」 |
| [5] Use Google Workspace connectors | **같음**(「Updated yesterday」). Drive 커넥터는 비공개 프로젝트에 파일을 더할 때만·공유 프로젝트는 꺼짐, Google Docs 는 최신 판으로 동기화, Team·Enterprise 는 Owner·Primary Owner 가 먼저 켬, 「Claude mirrors your existing permissions」 |
| [6] Use enterprise search | **같음**(「October 1, 2026」). Team·Enterprise, 미리 만든 「Ask Your Org」, Slack·Google·Microsoft 365, Documents·Chat 커넥터 필수, 권한 인지·공유 자격 증명 예외, 각자 자기 계정 인증, 색인 없음(MCP 호출), 사용 한도에 포함, Claude Mobile 미지원 |
| [7] `/llms.txt`, 홈 (라이브) | **같음.** 팀·그룹·프로젝트 폴더 권한·개인 폴더·이름조차 안 보임, PDF·Word·Excel·PowerPoint·한글(HWP/HWPX), 웹·데스크톱·폰, 호스팅이면 운영자가 저장 데이터를 읽을 수 있음, AGPL-3.0, 무료 요금제(아래), 「Hosted by Trina: free, or from $39 a month」, 「Claude usage is billed by Anthropic, not by Trina.」 |
| [8] `/guide/folder-permissions` | **같음.** Product 0.2.2 · Checked October 28, 2026. Everyone·Role·Group·Person, No access·Read·Read & write, Who sees what 의 After saving·People losing access, 하위 폴더 상속, 소유자·관리자의 팀 폴더 관리 접근, 권한을 빼도 앞 답변의 인용은 안 지워짐 |
| [9] `/security` | **같음.** 「This is a pre-release with no security certification yet.」, 「goes to the model provider (Anthropic, and OpenAI if Codex is on)」 |

### 호스팅 무료 요금제

- 사이트 변경 커밋: **`010f2d2`** 「feat(website): add the hosted Free plan next to the USD plans」(2026-10-31 16:41 +0700, `potenlab <dev@potenlab.dev>`). PR #1 병합 커밋 `1cf5f18`로 main 에 들어갔어요.
  - `site.ts`: `FREE_PLAN = { usd: 0, teams: 1, people: 3, running: 1, vcpu: 2, memoryGb: 2, storageGb: 5 }`. `PLANS`와 따로 있어요.
  - `seo.ts`(`llms.txt` 요약): 「Trina hosting has a free plan for small teams (limited spots) and monthly paid plans by the number of people, setup included.」
  - `en.ts`: 제목 「Hosted by Trina: free, or from {from} a month」, FAQ 「Is there a free plan?」 「1 free hosted team for up to 3 members … Spots are limited … may be paused when unused for a long time」, 무료 카드 「Up to 3 people」 「Limited spots」
- 네 글의 문장과 대조: **모두 같은 사실이에요**(무료 = 최대 3명 · 자리 한정).

| 글 | 문장 | 사이트 |
| --- | --- | --- |
| share-claude-skills | 「a free plan for small teams (limited spots) and monthly paid plans by team size」 | `llms.txt` 요약과 같은 말 |
| claude-code | 「Trina's hosting has a free plan for small teams (limited spots) and monthly paid plans by team size」 | 같음 |
| claude-team-plan | 「a free plan for up to 3 members, with limited spots, and paid plans at $39 …」, 표 「a free hosted plan for up to 3 members (limited spots)」·「free for up to 3 members (limited spots), then priced by team size」 | FAQ 「up to 3 members」 「Spots are limited」, `PLANS` 금액 그대로 |
| claude-projects(새 글) | 「a free plan for up to 3 members, with one answer running at a time and 5 GB of storage, limited spots and a pause when unused for a long time, and paid plans from $39 a month」 | FAQ·카드(1 answer, 5 GB, Limited spots, paused when unused) |

참고로 적어 둘 것이에요(본문과 어긋나지 않아요).
- 두 번째·세 번째 글의 고치지 않은 문장 「a server for the company alone on AWS in Seoul that Trina hosts」는 지금 `llms.txt` 요약(「a server of the company's own on AWS in Seoul that Trina hosts」)과 FAQ(「each company has a server of its own」)와 같아요. 다만 사이트는 이번에 「Every plan」을 「Every paid plan: a server … for your company alone」으로 바꿨고, 무료 카드는 「Your own server」 대신 「Hosted in Seoul」이라고만 해요. 무료 팀도 자기 서버인지는 사이트가 말하지 않아요. 지시 범위 밖이라 그대로 뒀어요.
- 라이브 `llms.txt`의 「How to start」 머리는 아직 「Hosted by Trina (From $39 a month)」예요. 사이트 문구라 손대지 않았어요. 어느 글도 이 머리를 인용하지 않아요.
- 초안의 「Outside the article」(가입 페이지 account.trina.app 의 운영 회사·약관)은 대표에게 보고된 일이라 다시 보지 않았어요.

## 2. 새 글

- 본문: `src/blog/claude-projects-for-teams-files-and-access.en.md` = 초안 17–165행(H1 부터 면책 문구까지).
  - **`cmp`로 바이트 단위로 같아요.** front matter, 출처 메모, Fact-check log 는 넣지 않았어요.
- `POSTS`(`src/content/blog-en.ts`)
  - `title`: 「Claude Projects for teams: files and access」(43자, 「| Trina AX」까지 54자). `description`: 초안 값 그대로(150자)
  - `author: 'minjae-lee'`
  - `published` = `modified` = `read` = `2026-11-01`(오늘 배포한다고 보고)
  - `relatedGuides: ['folder-permissions', 'team-files']`
  - `amounts` 없음. 본문의 금액은 `$39`(`PLANS`) 하나예요. 금액 가드가 그대로 통과해요.
  - 출처 9개: 초안 목록의 제목과 공개 URL. [7]은 `llms.txt` + 홈, [8]은 가이드 「Set folder permissions」, [9]는 보안 페이지예요.
- 카드: `bun run og --blog`로 `public/blog/claude-projects-for-teams-files-and-access.png`(1200×630, sha256 `9aad51b6…`)를 만들었어요.
  - 같이 다시 그려진 앞 세 카드는 **바이트가 같아요**(`2745c1df…`, `88f719e7…`, `b0fd7a3c…`). 그래서 커밋에 없어요.
- 표: 4열, 5행. 첫 열이 모두 `<th scope="row">`예요(기존 `rowHeaders()`).
- 날짜 줄: 「Blog · November 1, 2026 · By Minjae Lee, Co-CEO, Trina Inc.」

## 3. 앞 세 글 — 호스팅 문장만

- 세 초안에서 본문을 다시 잘라 넣었어요. 셋 다 **`cmp`로 같아요**(초안 23–199행, 19–178행, 20–199행).
- 본문 diff(`git diff --word-diff`)로 바뀐 곳이 지시서의 자리뿐인지 봤어요.
  - `share-claude-skills-with-your-team`: 「The software is open source under AGPL-3.0 …」 문단 한 곳
  - `claude-code-for-people-who-dont-code`: 「… Trina's hosting has a free plan …」 한 문장
  - `claude-team-plan-seats-and-usage-limits`: Way 3 의 「The software is free to install yourself …」 문장, 비교표 Trina AX 칸 두 개(Smallest size, A seat someone barely uses)
- 렌더한 페이지를 기준선(`1cf5f18` 빌드)과 비교했어요. 위 문장과 날짜(`article:modified_time`, JSON-LD `dateModified`, 화면 「Updated November 1, 2026」)만 달라요.
- `modified` = 2026-11-01. `published`·`read`는 그대로예요(10-29·10-29, 10-30·10-30, 10-31·10-31).
- 세 번째 글의 `amounts`는 그대로예요. 새 문장의 금액은 `PLANS`(`$39`·`$69`·`$129`)뿐이에요.
- 카드는 제목이 안 바뀌어서 다시 만들지 않았어요(위처럼 바이트도 같아요).

## 4. 확인

- `/blog`: 새 글부터 네 글이에요(11-01 Minjae Lee · 10-31 Dion Nam · 10-30 Minjae Lee · 10-29 Dion Nam).
- 「From the blog」
  - `folder-permissions` → 새 글
  - `team-files` → 두 번째 글, 그 아래 새 글(`POSTS` 순서)
  - `use-skills`·`review-skills` → 첫 글, `desktop-app` → 두 번째 글, `usage-limits`·`ai-connection` → 세 번째 글. 그대로예요.
  - 다른 영어 가이드, 한국어 가이드, 홈에는 없어요.
- sitemap: 새 글과 고친 세 글, `/blog` 모두 `lastmod` 2026-11-01 이에요.
- `llms.txt`: 새 글 한 줄이 더해졌어요. 다른 줄은 라이브와 같아요.

## 바꾼 문장

**없어요.** 네 본문 모두 초안 그대로예요.

## 검증

- `bun run test`: **509 pass, 0 fail**, 11,470 expect.
  - 기준선 `origin/main` `1cf5f18`: 504 pass, 0 fail, 11,102 expect(같은 맥, 임시 worktree).
  - 늘어난 5개(junit 테스트 이름으로 확인): 새 글 페이지에 걸린 사이트 가드 5(금액, YC·별, Drive 이름, 라이선스·저장소, CSP). 기존 단언은 바꾸지 않았어요.
- `bun run build`: 79쪽(78 + 1).
- `bun run verify`(포트 19592, Chromium 실행됨): 「no console errors, no CSP violations, no third-party requests, no overflow at 360/768/1280 in light and dark; behaviour and links OK」.
  - `scripts/verify.mjs`에 새 글(페이지·스크린샷·hreflang·내부 링크)과 `/guide/folder-permissions`(페이지·스크린샷·내부 링크)를 더했어요.
- 새 글 표 폭(Playwright, 라이트·다크 같음)
  - **1280: 표 내용 712px, 본문 폭 712px.** 넘치지 않아요. 열 155·194·190·172px 예요.
  - 360: 표 내용 601px(150px × 4), 상자 328px. 앞 글들처럼 표 칸 안에서 옆으로 스크롤되고 페이지는 넘치지 않아요.
  - 참고로 세 번째 글의 5열 비교표는 그대로 751px > 712px 예요(10-31 기록과 같음).
- `git diff --check`: 통과.
- diff: `/private/tmp/ax-blog-2026-11-01.diff`(`git diff origin/main...HEAD`).

## 남은 결정

1. **날짜.** 새 글의 `published`·`modified`·`read`와 앞 세 글의 `modified` = 2026-11-01 은 오늘(KST) 배포한다고 본 값이에요. 다른 날 배포하면 이 값들을 그날로 바꾸고 출처를 다시 읽어요. Help Center 넷([1]·[2]·[4]·[5])이 「Updated yesterday」예요.
2. **`team-files` 가이드 블록 순서.** 두 글이 `POSTS` 순서(오래된 글 먼저)로 보여요. `/blog`는 새 글 먼저예요. 바꾸려면 `GuideArticle.astro` 일이에요(이번에는 손대지 않음).
3. **무료 팀의 서버.** 위 「참고」의 첫 항목이에요. 사이트가 무료 팀도 자기 서버라고 말하지 않는다면, 두 번째·세 번째 글의 「a server for the company alone」은 유료 플랜 이야기로 읽혀요. 본문은 blog-ops 가 정해요.
4. 배포는 앞 지시서들과 같은 방식이에요.
   - Trina 계정 토큰 환경변수, `wrangler@4.150.0`, `NODE_OPTIONS=--dns-result-order=ipv4first`
   - 배포 전·후 버전 ID 를 적어요.
