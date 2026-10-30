# 블로그 두 번째 글 인수 기록 — 2026-10-30

넣을 곳: 이 저장소(`potenlab/trina-ax-hub`)의 `website/`(ax.trina.app). 이유: 앞 블로그 작업과 같은 사이트예요.

- 브랜치: `blog-claude-code-non-developers`. `origin/main` `c9d81ed`에서 땄어요.
  - 라이브도 `c9d81ed` 빌드예요(홈 에셋 이름과 `llms.txt`가 같아요).
- 구현 커밋: `a9b42bc` `feat(website): second blog post, Claude Code for people who don't code`. 이 문서는 다음 커밋이에요.
- push·배포는 하지 않았어요. 「배포해」를 기다려요.
- 지시서: blog-ops `ax/handoffs/2026-10-30-claude-code-for-people-who-dont-code-brief.md`. 앞 지시서 셋의 규칙을 따랐어요.
- 초안: blog-ops `ax/drafts/2026-10-30-claude-code-for-people-who-dont-code.md`
  - `status: fact-checked 2026-10-30`
  - sha256 `553783dd…41f135`

## ⚠ 먼저 볼 것: `c9d81ed`가 이 글이 피한 경로를 사이트에 넣었어요

작업을 시작할 때 `origin/main`에 새 커밋 `c9d81ed`가 있었어요.
- 제목: `fix(website): describe subscription sharing as on by default`
- 작성: Codex, 10-30 09:47 KST
- 라이브에 이미 나가 있어요.

바뀐 것은 세 가지예요.

1. **사이트 문구.** 홈의 「Which Claude plan do we need?」·결제 절·첫 주 체크리스트, 가이드 `ai-connection`, `llms.txt`, 브로셔가 바뀌었어요.
   - 새 문구: 「One team connection added by an admin can serve the whole team. Subscription sharing is on by default, and anyone who adds their own connection uses theirs first.」
   - 지시서 「참고」는 사이트가 「각자 자기 Claude 플랜 연결」을 적는다고 했는데, 지금은 **구독 하나를 팀이 같이 쓰는 것이 기본**이라고 적어요.
2. **약관 4.3.** 「In particular, people must not share one Claude login.」을 지우고 「Anthropic's plan terms and usage policies apply.」만 남겼어요.
3. **첫 글 본문.** `share-claude-skills-with-your-team.en.md`의 「Usage you can see」 항목이 바뀌었어요. 그래서 첫 글은 이제 blog-ops 초안과 **바이트 단위로 같지 않아요.**
   - 초안: 「Claude access comes from each person's own Claude plan or from one company API key with a monthly limit per person. [6]」
   - 지금 main·라이브: 「One team connection added by an admin can serve the whole team. Subscription sharing is on by default, and anyone who adds their own connection uses theirs first. A company API key with monthly limits per person is also an option. Each AI provider’s plan terms apply. [6]」

**이 글의 게시는 멈추지 않았어요.** 이유는 이래요.
- 이 글이 [8]로 인용한 문장은 라이브에 모두 그대로 있어요(아래 표).
- 이 글은 회사 API 키 경로만 적는데, 「You can also use a company API key with monthly limits per person.」도 그대로 있어요.
- 그래서 본문과 출처가 어긋나지 않아요.

다만 초안 「Fact-check log」 마지막 문단이 대표 확인 전까지 일부러 뺀 문제가 사이트에 더 강한 형태로 들어갔어요. 이 저장소 `CLAUDE.md`도 「Never share a Claude subscription login or OAuth token between people」라고 적고 있어요. 그래서 대표·blog-ops가 정할 일로 남겨요(「남은 결정」 1). 지시서대로 사이트 문구와 첫 글은 건드리지 않았어요.

## 1. 게시 직전 재확인 (출처별)

모두 **같음**이라 게시 작업을 진행했어요. 확인 시각은 2026-10-30 10:16–10:25 KST예요. 원문은 curl 로 받아(`.md`가 있는 문서는 `.md`로) 문장 단위로 대조했어요.

| 출처 | 다시 읽은 것 | 결과 |
| --- | --- | --- |
| [5] Help Center 15520349 | 200 | **같음.** 유료 플랜 4개, 「On October 6, 2026, new Cowork tasks on Pro and Max plans run in the cloud.」, 표면별 이용(Desktop 전 유료, 웹·모바일 Pro·Max·Team(Team 베타)·Enterprise 는 owner 가 켜면), 「Scheduled tasks run with no device online.」, 로컬 파일은 「only while the desktop app is open, only for folders you've connected」, 「there's no "Cowork" option to select. Describe your task」 |
| [6] Help Center 14479288 | 200 | **같음.** 「Cowork sessions run in the cloud by default」, 「Local execution remains available for existing desktop deployments」, 「only through the Claude Desktop app … only for folders the member has connected, and only while the app is online」, 「processed on Anthropic's servers … isn't used to train Claude」 |
| [7] Help Center 13455879 | 200 | **같음.** 「on by default, but organization owners can manually disable it」, Run Cowork in the cloud 「Team plans: on by default」·「Enterprise plans: off by default」, 「Local sessions: Claude's work runs on the user's computer」, Required 플러그인 「Members can't turn it off or remove it」, OpenTelemetry 로 SIEM 에 스트리밍 |
| [8] `/llms.txt`, 홈 (라이브) | 200 | **같음.** 서버 종류(사무실 Mac mini·Linux, 서울 AWS 전용 서버), 웹·데스크톱·폰, 「Do employees have to install anything? No.」, 팀·그룹·프로젝트 폴더 권한과 「The AI sees only the files the person asking can open」, 팀 스킬 검토, 일정 실행, 「company API key with monthly limits per person」, 「usage by person, model and skill」, 운영자 접근, 「What the AI reads to answer goes to Anthropic under your Claude plan's terms.」, AGPL, 인원별 월 요금제, 「Claude usage is billed by Anthropic, not by Trina.」. 구독 공유 문구는 위 ⚠ 절 |
| [9] `/guide/desktop-app`, `/guide/phone-app` (라이브) | 200 | **같음.** 「Download buttons appear only when installers have been added to your team server.」, 「Your company address must be reachable from your phone.」 |
| [10] `/security` (라이브) | 200 | **같음.** 「This is a pre-release with no security certification yet.」 |
| [11] `gh api repos/trina-app/trina-ax` | — | **같음.** public, license `AGPL-3.0` |
| [12] Self-hosted environments | 200 (`.md`) | **같음.** 「Run Claude Code cloud sessions on infrastructure you control」, 「in public beta on Team and Enterprise plans and are off by default」 |

참고로 적어 둘 것 두 가지예요(본문과 어긋나지 않아요).

- [5]의 표 아래 메모에 조건이 하나 더 있어요: 「… only while the desktop app is open on that computer **and the session was started on desktop or is a scheduled task**」. 본문 「only through …, only in folders …, and only while the app is open」은 필요조건만 말하므로 틀리지 않아요. 초안 메모에는 없는 조건이라 적어 둬요.
- [1]–[4]는 재확인 범위 밖이에요. 그래도 출처 목록을 만들며 열어 봤고, 핵심 인용은 그대로 있어요.
  - [1] 「agentic coding tool that reads your codebase…」
  - [2] 「The free claude.ai plan does not include Claude Code access.」
  - [3] 「Research, document editing, and spreadsheet work stay in Cowork.」
  - [4] 「uses the same agentic architecture that powers Claude Code」
  - 다만 **[2] 페이지 제목은 지금 「Advanced setup」**이에요(초안 「Set up Claude Code」). 「남은 결정」 2.

## 2. 글

- 본문은 `src/blog/claude-code-for-people-who-dont-code.en.md`예요.
  - 초안 16–174행(H1부터 면책 문구까지)이고, **`cmp`로 바이트 단위로 같아요.**
  - front matter, 초안 「Sources」 메모, 「Fact-check log」는 넣지 않았어요.
- `POSTS`(`src/content/blog-en.ts`)에 넣은 값이에요.
  - `title`·`description`: 초안 값 그대로(설명 154자)
  - `author: 'minjae-lee'`
  - `published` = `modified` = `2026-10-30`(오늘 배포한다고 보고), `read: '2026-10-30'`
  - `relatedGuides: ['desktop-app', 'team-files']`
- 출처 12개는 초안 목록의 제목과 공개 URL 만 썼어요.
  - [8]은 `llms.txt` + 홈, [9]는 두 가이드, [10]은 보안 페이지, [11]은 저장소예요. [8]–[10]의 제목은 첫 글처럼 사이트 데이터에서 가져와요.
  - [12]는 Anthropic Self-hosted environments 예요.
  - 본문의 `[1]`–`[12]`는 모두 링크가 되고, 빈 번호나 인용되지 않은 출처는 없어요(테스트).
- 글 카드: `bun run og --blog`로 `public/blog/claude-code-for-people-who-dont-code.png`(1200×630)를 만들었어요.
  - 글 제목과 「Trina AX Blog」만 있어요.
  - 같이 다시 그려진 첫 글 카드는 **바이트가 같아서** 그대로예요(`cmp`, sha256 `2745c1df…`).
- 표: 비교표 8행의 첫 칸이 기존 `rowHeaders()`로 `<th scope="row">`가 돼요.
- 가이드 링크: 영어 `/guide/desktop-app`과 `/guide/team-files` 끝에 「From the blog」로 이 글이 보여요.
  - 첫 글은 `use-skills`·`review-skills`에 그대로예요.
  - 다른 가이드, 한국어 가이드, 홈에는 블록이 없어요.
- `/blog`: 새 글이 위예요. 「October 30, 2026 · Minjae Lee」 다음에 「October 29, 2026 · Dion Nam」이 와요.
- 글 날짜 줄: 「Blog · October 30, 2026 · By Minjae Lee, Co-CEO, Trina Inc.」(게시일 = 수정일이라 「Updated」 없음)
- sitemap(`lastmod` 2026-10-30)과 `llms.txt` 「Pages」에 들어갔어요.

## 바꾼 문장

**없어요.** 렌더링에서 생기는 차이는 이래요.

- 사이트 마크다운 설정(smartypants)이 직선 `'`를 `’`로 바꿔요. 그래서 H1 은 「Claude Code for people who don’t code」로 보여요.
- 첫 글 제목에는 `'`가 없어서 이 차이가 처음 드러났어요. 기존 테스트 두 개가 걸렸어요.
  - 「화면 H1 = `title`」
  - 「JSON-LD `headline` = 화면 H1」
- 그래서 `headline(post)`(제목의 `'` → `’`)를 두고 JSON-LD `headline`에 써요.
  - 테스트는 화면 H1 이 그 값과 **정확히** 같은지 봐요. 첫 글은 이전과 같은 비교이고, 「headline = 화면 H1」 단언은 그대로예요.
  - 사이트 전체 마크다운 설정은 건드리지 않았어요.
- 아래 값은 초안 값 그대로라 직선 `'`예요.
  - `<title>`, `og:title`, `og:image:alt`, meta description
  - `/blog` 목록, 「From the blog」 블록, `llms.txt`, 카드 글자
- 「How to choose」의 `1.`–`3.`은 번호 목록(`<ol>`)으로 보여요.

## 테스트 변경 (넓힘만, 기존 단언 약화 없음)

새 글은 `POSTS`를 도는 기존 블로그 테스트와 사이트 전체 가드를 모두 받아요.

1. `test/blog.test.ts`
   - H1 단언의 기대값을 `p.title`에서 `headline(p)`로 바꿨어요. 아포스트로피가 없는 제목에서는 같은 값이에요. 렌더러가 `’`를 만들지 않으면 실패하므로 느슨해지지 않았어요.
   - ⚠ 검수 포인트: 이걸 단언 변경으로 본다면 대안은 둘이에요. H1 만 smartypants 에서 빼기, 또는 블로그 제목에 `’`를 쓰기(그러면 초안 값과 달라져요).
2. `test/blog.test.ts` 새 테스트 「/blog lists every post once, newest first」: 목록 순서와 날짜를 봐요.
3. `test/site.test.ts` 캐시 규칙 테스트: 손으로 적은 첫 글 경로는 그대로 두고, 모든 글과 글 카드를 더했어요.
4. `scripts/verify.mjs`
   - 새 글과 `/guide/desktop-app`을 페이지 목록·스크린샷에 더했어요.
   - 새 글을 hreflang 검사에 더했어요.
   - 새 글과 두 가이드(`desktop-app`·`team-files`)를 내부 링크 검사에 더했어요.

## 검증

- `bun run test`: **495 pass, 0 fail**, 10,492 expect.
  - 기준선 `c9d81ed`는 489 pass, 10,127 expect 예요(같은 맥, 임시 worktree).
  - 늘어난 6개: 새 순서 테스트 1, 새 글 페이지에 걸린 사이트 가드 5(금액, Drive, YC·별, CSP, 라이선스·저장소). junit 결과의 테스트 이름으로 비교했어요.
- `bun run build`: 77쪽(76 + 1).
- `bun run verify`(포트 19592, Chromium 실행됨): 「no console errors, no CSP violations, no third-party requests, no overflow at 360/768/1280 in light and dark; behaviour and links OK」.
- 눈으로 본 것: 360 다크·1280 라이트의 새 글, 1280 `/blog`.
  - 비교표는 1280 에서 네 열이 다 보여요. 360 에서는 표 칸 안에서 옆으로 스크롤돼요(첫 글과 같은 CSS 규칙). 페이지는 넘치지 않아요.
  - 행 머리글은 굵게, 배경 없이 보여요.
- 기존 페이지 회귀: 기준선 빌드와 파일별로 비교했어요(에셋 해시·로고 마스크 번호는 맞춰서).
  - 바뀐 것: `/blog`, 영어 가이드 `desktop-app`·`team-files`(`/en/` 별칭 포함, 블록 추가), `llms.txt`, `sitemap.xml`
  - 첫 글 페이지를 포함한 나머지는 같아요.
- `git diff --check`: 통과.
- diff: `/private/tmp/ax-blog-2026-10-30.diff`(`git diff origin/main...HEAD`).

## 남은 결정

1. **`c9d81ed`의 구독 공유 문구**(위 ⚠ 절). 대표·blog-ops 가 정해 주세요.
   - 사이트·약관·첫 글을 그대로 둘지
   - 첫 글을 초안대로 되돌릴지
   - 이 글을 그 상태로 게시할지

   이 작업에서는 아무것도 바꾸지 않았어요.
2. **[2] 제목.** 지시서대로 초안 제목 「Set up Claude Code」를 썼어요. 페이지 제목은 지금 「Advanced setup」이에요. 바꾸려면 `blog-en.ts` 한 줄이에요.
3. **날짜.** `published` = `modified` = 2026-10-30 은 오늘(KST) 배포한다고 본 값이에요. 다른 날 배포하면 두 값을 그날로 바꾸고, 출처를 다시 읽고 `read`도 바꿔요. 테스트가 sitemap `lastmod`·JSON-LD·화면 날짜를 같이 봐요.
4. **카드의 `'`.** 카드 글자는 초안 제목 그대로 직선 `'`예요. 화면 H1 과 맞추려면 `scripts/og.ts`에서 `headline()`을 쓰면 돼요. 첫 글 카드는 바뀌지 않아요.
5. 배포는 앞 지시서들과 같은 방식이에요.
   - Trina 계정 토큰 환경변수, `wrangler@4.150.0`, `NODE_OPTIONS=--dns-result-order=ipv4first`
   - 배포 전·후 버전 ID 를 적어요.
   - 앞 인수 문서(`blog-2026-10-30-authors.md`)의 남은 결정(푸터 대표 표기, 캐시 항목)도 그대로 남아 있어요.
