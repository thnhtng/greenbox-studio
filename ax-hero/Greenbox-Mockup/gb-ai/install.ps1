# Greenbox MCP — one-line setup for Windows. Copy the command from Greenbox (🤖 AI → ⚙), paste it in PowerShell:
#   $env:GREENBOX_SITE='https://YOUR-GREENBOX-SITE'; irm https://YOUR-GREENBOX-SITE/gb-ai/install.ps1 | iex
# Downloads greenbox_mcp.py + tools.json into %USERPROFILE%\.greenbox\mcp and adds Greenbox to Claude Desktop / Codex / Claude Code.
$ErrorActionPreference = 'Stop'
$site = $env:GREENBOX_SITE
if (-not $site) { Write-Host 'Thieu dia chi trang Greenbox / missing the Greenbox site URL ($env:GREENBOX_SITE)'; return }
$site = $site.TrimEnd('/')
$dir = Join-Path $HOME '.greenbox\mcp'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Write-Host "Greenbox MCP -> $dir"
foreach ($f in 'greenbox_mcp.py', 'tools.json', 'install_mcp.py') { Invoke-WebRequest -UseBasicParsing "$site/gb-ai/$f" -OutFile (Join-Path $dir $f) }
$py = $null
foreach ($c in 'py', 'python', 'python3') { $cmd = Get-Command $c -ErrorAction SilentlyContinue; if ($cmd -and $cmd.Source -notlike '*WindowsApps*') { $py = $cmd.Source; break } }
if (-not $py) { Write-Host 'Can Python 3 / Python 3 is needed: https://www.python.org/downloads/ (tick "Add python.exe to PATH"), roi chay lai lenh nay.'; return }
if ((Split-Path $py -Leaf) -eq 'py.exe') { & $py -3 (Join-Path $dir 'install_mcp.py') } else { & $py (Join-Path $dir 'install_mcp.py') }
