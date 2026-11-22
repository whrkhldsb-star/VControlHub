param(
  [switch]$SkipTasks,
  [switch]$SkipSeed,
  [string]$PreviousRelease = '',
  [string]$Domain = ''
)

# Resolve rights by SID, independent of host language and PowerShell version.
function Assert-MaintenanceItem($Item, [switch]$Ancestor) {
  $trusted = @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  $sid = [Security.Principal.SecurityIdentifier]
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Maintenance path is a reparse point: $($item.FullName)" }
  $acl = if ($PSVersionTable.PSEdition -eq 'Core') {
    [IO.FileSystemAclExtensions]::GetAccessControl($item)
  } else { $item.GetAccessControl() }
  if ($acl.GetOwner($sid).Value -notin $trusted) { throw "Maintenance path requires a privileged owner: $($item.FullName)" }
  $rights = [Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership,WriteAttributes,WriteExtendedAttributes'
  if (!$ancestor) { $rights = $rights -bor [Security.AccessControl.FileSystemRights]::Write }
  foreach ($rule in $acl.GetAccessRules($true, $true, $sid)) {
    if ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) {
      # CREATOR OWNER is substituted with the child's owner on inheritance.
      # The tree inspection checks the owner and effective rights of each child.
      if ($ancestor -or $rule.IdentityReference.Value -eq 'S-1-3-0') { continue }
    }
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted -and ($rule.FileSystemRights -band $rights)) {
      throw "Maintenance path grants write access outside SYSTEM or administrators: $($item.FullName)"
    }
  }
}

function Assert-MaintenancePath([string]$Path, [switch]$Tree) {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { return }
  $root = Get-Item -LiteralPath $Path -Force
  Assert-MaintenanceItem $root
  $parent = if ($root -is [IO.FileInfo]) { $root.Directory } else { $root.Parent }
  while ($parent) {
    Assert-MaintenanceItem $parent -Ancestor
    $parent = $parent.Parent
  }
  if ($Tree) {
    # Inspect each child before descending. A published dependency tree can
    # contain many files, so check its common ancestors only once.
    $pending = New-Object 'System.Collections.Generic.Stack[System.IO.DirectoryInfo]'
    $pending.Push($root)
    while ($pending.Count) {
      $dir = $pending.Pop()
      foreach ($child in $dir.EnumerateFileSystemInfos()) {
        Assert-MaintenanceItem $child
        if ($child -is [IO.DirectoryInfo]) { $pending.Push($child) }
      }
    }
  }
}

# Dot-sourcing exposes the same policy to packaging checks without installing.
if ($MyInvocation.InvocationName -eq '.') { return }

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

if (!$SkipTasks) {
  Assert-MaintenancePath $appDir
  Assert-MaintenancePath $PSScriptRoot -Tree
  if (Test-Path -LiteralPath (Join-Path $appDir '.env.local')) { Assert-MaintenancePath (Join-Path $appDir '.env.local') }
}
$nodeCommand = Get-Command node.exe -ErrorAction Stop
$nodeExe = $nodeCommand.Source
if (!$SkipTasks) { Assert-MaintenancePath $nodeExe; Assert-MaintenancePath (Join-Path $appDir 'deploy') -Tree }
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

foreach ($directory in @('storage', 'downloads', 'backups', 'tmp', 'uploads', 'logs')) {
  $dataDir = Join-Path $appDir $directory
  if (!(Test-Path -LiteralPath $dataDir -PathType Container)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
}

& (Join-Path $PSScriptRoot 'publish-release.ps1') -AppDir $appDir -NodeExe $nodeExe -SkipTasks:$SkipTasks -SkipSeed:$SkipSeed -Domain $Domain -PreviousRelease $PreviousRelease
