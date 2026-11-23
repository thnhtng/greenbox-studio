#!/bin/bash
# DramaClaw (local, Community edition) with Claude as its agent (Xia Director) — no API key: it uses the Claude Code CLI
# that comes with the Claude app (sign in once: the script offers it). Image / video / voice in DramaClaw itself still
# need a model gateway key; in Greenbox those come from Higgsfield.
DC="$HOME/gb-build/dramaclaw"
[ -d "$DC" ] || { echo "Chua co DramaClaw o $DC"; read -r; exit 1; }
# the newest Claude Code CLI: on PATH, else the one inside the Claude app
CL="$(command -v claude)"
if [ -z "$CL" ]; then CL="$(ls -t "$HOME/Library/Application Support/Claude/claude-code"/*/*/claude.app/Contents/MacOS/claude 2>/dev/null | head -1)"; fi
echo "Claude CLI: ${CL:-khong tim thay}"
if [ -n "$CL" ] && ! "$CL" -p "Reply OK" >/dev/null 2>&1; then
  echo; echo "Claude CLI chua dang nhap. Dang mo dang nhap (trinh duyet se hien ra)..."; "$CL" auth login || "$CL" /login
fi
export DRAMACLAW_LOCAL_AGENT_TRUST=1 DRAMACLAW_CHAT_BACKEND=claude CLAUDE_CLI_PATH="$CL"
cd "$DC"
if lsof -nP -iTCP:8780 -sTCP:LISTEN >/dev/null 2>&1; then echo "API :8780 dang chay roi (tat cua so do neu muon chay lai voi Claude)"; else
  uv run novelvideo api --host 127.0.0.1 --port 8780 & fi
cd "$DC/frontend"
if ! lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then npx -y pnpm@11.5.0 dev --port 5173 & fi
( sleep 6; open "http://localhost:5173/?lng=vi" ) &
echo; echo "DramaClaw: http://localhost:5173  (Ctrl+C hoac dong cua so nay de tat)"
wait
