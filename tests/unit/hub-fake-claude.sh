#!/bin/bash
# Fake Claude Code for the hub tests (see hub-fixtures.ts). Records argv, env, cwd, stdin and the MCP config, prints
# stream-json shaped like Claude Code 2.1.309. Never uses the network.
REC='__REC__'
job="${ANTHROPIC_CUSTOM_HEADERS#x-trina-job: }"
n=1; while [ -e "$REC/$job.$n.args" ]; do n=$((n+1)); done
base="$REC/$job.$n"
printf '%s\0' "$@" > "$base.args"
env > "$base.env"
pwd > "$base.cwd"
echo $$ > "$base.pid"
prompt="$(cat)"
printf '%s' "$prompt" > "$base.stdin"
mcp=""; resume=""; prev=""
for a in "$@"; do
  case "$prev" in --mcp-config) mcp="$a";; --resume) resume="$a";; esac
  prev="$a"
done
[ -n "$mcp" ] && cat "$mcp" > "$base.mcp"
echo "start $job" >> "$REC/order.log"
emit() { printf '%s\n' "$1"; }
sessions="$CLAUDE_CONFIG_DIR/projects/-fake-project"
if [ -n "$resume" ]; then
  if [ ! -e "$sessions/$resume.jsonl" ]; then
    emit '{"type":"result","subtype":"error_during_execution","is_error":true,"session_id":"'"$resume"'","total_cost_usd":0}'
    echo "No conversation found with session ID: $resume" >&2
    echo "end $job" >> "$REC/order.log"
    exit 1
  fi
  sid="$resume"
else
  sid="$( (cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen) | tr 'A-Z' 'a-z')"
fi
case "$prompt" in *"[hang-hard]"*) trap '' TERM;; esac
emit '{"type":"system","subtype":"init","cwd":"'"$(pwd)"'","session_id":"'"$sid"'","model":"claude-opus-5-5","tools":["mcp__trina__list_files","mcp__trina__read_file"],"mcp_servers":[{"name":"trina","status":"connected"}],"permissionMode":"dontAsk","apiKeySource":"ANTHROPIC_AUTH_TOKEN"}'
delta() { emit '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"'"$1"'"}},"session_id":"'"$sid"'"}'; }
start_text() { emit '{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_'"$1"'","type":"message","role":"assistant","content":[]}},"session_id":"'"$sid"'"}'; emit '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"'"$sid"'"}'; }
end_text() { emit '{"type":"assistant","message":{"content":[{"type":"text","text":"'"$1"'"}]},"session_id":"'"$sid"'"}'; emit '{"type":"stream_event","event":{"type":"content_block_stop","index":0},"session_id":"'"$sid"'"}'; emit '{"type":"stream_event","event":{"type":"message_stop"},"session_id":"'"$sid"'"}'; }
case "$prompt" in
  *"[crash]"*) echo "boom: something broke" >&2; echo "end $job" >> "$REC/order.log"; exit 3;;
  *"[fail]"*)
    emit '{"type":"assistant","message":{"content":[{"type":"text","text":"API Error: 403 {\"type\":\"error\",\"error\":{\"type\":\"permission_error\",\"message\":\"이번 달 사용 한도를 넘었어요. 관리자에게 문의해 주세요.\"}}"}]},"error":"unknown","session_id":"'"$sid"'"}'
    emit '{"type":"result","subtype":"success","is_error":true,"result":"API Error: 403 permission_error","session_id":"'"$sid"'","total_cost_usd":0}'
    echo "end $job" >> "$REC/order.log"; exit 1;;
  *"[hang]"*|*"[hang-hard]"*)
    start_text 0; delta "생각하는 중"
    while :; do sleep 0.2; done;;
esac
mkdir -p "$sessions"; echo '{"turn":1}' >> "$sessions/$sid.jsonl"
turns=$(wc -l < "$sessions/$sid.jsonl" | tr -d ' ')
pause=0; case "$prompt" in *"[slow]"*) pause=0.4;; esac
case "$prompt" in *"[tool]"*|*"[report]"*)
  start_text 1; delta "파일을 확인해 볼게요."; end_text "파일을 확인해 볼게요."
  emit '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"mcp__trina__read_file","input":{"path":"shared/a.md"}}]},"session_id":"'"$sid"'"}'
  emit '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"1\tabc"}]},"session_id":"'"$sid"'"}';;
esac
case "$prompt" in
  *"[report]"*) answer='# 주간 보고\n\n- 첫째 항목\n- 둘째 항목'
    start_text 2; sleep $pause; delta '# 주간 보고\n\n'; sleep $pause; delta '- 첫째 항목\n- 둘째 항목'; end_text "$answer";;
  *) answer="안녕하세요. ${turns}번째 답이에요."
    start_text 2; sleep $pause; delta "안녕하"; sleep $pause; delta "세요. "; sleep $pause; delta "${turns}번째 답이에요."; end_text "$answer";;
esac
emit '{"type":"result","subtype":"success","is_error":false,"result":"'"$answer"'","session_id":"'"$sid"'","total_cost_usd":0.0123,"num_turns":1}'
echo "end $job" >> "$REC/order.log"
