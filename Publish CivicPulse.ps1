$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath '.dev.vars')) {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  $generator.GetBytes($bytes)
  $generator.Dispose()
  $key = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot '.dev.vars'), "BOOTSTRAP_KEY=$key`n")
}

$identity = & npx wrangler whoami 2>&1
if ($LASTEXITCODE -ne 0 -or ($identity -join "`n") -match 'not authenticated') {
  Write-Host 'Cloudflare sign-in is required to create the permanent public link.'
  & npx wrangler login
  if ($LASTEXITCODE -ne 0) { throw 'Cloudflare sign-in was not completed.' }
}

& npm run build
if ($LASTEXITCODE -ne 0) { throw 'The website build failed.' }
& npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw 'Cloudflare deployment failed.' }

$line = Get-Content -LiteralPath '.dev.vars' | Where-Object { $_ -match '^BOOTSTRAP_KEY=' } | Select-Object -First 1
if (-not $line) { throw 'Setup key is missing from .dev.vars.' }
$key = $line.Substring('BOOTSTRAP_KEY='.Length)
$key | & npx wrangler secret put BOOTSTRAP_KEY
if ($LASTEXITCODE -ne 0) { throw 'The setup key could not be added to Cloudflare.' }

Write-Host 'Deployment complete. Open the workers.dev link shown above.'
Write-Host 'For the first setup screen, your private setup key is saved in E:\CivicPulse\.dev.vars.'
