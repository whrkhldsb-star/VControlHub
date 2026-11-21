param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [switch]$SkipTasks,
  [switch]$SkipSeed,
  [string]$Domain
)

$ErrorActionPreference = 'Stop'
$envFile = Join-Path $AppDir '.env.local'
$lock = [IO.File]::Open((Join-Path $appDir '.windows-deploy.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
$work = Join-Path $appDir ('.vch-upgrade-' + [guid]::NewGuid())
$candidate = Join-Path $work 'new'
$old = Join-Path $work 'old'
$artifacts = @('node_modules', '.next', 'dist')
$taskNames = @('VControlHub Web', 'VControlHub Worker', 'VControlHub SSH WS')
$previous = @{}
$running = @()
$registered = @()
$installed = @()
$cutover = $false
$keepRecovery = $false

function Get-InstalledRoleTasks {
  # A filtered CIM lookup reports ObjectNotFound on a fresh scheduler that
  # has no tasks at its root. An unfiltered listing can return an empty set.
  Get-ScheduledTask | Where-Object { $_.TaskPath -eq '\' -and $_.TaskName -in $taskNames }
}

function Stop-RoleTask($name) {
  $task = Get-ScheduledTask -TaskPath '\' -TaskName $name
  if ($task.State -in @('Running', 'Queued')) {
    Stop-ScheduledTask -InputObject $task
    for ($i = 0; $i -lt 30; $i++) {
      if ((Get-ScheduledTask -TaskPath '\' -TaskName $name).State -notin @('Running', 'Queued')) { return }
      Start-Sleep -Seconds 1
    }
    throw "Timed out stopping $name"
  }
}

try {
  New-Item -ItemType Directory -Path $candidate, $old | Out-Null
  foreach ($dir in Get-Content (Join-Path $appDir 'deploy/lib/release-directories.txt')) {
    $source = Join-Path $appDir $dir
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $candidate -Recurse -Force }
  }
  Get-ChildItem -LiteralPath $appDir -File -Force | Where-Object {
    $_.Name -ne '.windows-deploy.lock' -and ($_.Name -notlike '.env*' -or $_.Name -in @('.env', '.env.local', '.env.runtime', '.env.production', '.env.production.local', '.env.example'))
  } | Copy-Item -Destination $candidate -Force
  Push-Location $candidate
  try {
    Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
    & npm.cmd ci --include=dev
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & npm.cmd run prisma:generate
    if ($LASTEXITCODE -ne 0) { throw 'Prisma generation failed' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Next.js build failed' }
    & npm.cmd run build:runtime
    if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed' }
    foreach ($file in @('.next/BUILD_ID', 'dist/server.js', 'dist/worker.js', 'dist/ssh-ws-proxy.js')) {
      if (!(Get-Item -LiteralPath $file).Length) { throw "Missing release artifact $file" }
    }
    if (Test-Path -LiteralPath (Join-Path $appDir '.next/BUILD_ID')) {
      & $nodeExe deploy/check-upgrade-migrations.mjs
      if ($LASTEXITCODE -ne 0) { throw 'Migration preflight failed' }
    }

    foreach ($task in @(Get-InstalledRoleTasks)) {
      $name = $task.TaskName
      if ($task.State -in @('Running', 'Queued')) { $running += $name }
      if (!$SkipTasks) { $previous[$name] = Export-ScheduledTask -TaskPath '\' -TaskName $name
        [IO.File]::WriteAllText((Join-Path $old ($name + '.xml')), $previous[$name]) }
    }
    if ($SkipTasks -and $running.Count) { throw 'Stop the installed roles before publishing a build with -SkipTasks.' }
    $cutover = $true
    foreach ($name in $running) { Stop-RoleTask $name }
    & npm.cmd run prisma:deploy
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
    & npm.cmd exec --no -- tsx deploy/prepare-cost-ledger.ts
    if ($LASTEXITCODE -ne 0) { throw 'Budget delivery ledger migration failed' }
    if (!$SkipSeed) {
      & $nodeExe "--env-file=$envFile" --import tsx prisma/seed.ts
      if ($LASTEXITCODE -ne 0) { throw 'Database seed failed' }
    }
  } finally { Pop-Location }

  foreach ($dir in $artifacts) {
    $live = Join-Path $appDir $dir
    if (Test-Path -LiteralPath $live) { Move-Item -LiteralPath $live -Destination $old }
    Move-Item -LiteralPath (Join-Path $candidate $dir) -Destination $appDir
    $installed += $dir
  }
  if (!$SkipTasks) {
    $runner = Join-Path $PSScriptRoot 'run.ps1'
    $roles = @('web', 'worker', 'ssh-ws')
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
    for ($i = 0; $i -lt $roles.Count; $i++) {
      $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '" -Role ' + $roles[$i] + ' -NodeExe "' + $nodeExe + '"'
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
      $trigger = New-ScheduledTaskTrigger -AtStartup
      $registered += $taskNames[$i]
      Register-ScheduledTask -TaskName $taskNames[$i] -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Force | Out-Null
    }
    foreach ($name in $taskNames) { Start-ScheduledTask -TaskName $name }
    $webPort = if ($env:PORT) { [int]$env:PORT.Trim() } else { 3000 }
    $webHost = if ($env:NEXT_HOST) { $env:NEXT_HOST.Trim() } else { '127.0.0.1' }
    if ($webHost -eq '0.0.0.0') { $webHost = '127.0.0.1' }
    if ($webHost -eq '::') { $webHost = '::1' }
    $healthUrl = [UriBuilder]::new('http', $webHost, $webPort, '/login').Uri.AbsoluteUri
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      Start-Sleep -Seconds 2
      try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $healthUrl
        if ($response.StatusCode -eq 200 -and !@($taskNames | Where-Object {
          (Get-ScheduledTask -TaskPath '\' -TaskName $_).State -ne 'Running'
        }).Count) { $ready = $true; break }
      } catch { }
    }
    if (!$ready) { throw "Runtime did not become ready at $healthUrl; inspect the role logs." }
    Write-Host "VControlHub Windows runtime is ready at $healthUrl"
    $sshWsPort = if ($env:SSH_WS_PORT) { $env:SSH_WS_PORT.Trim() } else { '3001' }
    if ($Domain) { Write-Host "Configure Caddy or IIS HTTPS for $Domain and proxy /ssh to 127.0.0.1:${sshWsPort}; see docs/windows-development.md." }
  } else { Write-Host 'Windows build and migration completed; startup tasks were skipped.' }
} catch {
  if ($cutover) {
    try {
      foreach ($task in @(Get-InstalledRoleTasks | Where-Object { $_.TaskName -in $registered })) {
        Stop-RoleTask $task.TaskName
      }
      foreach ($dir in $installed) { Move-Item -LiteralPath (Join-Path $appDir $dir) -Destination $candidate }
      Get-ChildItem -LiteralPath $old -Directory -Force | Move-Item -Destination $appDir
      foreach ($name in $registered) {
        if ($previous.ContainsKey($name)) {
          Register-ScheduledTask -TaskPath '\' -TaskName $name -Xml $previous[$name] -Force | Out-Null
        } elseif (Get-InstalledRoleTasks | Where-Object { $_.TaskName -eq $name }) {
          Unregister-ScheduledTask -TaskPath '\' -TaskName $name -Confirm:$false
        }
      }
      foreach ($name in $running) {
        if ((Get-ScheduledTask -TaskPath '\' -TaskName $name).State -ne 'Running') { Start-ScheduledTask -TaskName $name }
      }
    } catch {
      $keepRecovery = $true
      throw "Rollback incomplete. Recovery files retained in $work. $_"
    }
  }
  throw
} finally {
  try { if (!$keepRecovery -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force } } finally { $lock.Dispose() }
}
