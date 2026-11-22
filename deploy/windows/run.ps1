param(
  [Parameter(Mandatory = $true)][ValidateSet('web', 'worker', 'ssh-ws')][string]$Role,
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [string]$ConfigFile,
  [string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
$appDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $appDir
$envFile = if ($ConfigFile) { $ConfigFile } else { Join-Path $appDir '.env.local' }
if (!(Test-Path -LiteralPath $envFile -PathType Leaf)) { throw "Missing $envFile" }
if (!$InstallRoot) { $InstallRoot = $appDir }
$envJson = & $NodeExe (Join-Path $PSScriptRoot 'read-install-env.mjs') $envFile --runtime $InstallRoot
if ($LASTEXITCODE -ne 0) { throw 'Could not load runtime configuration' }
foreach ($property in ($envJson | ConvertFrom-Json).PSObject.Properties) {
  [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
}
# Helpers resolve their code relative to APP_DIR, including after a rollback.
$env:APP_DIR = $appDir
$env:ENV_FILE = $envFile
$env:NODE_ENV = 'production'
# The separately registered worker owns background polling.
$env:VCONTROLHUB_WORKERS_DISABLED = if ($Role -eq 'worker') { 'false' } else { 'true' }
$entry = switch ($Role) {
  'web' { 'dist/server.js' }
  'worker' { 'dist/worker.js' }
  'ssh-ws' { 'dist/ssh-ws-proxy.js' }
}
if (!(Test-Path -LiteralPath $entry -PathType Leaf)) { throw "Missing $entry" }
$logDir = Join-Path $appDir 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir ("windows-$Role.log")
& $NodeExe "--env-file=$envFile" --import ./deploy/check-aria2-secret.mjs $entry *>> $logFile
exit $LASTEXITCODE
