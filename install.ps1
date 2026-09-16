# bource-mcp — one-shot installer
# Installs deps, downloads Playwright chromium, and auto-registers the MCP
# server + /bourse command into the user's GLOBAL opencode config.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
# Or for others (once public on GitHub):
#   irm https://raw.githubusercontent.com/a-saeedia/bource-mcp/main/install.ps1 | iex
param(
  [switch]$SkipBrowser,
  [string]$Node = ""
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

if (-not $Node) {
  $candidates = @("C:\Users\User\tools\node\node.exe", "C:\Program Files\nodejs\node.exe")
  foreach ($c in $candidates) { if (Test-Path $c) { $Node = $c; break } }
}
if (-not $Node) { $Node = "node" }
Write-Host "[bource-mcp] using node: $Node" -ForegroundColor Cyan

function Resolve-Npm {
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $fallbacks = @(
    "$env:APPDATA\npm\node_modules\npm\bin\npm-cli.js",
    "C:\Users\User\tools\node\node_modules\npm\bin\npm-cli.js",
    "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js"
  )
  foreach ($p in $fallbacks) { if (Test-Path $p) { return $p } }
  return $null
}

# 1) dependencies
$npmCli = Resolve-Npm
Push-Location $here
try {
  if ($npmCli) {
    Write-Host "[bource-mcp] npm install (via npm-cli.js)..." -ForegroundColor Cyan
    & $Node $npmCli install
  } else {
    Write-Host "[bource-mcp] npm install..." -ForegroundColor Cyan
    & $Node (Join-Path $here "node_modules\npm\bin\npm-cli.js") install 2>$null
    if ($LASTEXITCODE -ne 0) { npm install }
  }
  if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }

  # 2) playwright chromium (skip with -SkipBrowser)
  if (-not $SkipBrowser) {
    Write-Host "[bource-mcp] downloading Playwright chromium (~150 MB, one-time)..." -ForegroundColor Cyan
    $cli = Join-Path $here "node_modules\playwright\cli.js"
    if (Test-Path $cli) { & $Node $cli install chromium }
    else { npx playwright install chromium }
    if ($LASTEXITCODE -ne 0) { throw "playwright chromium install failed" }
  }
} finally {
  Pop-Location
}

# 3) register into opencode (idempotent)
Write-Host "[bource-mcp] registering MCP server into opencode config..." -ForegroundColor Cyan
& $Node (Join-Path $here "scripts\register-opencode.mjs")
if ($LASTEXITCODE -ne 0) { throw "registration failed" }

Write-Host ""
Write-Host "[bource-mcp] done." -ForegroundColor Green
Write-Host "  1. RESTART opencode (config loads once at startup)."
Write-Host "  2. Run /mcp — you should see 'bource' connected."
Write-Host "  3. Type /bourse to land in the market prompt, or just ask:"
Write-Host "       'is the Tehran market open?' / 'quote فملی'"
Write-Host "  4. For your TSE portal account pages: npm run login (human OTP login once)."
