param(
  [Parameter(Mandatory = $true)][ValidateSet('web', 'worker', 'ssh-ws')][string]$Role,
  [Parameter(Mandatory = $true)][string]$NodeExe
)

$ErrorActionPreference = 'Stop'
$appDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $appDir
$env:NODE_ENV = 'production'
$envFile = Join-Path $appDir '.env.local'
if (!(Test-Path -LiteralPath $envFile -PathType Leaf)) { throw "Missing $envFile" }
$entry = switch ($Role) {
  'web' { 'dist/server.js' }
  'worker' { 'dist/worker.js' }
  'ssh-ws' { 'dist/ssh-ws-proxy.js' }
}
if (!(Test-Path -LiteralPath $entry -PathType Leaf)) { throw "Missing $entry" }
$logDir = Join-Path $appDir 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir ("windows-$Role.log")
& $NodeExe "--env-file=$envFile" $entry *>> $logFile
exit $LASTEXITCODE
