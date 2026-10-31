# 블로그 세 번째 글 인수 기록 — 2026-10-31

넣을 곳: 이 저장소(`potenlab/trina-ax-hub`)의 `website/`(ax.trina.app). 이유: 앞 블로그 작업과 같은 사이트예요.

- 브랜치: `blog-claude-team-plan-seats`. `origin/main` `62304f8`에서 땄어요.
  - 라이브도 `62304f8` 빌드예요(라이브 `llms.txt` = 이 빌드에서 새 글 한 줄을 뺀 것).
- 커밋: 구현 커밋 하나와 이 문서 커밋이에요. 처음 멈췄을 때의 wip 커밋은 정리했어요.
- push·배포는 하지 않았어요. 「배포해」를 기다려요.
- 지시서: blog-ops `ax/handoffs/2026-10-31-claude-team-plan-seats-and-usage-limits-brief.md`와 그 뒤 blog-ops 결정(아래). 앞 지시서들의 규칙을 따랐어요.
- 초안: blog-ops `ax/drafts/2026-10-31-claude-team-plan-seats-and-usage-limits.md`
  - `status: fact-checked 2026-10-31`
  - sha256 `0b01ce92…5e10fe`(결정 뒤 고친 판)

## 처음에 멈춘 이유와 blog-ops 결정

처음 넣었을 때 기존 테스트 두 개가 이 글에 걸려 멈췄어요. blog-ops 가 세 가지를 정했어요.

1. **제목 길이**(`test/blog.test.ts:45`, 「제목 | Trina AX」 ≤ 60자). 처음 제목은 65자였어요.
   - 결정: 초안 제목·H1 을 「Claude Team plan: usage limits and unused seats」로 줄임(47 + 11 = **58자**).
   - 60자 한도와 제목 꼴은 그대로예요. slug 도 그대로예요.
2. **금액 가드**(`test/site.test.ts`, 페이지의 `$` 금액은 `PLANS`만). 이 글의 Anthropic 금액 26개가 걸렸어요.
   - 결정: 글 페이지에서만 `PLANS` ∪ 그 글의 `amounts`를 허용. 정규식은 숫자로 끝나게. 새 테스트 둘. 아래 「테스트 변경」에 적었어요.
3. **비교표 폭**(1280 에서도 표 칸 안 스크롤).
   - 결정: 초안에서 열 머리를 「Claude Console (Claude Code)」·「Trina AX (company API key)」로 줄임. 그래도 넘치면 그대로 두고 사이트 CSS 는 바꾸지 않음.
   - 결과는 「검증」에 적었어요(그대로 넘쳐요).

## 1. 게시 직전 재확인 (출처별)

모두 **같음**이에요. 확인 시각은 2026-10-31 10:48–10:50 KST예요. curl 로 받아(`.md`가 있는 문서는 `.md`로) 금액·배수·상한·최소 인원부터 문장 단위로 대조했어요. 결정 뒤 초안에서 바뀐 곳은 H1 과 비교표 머리 두 곳뿐이라(본문 diff 로 확인) 다시 읽지 않았어요.

| 출처 | 결과 |
| --- | --- |
| [1] claude.com/pricing | **같음.** Team 「For teams of 2 to 150」, Standard `$20`/`$25`, Premium `$100`/`$125`·「5x more usage than standard seats」, 「Mix and match seat types」, 「Up to $500 per month in pooled API credits」, Fable 「50% of weekly limits on premium seats」, Usage analytics·조직 스킬·SSO Yes, Enterprise 「US$20/seat/month, billed annually, 20 seat minimum」, API Sonnet 5.5 `$2`/`$10`·Opus 5.5 `$4`/`$20`·Haiku 5.5 ≤100K `$0.10`/`$0.50`, FAQ 「weekly and monthly caps」·「standard API rates」·「pay-as-you-go API credits through a Console account」, 세금 제외 |
| [2] Help Center 9266767 | **같음**(「Updated today」). 최소 2명, 가격 4개, 미국·세금 제외, 최대 150석, Standard 1.25x·Premium 6.25x, 주간 한도, 「per-member」·「can't be transferred or shared」·「one named individual」 |
| [3] Help Center 12004354 | **같음.** 좌석 표, 한 사람만, 남은 사용량 이전 불가, 순환 사용 금지, 감석·Premium→Standard 는 다음 갱신일·일할 환불 없음, 한 번에 합계 설정·Standard 하한, No seat assigned, 대기 초대는 셈에 들어감, 예약 변경은 하나만, 추가·업그레이드 즉시 일할 청구, 멤버 제거는 환불 없음 |
| [4] Help Center 11647753 | **같음**(「Updated today」). 첫 메시지부터 5시간, 주간 고정 시각, claude.ai·Claude Code·Claude Desktop 한 한도, 「weekly and monthly caps」 |
| [5] Help Center 12005970 | **같음.** 사전 구매, 사람별·조직 전체 켜기, 조직·사람별 월 한도, 「pause their usage credits until the end of the month」, 「MTD Spend column … optimize seat assignments」, API 단가 |
| [6] Help Center 9267289 | **같음**(「Updated today」). 즉시 일할 청구, 환불 없음, 풀 「capped at $500」, 3 Standard + 2 Premium = `$260`, 연간 `$2,400`, 월간 `$250` |
| [7] Help Center 17154008 | **같음**(「Updated today」). 「build Claude into your own apps and agents with the Claude API」, 풀 `$500`·`$260` |
| [8] Help Center 12883420 | **같음.** Team Owner·Primary Owner, 이니셜 메뉴의 Analytics, Weekly active members, 「Active members and assigned seats」, Members, Adoption level, Skills |
| [9] Help Center 9797531, 11526368 | **같음.** 좌석비는 접근만, Claude·Claude Code·Cowork 전부 API 단가, 사람별 한도 없음, 조직·사람별 지출 한도, 셀프 20석·영업 50석, 선불 크레딧·월 후불, 셀프는 중도 감석 불가, 잔액 0이면 조직 전체 중단 |
| [10] Claude Code overview (`.md`) | **같음.** 13행 「Most surfaces require a Claude subscription or Anthropic Console account.」, 114행 데스크톱 「A paid subscription is required.」 |
| [11] Workspaces (`.md`) | **같음.** 첫 Console 로그인 때 Claude Code workspace 자동 생성, 「the only workspace that supports per-user monthly spend limits」 |
| [12] `/llms.txt`, 홈 (라이브) | **같음.** 서버 종류(사무실 Mac mini·Linux, 서울 AWS 전용 서버), 웹·데스크톱·폰, 사람·모델·스킬별 사용량과 CSV, 「billed by Anthropic, not by Trina」, 「has run a server before」, 운영자 접근, 「under your Claude plan's terms」, AGPL-3.0, `$39`(5)·`$69`(15)·`$129`(40)·세금 제외·설치 포함·40명 초과 견적 |
| [13] `/guide/ai-connection` | **같음.** Product 0.2.2 · Checked October 28, 2026. 「choose Claude API key」, 「Whole team or Chosen groups and people」, 「This guide covers the company API key option.」 |
| [14] `/guide/usage-limits` | **같음.** 같은 판. Person·Per month·Token limit·Spending limit (USD), Warn only·Block, 「estimated at list prices … may differ from the provider’s bill」 |
| [15] `/security` | **같음.** 「This is a pre-release with no security certification yet.」 |
| [16] Authentication (`.md`) | **같음.** 「Your admin must have invited you first.」, 「For organizations that prefer API-based billing…」, 키 없는 로그인 「(recommended)」 「creates no API key」 |

저장소 `trina-app/trina-ax`: public, `AGPL-3.0`(`gh api`).

참고로 적어 둘 것이에요(본문과 어긋나지 않아요).
- [10] 페이지 제목이 지금 「Overview」예요. 초안과 두 번째 글 [1]은 「Claude Code overview」예요. 지시서대로 초안 제목을 썼어요.
- [7] URL 은 `…/17154008-monthly-api-credits-for-max-ultra-and-team-plans`로 301 돼요. 초안 URL 을 그대로 썼어요.
- [1] `<title>`은 「Plans & pricing」, H1 은 「Pricing」(초안 제목)이에요.
- [7] FAQ 「Does this cover claude -p?」: 연결한 Console 조직의 API 키로 직접 돌리는 `claude -p`는 API 크레딧이 덮는다고 적어요. 초안 「Not changed」의 Reviewer O4 와 관련 있어요. 본문은 이걸 말하지 않아요.

## 2. 글

- 본문: `src/blog/claude-team-plan-seats-and-usage-limits.en.md` = 초안 18–196행(H1 부터 면책 문구까지).
  - **`cmp`로 바이트 단위로 같아요.** 초안에서 H1 시작부터 「Anthropic.*」 줄 끝까지를 따로 잘라 비교했어요.
  - front matter, 출처 메모, Fact-check log 는 넣지 않았어요.
- `POSTS`(`src/content/blog-en.ts`)
  - `title`: 「Claude Team plan: usage limits and unused seats」. `description`: 초안 값 그대로(143자)
  - `author: 'dion-nam'`
  - `published` = `modified` = `2026-10-31`(오늘 배포한다고 보고), `read: '2026-10-31'`
  - `relatedGuides: ['usage-limits', 'ai-connection']`
  - `amounts`: 이 글이 출처에서 인용한 Anthropic 금액 14개 — `$25` `$20` `$125` `$100` `$500` `$260` `$2,400` `$250` `$4,800` `$2` `$10` `$4` `$0.10` `$0.50`. Trina 호스팅 금액은 넣지 않았어요.
  - 출처 16개: 초안 목록의 제목과 공개 URL. [9]는 Help Center 두 문서, [12]는 `llms.txt` + 홈, [13]·[14]는 가이드, [15]는 보안 페이지, [16]은 Authentication 이에요.
- 카드: `bun run og --blog`로 `public/blog/claude-team-plan-seats-and-usage-limits.png`(1200×630, 새 제목, sha256 `b0fd7a3c…`)를 만들었어요.
  - 같이 다시 그려진 앞 두 카드는 **바이트가 같아요**(sha256 `2745c1df…`, `88f719e7…`).
- 표 두 개 모두 첫 열이 `<th scope="row">`예요(청구 시점 표 4행 + 비교표 6행). 기존 `rowHeaders()`가 처리해요.
- `/blog`: 새 글부터 세 글이에요(10-31 Dion Nam · 10-30 Minjae Lee · 10-29 Dion Nam).
- 「From the blog」: `usage-limits`·`ai-connection` → 새 글. 앞 두 글의 블록(`use-skills`·`review-skills`, `desktop-app`·`team-files`)은 그대로예요. 다른 가이드에는 없어요.
- 날짜 줄: 「Blog · October 31, 2026 · By Dion Nam, Co-CEO, Trina Inc.」
- sitemap(`lastmod` 2026-10-31)과 `llms.txt`에 새 글이 있어요.

## 바꾼 문장

**없어요.** 제목과 비교표 머리는 blog-ops 가 초안에서 고쳤고, 그 초안을 그대로 옮겼어요.

## 테스트 변경 (blog-ops 결정대로)

1. `test/site.test.ts` 금액 가드
   - **블로그 글 페이지에서만** 허용 집합 = `PLANS` ∪ 그 글의 `amounts`. 다른 모든 페이지(`/blog` 목록, 가이드, 홈, `llms.txt`)와 `amounts`가 없는 앞 두 글은 지금처럼 `PLANS`만이에요.
   - 가드 위에 이유 한 줄: 블로그 글은 출처에서 날짜와 함께 인용한 제3자 금액을 쓸 수 있고, 그 목록은 `POSTS`에 적힌 것뿐이에요.
2. 금액 정규식: `\$\s?\d[\d,.]*` → `\$\s?\d+(?:[.,]\d+)*`(`test/helpers.ts`의 `MONEY`). 같은 금액을 잡되 뒤 문장 부호를 안 먹어요.
   - 기존 77쪽 + `llms.txt`(새 글 제외)에서 잡히는 금액: 옛 식 **31개**, 새 식 **31개**, 같은 목록이에요(`$39`×19, `$69`×6, `$129`×6). 파일마다 순서까지 같아요.
   - 달라지는 곳은 새 글뿐이에요: `$260.`·`$20,`·`$100.` → `$260`·`$20`·`$100`.
   - `₩` 금액 정규식은 지시 범위 밖이라 그대로예요.
3. `test/blog.test.ts` 새 테스트 둘
   - (a) 「every amount a post lists is in its text」: 글의 `amounts`가 모두 그 글 md 에 같은 정규식으로 나와요.
   - (b) 「a post’s amounts never include a Trina hosting price」: `amounts`와 `PLANS` 금액이 겹치지 않아요.
4. 가드가 실제로 막는지 일부러 틀린 값으로 확인했어요(확인 뒤 원래대로 돌림). 각각 해당 테스트 하나만 실패했어요.
   - `amounts`에서 `$4,800`을 빼면 → 금액 가드 실패
   - `amounts`에 `$39`를 넣으면 → (b) 실패
   - `amounts`에 `$999`를 넣으면 → (a) 실패
   - 두 번째 글에 `amounts: ['$25']`를 넣으면 → (a) 실패
5. `scripts/verify.mjs`: 새 글과 `/guide/usage-limits`를 페이지 목록·스크린샷에, 새 글을 hreflang 검사에, 새 글과 두 가이드(`usage-limits`·`ai-connection`)를 내부 링크 검사에 더했어요.

## 검증

- `bun run test`: **502 pass, 0 fail**, 11,067 expect.
  - 기준선 `origin/main` `62304f8`: 495 pass, 0 fail, 10,492 expect(같은 맥, 임시 worktree).
  - 늘어난 7개(junit 테스트 이름으로 확인): 새 글 페이지에 걸린 사이트 가드 5(금액, YC·별, Drive, 라이선스·저장소, CSP) + 새 테스트 2.
- `bun run build`: 78쪽(77 + 1).
- `bun run verify`(포트 19592, Chromium 실행됨): 「no console errors, no CSP violations, no third-party requests, no overflow at 360/768/1280 in light and dark; behaviour and links OK」.
- 비교표 폭(1280 라이트, 다시 잼): **표 751px, 본문 폭 712px.** 열 머리를 줄이기 전과 같아요.
  - 폭은 내용이 아니라 `src/styles/blog.css:36`의 칸 최소 폭 `min-width: 150px`가 정해요. 다섯 열 × 150px + 테두리 = 751px 예요. 내용만으로는 최소 400px 이면 돼요.
  - 결정대로 그대로 둬요. 표 칸 안에서 옆으로 스크롤되고, 페이지는 넘치지 않아요. 360 에서도 앞 글들처럼 표 칸 안에서 스크롤돼요.
  - 청구 시점 표(두 열)는 두 폭 모두 다 보여요.
- `git diff --check`: 통과.
- diff: `/private/tmp/ax-blog-2026-10-31.diff`(`git diff origin/main...HEAD`).

## 남은 결정

1. **날짜.** `published` = `modified` = 2026-10-31 은 오늘(KST) 배포한다고 본 값이에요. 다른 날 배포하면 세 값을 그날로 바꾸고 출처를 다시 읽어요. Help Center 넷이 「Updated today」예요.
2. **비교표 폭.** 다섯 열 표는 칸 최소 폭 때문에 데스크톱에서도 스크롤돼요. 바꾸려면 사이트 CSS 일이에요(이번에는 손대지 않음).
3. 배포는 앞 지시서들과 같은 방식이에요.
   - Trina 계정 토큰 환경변수, `wrangler@4.150.0`, `NODE_OPTIONS=--dns-result-order=ipv4first`
   - 배포 전·후 버전 ID 를 적어요.
