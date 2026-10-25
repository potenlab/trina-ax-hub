#!/bin/bash
# Trina AX 허브를 Mac(사무실 Mac mini)에 설치하거나 업데이트해요. 허브를 돌릴 사용자 계정으로, sudo 없이 실행하세요.
# sudo가 필요한 단계에서만, 무엇을 하는지 먼저 보여 주고 물어봐요.
#
#   bash deploy/macos/install-hub.sh [옵션]
#
# 옵션
#   --home DIR                설치 폴더 (기본 ~/TrinaAX)
#   --port N                  허브 포트 (처음 기본 47900. 이미 설치돼 있으면 있던 값을 그대로 써요)
#   --host ADDR               듣는 주소 (처음 기본 0.0.0.0 = 사내 PC도 접속. 127.0.0.1 = 이 Mac과 터널로만)
#   --public-url URL          공개 주소 (https, Cloudflare 터널). `trina-ax set-url --public` 과 같아요
#   --lan-url URL             사내 주소 (예: http://192.168.0.10:47900). 없으면 이 Mac의 주소를 찾아 넣어요
#   --tunnel-token-file FILE  Cloudflare 터널 토큰 파일 → 터널 서비스도 설치 (토큰은 data/에 저장돼 다음부터 생략 가능)
#   --no-tunnel               터널 서비스를 지워요 (저장된 토큰도)
#   --agent                   sudo를 쓸 수 없을 때: 사용자 서비스(LaunchAgent)로 설치. 이 사용자가 로그인해야 켜져요
#   --no-power                전원 설정(pmset: 잠자기 끔, 정전 후 자동 시동)을 바꾸지 않아요
#   --uninstall               서비스·plist·로그 순환 설정·app/ 을 지워요. data/ 와 team/ 은 남겨요
#   --yes                     --uninstall 확인을 묻지 않아요
#
# 하는 일
#   1. Homebrew 도구 확인 (bun, ripgrep, pandoc, poppler. 터널을 쓰면 cloudflared)
#   2. 이 폴더를 <home>/app.new 에 복사하고 의존성을 설치한 뒤 <home>/app 과 바꿔요 (실패하면 돌던 허브는 그대로)
#   3. data/config.json: 있던 host/port/주소는 그대로 둬요 (옵션을 줄 때만 바꿔요)
#   4. 시스템 서비스(LaunchDaemon) app.trina-ax.hub (+ app.trina-ax.tunnel). UserName = 이 사용자.
#      Mac이 켜지면 아무도 로그인하지 않아도 시작하고, 죽으면 launchd가 다시 켜요
#   5. 전원: sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1 · 로그 순환: /etc/newsyslog.d/trina-ax.conf
#   6. 명령: <home>/bin/trina-ax (+ /usr/local/bin/trina-ax 링크)
#   폴더 권한: <home> 0750, data 0700, logs 0700, team 0750
# data/ (DB·API 키·설정·터널 토큰)와 team/ (회사 파일)은 업데이트도 --uninstall도 지우지 않아요.
#
# 테스트용 환경 변수 (평소에는 쓰지 않아요): TRINA_AX_LAUNCHD_DIR, TRINA_AX_AGENT_DIR, TRINA_AX_NEWSYSLOG_DIR,
#   TRINA_AX_LINK_DIR, TRINA_AX_FIREWALL
set -euo pipefail

if [ -t 1 ]; then B=$'\033[1m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; N=$'\033[0m'; else B=; Y=; R=; C=; N=; fi
say()  { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  %s! %s%s\n' "$Y" "$*" "$N"; }
die()  { printf '%s%s%s\n' "$R" "$*" "$N" >&2; exit 1; }
usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; }

HOME_DIR="$HOME/TrinaAX"; PORT=""; HOST=""; PUBLIC_URL=""; LAN_URL=""; PUBLIC_SET=0; LAN_SET=0
TUNNEL_TOKEN_FILE=""; NO_TUNNEL=0; MODE=daemon; POWER=1; ACTION=install; YES=0
need() { [ "$2" -ge 2 ] || die "$1 다음에 값을 적어 주세요."; }
while [ $# -gt 0 ]; do
  case "$1" in
    --home) need "$1" $#; HOME_DIR="$2"; shift 2 ;;
    --port) need "$1" $#; PORT="$2"; shift 2 ;;
    --host) need "$1" $#; HOST="$2"; shift 2 ;;
    --public-url) need "$1" $#; PUBLIC_URL="$2"; PUBLIC_SET=1; shift 2 ;;
    --lan-url) need "$1" $#; LAN_URL="$2"; LAN_SET=1; shift 2 ;;
    --tunnel-token-file) need "$1" $#; TUNNEL_TOKEN_FILE="$2"; shift 2 ;;
    --no-tunnel) NO_TUNNEL=1; shift ;;
    --agent) MODE=agent; shift ;;
    --no-power) POWER=0; shift ;;
    --uninstall) ACTION=uninstall; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "모르는 옵션이에요: $1 (도움말: --help)" ;;
  esac
done

[ "$(uname -s)" = Darwin ] || die "macOS용 설치 스크립트예요. Linux는 deploy/linux/trina-ax.service 를 보세요."
[ "$(id -u)" -ne 0 ] || die "sudo 없이, 허브를 돌릴 사용자 계정으로 실행해 주세요. 필요한 단계에서만 sudo를 물어봐요."

case "$HOME_DIR" in /*) ;; *) HOME_DIR="$PWD/$HOME_DIR" ;; esac
while [ "${HOME_DIR%/}" != "$HOME_DIR" ]; do HOME_DIR="${HOME_DIR%/}"; done
case "$HOME_DIR" in ""|"$HOME"|"$HOME/Library"|/Users|/Applications|/Library|/System|/System/*|/usr|/usr/*|/bin|/sbin|/etc|/opt|/private|/private/etc|/private/tmp|/private/var|/var|/tmp|/Volumes)
  die "설치 폴더로 쓸 수 없는 곳이에요: ${HOME_DIR:-/} (예: ~/TrinaAX)" ;; esac
# the path goes into plists and the newsyslog config, which have no quoting
case "$HOME_DIR" in *[[:space:]\&\<\>\"\'\$\`\\]*) die "설치 폴더 경로에 공백이나 특수 문자가 없어야 해요: $HOME_DIR" ;; esac
if [ -n "$PORT" ]; then
  case "$PORT" in *[!0-9]*) die "--port 는 숫자로 적어 주세요." ;; esac
  [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "--port 는 1~65535 사이로 적어 주세요."
fi
if [ -n "$HOST" ]; then case "$HOST" in *[!0-9A-Za-z.:-]*) die "--host 는 0.0.0.0 이나 127.0.0.1 처럼 적어 주세요." ;; esac; fi
if [ -n "$TUNNEL_TOKEN_FILE" ]; then [ -s "$TUNNEL_TOKEN_FILE" ] || die "터널 토큰 파일이 없거나 비어 있어요: $TUNNEL_TOKEN_FILE"; fi

ME="$(id -un)"; MYGROUP="$(id -gn)"; UID_NUM="$(id -u)"
HUB=app.trina-ax.hub; TUNNEL=app.trina-ax.tunnel
DAEMON_DIR="${TRINA_AX_LAUNCHD_DIR:-/Library/LaunchDaemons}"
AGENT_DIR="${TRINA_AX_AGENT_DIR:-$HOME/Library/LaunchAgents}"
NEWSYSLOG_DIR="${TRINA_AX_NEWSYSLOG_DIR:-/etc/newsyslog.d}"
NEWSYSLOG_CONF="$NEWSYSLOG_DIR/trina-ax.conf"
LINK_DIR="${TRINA_AX_LINK_DIR:-/usr/local/bin}"
FIREWALL="${TRINA_AX_FIREWALL:-/usr/libexec/ApplicationFirewall/socketfilterfw}"
APP="$HOME_DIR/app"; DATA="$HOME_DIR/data"; LOGS="$HOME_DIR/logs"; TOKEN="$HOME_DIR/data/tunnel-token"
SRC="$(cd "$(dirname "$0")/../.." && pwd -P)"

# Explain, then run one command as root.
as_root() {
  local why="$1"; shift
  printf '  %s[sudo]%s %s\n         $ sudo %s\n' "$C" "$N" "$why" "$*"
  sudo "$@"
}

sudo_intro() { # what sudo will be used for (one password prompt; sudo remembers it for a few minutes)
  say "관리자 권한 (sudo)"
  info "아래 일에만 sudo를 써요. 이 Mac의 로그인 암호를 한 번 물어볼 수 있어요."
  local line; for line in "$@"; do info "  · $line"; done
  sudo -v || die "sudo를 쓸 수 없어요. 관리자 계정으로 실행하거나, sudo 없이 사용자 서비스로 설치하려면 --agent 를 붙여 주세요."
}

svc_loaded() { launchctl print "$1" >/dev/null 2>&1; }

# Stop and remove the user-level LaunchAgents (older installs, or --agent installs). Over SSH a plain bootout of the
# gui domain can fail; with sudo available (daemon mode) root can do it, otherwise the old hub would keep the port.
remove_agents() {
  local label d
  for label in "$HUB" "$TUNNEL"; do
    for d in "gui/$UID_NUM" "user/$UID_NUM"; do
      svc_loaded "$d/$label" || continue
      launchctl bootout "$d/$label" 2>/dev/null || true
      if svc_loaded "$d/$label" && [ "$MODE" = daemon ]; then
        as_root "예전 사용자 서비스 $label 를 꺼요 (SSH에서는 관리자 권한이 필요해요)" launchctl bootout "$d/$label" || true
      fi
      if svc_loaded "$d/$label"; then
        warn "예전 사용자 서비스 $d/$label 를 끄지 못했어요. 이 Mac을 다시 시동하면 사라져요 (plist는 지웠어요)."
      fi
    done
    rm -f "$AGENT_DIR/$label.plist"
  done
}

# launchd sometimes refuses a bootstrap right after a bootout of the same label; try a few times.
bootstrap_daemon() {
  local label="$1" dest="$2" i
  for i in 1 2 3; do
    if as_root "$label 서비스를 등록하고 켜요 (부팅할 때마다 자동으로 켜져요)" launchctl bootstrap system "$dest"; then return 0; fi
    sleep 2
  done
  die "$label 서비스를 켜지 못했어요. sudo launchctl print system/$label 와 $LOGS/launchd.log 를 확인해 주세요."
}

# ------------------------------------------------------------------------------------------------------------------
# uninstall

if [ "$ACTION" = uninstall ]; then
  [ -d "$HOME_DIR/app" ] || [ -d "$HOME_DIR/data" ] || [ -f "$DAEMON_DIR/$HUB.plist" ] || [ -f "$AGENT_DIR/$HUB.plist" ] \
    || die "여기에는 Trina AX 허브가 없어요: $HOME_DIR (다른 곳에 설치했다면 --home 을 주세요)"
  say "Trina AX 허브 지우기: $HOME_DIR"
  info "지우기 전에 확인하세요:"
  info "  1. 모든 직원 PC에서 연결을 풀었나요? 안 풀면 그 PC의 Claude가 없어진 허브를 계속 찾아서 멈춰요."
  info "     Mac: curl -fsSL <허브 주소>/install.sh | bash -s -- --uninstall"
  info "     Windows: & ([scriptblock]::Create((irm <허브 주소>/install.ps1))) -Uninstall"
  info "  2. 백업: trina-ax backup ~/Desktop/trina-backup --with-team"
  if [ "$YES" -ne 1 ]; then
    [ -t 0 ] || die "확인하려면 --yes 를 붙여 주세요."
    printf '  계속할까요? data/ 와 team/ 은 남아요. [y/N] '
    read -r answer
    case "$answer" in y|Y|yes|네|예) ;; *) die "그만뒀어요." ;; esac
  fi
  sys=()
  for label in "$HUB" "$TUNNEL"; do
    if [ -f "$DAEMON_DIR/$label.plist" ] || svc_loaded "system/$label"; then sys+=("시스템 서비스 $label 끄고 지우기"); fi
  done
  [ -f "$NEWSYSLOG_CONF" ] && sys+=("로그 순환 설정 $NEWSYSLOG_CONF 지우기")
  [ -L "$LINK_DIR/trina-ax" ] && [ "$(readlink "$LINK_DIR/trina-ax")" = "$HOME_DIR/bin/trina-ax" ] && sys+=("명령 링크 $LINK_DIR/trina-ax 지우기")
  [ ${#sys[@]} -gt 0 ] && sudo_intro "${sys[@]}"
  say "서비스 지우기"
  for label in "$HUB" "$TUNNEL"; do
    if svc_loaded "system/$label"; then as_root "$label 서비스를 꺼요" launchctl bootout "system/$label" || true; fi
    if [ -f "$DAEMON_DIR/$label.plist" ]; then as_root "$label 서비스 파일을 지워요" rm -f "$DAEMON_DIR/$label.plist"; fi
  done
  remove_agents
  if [ -f "$NEWSYSLOG_CONF" ]; then as_root "로그 순환 설정을 지워요" rm -f "$NEWSYSLOG_CONF"; fi
  if [ -L "$LINK_DIR/trina-ax" ] && [ "$(readlink "$LINK_DIR/trina-ax")" = "$HOME_DIR/bin/trina-ax" ]; then
    as_root "trina-ax 명령 링크를 지워요" rm -f "$LINK_DIR/trina-ax"
  fi
  for d in app app.new app.old; do
    # only folders this installer made (a copy of this repository)
    if [ -f "$HOME_DIR/$d/src/main.ts" ] && [ -f "$HOME_DIR/$d/deploy/macos/install-hub.sh" ]; then rm -rf "${HOME_DIR:?}/$d"; fi
  done
  rm -f "$HOME_DIR/bin/trina-ax" "$HOME_DIR/bin/trina-ax.tmp"
  rmdir "$HOME_DIR/bin" 2>/dev/null || true
  say "지웠어요"
  info "남겨 둔 것 (필요 없으면 직접 지우세요. 되돌릴 수 없어요):"
  info "  데이터 (DB·API 키·설정·터널 토큰)  $DATA"
  info "  회사 파일 (팀 폴더)               $HOME_DIR/team"
  info "  로그                              $LOGS"
  info "전원 설정(pmset)과 방화벽 허용 목록은 그대로예요. 시스템 설정 > 에너지 / 네트워크 > 방화벽에서 바꿀 수 있어요."
  info "Cloudflare를 썼다면 대시보드에서 터널과 공개 호스트 이름도 지워 주세요."
  exit 0
fi

# ------------------------------------------------------------------------------------------------------------------
# install / update

WANT_TUNNEL=0
if [ "$NO_TUNNEL" -eq 0 ] && { [ -n "$TUNNEL_TOKEN_FILE" ] || [ -s "$TOKEN" ]; }; then WANT_TUNNEL=1; fi

if [ "$MODE" = agent ] && { [ -f "$DAEMON_DIR/$HUB.plist" ] || [ -f "$DAEMON_DIR/$TUNNEL.plist" ]; }; then
  die "이미 시스템 서비스로 설치돼 있어요. --agent 로 바꾸려면 먼저 --uninstall 을 해 주세요 (sudo 필요). 시스템 서비스가 더 좋아요."
fi

say "도구 확인"
BREW="$(command -v brew || true)"
[ -z "$BREW" ] && [ -x /opt/homebrew/bin/brew ] && BREW=/opt/homebrew/bin/brew
need_tools=(bun rg pandoc pdftotext)
[ "$WANT_TUNNEL" -eq 1 ] && need_tools+=(cloudflared)
missing=()
for t in "${need_tools[@]}"; do command -v "$t" >/dev/null 2>&1 || [ -x "/opt/homebrew/bin/$t" ] || missing+=("$t"); done
if [ ${#missing[@]} -gt 0 ]; then
  [ -n "$BREW" ] || die "Homebrew가 필요해요: https://brew.sh 안내대로 설치한 뒤 다시 실행해 주세요."
  pkgs=()
  for t in "${missing[@]}"; do
    case "$t" in bun) pkgs+=(oven-sh/bun/bun) ;; rg) pkgs+=(ripgrep) ;; pdftotext) pkgs+=(poppler) ;; *) pkgs+=("$t") ;; esac
  done
  info "설치: ${pkgs[*]}"
  "$BREW" install "${pkgs[@]}"
fi
BUN="$(command -v bun || echo /opt/homebrew/bin/bun)"
[ -x "$BUN" ] || die "bun을 찾지 못했어요. brew install oven-sh/bun/bun 후 다시 실행해 주세요."
CF="$(command -v cloudflared || echo /opt/homebrew/bin/cloudflared)"
CLAUDE_BIN="$(command -v claude || true)"
[ -z "$CLAUDE_BIN" ] && [ -x "$HOME/.local/bin/claude" ] && CLAUDE_BIN="$HOME/.local/bin/claude"
if [ -n "$CLAUDE_BIN" ]; then
  info "Claude Code: $CLAUDE_BIN ($("$CLAUDE_BIN" --version 2>/dev/null | head -n 1 || echo '버전 확인 실패'))"
else
  warn "Claude Code가 없어서 휴대폰 채팅·예약 작업이 꺼져 있어요. curl -fsSL https://claude.ai/install.sh | bash 후 이 스크립트를 다시 실행하세요."
fi
for p in "$BUN" "$CF" "$CLAUDE_BIN"; do
  case "$p" in *[[:space:]\&\<\>\"\'\$\`\\]*) die "도구 경로에 공백이나 특수 문자가 있어요: $p" ;; esac
done

say "앱 준비: $APP"
mkdir -p "$HOME_DIR" "$DATA" "$HOME_DIR/team" "$LOGS" "$HOME_DIR/bin"
chmod 750 "$HOME_DIR" "$HOME_DIR/team"
chmod 700 "$DATA" "$LOGS"
rm -rf "$HOME_DIR/app.new"
rsync -a --delete --exclude .git --exclude node_modules --exclude .dev --exclude '/tests/' --exclude '*.log' --exclude .DS_Store \
  "$SRC/" "$HOME_DIR/app.new/"
if ! (cd "$HOME_DIR/app.new" && "$BUN" install --production --frozen-lockfile >/dev/null); then
  rm -rf "$HOME_DIR/app.new"
  die "의존성 설치에 실패했어요 (인터넷 연결을 확인해 주세요). 지금 돌고 있는 허브는 그대로예요."
fi
chmod 750 "$HOME_DIR/app.new"
export TRINA_AX_HOME="$HOME_DIR"
# check the addresses before anything stops (the same rules as the settings page)
URL_ARGS=()
[ "$PUBLIC_SET" -eq 1 ] && URL_ARGS+=(--public "$PUBLIC_URL")
[ "$LAN_SET" -eq 1 ] && URL_ARGS+=(--lan "$LAN_URL")
if [ ${#URL_ARGS[@]} -gt 0 ]; then "$BUN" "$HOME_DIR/app.new/src/cli.ts" set-url --dry-run "${URL_ARGS[@]}" >/dev/null || die "주소를 고쳐서 다시 실행해 주세요."; fi

say "설정: $DATA/config.json"
# written before anything stops; the running hub read its config at startup
cfg_out="$("$BUN" -e '
  const fs = require("fs"); const [f, host, port, claude] = process.argv.slice(1)
  let c = {}
  try { c = JSON.parse(fs.readFileSync(f, "utf8")) } catch (e) {
    if (e.code !== "ENOENT") { console.error("data/config.json을 읽지 못했어요. 고친 뒤 다시 실행해 주세요: " + e.message); process.exit(1) }
  }
  if (host) c.host = host; else c.host ??= "0.0.0.0"
  if (port) c.port = Number(port); else c.port ??= 47900
  if (claude) c.claudeBin = claude
  fs.writeFileSync(f + ".tmp", JSON.stringify(c, null, 2) + "\n", { mode: 0o600 })
  fs.renameSync(f + ".tmp", f)
  console.log(c.host + " " + c.port)
' "$DATA/config.json" "$HOST" "$PORT" "$CLAUDE_BIN")"
read -r HOST PORT <<< "$cfg_out"
info "듣는 주소 $HOST:$PORT (바꾸려면 --host / --port)"
if [ "$WANT_TUNNEL" -eq 1 ] && [ -n "$TUNNEL_TOKEN_FILE" ]; then
  install -m 600 "$TUNNEL_TOKEN_FILE" "$TOKEN.tmp" && mv "$TOKEN.tmp" "$TOKEN"
  info "터널 토큰을 $TOKEN 에 저장했어요 (0600)."
fi
if [ "$NO_TUNNEL" -eq 1 ]; then rm -f "$TOKEN"; fi

TMPD="$(mktemp -d)"; STOPPED=0; DONE=0
on_exit() {
  rm -rf "$TMPD"
  if [ "$STOPPED" -eq 1 ] && [ "$DONE" -ne 1 ]; then
    printf '%s허브가 아직 꺼져 있을 수 있어요. 위 오류를 고친 뒤 이 스크립트를 다시 실행해 주세요.%s\n' "$R" "$N" >&2
  fi
}
trap on_exit EXIT
FW_ON=0
if [ -x "$FIREWALL" ] && "$FIREWALL" --getglobalstate 2>/dev/null | grep -Eq 'State = [12]|is enabled'; then FW_ON=1; fi
BUN_REAL="$("$BUN" -e 'console.log(require("fs").realpathSync(process.execPath))')"

if [ "$MODE" = daemon ]; then
  steps=("시스템 서비스 등록: $DAEMON_DIR/$HUB.plist (Mac이 켜지면 로그인 없이 허브 시작, $ME 계정 권한으로 실행)")
  [ "$WANT_TUNNEL" -eq 1 ] && steps+=("터널 서비스 등록: $DAEMON_DIR/$TUNNEL.plist")
  [ "$NO_TUNNEL" -eq 1 ] && [ -f "$DAEMON_DIR/$TUNNEL.plist" ] && steps+=("터널 서비스 지우기")
  [ "$POWER" -eq 1 ] && steps+=("전원: 잠자기 끄기, 정전 뒤 자동 시동 (pmset)")
  steps+=("로그 순환 설정: $NEWSYSLOG_CONF" "trina-ax 명령 링크: $LINK_DIR/trina-ax")
  [ "$FW_ON" -eq 1 ] && steps+=("macOS 방화벽에서 bun 수신 연결 허용 (사내 PC 접속용)")
  sudo_intro "${steps[@]}"
fi

say "서비스 준비"
STOPPED=1
if [ "$MODE" = daemon ]; then
  for label in "$HUB" "$TUNNEL"; do
    if svc_loaded "system/$label"; then as_root "새 버전으로 바꾸려고 $label 서비스를 잠시 꺼요" launchctl bootout "system/$label" || true; fi
  done
  if [ -f "$AGENT_DIR/$HUB.plist" ] || [ -f "$AGENT_DIR/$TUNNEL.plist" ]; then info "예전 방식(LaunchAgent) 서비스를 지워요. 이제 시스템 서비스로 돌아요."; fi
fi
remove_agents
if [ -d "$APP" ]; then rm -rf "$HOME_DIR/app.old"; mv "$APP" "$HOME_DIR/app.old"; fi
mv "$HOME_DIR/app.new" "$APP"
rm -rf "$HOME_DIR/app.old"
CLI=("$BUN" "$APP/src/cli.ts")

say "주소"
if [ ${#URL_ARGS[@]} -gt 0 ]; then "${CLI[@]}" set-url "${URL_ARGS[@]}" | sed 's/^/  /'; fi
LAN_NOW="$("${CLI[@]}" status --json | "$BUN" -e 'const j = JSON.parse(await Bun.stdin.text()); console.log(j.lanUrl ?? "")')"
if [ -z "$LAN_NOW" ] && [ "$HOST" != 127.0.0.1 ] && [ "$HOST" != localhost ]; then
  IFACE="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2; exit }' || true)"
  LAN_IP=""
  for i in $IFACE en0 en1; do
    LAN_IP="$(ipconfig getifaddr "$i" 2>/dev/null || true)"
    if [ -n "$LAN_IP" ]; then IFACE="$i"; break; fi
  done
  if [ -n "$LAN_IP" ]; then
    "${CLI[@]}" set-url --lan "http://$LAN_IP:$PORT" >/dev/null
    info "사내 주소를 http://$LAN_IP:$PORT 로 정했어요 ($IFACE)."
    info "공유기(DHCP) 설정에서 이 Mac의 주소를 $LAN_IP 로 고정(예약)해 두세요. 주소가 바뀌면 사내 PC 연결이 끊겨요."
    info "바꾸려면: trina-ax set-url --lan http://<주소>:$PORT"
    hw="$(networksetup -listallhardwareports 2>/dev/null | awk -v d="$IFACE" '/^Hardware Port:/ { sub(/^Hardware Port: /, ""); p = $0 } /^Device:/ && $2 == d { print p; exit }' || true)"
    case "$hw" in *Wi-Fi*|*AirPort*) warn "Wi-Fi로 연결돼 있어요. 허브는 유선 랜을 권해요 (끊김이 적어요)." ;; esac
  else
    warn "이 Mac의 사내 주소를 찾지 못했어요. 네트워크 연결을 확인하고 trina-ax set-url --lan http://<주소>:$PORT 로 넣어 주세요."
  fi
elif [ -n "$LAN_NOW" ]; then
  info "사내 주소: $LAN_NOW (그대로 둬요. 바꾸려면 --lan-url 또는 trina-ax set-url --lan)"
fi

# ------------------------------------------------------------------------------------------------------------------
# launchd services

PATH_ENV="$(dirname "$BUN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin"
# plist <label> <log file> <program> [args…] → XML on stdout
plist() {
  local label="$1" log="$2"; shift 2
  local a
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
    '<plist version="1.0"><dict>'
  printf '  <key>Label</key><string>%s</string>\n' "$label"
  [ "$MODE" = daemon ] && printf '  <key>UserName</key><string>%s</string>\n' "$ME"
  printf '  <key>ProgramArguments</key><array>\n'
  printf '    <string>%s</string>\n' "$BUN" "$APP/deploy/macos/run-logged.ts" "$log"
  [ "$MODE" = agent ] && printf '    <string>%s</string>\n' --max-size 10M --keep 7
  printf '    <string>--</string>\n'
  for a in "$@"; do printf '    <string>%s</string>\n' "$a"; done
  printf '  </array>\n'
  printf '  <key>WorkingDirectory</key><string>%s</string>\n' "$APP"
  printf '  <key>EnvironmentVariables</key><dict>\n'
  printf '    <key>%s</key><string>%s</string>\n' TRINA_AX_HOME "$HOME_DIR" HOME "$HOME" USER "$ME" LANG en_US.UTF-8 PATH "$PATH_ENV"
  printf '  </dict>\n'
  # Interactive: no CPU/IO throttling (everyone's Claude waits on this). 256 open files is launchd's default; too few.
  printf '%s\n' '  <key>ProcessType</key><string>Interactive</string>' \
    '  <key>RunAtLoad</key><true/>' \
    '  <key>KeepAlive</key><true/>' \
    '  <key>ThrottleInterval</key><integer>10</integer>' \
    '  <key>ExitTimeOut</key><integer>30</integer>' \
    '  <key>Umask</key><integer>23</integer>' \
    '  <key>SoftResourceLimits</key><dict><key>NumberOfFiles</key><integer>8192</integer></dict>'
  # only run-logged.ts's own startup errors land here; the program's output goes to <log>
  printf '  <key>StandardOutPath</key><string>%s</string>\n' "$LOGS/launchd.log"
  printf '  <key>StandardErrorPath</key><string>%s</string>\n' "$LOGS/launchd.log"
  printf '</dict></plist>\n'
}

plist "$HUB" "$LOGS/hub.log" "$BUN" "$APP/src/main.ts" > "$TMPD/$HUB.plist"
labels=("$HUB")
if [ "$WANT_TUNNEL" -eq 1 ]; then
  plist "$TUNNEL" "$LOGS/tunnel.log" "$CF" tunnel --no-autoupdate run --token-file "$TOKEN" > "$TMPD/$TUNNEL.plist"
  labels+=("$TUNNEL")
fi
for f in "$TMPD"/*.plist; do plutil -lint -s "$f" || die "서비스 파일이 잘못 만들어졌어요: $f"; done

if [ "$MODE" = daemon ]; then
  say "시스템 서비스 (LaunchDaemon)"
  for label in "${labels[@]}"; do
    dest="$DAEMON_DIR/$label.plist"
    as_root "$label 서비스 파일을 $DAEMON_DIR 에 넣어요 (root 소유, 644여야 launchd가 읽어요)" cp "$TMPD/$label.plist" "$dest"
    as_root "서비스 파일 소유자를 root로" chown root:wheel "$dest"
    as_root "서비스 파일 권한을 644로" chmod 644 "$dest"
    as_root "$label 서비스가 꺼져(disabled) 있었다면 풀어요" launchctl enable "system/$label" || true
    bootstrap_daemon "$label" "$dest"
  done
  if [ "$WANT_TUNNEL" -eq 0 ] && [ -f "$DAEMON_DIR/$TUNNEL.plist" ]; then
    as_root "터널 서비스 파일을 지워요 (--no-tunnel)" rm -f "$DAEMON_DIR/$TUNNEL.plist"
  fi

  say "로그 순환 (newsyslog)"
  {
    echo "# Trina AX hub logs (written by install-hub.sh). Rotated at 10 MB, gzip, 7 kept; run-logged.ts reopens them."
    echo "# logfilename                                   [owner:group]   mode count size(KB) when flags"
    echo "$LOGS/hub.log $ME:$MYGROUP 600 7 10240 * NZ"
    echo "$LOGS/tunnel.log $ME:$MYGROUP 600 7 10240 * NZ"
  } > "$TMPD/trina-ax.conf"
  as_root "로그가 10MB가 넘으면 잘라서 7개까지 남기게 해요" cp "$TMPD/trina-ax.conf" "$NEWSYSLOG_CONF"
  as_root "로그 순환 설정 소유자를 root로" chown root:wheel "$NEWSYSLOG_CONF"
  as_root "로그 순환 설정 권한을 644로" chmod 644 "$NEWSYSLOG_CONF"

  if [ "$POWER" -eq 1 ]; then
    say "전원 설정"
    info "허브가 잠들면 회사 전체의 Claude가 멈춰요. 잠자기를 끄고, 정전 뒤 전기가 들어오면 스스로 켜지게 해요."
    as_root "잠자기·디스크 잠자기 끄기, 정전 후 자동 시동, 네트워크로 깨우기" pmset -a sleep 0 disksleep 0 autorestart 1 womp 1 \
      || warn "pmset이 일부 설정을 못 했어요. 시스템 설정 > 에너지에서 확인해 주세요."
    info "화면만 꺼지는 건 괜찮아요 (displaysleep는 그대로)."
  fi

  if [ "$FW_ON" -eq 1 ] && [ "$HOST" != 127.0.0.1 ]; then
    say "macOS 방화벽"
    info "방화벽이 켜져 있어요. 시스템 서비스는 '연결 허용?' 창을 띄울 수 없어서 미리 허용해 둬요."
    as_root "bun을 방화벽 목록에 넣어요" "$FIREWALL" --add "$BUN_REAL" || true
    as_root "bun의 수신 연결을 허용해요" "$FIREWALL" --unblockapp "$BUN_REAL" || true
    info "brew upgrade bun 으로 bun이 바뀌면 이 스크립트를 다시 실행해 주세요 (허용 목록이 파일 경로 기준이에요)."
    if "$FIREWALL" --getblockall 2>/dev/null | grep -q 'set to enabled'; then
      warn "방화벽의 '들어오는 연결 모두 차단'이 켜져 있어서 사내 PC가 허브에 접속할 수 없어요. 시스템 설정 > 네트워크 > 방화벽 > 옵션에서 꺼 주세요."
    fi
  fi

  say "trina-ax 명령"
  if [ ! -e "$LINK_DIR/trina-ax" ] || [ -L "$LINK_DIR/trina-ax" ]; then
    as_root "어느 폴더에서나 trina-ax 명령을 쓸 수 있게 해요" mkdir -p "$LINK_DIR"
    as_root "trina-ax 명령 링크" ln -sfn "$HOME_DIR/bin/trina-ax" "$LINK_DIR/trina-ax"
  else
    warn "$LINK_DIR/trina-ax 가 이미 다른 파일이라 링크를 만들지 않았어요. $HOME_DIR/bin/trina-ax 를 쓰세요."
  fi
else
  say "사용자 서비스 (LaunchAgent, --agent)"
  mkdir -p "$AGENT_DIR"
  DOMAIN="gui/$UID_NUM"
  for label in "${labels[@]}"; do
    install -m 644 "$TMPD/$label.plist" "$AGENT_DIR/$label.plist"
    launchctl enable "$DOMAIN/$label" 2>/dev/null || true
    if ! launchctl bootstrap "$DOMAIN" "$AGENT_DIR/$label.plist" 2>/dev/null; then
      # no GUI login for this user (e.g. over SSH): the background user domain works until the next login
      DOMAIN="user/$UID_NUM"
      launchctl bootstrap "$DOMAIN" "$AGENT_DIR/$label.plist" || die "$label 서비스를 켜지 못했어요."
      warn "이 사용자가 화면에서 로그인해 있지 않아서 임시(user 도메인)로 켰어요. 다음 로그인부터는 로그인할 때 켜져요."
    fi
  done
  warn "사용자 서비스는 이 사용자($ME)가 로그인해야 켜져요. 정전 뒤에는 누군가 로그인할 때까지 허브가 꺼져 있어요."
  info "시스템 설정 > 사용자 및 그룹 > '자동으로 로그인'을 $ME 로 켜 두세요 (FileVault가 켜져 있으면 자동 로그인을 쓸 수 없어요)."
  info "로그는 run-logged.ts가 10MB마다 직접 잘라요 (sudo가 없어서 newsyslog를 못 써요)."
  [ "$POWER" -eq 1 ] && info "전원: 시스템 설정 > 에너지에서 '자동으로 잠자기 방지'와 '정전 후 자동으로 시동'을 켜 주세요 (sudo pmset를 못 써서요)."
  [ "$FW_ON" -eq 1 ] && info "방화벽: 'bun이 수신 연결을 허용할까요?' 창이 뜨면 '허용'을 눌러 주세요."
fi

# the trina-ax command
tmpl="$(cat "$APP/deploy/macos/trina-ax.sh")"
tmpl="${tmpl//@@HOME@@/$HOME_DIR}"; tmpl="${tmpl//@@BUN@@/$BUN}"; tmpl="${tmpl//@@MODE@@/$MODE}"
tmpl="${tmpl//@@DAEMON_DIR@@/$DAEMON_DIR}"; tmpl="${tmpl//@@AGENT_DIR@@/$AGENT_DIR}"
printf '%s\n' "$tmpl" > "$HOME_DIR/bin/trina-ax.tmp"
chmod 755 "$HOME_DIR/bin/trina-ax.tmp"
mv "$HOME_DIR/bin/trina-ax.tmp" "$HOME_DIR/bin/trina-ax"

if [ "$MODE" = daemon ]; then
  FV="$(fdesetup status 2>/dev/null || true)"
  case "$FV" in
    *"FileVault is On"*)
      say "FileVault"
      warn "FileVault가 켜져 있어요. 정전이나 업데이트로 다시 시동되면, 누군가 이 Mac 앞에서 암호를 넣을 때까지 macOS가 부팅을 멈춰요."
      info "그동안은 허브도 켜지지 않아요 (시스템 서비스는 FileVault만 풀리면 로그인 없이 켜져요). 고르세요:"
      info "  1. FileVault 끄기: 시스템 설정 > 개인정보 보호 및 보안 > FileVault (디스크 암호화를 끌지 회사와 정하세요)"
      info "  2. 켜 둔다면: 계획된 재시동은 sudo fdesetup authrestart 로 하고, 정전 뒤에는 사람이 암호를 넣어야 해요."
      ;;
    *) info "시스템 서비스라서 Mac이 켜지면 아무도 로그인하지 않아도 허브가 켜져요. 자동 로그인은 필요 없어요." ;;
  esac
fi

DONE=1
say "확인"
if ! "${CLI[@]}" ping --wait 30; then
  warn "허브가 응답하지 않아요. 로그 마지막 부분:"
  tail -n 30 "$LOGS/hub.log" 2>/dev/null | sed 's/^/    /' || true
  tail -n 10 "$LOGS/launchd.log" 2>/dev/null | sed 's/^/    /' || true
  die "로그: $LOGS/hub.log · 다시 켜기: $HOME_DIR/bin/trina-ax restart"
fi
"$HOME_DIR/bin/trina-ax" status | sed 's/^/  /'
say "다음 할 일"
info "처음이라면: 위 '처음 설정' 주소를 열어 소유자 계정을 만드세요 (다른 컴퓨터에서는 토큰이 붙은 주소로)."
info "공개 주소(https)가 아직 없다면 Cloudflare 터널부터 (docs/OPERATOR.md). 직원을 연결하기 전에 주소를 먼저 정하세요."
info "점검: trina-ax doctor --live · 로그: trina-ax logs -f · 도움말: trina-ax help"
[ "$MODE" = agent ] && info "명령 경로: echo 'export PATH=\"$HOME_DIR/bin:\$PATH\"' >> ~/.zprofile"
exit 0
