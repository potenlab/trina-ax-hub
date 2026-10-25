# Trina AX

공유 계정 없이 쓰는 회사 Claude. 직원 각자의 PC에서 Claude Code(또는 데스크톱 앱의 Code 탭)가 돌고,
사무실의 Mac mini 한 대(또는 Linux 서버)에 있는 **허브**가 회사가 함께 쓰는 것을 맡아요.

- **회사 파일**: 팀 폴더를 MCP 도구로 열어 줘요. 폴더별 권한, 기록, 지운 파일·이전 버전 보관.
- **회사 스킬**: 팀 폴더의 `skills/`를 사람마다 Claude Code 플러그인으로 묶어 자동 설치·업데이트.
- **모델 중계**: PC의 모델 요청이 허브를 거쳐 **고객사 자신의 Anthropic API 키**로 결제돼요. 사람·그룹별 예산과 사용량.
- **허브 세션**: 휴대폰 채팅과 예약 작업.
- **웹 화면**: 처음 설정, 관리(사람·그룹·폴더 권한·예산·사용량·스킬·설정·기록), 내 PC 연결, 휴대폰 채팅.

구독 로그인이나 OAuth 토큰을 여러 사람이 나눠 쓰지 않아요. 토큰을 되팔지도 않아요.

English: a company hub for Claude Code. Claude runs on each employee's PC; the hub serves company files (MCP),
skills (a plugin marketplace), a model relay billed to the customer's own Anthropic API key with per-person budgets,
and phone chat. Design and module contracts: [docs/DESIGN.md](docs/DESIGN.md). Installing and running it at a
customer: [docs/OPERATOR.md](docs/OPERATOR.md) (Korean).

## 개발자 빠른 시작

```bash
bun install
bun run dev                 # http://127.0.0.1:47900/setup 에서 소유자 만들기 (데이터: ~/TrinaAX, TRINA_AX_HOME으로 바꾸기)
bun run typecheck
bun test tests/unit         # 단위 테스트 (deploy 스크립트는 가짜 launchctl/sudo로 실제 실행해 봐요)
bun run test:e2e            # 진짜 Claude Code로 전체 흐름
bun src/cli.ts help         # 관리 명령
```

Bun 1.3.12 · TypeScript strict · Hono · bun:sqlite. 규칙은 [CLAUDE.md](CLAUDE.md), 누가 어느 파일을 맡는지는 DESIGN.md.

## 운영자 빠른 시작 (고객사 Mac mini)

허브 전용 macOS 계정(관리자)으로, sudo 없이:

```bash
git clone <저장소> ~/src/trina-ax && cd ~/src/trina-ax      # 또는 tarball (OPERATOR.md 2장)
bash deploy/macos/install-hub.sh                           # 시스템 서비스로 설치. sudo는 필요한 단계에서만, 이유를 보여 주고 물어요
trina-ax status                                            # '처음 설정' 주소에서 소유자 만들기
bash deploy/macos/install-hub.sh --tunnel-token-file ~/tunnel-token.txt --public-url https://ax.acme.co.kr
trina-ax doctor --live                                     # 모두 ✓ 이면 직원 연결 시작
```

- 공개 주소(https)는 **직원을 연결하기 전에** 정하세요. PC는 연결할 때의 주소를 기억해요.
- 업데이트: `git pull && bash deploy/macos/install-hub.sh` (설정은 그대로). 제거: `--uninstall` (data/와 team/은 남아요).
  제거 전에 모든 PC에서 연결을 먼저 풀어야 해요.
- Linux 서버: [deploy/linux/trina-ax.service](deploy/linux/trina-ax.service) 머리말.
- 방문 전 준비, Cloudflare 터널, 직원 20명 연결, 백업·되살리기, 문제 해결: [docs/OPERATOR.md](docs/OPERATOR.md).
