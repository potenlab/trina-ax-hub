# Trina AX 운영 가이드 (TreeSoop 엔지니어용)

고객사 사무실의 Mac mini(또는 Linux 서버) 한 대에 허브를 설치하고 운영하는 방법이에요.
**직원 모두의 Claude가 이 허브를 거쳐요. 허브가 멈추면 회사 전체의 Claude가 멈춰요.** 이 문서의 절반은 그걸 막는 이야기예요.

- 제품 구조와 모듈 계약: [DESIGN.md](DESIGN.md)
- 허브 명령 전체: `trina-ax help`, 명령별 자세히: `trina-ax help <명령>`

## 목차

1. [방문 전 준비](#1-방문-전-준비)
2. [코드 가져오기](#2-코드-가져오기)
3. [허브 설치](#3-허브-설치)
4. [Cloudflare 터널 (공개 주소)](#4-cloudflare-터널-공개-주소)
5. [공개 주소는 직원 연결 전에](#5-공개-주소는-직원-연결-전에)
6. [회사 파일 옮기기와 폴더 권한](#6-회사-파일-옮기기와-폴더-권한)
7. [직원 20명 연결하기](#7-직원-20명-연결하기)
8. [평소 점검](#8-평소-점검)
9. [퇴사자 · 비밀번호 분실 · 새 PC](#9-퇴사자--비밀번호-분실--새-pc)
10. [백업과 되살리기](#10-백업과-되살리기)
11. [업데이트](#11-업데이트)
12. [새 모델 가격](#12-새-모델-가격)
13. [계약 종료 · 제거](#13-계약-종료--제거)
14. [문제 해결](#14-문제-해결)
15. [명령 요약](#15-명령-요약)

---

## 1. 방문 전 준비

고객사 담당자와 미리 정해 둘 것들이에요. 현장에서 막히는 건 대부분 여기서 시작돼요.

| 항목 | 정할 것 · 확인할 것 | 메모 |
|---|---|---|
| 하드웨어 | Mac mini (Apple Silicon, 메모리 16 GB 이상), 저장 공간은 팀 폴더 크기 × 3 이상 | 휴대폰 채팅·예약 작업은 허브에서 Claude Code를 돌려요 |
| macOS | 14 Sonoma 이상, 최신 업데이트 | 자동 업데이트는 "보안 응답만"으로 (재시동 시간 통제) |
| 계정 | 허브 전용 macOS 계정 하나 (예: `trina`, **관리자** 권한) | 설치할 때 sudo가 필요해요. 대표님 개인 계정은 쓰지 마세요 |
| 다른 계정 | 허브 Mac에 다른 사용자 계정을 만들지 않기 | macOS 사용자는 모두 `staff` 그룹이라 팀 폴더(0750)를 읽을 수 있어요 |
| FileVault vs 자동 부팅 | 아래 표를 보고 고객과 결정 | **가장 중요한 결정이에요** |
| 전원 | 정전 후 자동 시동, 잠자기 끔 (설치 스크립트가 해요). UPS가 있으면 더 좋아요 | |
| 네트워크 | **유선 랜**, 공유기에서 이 Mac에 **고정 IP(DHCP 예약)** | 주소가 바뀌면 사내 PC 연결이 끊겨요. MAC 주소: `networksetup -getmacaddress en0` |
| Anthropic | **고객 소유** Console 조직 + API 키 (아래) | TreeSoop 키를 쓰면 토큰 재판매가 돼요. 절대 안 돼요 |
| Cloudflare | 터널을 만들 계정과 도메인의 주인 (아래) | 계약이 끝나도 남는 쪽이 갖는 게 좋아요 |
| 직원 목록 | 이름, 아이디(영문), 부서(그룹), 관리자 여부, PC 종류(Mac/Windows) | CSV로 받으면 한 번에 만들 수 있어요 (7장) |
| 회사 파일 | 지금 어디에 있는지 (NAS, Google Drive, 개인 PC), 크기, 부서별 공개 범위 | 6장 |

### FileVault와 자동 부팅

허브는 **시스템 서비스(LaunchDaemon)** 로 설치돼서, Mac이 켜지기만 하면 아무도 로그인하지 않아도 시작해요.
단, FileVault가 켜져 있으면 정전·업데이트 후 **부팅 자체가 암호 입력 화면에서 멈춰요.** 그동안 허브도 꺼져 있어요.

| 선택 | 정전 뒤 | 디스크 암호화 | 이럴 때 |
|---|---|---|---|
| FileVault 끔 | 전기가 들어오면 스스로 켜지고 허브도 켜져요 | 없음 (Mac을 통째로 가져가면 읽을 수 있어요) | 서버실·잠기는 방에 두는 경우. **기본 권장** |
| FileVault 켬 | 누군가 Mac 앞에서 암호를 넣어야 켜져요 | 있음 | 보안 규정상 암호화가 필수인 경우. 계획된 재시동은 `sudo fdesetup authrestart` |

자동 로그인은 필요 없어요 (시스템 서비스라서). sudo를 못 쓰는 환경이라 `--agent`로 설치하면 그때만 자동 로그인이 필요하고,
자동 로그인은 FileVault와 함께 쓸 수 없어요.

### Anthropic Console (고객 소유)

1. 고객 담당자가 https://console.anthropic.com 에서 **회사 이름으로** 조직을 만들어요 (TreeSoop 엔지니어는 멤버로 초대받기).
2. 결제: 회사 카드로 **선불 크레딧**을 넣고 **자동 충전(auto-reload)** 을 켜요. 잔액이 떨어지면 모든 직원의 Claude가 멈춰요.
3. Workspaces에서 `Trina AX` 워크스페이스를 만들고, 거기서 API 키를 만들어요 (이름: `trina-ax-hub`). 키는 한 번만 보여요.
4. Limits에서 등급(Tier)과 분당 한도를 확인해요. 20명이 Claude Code를 같이 쓰면 낮은 등급에서는 한도에 걸려요.
   크레딧 누적 결제액으로 등급이 오르니 첫 충전을 넉넉히 하는 것을 권해요.
5. 키는 허브에 바로 넣어요 (`trina-ax set-key` 또는 설정 화면). 메신저·메일로 보내지 마세요.

### Cloudflare (공개 주소)

회사 스킬 설치와 사무실 밖 접속에는 https 공개 주소가 필요해요. Cloudflare Tunnel을 쓰면 공유기 포트를 열지 않아도 돼요.

| 누가 갖나 | 장점 | 주의 |
|---|---|---|
| **기본:** TreeSoop 계정 + `<회사>.trina.app` (예: `acme.trina.app`) | 명령 하나로 끝나요 (4장). 고객은 아무것도 준비하지 않아도 돼요 | 계약이 끝나면 주소가 사라져요. 13장 순서를 꼭 지키기 |
| 고객 계정 + 고객 도메인 (예: `ax.acme.co.kr`) | 계약이 끝나도 고객 것 | 고객이 원할 때만. 도메인의 네임서버가 Cloudflare에 있어야 해요 (서브도메인만 쓰려면 그 영역 전체) |

`<회사>` 는 영문 소문자·숫자·하이픈 2~40자예요 (예: `acme`, `acme-korea`). `acme.ax.trina.app` 처럼 두 단계로 만들지 않아요.
Cloudflare 무료 인증서(Universal SSL)가 `*.trina.app` 한 단계만 덮어서, 두 단계 이름은 https가 안 돼요.

---

## 2. 코드 가져오기

허브 Mac에서, 허브 전용 계정으로 로그인해서 해요.

**A. Git (비공개 저장소, 읽기 전용 배포 키)**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/trina_ax_deploy -N '' -C "trina-ax hub <고객사>"
cat ~/.ssh/trina_ax_deploy.pub     # → GitHub 저장소 Settings > Deploy keys 에 추가 (Allow write access 끄기)
cat >> ~/.ssh/config <<'EOF'
Host github-trina-ax
  HostName github.com
  IdentityFile ~/.ssh/trina_ax_deploy
  IdentitiesOnly yes
EOF
git clone git@github-trina-ax:<org>/trina-ax.git ~/src/trina-ax
```

**B. tarball (인터넷·GitHub 접근이 어려울 때)**

```bash
# TreeSoop 노트북에서
git archive --format=tar.gz -o trina-ax-$(git describe --always).tar.gz HEAD
# 허브 Mac으로 옮긴 뒤 (USB, AirDrop, scp)
mkdir -p ~/src/trina-ax && tar xzf trina-ax-*.tar.gz -C ~/src/trina-ax
xattr -dr com.apple.quarantine ~/src/trina-ax   # 내려받은 파일 표시 지우기
```

`~/src/trina-ax`는 원본이에요. 설치하면 `~/TrinaAX/app`으로 복사되고, 허브는 그 복사본으로 돌아요.

---

## 3. 허브 설치

준비물: [Homebrew](https://brew.sh) (없으면 먼저 설치). bun, ripgrep, pandoc, poppler, cloudflared는 스크립트가 brew로 설치해요.
휴대폰 채팅·예약 작업을 쓰려면 허브 계정에 Claude Code도 설치해요 (**로그인은 하지 마세요.** 허브가 회사 키로 직접 돌려요):

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

설치 (터널 토큰은 4장에서 만들어요. 처음에는 없이 설치하고 나중에 다시 실행해도 돼요):

```bash
cd ~/src/trina-ax
bash deploy/macos/install-hub.sh --tunnel-token-file ~/tunnel-token.txt --public-url https://acme.trina.app
```

| 옵션 | 뜻 | 기본 |
|---|---|---|
| `--home DIR` | 설치 폴더 | `~/TrinaAX` |
| `--port N` | 허브 포트 | 47900 (다시 실행하면 있던 값 유지) |
| `--host ADDR` | 듣는 주소. `0.0.0.0` = 사내 PC도 접속, `127.0.0.1` = 터널로만 | 0.0.0.0 (유지) |
| `--public-url URL` | 공개 https 주소 (`trina-ax set-url --public`과 같아요) | 유지 |
| `--lan-url URL` | 사내 주소. 없으면 이 Mac의 IP를 찾아서 넣어요 | 자동 |
| `--tunnel-token-file FILE` | Cloudflare 터널 토큰 → 터널 서비스 설치. 다음부터는 저장된 토큰을 써요 | |
| `--no-tunnel` | 터널 서비스와 토큰 지우기 | |
| `--agent` | sudo를 쓸 수 없을 때: 로그인해야 켜지는 사용자 서비스 | 쓰지 마세요 |
| `--no-power` | 전원 설정(pmset)을 건드리지 않기 | |
| `--uninstall [--yes]` | 제거 (13장) | |

스크립트가 하는 일과 sudo를 쓰는 곳 (쓰기 전에 화면에 이유를 보여 주고 암호를 한 번 물어요):

| 단계 | sudo | 내용 |
|---|---|---|
| 앱 준비 | | `~/TrinaAX/app.new`에 복사·의존성 설치 후 `app`과 바꿔요. 실패하면 돌던 허브는 그대로 |
| 설정 | | `data/config.json`의 host/port/주소는 옵션을 줄 때만 바꿔요 |
| 시스템 서비스 | ✓ | `/Library/LaunchDaemons/app.trina-ax.hub.plist` (+ `.tunnel`), 이 계정 권한으로 실행, 죽으면 다시 켜짐 |
| 로그 순환 | ✓ | `/etc/newsyslog.d/trina-ax.conf`: `hub.log`, `tunnel.log`를 10 MB마다 압축해 7개까지 |
| 전원 | ✓ | `pmset -a sleep 0 disksleep 0 autorestart 1 womp 1` (화면은 꺼져도 돼요) |
| 방화벽 | ✓ | macOS 방화벽이 켜져 있으면 bun의 수신 연결을 미리 허용 (시스템 서비스는 허용 창을 못 띄워요) |
| 명령 | ✓ | `/usr/local/bin/trina-ax` → `~/TrinaAX/bin/trina-ax` |

폴더 권한: `~/TrinaAX` 0750, `data` 0700 (DB·API 키), `logs` 0700, `team` 0750.

**처음 설정 (소유자 계정)**: 설치가 끝나면 `trina-ax status`가 `처음 설정` 주소를 보여 줘요.

- 허브 Mac 앞이라면: `http://127.0.0.1:47900/setup`
- 다른 컴퓨터(SSH로 설치한 경우)에서는: 토큰이 붙은 주소 `http://<사내 IP>:47900/setup?t=…` (한 번만 써요)

회사 이름, 소유자(고객사 대표 또는 IT 담당) 아이디·비밀번호, API 키를 넣으면 끝이에요. 그다음:

```bash
trina-ax doctor --live      # 모두 ✓ 인지 확인 (✗ 가 있으면 14장)
```

---

## 4. Cloudflare 터널 (공개 주소)

### 기본: `<회사>.trina.app` (명령 하나)

**TreeSoop 운영자 컴퓨터에서** 실행해요 (고객 Mac 아님). Cloudflare 토큰이 고객 Mac에 가지 않게 하려는 거예요.
토큰은 `~/.config/trina-ax/cloudflare-token` (또는 `CLOUDFLARE_API_TOKEN`, `--cf-token-file`)에서 읽어요.
권한: trina.app 의 Zone · Zone · Read 와 Zone · DNS · Edit, 계정의 Cloudflare Tunnel · Edit.

```bash
bun deploy/cloudflare/customer-address.ts new acme          # 터널 trina-ax-acme + DNS acme.trina.app + 토큰 파일
scp ./acme-tunnel-token.txt <허브 Mac>:~/tunnel-token.txt && rm ./acme-tunnel-token.txt
```

허브 Mac에서:

```bash
bash ~/src/trina-ax/deploy/macos/install-hub.sh --tunnel-token-file ~/tunnel-token.txt --public-url https://acme.trina.app
rm ~/tunnel-token.txt
```

다시 운영자 컴퓨터에서 `bun deploy/cloudflare/customer-address.ts check acme` → 모두 ✓ 이면 끝이에요.

| 명령 | 하는 일 |
|---|---|
| `new <회사> [--port 47900]` | 이름 확인 → 터널 → 터널 경로(`https://<회사>.trina.app` → 허브 `127.0.0.1:<port>`) → DNS → 토큰 파일 (0600, 화면에 안 찍어요). 다시 실행해도 안전해요 |
| `check <회사>` | DNS · 터널 경로 · 터널 상태 · `https://<회사>.trina.app/healthz` 를 하나씩 확인. 문제가 있으면 1로 끝나요 |
| `list` | 만든 고객 주소와 터널 상태 (켜짐 · 꺼짐 · 아직 연결 전) |
| `token <회사>` | 토큰 파일 다시 받기 (허브 Mac을 바꿀 때) |
| `remove <회사> --yes` | DNS와 터널 지우기 (13장 순서대로, 마지막에) |

이미 쓰는 이름(`www`, `console`, `drive` 등 트리나가 쓰는 이름, 이미 DNS가 있는 이름)은 거절해요.
허브 포트를 바꿨다면 `--port` 를 같이 줘요 (`trina-ax status` 에 나와요).

### 고객 도메인을 쓸 때 (예: `ax.acme.co.kr`)

고객 Cloudflare 계정에서 대시보드로 만들어요.

1. Cloudflare 대시보드 → **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel** → **Cloudflared**.
2. 이름: `trina-ax-<고객사>`. 다음 화면의 설치 명령 `cloudflared service install eyJ…` 에서 **`eyJ…` 부분(토큰)만** 복사해요.
   (그 명령을 그대로 실행하지 마세요. 허브 설치 스크립트가 터널 서비스를 직접 만들어요.)
3. 허브 Mac에 토큰 파일을 만들어요:
   ```bash
   pbpaste > ~/tunnel-token.txt && chmod 600 ~/tunnel-token.txt
   ```
4. 터널의 **Public hostname** (요즘 화면에서는 *Published application routes*) 추가:
   - Subdomain `ax`, Domain `acme.co.kr`
   - Service Type **HTTP**, URL **`localhost:47900`**
5. 설치 스크립트를 다시 실행하고 토큰 파일을 지워요 (토큰은 `~/TrinaAX/data/tunnel-token`에 0600으로 저장돼요):
   ```bash
   bash ~/src/trina-ax/deploy/macos/install-hub.sh --tunnel-token-file ~/tunnel-token.txt --public-url https://ax.acme.co.kr
   rm ~/tunnel-token.txt
   ```
6. 확인: `trina-ax doctor` 에서 **공개 주소 ✓**, **공개 경로 ✓**.

> **허브 주소 앞에 막는 것을 두지 마세요.** Claude Code와 설치 스크립트는 브라우저가 아니라서 로그인 화면이나 사람 확인을 통과하지 못해요.
> 아래 경로에는 **Cloudflare Access, Bot Fight Mode, WAF challenge(Managed Challenge, JS Challenge), Under Attack 모드** 중 어떤 것도 걸면 안 돼요:
> `/v1/*` (모델), `/mcp` (회사 파일), `/plugins/*` (회사 스킬), `/install.sh`, `/install.ps1`, `/api/enroll`.
> Bot Fight Mode는 도메인(영역) 전체에 걸려서 경로별로 뺄 수 없어요. 이 영역에서 끄거나 다른 도메인을 쓰세요.
> 허브는 자체 로그인, 기기별 토큰, 요청 제한을 이미 갖고 있어요.

---

## 5. 공개 주소는 직원 연결 전에

PC는 **연결할 때의 허브 주소**를 Claude 설정에 저장해요. 나중에 주소를 바꾸면 모든 PC에서 설치 명령을 다시 실행해야 해요.

1. 공개 주소(https)를 먼저 정하고 (`trina-ax set-url --public https://acme.trina.app` 또는 설정 화면 > 주소)
2. `trina-ax restart`
3. `trina-ax doctor`에서 공개 주소 ✓ 를 본 다음에 직원을 연결해요.

공개 주소가 있으면 사무실 PC도 공개 주소를 써요 (어디서나 같은 주소). 공개 주소 없이 사내 주소만 쓰면 회사 스킬이 설치되지 않고,
사무실 밖에서는 연결이 안 돼요.

---

## 6. 회사 파일 옮기기와 폴더 권한

팀 폴더는 `~/TrinaAX/team`이에요. 처음 설정하면 이렇게 만들어져요:

| 폴더 | 기본 권한 | 용도 |
|---|---|---|
| `shared/` | 모두 읽기·쓰기 | 회사 공용 문서 |
| `skills/` | 모두 읽기 | 회사 스킬 (`skills/company/<스킬>/SKILL.md`), 회사 규칙 `skills/RULES.md` |
| `users/<아이디>/` | 본인만 | 개인 폴더 |
| `.trina/` | 아무도 (허브 전용) | 지운 파일 보관함(`trash/`), 이전 버전(`versions/`) |

옮기는 순서:

1. 부서별로 폴더를 정해요. 예: `shared/공지`, `영업/`, `재무/`, `인사/`.
2. 파일을 복사해요 (권한·날짜 유지). 외장 디스크나 NAS에서:
   ```bash
   rsync -a --progress /Volumes/NAS/영업/ ~/TrinaAX/team/영업/
   ```
   Google Drive는 먼저 내려받아서 복사해요. 복사가 끝나면 `ls -la ~/TrinaAX/team` 으로 주인이 허브 계정인지 확인해요.
3. 관리 > **그룹**에서 부서 그룹을 만들고, 관리 > **폴더 권한**에서 폴더마다 그룹에 `볼 수 없음 / 읽기 / 읽기·쓰기`를 정해요.
   (규칙이 없는 폴더는 위 폴더의 규칙을 따라요. 민감한 폴더는 `모두: 볼 수 없음` 후 해당 그룹만 열기.)
4. 직원 계정으로 Claude에게 "재무 폴더에 뭐가 있어?"라고 물어서 권한이 맞는지 확인해요.

> **팀 폴더를 SMB(파일 공유)·AirDrop·클라우드 동기화로 직접 열지 마세요.** 그 길로 들어온 사람에게는 Trina의 폴더 권한과
> 기록(감사 로그), 이전 버전 보관이 적용되지 않아요. 직원은 Claude(MCP)로만 회사 파일에 닿게 하는 것이 원칙이에요.

---

## 7. 직원 20명 연결하기

### 7-1. 계정 만들기

웹: 관리 > **사람** > 사람 추가 (임시 비밀번호가 한 번 나와요). 많으면 허브 터미널에서 한 번에:

```bash
# people.csv:  아이디,이름   (한 줄에 한 명, 머리글 없이)
while IFS=, read -r id name; do trina-ax user-add "$id" "$name"; done < people.csv | tee ~/임시비밀번호.txt
```

`~/임시비밀번호.txt`는 각자에게 직접 전한 뒤 **바로 지워요** (`rm -P ~/임시비밀번호.txt`). 관리자는 `--admin`.
그다음 웹에서 그룹을 정해요 (관리 > 사람 > 그 사람 > 그룹).

예산: 관리 > **예산**에서 회사·그룹·사람별 월 한도를 정해요. 한도에 닿으면 그 사람의 Claude가 이유를 한국어로 알려 주며 멈춰요.

### 7-2. 자리마다 (한 사람 5분)

| 순서 | Mac | Windows |
|---|---|---|
| 1 | 브라우저로 `https://acme.trina.app/login` → 임시 비밀번호로 로그인 → 새 비밀번호 | 같음 |
| 2 | **내 PC** > **PC 연결하기** → Mac 명령 복사 | **PC 연결하기** → Windows 명령 복사 |
| 3 | 터미널 앱에 붙여 넣기 (`curl -fsSL …/install.sh \| bash -s -- <코드>`) | PowerShell(관리자 아님)에 붙여 넣기 (`& ([scriptblock]::Create((irm …/install.ps1))) <코드>`) |
| 4 | Claude Code가 없으면 스크립트가 공식 설치기로 깔아요 | 같음. Claude Code가 Windows에서 **Git for Windows**를 요구하면 먼저 설치해야 해요 → **시범 PC 한 대에서 먼저 확인** |
| 5 | 새 터미널에서 `claude` → "회사 공유 폴더에 뭐가 있어?" | 새 PowerShell 창에서 `claude` → 같음 |
| 6 | `claude mcp list` 에 `trina` ✓, `/plugin` 에 `company@trina-ax` | 같음 |

- 연결 코드는 24시간, 한 번만 써요. 관리자가 대신 만들 수도 있어요: `trina-ax enroll <아이디>`.
  이렇게 만든 연결은 본인 개인 폴더(`users/<아이디>/`)를 열기 전에 본인이 내 PC 화면에서 승인해야 해요.
- 데스크톱 앱의 Code 탭도 같은 설정(`~/.claude/settings.json`)을 써요.
- 설치 스크립트는 원래 설정을 백업하고, 더한 것만 `--uninstall`로 되돌려요.

---

## 8. 평소 점검

| 언제 | 무엇 | 어디서 |
|---|---|---|
| 매주 | 대시보드: 이번 달 비용, 활동한 사람, 한도 가까운 예산 | 관리 > 대시보드 |
| 매주 | `trina-ax doctor --live` (모두 ✓) | 허브 터미널 (SSH 가능) |
| 매주 | 백업이 새로 생겼는지 (10장) | 백업 디스크 |
| 매월 | Anthropic 콘솔 잔액·자동 충전·한도 | console.anthropic.com |
| 매월 | 허브·Claude Code 업데이트 (11장) | |
| 필요할 때 | 사용량 상세·CSV, 기록(누가 무엇을 했나) | 관리 > 사용량, 기록 |
| 문제 생겼을 때 | `trina-ax status`, `trina-ax logs -f`, `trina-ax logs --tunnel` | 허브 터미널 |

`trina-ax doctor`가 보는 것: 서버 응답(과 버전), 소유자, API 키(`--live`면 Anthropic에 실제 확인, 10초 제한, 키는 안 보여요),
공개 주소 `/healthz`와 `/v1 /mcp /plugins /install.sh`가 Cloudflare에 막히지 않는지, 사내 주소, claude 버전, 디스크 여유,
DB 검사(`PRAGMA quick_check`), 팀 폴더 쓰기, data 폴더 권한, 잠자기 설정, 로그 크기. ✗ 가 있으면 1로 끝나요.

---

## 9. 퇴사자 · 비밀번호 분실 · 새 PC

| 상황 | 할 일 |
|---|---|
| 퇴사 | 관리 > 사람 > 그 사람 > 상태 **꺼짐**: 웹 로그인과 모든 PC 연결이 바로 끊겨요. 개인 폴더 `~/TrinaAX/team/users/<아이디>/`에서 필요한 파일을 `shared/`로 옮겨요. 회사 PC라면 그 PC에서 `--uninstall`도 실행 (Claude가 없는 허브를 찾지 않게) |
| 비밀번호 분실 | 관리 > 사람 > **비밀번호 초기화**, 또는 `trina-ax reset-password <아이디>` (웹 로그인만 끊기고 PC는 그대로 돼요). 소유자가 잊었으면 허브 터미널에서 `trina-ax reset-password <소유자 아이디>` |
| 새 PC | 본인이 내 PC > PC 연결하기 → 새 PC에서 명령 실행. 예전 PC는 내 PC 목록(또는 관리 > 사람)에서 **끊기** |
| PC 분실 | 관리 > 사람 > 그 사람 > PC 목록에서 바로 **끊기**. 그 PC의 토큰은 더 이상 아무것도 못 해요 |

---

## 10. 백업과 되살리기

| 방법 | 무엇 | 메모 |
|---|---|---|
| Time Machine | `~/TrinaAX` 전체 (기본으로 포함, 제외 목록 확인) | 디스크 고장·Mac 교체 대비. DB는 쓰는 중에 복사될 수 있어서 아래 백업도 같이 |
| `trina-ax backup <폴더> [--with-team]` | DB 일관된 복사본(`VACUUM INTO`), `data/secrets` (API 키), `config.json`, 터널 토큰, `--with-team`이면 팀 폴더 | 허브를 끄지 않고 돼요. 폴더 0700, 파일 0600. **API 키가 들어 있으니 안전한 곳에** |

매일 새벽 자동 백업 (외장 디스크 `/Volumes/Backup` 예시, 30일 지난 것 정리):

```bash
crontab -e
# 매일 02:30
30 2 * * * /usr/local/bin/trina-ax backup /Volumes/Backup/trina --with-team >> ~/TrinaAX/logs/backup.log 2>&1 && find /Volumes/Backup/trina -maxdepth 1 -name 'trina-ax-backup-*' -mtime +30 -exec rm -rf {} +
```

cron이 외장 디스크에 쓰려면 시스템 설정 > 개인정보 보호 및 보안 > **전체 디스크 접근 권한**에 `/usr/sbin/cron`을 추가해야 해요.

### 되살리기 (허브 전체)

백업 폴더의 `RESTORE.txt`에 그 백업에 맞는 명령이 그대로 적혀 있어요. 순서는:

1. `trina-ax stop`
2. 지금 데이터 옮겨 두기: `mv ~/TrinaAX/data ~/TrinaAX/data.before-restore`
3. `mkdir -m 700 ~/TrinaAX/data && cp -Rp <백업>/data/. ~/TrinaAX/data/`
4. `chmod 700 ~/TrinaAX/data ~/TrinaAX/data/secrets && chmod 600 ~/TrinaAX/data/hub.db`
5. 팀 폴더가 필요하면 `rsync -a <백업>/team/ ~/TrinaAX/team/`
6. `trina-ax start && trina-ax doctor`

새 Mac으로 옮길 때: 새 Mac에 2·3장대로 설치 → 위 순서로 data/와 team/을 넣기 → 같은 공개 주소(터널 토큰)를 쓰면 PC는 다시 연결할 필요가 없어요.

### 되살리기 연습 (분기마다 한 번)

백업이 정말 열리는지, 운영 허브를 건드리지 않고 확인해요:

```bash
B=/Volumes/Backup/trina/trina-ax-backup-<날짜>      # 확인할 백업
T=$(mktemp -d) && mkdir -m 700 $T/data && cp -Rp $B/data/. $T/data/
# 다른 포트, 이 Mac 안에서만, Claude 실행 끔, 회사 키로 Anthropic을 부르지 않게
export TRINA_AX_HOME=$T TRINA_AX_PORT=47999 TRINA_AX_HOST=127.0.0.1 TRINA_AX_CLAUDE_BIN= TRINA_AX_UPSTREAM=http://127.0.0.1:9
# trina-ax 명령은 운영 허브 폴더로 고정돼 있어서, 여기서는 CLI를 직접 불러요
bun ~/TrinaAX/app/src/cli.ts users && bun ~/TrinaAX/app/src/cli.ts doctor   # 사람 목록이 맞고 DB ✓ 인지
bun ~/TrinaAX/app/src/main.ts            # http://127.0.0.1:47999 에 로그인해 사용량·기록 확인 후 Ctrl+C
unset TRINA_AX_HOME TRINA_AX_PORT TRINA_AX_HOST TRINA_AX_CLAUDE_BIN TRINA_AX_UPSTREAM; rm -rf $T
```

### 파일 하나 되살리기

허브는 파일을 지우거나 덮어쓸 때 원래 것을 보관해요: 지운 파일은 `team/.trina/trash/<날짜>/…`, 덮어쓴 파일의 이전 버전은
`team/.trina/versions/<id>` (목록은 DB의 `file_versions`).

- 관리 화면의 **되살리기** 페이지(휴지통·이전 버전)에서 골라서 되살려요.
- 터미널: `trina-ax restore` (곧 추가돼요, `trina-ax help restore`).
- 마지막 수단: `ls ~/TrinaAX/team/.trina/trash/` 에서 찾아 원하는 위치로 복사.

---

## 11. 업데이트

**허브** (근무 시간 밖에. 5–10초 끊기고, 돌던 휴대폰 채팅 작업은 중단돼요):

```bash
cd ~/src/trina-ax && git pull            # 또는 새 tarball을 같은 곳에 풀기
bash deploy/macos/install-hub.sh         # 옵션 없이: 설정·주소·터널은 그대로
trina-ax doctor --live
```

PC 쪽은 할 일이 없어요. 회사 스킬은 Claude Code가 알아서 업데이트하고, 설치 스크립트를 다시 돌릴 일은 드물어요.

**허브의 Claude Code** (휴대폰 채팅·예약 작업용, 허브 작업은 자동 업데이트를 꺼 두고 돌아요):

```bash
claude update && claude --version
trina-ax restart && trina-ax doctor      # claude ✓ 와 버전 확인, 휴대폰 채팅으로 한 번 시험
```

`brew upgrade`로 bun이 바뀌었다면 `install-hub.sh`를 한 번 다시 실행해요 (서비스 경로, 방화벽 허용 목록).

**Linux 허브**: `deploy/linux/trina-ax.service` 머리말 참고. 업데이트는 `git pull` → `bun install --production --frozen-lockfile` → `trina-ax restart`.

---

## 12. 새 모델 가격

사용량 화면의 비용은 허브의 가격표(USD / 100만 토큰)로 계산해요. 모르는 모델은 **가장 비싼 가격**으로 계산해서 싸게 보이지 않아요.
새 모델이 나오면:

1. https://platform.claude.com 의 가격 페이지에서 입력·출력·캐시 쓰기(5분/1시간)·캐시 읽기 가격을 확인해요.
2. `trina-ax pricing check claude-<새 모델>` → "가장 비싼 가격으로 계산" 이 나오면 추가가 필요해요.
3. JSON 파일을 만들어 저장 (`set`은 더한 항목 전체를 바꿔요. 기존 것도 함께 적기):
   ```bash
   cat > ~/prices.json <<'EOF'
   [{ "match": "^claude-sonnet-6(-\\d{8}|-latest)?$", "input": 3, "output": 15, "cacheWrite5m": 3.75, "cacheWrite1h": 6, "cacheRead": 0.3 }]
   EOF
   trina-ax pricing set ~/prices.json && trina-ax pricing check claude-sonnet-6
   ```
4. 다음 요청부터 적용돼요 (재시작 필요 없음). 이미 기록된 비용은 바뀌지 않아요. 되돌리기: `trina-ax pricing reset`.

---

## 13. 계약 종료 · 제거

**순서가 중요해요.** 허브를 먼저 지우면 직원 PC의 Claude가 없어진 허브를 계속 찾아서 아무것도 안 돼요.

1. 고객에게 날짜를 알리고, **모든 PC에서 연결 해제**:
   - Mac: `curl -fsSL https://acme.trina.app/install.sh | bash -s -- --uninstall`
   - Windows: `& ([scriptblock]::Create((irm https://acme.trina.app/install.ps1))) -Uninstall`
   - 관리 > 사람에서 연결된 PC 수가 0이 될 때까지 확인 (못 하는 PC는 그 PC의 `~/.claude/settings.json`에서 `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` 지우기)
2. 데이터 넘기기: `trina-ax backup /Volumes/<고객 디스크> --with-team` (회사 파일은 `team/`에 그대로 있어요)
3. 허브 제거: `bash ~/TrinaAX/app/deploy/macos/install-hub.sh --uninstall`
   (서비스·plist·로그 순환 설정·`app/`·명령을 지우고, `data/`와 `team/`은 남겨요)
4. Cloudflare: 운영자 컴퓨터에서 `bun deploy/cloudflare/customer-address.ts remove acme --yes` (고객 도메인이면 고객 대시보드에서 터널과 DNS 레코드 지우기)
5. Anthropic: 고객이 콘솔에서 허브 API 키를 폐기 (Settings > API keys)
6. 고객이 원하면 남은 데이터 지우기: `rm -rf ~/TrinaAX` (되돌릴 수 없어요. 2번 백업을 넘긴 뒤에)

---

## 14. 문제 해결

먼저 `trina-ax doctor --live` 를 돌리면 대부분 어디가 문제인지 나와요.

| 증상 | 원인 · 확인 | 해결 |
|---|---|---|
| 모든 PC에서 Claude가 멈춤 | 허브가 꺼짐: `trina-ax status` | `trina-ax start`, 안 되면 `trina-ax logs` 마지막 줄 |
| 아침마다 안 됨, 밤에는 됨 | Mac이 잠듦: `pmset -g` 의 `sleep` | `sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1` (설치 스크립트를 다시 돌려도 돼요) |
| 정전 뒤 허브가 안 켜짐 | FileVault 잠금 화면에서 멈춤, 또는 자동 시동 꺼짐 | Mac 앞에서 암호 입력. 1장 FileVault 결정 다시 보기, `pmset -g` 의 `autorestart 1` |
| 사내 PC만 "연결하지 못했어요" | 방화벽, 사내 IP 바뀜, host가 127.0.0.1 | PC 브라우저에서 `http://<IP>:47900/healthz`. `ipconfig getifaddr en0` 로 IP 확인 → `trina-ax set-url --lan …`, DHCP 예약. 방화벽: 시스템 설정 > 네트워크 > 방화벽에서 bun 허용 (`install-hub.sh` 다시 실행) |
| PC 설치 중 "허브(…)에 연결하지 못했어요" | 주소 오타, 터널 꺼짐, 회사 프록시 | 그 PC 브라우저에서 `<허브 주소>/healthz` 가 `{"ok":true…}` 인지. `trina-ax logs --tunnel`. 프록시가 있으면 IT에 허브 도메인 예외 요청 |
| "연결 코드를 확인하지 못했어요 … 아무것도 바꾸지 않았어요" | 코드 만료(24시간)·이미 사용·계정 꺼짐·오타. 설치 스크립트는 Claude Code를 받기 **전에** 코드부터 허브에 물어봐요(코드는 쓰지 않아요). 그래서 몇 분 기다린 뒤에 실패하지 않고, PC에는 아무것도 바뀌지 않아요. 이유(만료/사용/없음)는 화면에는 안 나오고 허브 로그(`trina-ax logs`의 `enroll check refused`)에만 남아요 | 내 PC > PC 연결하기로 새 코드. 10번 틀리면 그 주소에서 한 시간 동안 막혀요 |
| 설치 끝에 노란 "연결은 됐지만 회사 API 키가 아직 없어서 Claude가 답하지 못해요" | 그 사람이 '회사 API 키' 방식인데 허브에 키가 없어요. PC 연결은 정상이에요 | `trina-ax set-key` (또는 관리 > 설정). 키를 넣으면 그 PC는 **다시 설치하지 않아도** 바로 돼요. 키가 필요 없는 구독 방식이면 관리 > 사람 > Claude 사용 방식 |
| 설치 끝에 "마지막으로 한 가지만 남았어요" 상자 | 구독 방식인데 이 PC에서 아직 Claude에 로그인 안 했어요. 정상이에요 | 터미널에서 `claude` 를 실행하면 브라우저에서 Claude 로그인이 열려요. 회사 Claude 계정으로 로그인 |
| 설치 중 "회사 스킬을 받는 중이에요. 최대 3분 걸려요" 에서 오래 기다림, 또는 "3분 안에 끝나지 않아서 멈췄어요" | 스킬을 내려받는 데 시간이 걸려요 (느린 회선, 공개 주소·Cloudflare 막힘). 10초마다 "… 20초 지났어요" 줄이 나와요. 멈춰도 연결은 이미 끝났어요 | 기다려도 돼요. 멈췄다면 다음에 Claude Code를 켤 때 받아요. 계속 안 되면 아래 "회사 스킬이 PC에 안 깔림" 줄 |
| Claude가 "API 키가 아직 등록되지 않았어요" | 허브에 키 없음 | `trina-ax set-key` |
| Anthropic 401 | 키가 틀리거나 폐기됨 | 콘솔에서 새 키 → `trina-ax set-key` → `trina-ax doctor --live` |
| 403 (한국어로 예산 안내) | Trina 예산 한도 | 관리 > 예산에서 한도 조정 |
| 403 (영어, permission/organization) | 콘솔 조직·워크스페이스 권한, 키 권한 | 콘솔에서 키가 속한 워크스페이스와 조직 상태 확인 |
| 400 "credit balance is too low" | 선불 크레딧 바닥 | 콘솔 Billing에서 충전, **자동 충전 켜기** |
| 429 / 느려짐 | 콘솔 등급 한도 | 콘솔 Limits 확인, 등급 올리기 |
| 회사 스킬이 PC에 안 깔림 | 공개 https 주소 없음, Cloudflare가 `/plugins` 막음 | `trina-ax doctor` 공개 주소·공개 경로 ✓ 확인. PC에서 `claude plugin marketplace update trina-ax` |
| doctor: 공개 경로 ✗ | Access·Bot Fight Mode·WAF challenge | 4장 경고 박스대로 끄기 |
| 휴대폰 채팅 "Claude를 실행할 수 없어요" | 허브에 Claude Code 없음 | 허브 계정에서 `curl -fsSL https://claude.ai/install.sh \| bash` → `install-hub.sh` 다시 실행 → `trina-ax restart` |
| Windows: `irm` 이 TLS 오류 | 오래된 PowerShell 5.1 기본 TLS | 먼저 `[Net.ServicePointManager]::SecurityProtocol = 'Tls12'` 실행 후 다시 |
| Windows: `claude`를 찾을 수 없음 | 설치 직후 PATH | PowerShell 창을 새로 열기 |
| Windows: Claude Code가 Git Bash를 찾음 | Git for Windows 필요 | https://git-scm.com 에서 설치 후 새 창에서 다시 |
| Windows: 백신이 스크립트 차단 | 회사 백신 정책 | IT에 허브 도메인·`install.ps1` 예외 요청, 시범 PC에서 먼저 |
| 디스크 부족 | `trina-ax doctor` 디스크 | 오래된 `team/.trina/trash/<날짜>/` 정리, 로그·백업 정리 |
| 로그가 너무 큼 | 로그 순환 설정 없음 | `ls /etc/newsyslog.d/trina-ax.conf`, 없으면 `install-hub.sh` 다시 실행 |

로그: `trina-ax logs -f` (허브), `trina-ax logs --tunnel` (터널), 서비스 자체 오류는 `~/TrinaAX/logs/launchd.log`.
로그에는 토큰·키·비밀번호·파일 내용이 들어가지 않아요. 고객 허락 없이 로그를 밖으로 보내지 마세요.

---

## 15. 명령 요약

| 명령 | 하는 일 |
|---|---|
| `trina-ax status` | 서비스 상태, 주소, 키 유무, 사람 수 (`--json`) |
| `trina-ax start / stop / restart [hub\|tunnel]` | 켜기 / 정말 끄기 / 다시 시작 (시스템 서비스라 sudo 암호를 물어요) |
| `trina-ax logs [-f] [-n 200] [--tunnel]` | 로그 |
| `trina-ax doctor [--live]` | 전체 점검 |
| `trina-ax set-url --public https://… --lan http://…` | 주소 (적용: `restart`) |
| `trina-ax set-key` / `remove-key` | 회사 API 키 (입력으로만) |
| `trina-ax users` / `user-add <아이디> "<이름>" [--admin]` | 사람 목록 / 추가 (임시 비밀번호 `xxxx-xxxx-xxxx`) |
| `trina-ax reset-password <아이디>` | 임시 비밀번호 |
| `trina-ax enroll <아이디>` | PC 연결 코드 + 설치 명령 |
| `trina-ax backup <폴더> [--with-team]` | 백업 + 되살리기 방법 |
| `trina-ax pricing [show\|check\|set\|reset]` | 모델 가격표 |
| `trina-ax ping [--wait 30]` | 이 Mac에서 허브 응답 확인 |
| `bash deploy/macos/install-hub.sh [--uninstall]` | 설치·업데이트·제거 |
| `bun deploy/cloudflare/customer-address.ts new\|check\|list\|token\|remove <회사>` | (운영자 컴퓨터) 고객 주소 `<회사>.trina.app` 만들기·확인·지우기 (4장) |

## 부록: Claude 사용 방식 두 가지와 Claude 앱 커넥터

| | 각자 Claude 구독 (기본) | 회사 API 키 |
|---|---|---|
| 직원이 할 일 | PC 연결 후 `claude` → `/login` 으로 본인 구독 로그인 | PC 연결만 |
| 요금 | 각자 구독 (Team 좌석 등) | 회사 Anthropic 계정 |
| 허브가 보는 것 | 사용량(어림 비용), 파일·스킬 사용 | 사용량(실제 비용), 파일·스킬 사용 |
| 예산 | 표시만 | 막기·표시 |
| 휴대폰 | 본인 Claude 앱 + 회사 커넥터 | 허브 채팅(/app) 또는 Claude 앱 커넥터 |

- 회사 기본값: 관리 › 설정 › Claude 사용 방식. 사람별: 관리 › 사람 › (이름) › Claude 사용 방식.
- 방식을 바꾼 사람은 '내 PC'에서 PC를 다시 연결해야 적용돼요(설치 명령을 한 번 더 실행).
- **Claude 앱 커넥터**: 공개 주소가 있어야 해요. 커넥터 주소는 `https://<공개 주소>/mcp`.
  - Claude Team: Claude 조직 설정 › 커넥터 › 추가 › 커스텀에 소유자가 한 번 넣어요. 직원은 Claude 앱 › 설정 › 커넥터에서 '연결' → 허브 아이디로 로그인 → 허용.
  - Pro·Max 개인: 각자 설정 › 커넥터 › 커스텀 커넥터 추가.
  - Cloudflare: `/mcp`, `/oauth/*`, `/.well-known/*` 에 Access·봇 차단·WAF 챌린지를 두지 마세요. Claude는 Anthropic 서버(160.79.104.0/21)에서 접속해요.
- 휴대폰 채팅(/app)과 예약 작업은 허브에서 회사 키로 실행돼요. 회사 키가 없으면 꺼지고, 직원에게 Claude 앱 커넥터를 안내해요.
