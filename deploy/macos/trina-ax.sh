#!/bin/bash
# trina-ax: 허브 관리 명령. install-hub.sh가 이 파일을 <home>/bin/trina-ax 로 설치해요 (아래 빈 자리를 채워서).
# 고치지 말고 install-hub.sh를 다시 실행하세요.
#
#   trina-ax start   [hub|tunnel]   켜기 (기본: 허브와 터널 둘 다)
#   trina-ax stop    [hub|tunnel]   끄기. 정말 꺼져요 (다음 시동 때나 start 하면 다시 켜져요)
#   trina-ax restart [hub|tunnel]   다시 시작 (설정을 바꾼 뒤)
#   trina-ax status                 서비스 상태와 허브 설정
#   trina-ax logs [-f] [--tunnel]   로그 보기
#   trina-ax <그 밖의 명령>          관리 명령 (trina-ax help)
set -euo pipefail

TRINA_AX_HOME='@@HOME@@'
BUN='@@BUN@@'
# daemon = 시스템 서비스 (/Library/LaunchDaemons, Mac이 켜지면 로그인 없이 시작)
# agent  = 사용자 서비스 (~/Library/LaunchAgents, 이 사용자가 로그인해야 시작)
MODE='@@MODE@@'
DAEMON_DIR='@@DAEMON_DIR@@'
AGENT_DIR='@@AGENT_DIR@@'
export TRINA_AX_HOME

HUB=app.trina-ax.hub
TUNNEL=app.trina-ax.tunnel
uid="$(id -u)"
CLI=("$BUN" "$TRINA_AX_HOME/app/src/cli.ts")

name_of() { [ "$1" = "$HUB" ] && echo 허브 || echo 터널; }
plist_of() { if [ "$MODE" = daemon ]; then echo "$DAEMON_DIR/$1.plist"; else echo "$AGENT_DIR/$1.plist"; fi; }

# launchd domain the service is loaded in (empty = not loaded)
loaded_domain() {
  local d
  if [ "$MODE" = daemon ]; then
    if launchctl print "system/$1" >/dev/null 2>&1; then echo system; fi
    return 0
  fi
  for d in "gui/$uid" "user/$uid"; do
    if launchctl print "$d/$1" >/dev/null 2>&1; then echo "$d"; return 0; fi
  done
}

field_of() { launchctl print "$1" 2>/dev/null | awk -v k="$2" '$1 == k && $2 == "=" { print $3; exit }'; }

# system services need root: say why, then sudo. User services (agent) run as is.
as_root() {
  local why="$1"; shift
  if [ "$MODE" != daemon ] || [ "$uid" -eq 0 ]; then "$@"; return; fi
  printf '  [sudo] %s\n         $ sudo %s\n' "$why" "$*" >&2
  sudo "$@"
}

targets() {
  case "${1:-all}" in
    hub) echo "$HUB" ;;
    tunnel) echo "$TUNNEL" ;;
    all) echo "$HUB"; if [ -f "$(plist_of "$TUNNEL")" ]; then echo "$TUNNEL"; fi ;;
    *) echo "hub, tunnel 중 하나를 적거나 비워 두세요: $1" >&2; exit 1 ;;
  esac
}

svc_start() {
  local label="$1" plist d n
  plist="$(plist_of "$label")"; n="$(name_of "$label")"
  [ -f "$plist" ] || { echo "$n 서비스가 설치돼 있지 않아요 ($plist). install-hub.sh를 실행해 주세요." >&2; return 1; }
  d="$(loaded_domain "$label")"
  if [ -n "$d" ]; then
    as_root "$n 서비스를 켜요" launchctl kickstart "$d/$label"
  elif [ "$MODE" = daemon ]; then
    as_root "$n 서비스가 꺼져(disabled) 있었다면 풀어요" launchctl enable "system/$label" || true
    as_root "$n 서비스를 시스템에 등록하고 켜요" launchctl bootstrap system "$plist"
  else
    launchctl enable "gui/$uid/$label" 2>/dev/null || true
    launchctl bootstrap "gui/$uid" "$plist" 2>/dev/null || launchctl bootstrap "user/$uid" "$plist"
  fi
  echo "$n: 켰어요."
}

svc_stop() {
  local label="$1" d n
  n="$(name_of "$label")"
  d="$(loaded_domain "$label")"
  if [ -z "$d" ]; then echo "$n: 이미 꺼져 있어요."; return 0; fi
  # KeepAlive라서 프로세스만 죽이면 launchd가 바로 다시 켜요. 등록을 풀어야 정말 꺼져요.
  as_root "$n 서비스를 꺼요 (launchd 등록을 풀어야 다시 켜지지 않아요)" launchctl bootout "$d/$label"
  echo "$n: 껐어요. 다시 켜려면 trina-ax start (Mac을 다시 시동해도 켜져요)."
}

svc_restart() {
  local label="$1" d n
  n="$(name_of "$label")"
  d="$(loaded_domain "$label")"
  if [ -z "$d" ]; then svc_start "$label"; return; fi
  as_root "$n 서비스를 다시 시작해요" launchctl kickstart -k "$d/$label"
  echo "$n: 다시 시작했어요."
}

svc_status() {
  local label d n state pid
  for label in "$HUB" "$TUNNEL"; do
    n="$(name_of "$label")"
    [ -f "$(plist_of "$label")" ] || { [ "$label" = "$TUNNEL" ] && continue; echo "서비스 $n: 설치 안 됨"; continue; }
    d="$(loaded_domain "$label")"
    if [ -z "$d" ]; then echo "서비스 $n: 꺼짐 (trina-ax start)"; continue; fi
    state="$(field_of "$d/$label" state)"; pid="$(field_of "$d/$label" pid)"
    echo "서비스 $n: ${state:-?}${pid:+ (pid $pid)} · ${MODE} · $d/$label"
  done
}

cmd="${1:-help}"
case "$cmd" in
  start|stop|restart)
    shift
    for label in $(targets "${1:-all}"); do "svc_$cmd" "$label"; done
    if [ "$cmd" != stop ] && [ "${1:-all}" != tunnel ]; then "${CLI[@]}" ping --wait 30; fi
    ;;
  status)
    if [ "${2:-}" != --json ]; then svc_status; fi
    exec "${CLI[@]}" "$@"
    ;;
  *)
    exec "${CLI[@]}" "$@"
    ;;
esac
