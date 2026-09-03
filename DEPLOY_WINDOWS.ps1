$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Step([string]$message) {
  Write-Host "`n=== $message ===" -ForegroundColor Cyan
}

function Require-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name"
  }
}

Step "Check Node.js and npm"
Require-Command "node"
Require-Command "npm"
Require-Command "npx"
$nodeVersion = (& node -p "process.versions.node").Trim()
if ($LASTEXITCODE -ne 0 -or -not $nodeVersion) {
  throw "Unable to read Node.js version."
}
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 22) {
  throw "Node.js $nodeVersion detected. Fluxa requires Node.js 22 or newer."
}
Write-Host "Node.js $nodeVersion"

Step "Install pinned dependencies"
& npm install
if ($LASTEXITCODE -ne 0) {
  throw "npm install failed."
}

Step "Create local deployment secrets"
$varsPath = Join-Path $PSScriptRoot '.dev.vars'
if (-not (Test-Path $varsPath)) {
  $secretLines = & node scripts/generate-secrets.mjs
  if ($LASTEXITCODE -ne 0) {
    throw "Secret generation failed."
  }
  $secretText = (($secretLines | ForEach-Object { [string]$_ }) -join "`r`n") + "`r`n"
  [System.IO.File]::WriteAllText($varsPath, $secretText, [System.Text.Encoding]::ASCII)
  Write-Host "Created .dev.vars with ADMIN_TOKEN, SUB_TOKEN, CLIENT_UUID and TROJAN_PASSWORD."
  Write-Host "Keep .dev.vars private. Never upload it to GitHub." -ForegroundColor Yellow
} else {
  Write-Host "Existing .dev.vars found. It will be reused and will NOT be overwritten."
}

Step "Login to Cloudflare"
Write-Host "A browser window may open. Sign in to your Cloudflare account and approve Wrangler."
& npx wrangler login
if ($LASTEXITCODE -ne 0) {
  throw "Cloudflare login failed."
}

Step "Run Fluxa release checks"
& npm run release-check
if ($LASTEXITCODE -ne 0) {
  throw "Fluxa release checks failed."
}

Step "Deploy Fluxa to Cloudflare"
Write-Host "The first deployment may provision FLUXA_KV and the SQLite Durable Object automatically."
$deployLines = & npx wrangler deploy --secrets-file .dev.vars 2>&1
$deployExit = $LASTEXITCODE
$deployLines | ForEach-Object { Write-Host $_ }
if ($deployExit -ne 0) {
  throw "Cloudflare deployment failed."
}

$url = $null
foreach ($line in $deployLines) {
  $m = [regex]::Match([string]$line, 'https://[A-Za-z0-9._-]+\.workers\.dev')
  if ($m.Success) {
    $url = $m.Value
  }
}
if (-not $url) {
  $url = Read-Host "Paste the deployed https://...workers.dev URL"
}
if (-not $url) {
  throw "Worker URL was not provided."
}
$url = $url.Trim().TrimEnd('/')
[System.IO.File]::WriteAllText((Join-Path $PSScriptRoot '.fluxa-url.txt'), $url + "`r`n", [System.Text.Encoding]::ASCII)

Step "Run read-only Smoke Check"
$vars = @{}
Get-Content $varsPath | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') {
    $vars[$matches[1].Trim()] = $matches[2].Trim()
  }
}
$env:FLUXA_URL = $url
$env:FLUXA_ADMIN_TOKEN = $vars['ADMIN_TOKEN']
$env:FLUXA_SUB_TOKEN = $vars['SUB_TOKEN']
& npm run smoke
if ($LASTEXITCODE -ne 0) {
  throw "Smoke Check failed. The Worker may be deployed, but verification did not pass."
}

Step "Done"
Write-Host "Fluxa URL: $url" -ForegroundColor Green
Write-Host "Admin UI: $url/admin"
Write-Host "Health:   $url/health"
Write-Host "Secrets:  $varsPath" -ForegroundColor Yellow
Write-Host "Next: open /admin, run Diagnostics, then test subscriptions with real clients."
