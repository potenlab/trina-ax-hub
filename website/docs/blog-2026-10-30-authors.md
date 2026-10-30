# 블로그 저자 인수 기록 — 2026-10-30

넣을 곳: 이 저장소(`potenlab/trina-ax-hub`)의 `website/`(ax.trina.app). 이유: 앞 블로그 작업과 같은 사이트예요.

- 브랜치: `blog-authors`. `origin/main` `4c1639e`(라이브 Workers `b5d331a4…`)에서 땄어요.
- 구현 커밋: `cb4d0dc` `feat(website): blog authors, table row headers, cache rule test`. 이 문서는 다음 커밋이에요.
- push·배포는 하지 않았어요. 「배포해」를 기다려요.
- 지시서: blog-ops `ax/handoffs/2026-10-30-blog-authors-brief.md`. 같은 검수에 넣으라는 추가 지시(Lighthouse 두 항목)도 이 브랜치에 있어요(아래 「추가 지시」).

## 저자 (지시서 1–4절)

- `src/content/blog-en.ts`의 `AUTHORS`에 두 사람만, 받은 값만 넣었어요.
  - `dion-nam`: 「Dion Nam」, 「Co-CEO, Trina Inc.」
  - `minjae-lee`: 「Minjae Lee」, 「Co-CEO, Trina Inc.」
- 소개·사진·프로필 링크·경력은 넣지 않았어요. 테스트가 저자마다 필드가 `name`·`jobTitle` 둘뿐인지 확인해요.
- `Post.author`는 둘 중 하나예요. 첫 글은 `dion-nam`이에요(초안 front matter `author: Dion Nam`). 다음 글부터는 blog-ops 초안의 `author:`를 따라요.
- 화면
  - 글의 날짜 줄은 「Blog · October 29, 2026 · Updated October 30, 2026 · By Dion Nam, Co-CEO, Trina Inc.」예요. 사이트 날짜 줄의 「·」 구분을 그대로 썼어요.
  - `/blog` 목록의 각 글은 「October 29, 2026 · Dion Nam」으로 보여요.
  - 면책 문구는 본문이라 그대로예요.
- 메타
  - `<meta name="author" content="Dion Nam">`와 `<meta property="article:author" content="Dion Nam">`를 글 페이지에만 넣었어요. 테스트가 다른 페이지에 없는지 확인해요.
  - JSON-LD `BlogPosting.author`는 `{"@type":"Person","name":"Dion Nam","jobTitle":"Co-CEO, Trina Inc.","worksFor":{"@id":"https://ax.trina.app/#org"}}`예요. `publisher`는 Organization 그대로예요.
- `llms.txt`: 저자를 넣는 관례가 없어서 그대로예요.
- 날짜: `modified`는 2026-10-30 그대로예요(저자 표기는 본문 변경이 아니에요). 본문 파일도 초안과 그대로 같아요(`cmp` 확인).

## 추가 지시: Lighthouse 두 항목

### 1. `uses-long-cache-ttl` — 전제가 라이브와 달라서 `_headers`는 고치지 않았어요

- `public/_headers`에는 **처음부터**(`e700c5a`) `/_astro/*` → `Cache-Control: public, max-age=31536000, immutable` 규칙이 있어요. 라이브도 그렇게 나가요. `curl -I https://ax.trina.app/_astro/Nav.t9ziCPkZ.css`의 결과가 `cache-control: public, max-age=31536000, immutable`이에요.
- 같은 Lighthouse 12.2.1(이 맥의 npx 캐시)로 라이브 글을 모바일로 다시 쟀어요.
  - 점수: 성능 99 · 접근성 100 · 권장사항 100 · SEO 100. blog-ops 와 같아요.
  - `uses-long-cache-ttl`이 짚은 것은 두 개이고, `/_astro/*`는 없어요.
    - `https://ax.trina.app/theme.js`: 1시간. `_headers`의 기존 `/theme.js` 규칙이에요. 파일 이름에 해시가 없어서 1년·immutable 로 두면 고쳐도 방문자에게 안 가요.
    - `https://static.cloudflareinsights.com/beacon.min.js/…`: 1일. trina.app 존의 Web Analytics 가 브라우저 요청의 HTML 에 끼워 넣는 외부 스크립트라 우리 `_headers`로 바꿀 수 없어요. curl 로 받은 HTML 에는 없고, Chrome 처럼 요청하면 들어가요.
- 그래서 `_headers`는 그대로 뒀어요. 같은 규칙을 또 넣으면 Cloudflare 는 값을 쉼표로 이어 붙여요.
- 대신 요청대로 이 규칙을 확인하는 테스트를 `test/site.test.ts`에 하나 더했어요. 기존 CSP·헤더 테스트는 그대로예요. 새 테스트가 확인하는 것은 세 가지예요.
  - immutable 규칙은 `/_astro/*` 하나뿐이에요.
  - `dist/_astro/`의 모든 파일 이름에 8자 해시가 있고, 모두 1년·immutable 을 받아요.
  - 페이지·`/blog`·글·글 카드·`og.png`·`llms.txt`·`sitemap.xml`·`theme.js`는 1년·immutable 을 받지 않아요.
- 남은 선택(리드·대표)
  - **`theme.js`를 해시 이름으로 바꾸기**: `Base.astro`에서 `?url`로 가져오면 `/_astro/` 아래로 옮겨져 1년 캐시를 받아요. 페인트 전 외부 파일이라는 CSP 조건은 그대로예요.
  - **Web Analytics 비컨 끄기**: 존 설정이에요. 끄면 이 항목과 외부 요청이 사라지지만 방문 통계도 없어져요.
  - **그대로 두기**: 성능 점수는 지금도 99 예요.

### 2. `td-has-header` — 고쳤어요(블로그 렌더에서만)

- 라이브에서 `td-has-header`가 0점이었어요. 비교표의 첫 열(행 이름)이 `<td>`였기 때문이에요.
- `blog-en.ts`의 `rowHeaders()`가 글 HTML 에서 각 행 첫 칸을 `<th scope="row">`로 바꿔요(`[n]` 링크와 같은 자리에서 처리). **사이트 전체 마크다운 설정은 건드리지 않았어요.** 약관 페이지의 표는 그대로예요.
- 화면은 이전과 같아 보여요. 행 이름은 굵게, 배경 없이 나와요(`.blog-text tbody th { background: none }`).
- 로컬 미리보기에서 Lighthouse 를 돌리면 `td-has-header`가 1(통과)이고, 접근성·권장사항·SEO 는 100 이에요.
- 테스트: 글의 모든 `<tbody>` 행이 `<th scope="row">`로 시작하는지 봐요. 단어 순서 대조 테스트도 그대로 통과해요(글자는 안 바뀜).

## 검증

- `bun run test`: **489 pass, 0 fail**, 10,127 expect. 기준선 `4c1639e`는 487 pass 예요. 늘어난 2개는 저자 테스트 1 + 캐시 규칙 테스트 1 이에요. 행 머리글 확인은 기존 본문 테스트 안에 더했어요.
- 앞번에 만든 블로그 테스트는 새 사양대로 기대값을 바꿨어요. 사이트 전체 단언은 그대로예요.
  - 목록 메타에 저자 이름이 들어가요
  - 날짜 줄 끝이 「By …」예요
  - JSON-LD author 가 Person 이에요
- `bun run verify` (포트 19592, Chromium 실행됨) 결과: 「no console errors, no CSP violations, no third-party requests, no overflow at 360/768/1280 in light and dark; behaviour and links OK」.
- 눈으로 본 것(360·1280 × 라이트·다크)
  - 글 날짜 줄은 360 에서 세 줄로 접혀요(「… 2026 ·」, 「Updated … ·」, 「By Dion Nam, Co-CEO, Trina Inc.」)
  - `/blog` 목록에 「October 29, 2026 · Dion Nam」이 보여요
  - 비교표는 이전과 같은 모양이에요
- 기존 페이지 회귀: `origin/main` 빌드와 파일별로 비교했어요. 바뀐 것은 `/blog`(저자 이름)와 글(저자 메타, JSON-LD, 날짜 줄, 표 행 머리글)뿐이에요. 나머지 79개(홈·가이드·약관·`llms.txt`·`sitemap.xml` 등)는 에셋 해시·로고 번호 말고는 같아요.
- `git diff --check`: 통과.

## 남은 결정

1. **푸터의 대표 표기.** 모든 페이지 푸터(전자상거래법 사업자 정보, `src/site.ts` `COMPANY.ceo`)는 「CEO Daehyeon Nam (남대현)」으로 대표 한 명을 법적 이름으로 적어요. 글의 byline 은 「Dion Nam, Co-CEO」예요. 법적 정보라 이번에 바꾸지 않았어요. 푸터에 공동대표를 적을지는 대표가 정해 주세요.
2. **캐시 항목.** 위 「남은 선택」 중 하나(`theme.js` 해시 이름, 비컨 끄기, 그대로 두기).
3. 배포는 앞 지시서들과 같은 방식이에요: Trina 계정 토큰 환경변수, `wrangler@4.150.0`, `NODE_OPTIONS=--dns-result-order=ipv4first`, 배포 전·후 버전 ID 기록. 저자 표기만 바뀌므로 `modified`는 배포일과 관계없이 2026-10-30 그대로예요.
