#!/bin/sh
# Greenbox MCP — one-line setup for Mac / Linux. Copy the command from Greenbox (🤖 AI → ⚙), paste it in Terminal:
#   curl -fsSL https://YOUR-GREENBOX-SITE/gb-ai/install.sh | sh -s -- https://YOUR-GREENBOX-SITE
# Downloads greenbox_mcp.py + tools.json into ~/.greenbox/mcp and adds Greenbox to Claude Desktop / Codex / Claude Code.
set -e
SITE="${1:-${GREENBOX_SITE:-}}"
if [ -z "$SITE" ]; then echo "Thiếu địa chỉ trang Greenbox / missing the Greenbox site URL:  ... | sh -s -- https://your-site"; exit 1; fi
SITE="${SITE%/}"
DIR="$HOME/.greenbox/mcp"
mkdir -p "$DIR"
echo "Greenbox MCP → $DIR"
for f in greenbox_mcp.py tools.json install_mcp.py; do
  curl -fsSL "$SITE/gb-ai/$f" -o "$DIR/$f" || { echo "Không tải được / could not download $SITE/gb-ai/$f"; exit 1; }
done
PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "Cần Python 3 / Python 3 is needed."
  echo "  macOS: gõ  xcode-select --install  (hoặc tải ở https://www.python.org), rồi chạy lại lệnh này."
  exit 1
fi
"$PY" "$DIR/install_mcp.py"
