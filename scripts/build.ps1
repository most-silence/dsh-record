# One-shot rebuild of the dsh-record plugin (node half + browser half).
# Prereqs:
#   1. Node 22+ (verify: `node -v`)
#   2. internet access for `npm install` of tsdown/typescript (first run)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build.ps1

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "==> [1/3] Install build tools (tsdown/typescript, first run) ..." -ForegroundColor Cyan
npm install --legacy-peer-deps 2>&1 | Select-Object -Last 3

Write-Host "==> [2/3] Build both halves (lib/index.js + lib/client.js) ..." -ForegroundColor Cyan
npx tsdown
if ($LASTEXITCODE -ne 0) { throw "tsdown build failed" }

Write-Host "==> [3/3] Sanity check ..." -ForegroundColor Cyan
if (-not (Test-Path "lib/index.js") -or -not (Test-Path "lib/client.js")) { throw "build artifacts missing" }
Write-Host "OK: lib/index.js + lib/client.js generated"

Write-Host ""
Write-Host "Build done. Install into the running profile:" -ForegroundColor Green
Write-Host "  dsh plugin --profile web add file:$PWD"
Write-Host "  (or, in the Web/Desktop GUI: 插件 -> 添加插件 -> 粘贴 file:$PWD)"
