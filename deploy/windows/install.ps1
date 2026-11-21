param(
  [switch]$SkipTasks,
  [switch]$SkipSeed,
  [string]$Domain = ''
)

$ErrorActionPreference = 'Stop'
$appDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $appDir

if (!$SkipTasks) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run an elevated PowerShell session to register startup tasks, or pass -SkipTasks for build-only validation.'
  }
}

$nodeCommand = Get-Command node.exe -ErrorAction Stop
$nodeExe = $nodeCommand.Source
& $nodeExe (Join-Path $appDir 'deploy\check-node-version.mjs')
if ($LASTEXITCODE -ne 0) { throw "Unsupported Node.js runtime" }
Get-Command npm.cmd -ErrorAction Stop | Out-Null
$envFile = Join-Path $appDir '.env.local'
$firstInstall = !(Test-Path -LiteralPath $envFile -PathType Leaf)
if ($firstInstall) {
  $template = [IO.File]::ReadAllText((Join-Path $appDir 'deploy\env.production.example'))
  $template = $template.Replace('STORAGE_ROOT="/var/lib/${APP_SLUG:-vcontrolhub}/storage"', 'STORAGE_ROOT="./storage"')
  $template = $template.Replace('DOWNLOAD_ROOT="/var/lib/${APP_SLUG:-vcontrolhub}/downloads"', 'DOWNLOAD_ROOT="./downloads"')
  $template = $template.Replace('BACKUP_DIR="/var/backups/${APP_SLUG:-vcontrolhub}"', 'BACKUP_DIR="./backups"')
  $template = $template.Replace('ARIA2_RPC_DIR="/var/lib/${APP_SLUG:-vcontrolhub}/aria2"', 'ARIA2_RPC_DIR="./tmp/aria2"')
  [IO.File]::WriteAllText($envFile, $template, [Text.UTF8Encoding]::new($false))
}

$content = [IO.File]::ReadAllText($envFile)
foreach ($name in @('STORAGE_DIRECT_ACCESS_SECRET', 'ARIA2_RPC_SECRET')) {
  $pattern = '(?m)^[ \t]*' + $name + '[ \t]*=[^\r\n]*'
  $matchesInFile = [regex]::Matches($content, $pattern)
  $value = if ($matchesInFile.Count) { ($matchesInFile[$matchesInFile.Count - 1].Value -split '=', 2)[1].Trim().Trim('"').Trim("'") } else { '' }
  if (!$value -or $value -match 'REPLACE_WITH|CHANGE_ME|CHANGE_THIS|(^|_)default_token$') {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $line = $name + '="' + [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_') + '"'
    if ($matchesInFile.Count) { $content = [regex]::Replace($content, $pattern, $line) }
    else { $content = $content.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine }
    [IO.File]::WriteAllText($envFile, $content, [Text.UTF8Encoding]::new($false))
    Write-Host "Generated $name."
  }
}
if ($firstInstall) {
  throw "Created $envFile. Set DATABASE_URL, AUTH_SESSION_SECRET, SSH_WS_SECRET, ENCRYPTION_KEY and ADMIN_INITIAL_PASSWORD, then rerun this script."
}

$envJson = & $nodeExe "--env-file=$envFile" (Join-Path $PSScriptRoot 'read-install-env.mjs') $envFile
if ($LASTEXITCODE -ne 0) { throw 'Could not load production environment' }
$envValues = $envJson | ConvertFrom-Json
foreach ($property in $envValues.PSObject.Properties) {
  [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
}
foreach ($directory in @('storage', 'downloads', 'backups', 'tmp', 'uploads', 'logs')) {
  New-Item -ItemType Directory -Path (Join-Path $appDir $directory) -Force | Out-Null
}

& (Join-Path $PSScriptRoot 'publish-release.ps1') -AppDir $appDir -NodeExe $nodeExe -SkipTasks:$SkipTasks -SkipSeed:$SkipSeed -Domain $Domain
