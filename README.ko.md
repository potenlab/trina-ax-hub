<p align="center">
  <b>트리나 AX: 직원 모두의 Claude를 우리 회사를 아는 AI로</b><br>
  회사가 함께 쓰는 것(사람마다 권한이 다른 회사 파일, 스킬, 사용량)을 허브 한 곳에 두고,<br>
  직원들이 이미 쓰는 Claude에 연결해요. 데스크톱·휴대폰 앱, claude.ai, Claude Code, Cowork 어디서나 돼요.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="라이선스: Apache-2.0"></a>
  <a href="https://github.com/potenlab/trina-ax/actions/workflows/ci.yml"><img src="https://github.com/potenlab/trina-ax/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="#직접-설치"><img src="https://img.shields.io/badge/hub-macOS%20%7C%20Linux-555" alt="허브: macOS | Linux"></a>
</p>

<p align="center">
  <a href="https://ax.trina.app/ko/"><b>웹사이트</b></a> ·
  <a href="#직접-설치"><b>직접 설치</b></a> ·
  <a href="#트리나-호스팅"><b>트리나 호스팅</b></a> ·
  <a href="#보안"><b>보안</b></a> ·
  <a href="docs/DESIGN.md"><b>설계 (영어)</b></a> ·
  <a href="docs/OPERATOR.md"><b>운영 가이드</b></a>
  <br><sub><a href="README.md">English</a></sub>
</p>

## 트리나 AX 소개

직원들이 Claude를 쓰는 회사가, 한 계정을 나눠 쓰지 않고 회사 파일과 일하는 방식을 Claude에 연결하는 허브예요.

- 직원은 각자의 Claude를 그대로 써요. 본인 Team·Pro·Max 좌석이나, 허브를 거치는 회사 API 키로요.
- **허브**(이 저장소)는 트리나가 호스팅하면 `https://<회사>.trina.app`에서, 직접 설치하면 회사의 Mac mini나 Linux 서버에서
  돌아요. 팀 폴더와 회사 스킬, 사용 기록을 맡아요.
- Claude 사용료는 Anthropic이 **회사 계정**으로 청구해요. 구독을 나눠 쓰지 않고, 트리나가 사용료를 되팔지도 않아요.

## 직원이 하는 일

**Claude Team·Enterprise**면 직원 PC에 설치할 게 없어요.

1. 관리자가 허브를 조직 커넥터로 한 번 등록하고, 허브가 만들어 주는 관리형 설정을 붙여 넣어요 (허브의 **관리 › Claude 조직 설정**).
2. 직원은 초대 링크를 열어 비밀번호를 정하고, Claude에서 회사 커넥터의 **연결**을 눌러요.
3. 데스크톱 앱, claude.ai, 휴대폰 앱, Cowork, Claude Code 어디서든 회사 파일을 물어봐요.

**Pro·Max** 개인 구독이면 직원이 커넥터 주소를 한 번 붙여 넣어요 (Claude › 사용자 지정 › 커넥터 › 커스텀 커넥터 추가).
**회사 API 키**로 쓰는 직원은 자기 페이지에 나오는 명령어 한 줄로 Claude Code를 연결해요.

## 주요 기능

- **사람마다 다르게 열리는 회사 파일**: 팀 폴더를 Claude의 도구(`list_files`, `read_file`, `search_files`, `write_file` 등)로
  열어 줘요. 폴더마다 사람·그룹별 권한을 정하고, 볼 수 없는 폴더는 없는 폴더와 똑같이 보여요. PDF, 워드, 파워포인트,
  엑셀, 한글(HWP·HWPX)을 글자로 읽어요. 브라우저에서 파일을 올리고, 내려받고, 정리할 수도 있어요.
- **이전 버전과 되살리기**: 바꾸기 전 파일은 모두 남고, 지운 파일은 휴지통으로 가요. 둘 다 90일 동안 보관해서 되살릴 수 있어요.
- **회사 스킬**: 팀 폴더의 `skills/`에 넣은 스킬을 Claude Code 플러그인으로 묶어 최신으로 유지하고, Claude 앱에서는 연결을 통해 읽어요.
- **Claude 사용 방식 두 가지 (사람마다)**: 각자 구독(기본값, 사용량은 Claude Code가 보내 주는 기록을 Claude 로그인 이메일로
  사람과 맞춰요) 또는 허브의 모델 중계를 거치는 **회사 API 키**(사람·그룹·회사별 월 한도). 회사 키는 허브 밖으로 나가지 않아요.
- **사용량**: 사람·그룹·모델·스킬별로 보고 CSV로 내려받아요.
- **초대**: 관리자가 한 명씩, 또는 목록을 붙여 넣어 한 번에 초대해요. 임시 비밀번호 대신 한 번만 쓰는 링크가 가요.
- **휴대폰 채팅과 예약 작업** (선택, 회사 API 키 필요): 허브가 Claude 세션을 직접 돌려요. 기본 도구는 꺼 두어서 같은 권한
  안에서만 파일에 닿아요.
- **한국어 웹 화면**: 처음 설정, 관리(사람·그룹·폴더 권한·예산·사용량·스킬·Claude 조직 설정·설정·기록·되살리기), 사람마다의 첫 화면.
- **운영 도구**: `trina-ax` 명령(`status`, `doctor`, `backup`, `restore`, `users`, `logs` 등), 항상 켜 두는 macOS 설치 스크립트,
  Linux systemd 유닛, `<회사>.trina.app` 주소를 만드는 `deploy/cloudflare/customer-address.ts`, [운영 가이드](docs/OPERATOR.md).

## 직접 설치

### 내 컴퓨터에서 써 보기

[Bun](https://bun.sh) 1.3.12가 필요해요. ripgrep, pandoc, poppler가 있으면 파일 검색과 문서 글자 읽기가 더해져요.

```bash
git clone https://github.com/potenlab/trina-ax && cd trina-ax
bun install
bun run dev                 # http://127.0.0.1:47900/setup 에서 소유자 만들기 (데이터: ~/TrinaAX, TRINA_AX_HOME으로 바꾸기)
bun run typecheck
bun test tests/unit
bun run test:e2e            # 진짜 Claude Code로 전체 흐름 (`claude`, `cloudflared` 필요)
bun src/cli.ts help         # 관리 명령
```

### Mac mini에 허브 설치

허브 전용 macOS 관리자 계정에서, sudo 없이 실행해요. sudo가 필요한 단계에서만 이유를 보여 주고 물어요.

```bash
git clone https://github.com/potenlab/trina-ax ~/src/trina-ax && cd ~/src/trina-ax
bash deploy/macos/install-hub.sh
trina-ax status                                      # '처음 설정' 주소에서 소유자 만들기
bash deploy/macos/install-hub.sh --tunnel-token-file ~/tunnel-token.txt --public-url https://hub.example.com
trina-ax doctor --live                               # 모두 ✓ 이면 직원 초대
```

- Claude 앱과 스킬에는 https 공개 주소가 필요해요. Cloudflare 터널이면 공유기 포트를 열지 않아도 돼요. 운영 가이드 4장을 따르거나,
  본인 Cloudflare API 토큰으로 `bun deploy/cloudflare/customer-address.ts new <이름> --domain example.com` 을 실행해요.
- 공개 주소는 **직원이 연결하기 전에** 정해요.
- 업데이트: `git pull && bash deploy/macos/install-hub.sh` (설정은 그대로). 제거: `--uninstall` (`data/`와 `team/`은 남아요).
- Linux: [deploy/linux/trina-ax.service](deploy/linux/trina-ax.service) 머리말을 봐요.

## 트리나 호스팅

직접 설치는 무료예요. 직접 운영하기 어렵다면 **트리나가 호스팅해 드려요**. 트리나 서버에서 회사 허브를
`https://<회사>.trina.app`으로 열고, 폴더와 권한을 정리하고, Claude 조직에 연결하고, 업데이트와 백업까지 해요.
원하시면 도입을 같이 진행하고, 매달 자주 하는 일을 스킬로 만들어 더해요.

비용은 견적으로 안내해요 (인원, 파일 양, 운영 범위에 따라 달라요): [ax.trina.app](https://ax.trina.app/ko/) ·
[contact@trina.app](mailto:contact@trina.app?subject=%ED%8A%B8%EB%A6%AC%EB%82%98%20AX%20%EB%8F%84%EC%9E%85%20%EB%AC%B8%EC%9D%98).
호스팅이든 직접 설치든 소프트웨어는 같고, 모두 이 저장소에 있어요. Claude 사용료는 언제나 Anthropic에 직접 내요.

## 보안

- **파일로 가는 문은 하나**: 어느 앱에서 오든 모든 경로가 `authorize()`(`src/policy/`)를 거쳐요. 볼 수 없는 경로는 없는 경로와 똑같이 보여요.
- **PC·앱 연결·사람마다 따로인 토큰**: 해시로만 저장하고 한 번만 보여 줘요. 언제든 끊을 수 있어요. 앱 연결 토큰은 짧게 살고
  모델 중계에 쓸 수 없어요. 조직 토큰(사용량 수집과 조직 공용 스킬 플러그인용)은 그 밖의 일을 못 해요.
- **회사 API 키는 허브에만**: 0600 파일에 두고 다시 보여 주지 않고 기록에도 남기지 않아요.
- **올라온 문서는 격리해서 열어요** (macOS `sandbox-exec`, Linux `bwrap`), 시간·크기 제한과 함께요.
- **웹 보호**: 모든 양식에 CSRF 토큰, https에서는 `__Host-` 쿠키(고객 허브들이 같은 상위 도메인을 써서), 아이디·주소별 로그인 잠금,
  한 번만 쓰는 초대 링크, 소유자는 한 명.
- **기록에 민감한 것 없음**: 로그·감사 기록·오류에 토큰, API 키, 비밀번호, 파일 내용이 남지 않아요.

약속하지 않는 것: Claude가 답하려고 읽은 내용은 쓰는 요금제의 약관에 따라 Anthropic으로 가요. 서버 관리자 권한이 있는 사람은
팀 폴더와 `data/`를 볼 수 있고, 트리나가 호스팅하는 허브라면 트리나 운영자도 여기에 들어가요. https 없이 사무실 안에서만 쓰면
PC와 허브 사이가 암호화되지 않아요. 각자 구독으로 쓰면 비용은 Claude Code가 보내 주는 값으로 낸 추정치예요.
보안 문제를 찾았다면 [SECURITY.md](SECURITY.md)를 봐 주세요.

## 기여

이슈와 PR을 환영해요. [CONTRIBUTING.md](CONTRIBUTING.md)를 먼저 봐 주세요. 기여는 Apache-2.0으로 받고, 커밋마다 DCO 서명
(`git commit -s`)이 필요해요. [행동 강령](CODE_OF_CONDUCT.md)을 지켜 주세요.

## 라이선스

Apache-2.0, [LICENSE](LICENSE)를 봐 주세요. Copyright 2026 Trina Inc. (주식회사 트리나). 고지는 [NOTICE](NOTICE)에, 서드파티 구성
요소는 [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md)에 있어요. "Trina"와 "Trina AX"는 주식회사 트리나의 상표이고 Apache-2.0으로
허락하지 않아요.

---

<p align="center">
  <sub>만든 곳: <a href="https://trina.app">주식회사 트리나</a> (Trina Inc.) · <a href="mailto:contact@trina.app">contact@trina.app</a><br>
  Claude, Claude Code, Cowork는 Anthropic의 상표예요. 트리나 AX는 Anthropic과 관계없는 별도 제품이에요.</sub>
</p>
