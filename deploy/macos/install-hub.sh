#!/usr/bin/env bash
# Install or update the Trina AX hub on a Mac (the office Mac mini). Run as the user that will own the hub:
#   bash deploy/macos/install-hub.sh [--home ~/TrinaAX] [--port 47900] [--public-url https://acme.ax.trina.app]
#                                    [--lan-url http://192.168.1.17:47900] [--tunnel-token-file FILE]
# What it does:
#   1. checks Homebrew tools (bun, ripgrep, pandoc, poppler; cloudflared only with --tunnel-token-file)
#   2. copies this checkout to <home>/app and installs dependencies
#   3. writes LaunchAgent app.trina-ax.hub (and app.trina-ax.tunnel when a tunnel token file is given)
#   4. installs a `trina-ax` command in <home>/bin
# Data (<home>/data) and the team folder (<home>/team) are never touched by an update.
set -euo pipefail

HOME_DIR="$HOME/TrinaAX"; PORT=47900; PUBLIC_URL=""; LAN_URL=""; TUNNEL_TOKEN_FILE=""; HOST="0.0.0.0"
while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --public-url) PUBLIC_URL="$2"; shift 2 ;;
    --lan-url) LAN_URL="$2"; shift 2 ;;
    --tunnel-token-file) TUNNEL_TOKEN_FILE="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "모르는 옵션: $1" >&2; exit 1 ;;
  esac
done

SRC="$(cd "$(dirname "$0")/../.." && pwd)"
say() { printf '\033[1m==> %s\033[0m\n' "$*"; }

say "도구 확인"
BREW="$(command -v brew || true)"
need=(bun rg pandoc pdftotext)
[ -n "$TUNNEL_TOKEN_FILE" ] && need+=(cloudflared)
missing=()
for t in "${need[@]}"; do command -v "$t" >/dev/null 2>&1 || [ -x "/opt/homebrew/bin/$t" ] || missing+=("$t"); done
if [ ${#missing[@]} -gt 0 ]; then
  [ -n "$BREW" ] || { echo "Homebrew가 필요해요: https://brew.sh" >&2; exit 1; }
  pkgs=()
  for t in "${missing[@]}"; do
    case "$t" in bun) pkgs+=(oven-sh/bun/bun) ;; rg) pkgs+=(ripgrep) ;; pdftotext) pkgs+=(poppler) ;; *) pkgs+=("$t") ;; esac
  done
  say "설치: ${pkgs[*]}"
  "$BREW" install "${pkgs[@]}"
fi
BUN="$(command -v bun || echo /opt/homebrew/bin/bun)"
CLAUDE_BIN="$(command -v claude || ls "$HOME/.local/bin/claude" 2>/dev/null || true)"
[ -n "$CLAUDE_BIN" ] || echo "참고: Claude Code가 없어서 휴대폰 채팅·예약 작업은 꺼져 있어요 (curl -fsSL https://claude.ai/install.sh | bash 후 다시 실행)."

say "앱 복사: $HOME_DIR/app"
mkdir -p "$HOME_DIR"/{app,data,team,logs,bin}
chmod 700 "$HOME_DIR/data"
rsync -a --delete --exclude .git --exclude node_modules --exclude .dev --exclude 'tests/.work' "$SRC/" "$HOME_DIR/app/"
(cd "$HOME_DIR/app" && "$BUN" install --production --frozen-lockfile >/dev/null)

say "설정 저장"
CFG="$HOME_DIR/data/config.json"
"$BUN" -e '
  const fs = require("fs"); const [f, host, port, pub, lan, claude] = process.argv.slice(1)
  let c = {}; try { c = JSON.parse(fs.readFileSync(f, "utf8")) } catch {}
  c.host = host; c.port = Number(port)
  if (pub) c.publicUrl = pub
  if (lan) c.lanUrl = lan
  if (claude) c.claudeBin = claude
  fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 })
' "$CFG" "$HOST" "$PORT" "$PUBLIC_URL" "$LAN_URL" "$CLAUDE_BIN"

cat > "$HOME_DIR/bin/trina-ax" <<EOF
#!/usr/bin/env bash
export TRINA_AX_HOME="$HOME_DIR"
case "\${1:-}" in
  start)   launchctl kickstart "gui/\$(id -u)/app.trina-ax.hub" ;;
  restart) launchctl kickstart -k "gui/\$(id -u)/app.trina-ax.hub" ;;
  stop)    launchctl kill TERM "gui/\$(id -u)/app.trina-ax.hub" ;;
  logs)    tail -n "\${2:-100}" "$HOME_DIR/logs/hub.log" ;;
  *)       exec "$BUN" "$HOME_DIR/app/src/cli.ts" "\$@" ;;
esac
EOF
chmod +x "$HOME_DIR/bin/trina-ax"

say "LaunchAgent"
LA="$HOME/Library/LaunchAgents"; mkdir -p "$LA"
PLIST="$LA/app.trina-ax.hub.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.trina-ax.hub</string>
  <key>ProgramArguments</key><array><string>$BUN</string><string>$HOME_DIR/app/src/main.ts</string></array>
  <key>WorkingDirectory</key><string>$HOME_DIR/app</string>
  <key>EnvironmentVariables</key><dict>
    <key>TRINA_AX_HOME</key><string>$HOME_DIR</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME_DIR/logs/hub.log</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/logs/hub.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/app.trina-ax.hub" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

if [ -n "$TUNNEL_TOKEN_FILE" ]; then
  say "Cloudflare 터널"
  install -m 600 "$TUNNEL_TOKEN_FILE" "$HOME_DIR/data/tunnel-token"
  CF="$(command -v cloudflared || echo /opt/homebrew/bin/cloudflared)"
  TPLIST="$LA/app.trina-ax.tunnel.plist"
  cat > "$TPLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.trina-ax.tunnel</string>
  <key>ProgramArguments</key><array><string>$CF</string><string>tunnel</string><string>--no-autoupdate</string><string>run</string><string>--token-file</string><string>$HOME_DIR/data/tunnel-token</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME_DIR/logs/tunnel.log</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/logs/tunnel.log</string>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)/app.trina-ax.tunnel" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$TPLIST"
fi

say "확인"
for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
  echo "허브가 http://127.0.0.1:$PORT 에서 돌고 있어요."
  echo "처음이라면 브라우저에서 http://127.0.0.1:$PORT/setup 을 열어 소유자를 만드세요."
  echo "명령: $HOME_DIR/bin/trina-ax status | enroll <아이디> | logs | restart"
else
  echo "허브가 응답하지 않아요. 로그: $HOME_DIR/logs/hub.log" >&2; exit 1
fi
