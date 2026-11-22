param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [switch]$SkipTasks,
  [switch]$SkipSeed,
  [string]$PreviousRelease,
  [string]$Domain
)

$ErrorActionPreference = 'Stop'
$envFile = Join-Path $AppDir '.env.local'
if (!$SkipTasks) {
  # install.ps1 verifies this script and supplies its ACL checker before
  # invoking it. Do not load policy code from an unchecked working copy.
  if (!(Get-Command Assert-MaintenancePath -CommandType Function -ErrorAction SilentlyContinue)) {
    throw 'Use deploy/windows/install.ps1 to publish startup tasks.'
  }
  Assert-MaintenancePath $appDir
  Assert-MaintenancePath $envFile
  Assert-MaintenancePath $NodeExe
  Assert-MaintenancePath (Get-Command npm.cmd -ErrorAction Stop).Source
}
$releases = Join-Path $appDir '.vch-releases'
$published = Join-Path $releases 'current'
$manifest = '.vch-program-files'
$stateDirs = @('storage', 'uploads', 'downloads', 'backups', 'logs', 'tmp')

$lock = [IO.File]::Open((Join-Path $appDir '.windows-deploy.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
$work = Join-Path $appDir ('.vch-upgrade-' + [guid]::NewGuid())
$candidate = Join-Path $work 'new'
$old = Join-Path $work 'old'
$artifacts = @('node_modules', '.next', 'dist')
$taskNames = @('VControlHub Web', 'VControlHub Worker', 'VControlHub SSH WS')
$previous = @{}
$running = @()
$registered = @()
$legacyTasks = @()
$rollbackPrepared = $false
$installed = @()
$programBackup = Join-Path $work 'previous-program'
$oldProgram = @()
$newProgram = @()
$retired = @()
$publishedFiles = @()
$createdRuntime = $false
$movedState = @()
$linkedState = @()
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
  foreach ($task in @(Get-InstalledRoleTasks)) {
    $name = $task.TaskName
    if ($task.State -in @('Running', 'Queued')) { $running += $name }
    if (!$SkipTasks) { $previous[$name] = Export-ScheduledTask -TaskPath '\' -TaskName $name
      $legacyRunner = Join-Path $PSScriptRoot 'run.ps1'
      if ($previous[$name].IndexOf([Security.SecurityElement]::Escape($legacyRunner), [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        if (!$PreviousRelease) { throw 'For the first versioned upgrade, supply -PreviousRelease with the complete previous running release.' }
        $prior = (Resolve-Path -LiteralPath $PreviousRelease).Path
        if ($prior -eq $appDir) { throw 'The previous release must be a separate directory.' }
        Assert-MaintenancePath $prior -Tree
        foreach ($file in @('deploy/windows/run.ps1','scripts/backup.mjs','.next/BUILD_ID','dist/server.js','dist/worker.js','dist/ssh-ws-proxy.js','node_modules','public','.env.local')) {
          if (!(Test-Path -LiteralPath (Join-Path $prior $file))) { throw "Incomplete previous release: $file" }
        }
        $priorRunner = Join-Path $prior 'deploy/windows/run.ps1'
        $xml = [xml]$previous[$name]
        foreach ($action in $xml.Task.Actions.Exec) {
          $action.Arguments = [regex]::Replace($action.Arguments, [regex]::Escape($legacyRunner), { param($m) $priorRunner }, 'IgnoreCase')
        }
        $previous[$name] = $xml.OuterXml
        $legacyTasks += $name
      }
      [IO.File]::WriteAllText((Join-Path $old ($name + '.xml')), $previous[$name]) }
  }
  if ($SkipTasks -and $running.Count) { throw 'Stop the installed roles before publishing a build with -SkipTasks.' }
  $rollbackPrepared = $true
  if (!$SkipTasks) { Assert-MaintenancePath $work; Assert-MaintenancePath $candidate }
  foreach ($dir in Get-Content (Join-Path $appDir 'deploy/lib/release-directories.txt')) {
    $source = Join-Path $appDir $dir
    if ($dir -in $stateDirs) { continue }
    if (Test-Path -LiteralPath $source) {
      if (!$SkipTasks) { Assert-MaintenancePath $source -Tree }
      Copy-Item -LiteralPath $source -Destination $candidate -Recurse -Force }
  }
  Get-ChildItem -LiteralPath $appDir -File -Force | Where-Object {
    $_.Name -notin @('.windows-deploy.lock', $manifest) -and ($_.Name -notlike '.env*' -or $_.Name -in @('.env.local', '.env.example'))
  } | ForEach-Object {
    if (!$SkipTasks) { Assert-MaintenancePath $_.FullName }
    Copy-Item -LiteralPath $_.FullName -Destination $candidate -Force
  }
  $releaseEnv = Join-Path $candidate '.env.local'
  $envJson = & $nodeExe (Join-Path $PSScriptRoot 'read-install-env.mjs') $releaseEnv
  if ($LASTEXITCODE -ne 0) { throw 'Could not load production environment' }
  foreach ($property in ($envJson | ConvertFrom-Json).PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
  }
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
    & $nodeExe deploy/check-upgrade-migrations.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Migration preflight failed' }

    if (!$SkipTasks) {
      Assert-MaintenancePath $candidate -Tree
      if (Test-Path -LiteralPath $releases) { Assert-MaintenancePath $releases }
      if (Test-Path -LiteralPath $published) {
        Assert-MaintenancePath $published
        $priorManifest = Join-Path $published $manifest
        Assert-MaintenancePath $priorManifest
        $oldProgram = @(Get-Content -LiteralPath $priorManifest -Encoding UTF8)
        foreach ($name in $oldProgram) {
          if (!$name -or $name -in @('.', '..') -or [IO.Path]::GetFileName($name) -ne $name) { throw 'Invalid published release manifest' }
          $program = Get-Item -LiteralPath (Join-Path $published $name) -Force
          Assert-MaintenancePath $program.FullName -Tree:($program -is [IO.DirectoryInfo])
        }
      }
      foreach ($key in @('STORAGE_ROOT','DOWNLOAD_ROOT','BACKUP_DIR','ARIA2_RPC_DIR','FILE_VERSION_DIR','MEDIA_UPLOAD_TMP_DIR','MEDIA_THUMB_CACHE_DIR','IMAGE_UPLOAD_DIR','VCH_STORAGE_ROOT')) {
        $value = [Environment]::GetEnvironmentVariable($key)
        if (!$value) { continue }
        if ($key -eq 'VCH_STORAGE_ROOT') { $value = Join-Path $value 'storage/vps-backups' }
        $absolute = if ([IO.Path]::IsPathRooted($value)) { [IO.Path]::GetFullPath($value) } else { [IO.Path]::GetFullPath((Join-Path $appDir $value)) }
        $prefix = $appDir.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
        if ($absolute -eq $appDir) { throw "Persistent path overlaps release root: $key" }
        if ($absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
          $top = ($absolute.Substring($prefix.Length) -split '[\\/]')[0]
          if ($top -notin $stateDirs) {
            if ($top.StartsWith('.') -or (Test-Path -LiteralPath (Join-Path $candidate $top))) { throw "Persistent path overlaps release source: $key" }
            $stateDirs += $top
          }
        }
      }
      $newProgram = @($manifest) + @(Get-ChildItem -LiteralPath $candidate -Force | ForEach-Object { $_.Name })
      foreach ($name in $newProgram) {
        if ($name -in $stateDirs -or ($name -notin $oldProgram -and (Test-Path -LiteralPath (Join-Path $published $name)))) {
          throw "Release collides with persistent data: $name"
        }
      }
      [IO.File]::WriteAllLines((Join-Path $candidate $manifest), [string[]]$newProgram)
      foreach ($dir in $stateDirs) {
        $dataDir = Join-Path $appDir $dir
        $liveData = Join-Path $published $dir
        $entry = Get-Item -LiteralPath $dataDir -Force -ErrorAction SilentlyContinue
        if ($entry -and ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
          $rawTarget = if ($entry.Target -is [Array]) { [string]$entry.Target[0] } else { [string]$entry.Target }
          $canonTarget = if ($rawTarget -and (Test-Path -LiteralPath $rawTarget)) { [string](& $nodeExe -e "process.stdout.write(require('fs').realpathSync.native(process.argv[1]))" $rawTarget) } else { $rawTarget }
          $canonLive = if (Test-Path -LiteralPath $liveData) { [string](& $nodeExe -e "process.stdout.write(require('fs').realpathSync.native(process.argv[1]))" $liveData) } else { $liveData }
          if (!($canonTarget) -or ($canonTarget.TrimEnd([char[]]@('\', '/')) -ne $canonLive.TrimEnd([char[]]@('\', '/'))) -or !(Test-Path -LiteralPath $liveData -PathType Container)) {
            throw "Unexpected persistent directory link: $dataDir"
          }
        } elseif ((Test-Path -LiteralPath $liveData) -or ($entry -and !($entry -is [IO.DirectoryInfo]))) {
          throw "Cannot identify the installed data directory: $dataDir"
        }
      }
    }

    $cutover = $true
    foreach ($name in $running) { Stop-RoleTask $name }
    & npm.cmd run prisma:deploy
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
    & npm.cmd exec --no -- tsx deploy/prepare-cost-ledger.ts
    if ($LASTEXITCODE -ne 0) { throw 'Budget delivery ledger migration failed' }
    if (!$SkipSeed) {
      & $nodeExe "--env-file=$releaseEnv" --import tsx prisma/seed.ts
      if ($LASTEXITCODE -ne 0) { throw 'Database seed failed' }
    }
  } finally { Pop-Location }

  if ($SkipTasks) {
    foreach ($dir in $artifacts) {
      $live = Join-Path $appDir $dir
      if (Test-Path -LiteralPath $live) { Move-Item -LiteralPath $live -Destination $old }
      Move-Item -LiteralPath (Join-Path $candidate $dir) -Destination $appDir
      $installed += $dir
    }
  } else {
    New-Item -ItemType Directory -Path $releases -Force | Out-Null
    Assert-MaintenancePath $releases
    if (!(Test-Path -LiteralPath $published)) {
      New-Item -ItemType Directory -Path $published | Out-Null
      $createdRuntime = $true
    }
    Assert-MaintenancePath $published
    # The application and its backup tools need real data directories in their
    # working tree. Retain them across releases and link the old checkout paths.
    foreach ($dir in $stateDirs) {
      $dataDir = Join-Path $appDir $dir
      $liveData = Join-Path $published $dir
      if (Test-Path -LiteralPath $liveData) { continue }
      if (!(Test-Path -LiteralPath $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
      [IO.Directory]::Move($dataDir, $liveData)
      $movedState += $dir
      $linkType = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { 'Junction' } else { 'SymbolicLink' }
      New-Item -ItemType $linkType -Path $dataDir -Target $liveData | Out-Null
      $linkedState += $dir
    }
    # All roles are stopped. Swap the complete program, including helpers,
    # config and static files. Track individual renames for a partial cutover.
    New-Item -ItemType Directory -Path $programBackup | Out-Null
    foreach ($name in $oldProgram) {
      Move-Item -LiteralPath (Join-Path $published $name) -Destination $programBackup -Force
      $retired += $name
    }
    foreach ($name in $newProgram) {
      Move-Item -LiteralPath (Join-Path $candidate $name) -Destination $published -Force
      $publishedFiles += $name
    }
    $runner = Join-Path $published 'deploy/windows/run.ps1'
    $roles = @('web', 'worker', 'ssh-ws')
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
    for ($i = 0; $i -lt $roles.Count; $i++) {
      $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $runner + '" -Role ' + $roles[$i] + ' -NodeExe "' + $nodeExe + '" -InstallRoot "' + $appDir + '"'
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
    $parsedIp = $null
    $formattedHost = if ([Net.IPAddress]::TryParse($webHost.Trim('[', ']'), [ref]$parsedIp) -and $parsedIp.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) {
      '[' + $parsedIp.ToString() + ']'
    } else {
      $webHost
    }
    $healthUrl = "http://${formattedHost}:${webPort}/login"
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
    if ($retired.Count) {
      $archive = Join-Path $releases ([guid]::NewGuid().ToString())
      [IO.Directory]::Move($programBackup, $archive)
      $programBackup = $archive
    }
    Write-Host "VControlHub Windows runtime is ready at $healthUrl"
    $sshWsPort = if ($env:SSH_WS_PORT) { $env:SSH_WS_PORT.Trim() } else { '3001' }
    if ($Domain) { Write-Host "Configure Caddy or IIS HTTPS for $Domain and proxy /ssh to 127.0.0.1:${sshWsPort}; see docs/windows-development.md." }
  }
} catch {
  if ($cutover -or ($rollbackPrepared -and $legacyTasks.Count)) {
    try {
      $restoreTasks = @(($registered + $legacyTasks) | Select-Object -Unique)
      foreach ($task in @(Get-InstalledRoleTasks | Where-Object { $_.TaskName -in $restoreTasks })) {
        Stop-RoleTask $task.TaskName
      }
      foreach ($name in $publishedFiles) { Move-Item -LiteralPath (Join-Path $published $name) -Destination $candidate -Force }
      foreach ($name in $retired) { Move-Item -LiteralPath (Join-Path $programBackup $name) -Destination $published -Force }
      foreach ($dir in $linkedState) { [IO.Directory]::Delete((Join-Path $appDir $dir)) }
      foreach ($dir in $movedState) { [IO.Directory]::Move((Join-Path $published $dir), (Join-Path $appDir $dir)) }
      if ($createdRuntime) { [IO.Directory]::Delete($published) }
      foreach ($dir in $installed) { Move-Item -LiteralPath (Join-Path $appDir $dir) -Destination $candidate }
      Get-ChildItem -LiteralPath $old -Directory -Force | Move-Item -Destination $appDir
      foreach ($name in $restoreTasks) {
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
