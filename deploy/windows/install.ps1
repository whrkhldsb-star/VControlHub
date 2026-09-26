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
$version = & $nodeExe -p 'process.versions.node'
$parts = $version.Split('.')
if ([int]$parts[0] -lt 22 -or ([int]$parts[0] -eq 22 -and [int]$parts[1] -lt 9)) {
  throw "Node.js 22.9+ is required; found $version"
}
Get-Command npm.cmd -ErrorAction Stop | Out-Null
$envFile = Join-Path $appDir '.env.local'
if (!(Test-Path -LiteralPath $envFile -PathType Leaf)) {
  $template = [IO.File]::ReadAllText((Join-Path $appDir 'deploy\env.production.example'))
  $template = $template.Replace('STORAGE_ROOT="/var/lib/${APP_SLUG:-vcontrolhub}/storage"', 'STORAGE_ROOT="./storage"')
  $template = $template.Replace('DOWNLOAD_ROOT="/var/lib/${APP_SLUG:-vcontrolhub}/downloads"', 'DOWNLOAD_ROOT="./downloads"')
  $template = $template.Replace('BACKUP_DIR="/var/backups/${APP_SLUG:-vcontrolhub}"', 'BACKUP_DIR="./backups"')
  $template = $template.Replace('ARIA2_RPC_DIR="/var/lib/${APP_SLUG:-vcontrolhub}/aria2"', 'ARIA2_RPC_DIR="./tmp/aria2"')
  [IO.File]::WriteAllText($envFile, $template, [Text.UTF8Encoding]::new($false))
  throw "Created $envFile. Set DATABASE_URL, AUTH_SESSION_SECRET, SSH_WS_SECRET, ENCRYPTION_KEY and ADMIN_INITIAL_PASSWORD, then rerun this script."
}

$content = [IO.File]::ReadAllText($envFile)
$directSecretMatch = [regex]::Match($content, '(?m)^STORAGE_DIRECT_ACCESS_SECRET\s*=\s*(.*)$')
$directSecret = $directSecretMatch.Groups[1].Value.Trim().Trim('"').Trim("'")
if (!$directSecret -or $directSecret -match 'REPLACE_WITH|CHANGE_ME') {
  $directSecret = & $nodeExe -e 'console.log(require("node:crypto").randomBytes(48).toString("base64url"))'
  $line = 'STORAGE_DIRECT_ACCESS_SECRET="' + $directSecret + '"'
  if ($content -match '(?m)^STORAGE_DIRECT_ACCESS_SECRET=') {
    $content = [regex]::Replace($content, '(?m)^STORAGE_DIRECT_ACCESS_SECRET=.*$', $line)
  } else {
    $content = $content.TrimEnd() + [Environment]::NewLine + $line + [Environment]::NewLine
  }
  [IO.File]::WriteAllText($envFile, $content, [Text.UTF8Encoding]::new($false))
  Write-Host 'Generated STORAGE_DIRECT_ACCESS_SECRET for signed cloud-storage links.'
}

$required = @('DATABASE_URL', 'AUTH_SESSION_SECRET', 'SSH_WS_SECRET', 'STORAGE_DIRECT_ACCESS_SECRET', 'ENCRYPTION_KEY', 'ADMIN_INITIAL_PASSWORD')
$validate = 'for (const key of ' + (ConvertTo-Json -Compress -InputObject $required) + ') { const v = process.env[key] || ""; if (!v || /REPLACE_WITH|CHANGE_ME|example\.com/i.test(v)) { console.error("Missing or placeholder: " + key); process.exitCode = 1 } }'
& $nodeExe "--env-file=$envFile" -e $validate
if ($LASTEXITCODE -ne 0) { throw 'Production environment validation failed' }
$exportNames = 'const fs = require("fs"); const names = [...fs.readFileSync(process.argv[1], "utf8").matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(match => match[1]); console.log(JSON.stringify(Object.fromEntries(names.map(name => [name, process.env[name] ?? ""]))))'
$envJson = & $nodeExe "--env-file=$envFile" -e $exportNames $envFile
if ($LASTEXITCODE -ne 0) { throw 'Could not load production environment' }
$envValues = $envJson | ConvertFrom-Json
foreach ($property in $envValues.PSObject.Properties) {
  [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
}
foreach ($directory in @('storage', 'downloads', 'backups', 'tmp', 'uploads', 'logs')) {
  New-Item -ItemType Directory -Path (Join-Path $appDir $directory) -Force | Out-Null
}

$taskNames = @('VControlHub Web', 'VControlHub Worker', 'VControlHub SSH WS')
$previouslyRunning = @()
if (!$SkipTasks) {
  foreach ($name in $taskNames) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq 'Running') { $previouslyRunning += $name }
    if ($task) { Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue }
  }
}

try {
  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  & npm.cmd run prisma:generate
  if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed' }
  & npm.cmd run prisma:deploy
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
  if (!$SkipSeed) {
    & $nodeExe "--env-file=$envFile" --import tsx prisma/seed.ts
    if ($LASTEXITCODE -ne 0) { throw 'Database seed failed' }
  }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Next.js build failed' }
  & npm.cmd run build:runtime
  if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed' }
} catch {
  foreach ($name in $previouslyRunning) { Start-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue }
  throw
}

if ($SkipTasks) { Write-Host 'Windows build and migration completed; startup tasks were skipped.'; exit 0 }

$runner = Join-Path $PSScriptRoot 'run.ps1'
$roles = @('web', 'worker', 'ssh-ws')
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
for ($i = 0; $i -lt $roles.Count; $i++) {
  $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '" -Role ' + $roles[$i] + ' -NodeExe "' + $nodeExe + '"'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtStartup
  Register-ScheduledTask -TaskName $taskNames[$i] -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Force | Out-Null
  Start-ScheduledTask -TaskName $taskNames[$i]
}

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 2
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri 'http://127.0.0.1:3000/login'
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}
if (!$ready) { throw 'Web process did not become healthy on 127.0.0.1:3000; inspect logs/windows-web.log and Scheduled Tasks.' }
Write-Host "VControlHub Windows runtime is ready at http://127.0.0.1:3000/login"
if ($Domain) { Write-Host "Configure Caddy or IIS HTTPS for $Domain and proxy /ssh to 127.0.0.1:3001; see docs/windows-development.md." }
