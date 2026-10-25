#!/bin/bash
# Fake launchctl for tests/unit/deploy-macos.test.ts: records calls in $FAKE_STATE/calls.log and really starts a
# plist's ProgramArguments (EnvironmentVariables, WorkingDirectory, StandardOutPath) in the background, like launchd.
# $FAKE_NO_GUI=1 makes the gui/<uid> domain refuse bootstrap, as it does over SSH.
S="$FAKE_STATE"
echo "launchctl $*" >> "$S/calls.log"
k() { printf '%s' "$1" | tr '/' '_'; }
running() { [ -f "$S/$(k "$1").pid" ] && kill -0 "$(cat "$S/$(k "$1").pid")" 2>/dev/null; }
x() { plutil -extract "$1" raw -o - "$2" 2>/dev/null; }
start_job() {
  local id="$1" plist="$2" n i wd out
  local args=() envs=()
  n="$(x ProgramArguments "$plist")"
  for ((i = 0; i < n; i++)); do args+=("$(x "ProgramArguments.$i" "$plist")"); done
  wd="$(x WorkingDirectory "$plist" || echo /)"
  for key in TRINA_AX_HOME HOME USER LANG PATH; do
    if v="$(x "EnvironmentVariables.$key" "$plist")"; then envs+=("$key=$v"); fi
  done
  out="$(x StandardOutPath "$plist" || echo /dev/null)"
  (cd "$wd" && exec env -i "${envs[@]}" "${args[@]}" >> "$out" 2>&1 < /dev/null) &
  echo $! > "$S/$(k "$id").pid"
  echo "$plist" > "$S/$(k "$id").plist"
  disown 2>/dev/null || true
}
stop_job() {
  local id="$1" pid i
  pid="$(cat "$S/$(k "$id").pid" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    kill -TERM "$pid" 2>/dev/null || true
    for ((i = 0; i < 100; i++)); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$S/$(k "$id").pid"
}
loaded() { [ -f "$S/$(k "$1").plist" ]; }
case "$1" in
  print)
    case "$2" in
      */*/*|system/*)
        if ! loaded "$2"; then echo "Could not find service \"$2\"" >&2; exit 113; fi
        if running "$2"; then printf '%s = {\n\tstate = running\n\tpid = %s\n}\n' "$2" "$(cat "$S/$(k "$2").pid")"
        else printf '%s = {\n\tstate = not running\n}\n' "$2"; fi ;;
      gui/*) [ "${FAKE_NO_GUI:-0}" = 1 ] && exit 113; echo "gui domain" ;;
      *) echo "domain" ;;
    esac ;;
  bootstrap)
    case "$2" in gui/*) [ "${FAKE_NO_GUI:-0}" = 1 ] && { echo "Bootstrap failed: 125: Domain does not support specified action" >&2; exit 125; } ;; esac
    label="$(x Label "$3")"
    if loaded "$2/$label"; then echo "Bootstrap failed: 5: Input/output error" >&2; exit 5; fi
    start_job "$2/$label" "$3" ;;
  bootout)
    id="$2"; [ -n "${3:-}" ] && id="$2/$(x Label "$3")"
    if ! loaded "$id"; then echo "Boot-out failed: 113: Could not find specified service" >&2; exit 113; fi
    stop_job "$id"; rm -f "$S/$(k "$id").plist" ;;
  kickstart)
    kill_first=0; [ "$2" = -k ] && { kill_first=1; shift; }
    loaded "$2" || { echo "Could not find service" >&2; exit 113; }
    if [ "$kill_first" = 1 ]; then stop_job "$2"; fi
    running "$2" || start_job "$2" "$(cat "$S/$(k "$2").plist")" ;;
  enable|disable) ;;
  *) echo "fake launchctl: unsupported $*" >&2; exit 64 ;;
esac
