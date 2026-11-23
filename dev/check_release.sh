#!/bin/bash
# Claude Code Stop hook (project .claude/settings.json): at the end of a turn, if any source of the mockup / intro /
# full tool is newer than the AX Hero hand-in folder, block the stop (exit 2) and tell Claude to run the release.
# Works for every account / session that opens this project. Loop guard: once the hook has already pushed Claude
# to keep going (stop_hook_active true), it lets the turn end.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
input="$(cat)"
case "$input" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;; esac
out="$(python3 "$DIR/dev/release.py" --check 2>&1)"
if [ $? -ne 0 ]; then
  echo "Greenbox: the AX Hero hand-in is out of date ($out)." >&2
  echo "Run: cd \"$DIR\" && python3 dev/release.py   (builds 3D, mockup zip, introduction.html, full zip, copies them to 'AX Hero - nop bai'; add --no-full to skip the 101 MB zip)." >&2
  echo "Then add the round to GREENBOX-HANDOFF.md with the sizes it prints. If the user only asked a question and nothing changed, run it anyway: the folder must match the tool." >&2
  exit 2
fi
exit 0
