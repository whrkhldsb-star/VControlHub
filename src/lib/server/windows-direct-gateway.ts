import { DIRECT_GATEWAY_DEFAULT_PORT } from "./direct-gateway";

const TASK_NAME = "VControlHub Direct Gateway";
const FIREWALL_RULE = "VControlHub Direct Gateway 31888";
export const WINDOWS_GATEWAY_SCRIPT_NAME = "gateway.ps1";

function powershellLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Windows OpenSSH presents drive paths as /C:/folder; PowerShell needs C:\folder. */
export function windowsSftpPathToNative(path: string) {
  const segments = path.slice(4).split("/");
  if (!/^\/[A-Za-z]:\//.test(path) || !segments.some(Boolean) || segments.some((segment, index) => (!segment && index !== segments.length - 1) || segment === ".." || segment === "." || /[\\:*?"<>|\0]/.test(segment))) {
    throw new Error("Windows SFTP root must be an absolute drive path such as /C:/VControlHub/Files");
  }
  return `${path.slice(1, 3)}\\${path.slice(4).replaceAll("/", "\\")}`.replace(/\\+$/, "");
}

export function buildWindowsDirectGatewaySource(input: { rootPath: string; secret: string; publicListen: boolean }) {
  if (!input.secret) throw new Error("Direct gateway secret is required");
  const root = windowsSftpPathToNative(input.rootPath);
  return String.raw`$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath(${powershellLiteral(root)}).TrimEnd([char]92)
$Secret = ${powershellLiteral(input.secret)}
$Port = ${DIRECT_GATEWAY_DEFAULT_PORT}
$Prefix = 'http://${input.publicListen ? "+" : "localhost"}:' + $Port + '/'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class VchFinalPath {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
}
'@

function Send-Plain($context, [int]$status, [string]$message) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($message)
  $context.Response.StatusCode = $status
  $context.Response.ContentType = 'text/plain; charset=utf-8'
  $context.Response.ContentLength64 = $bytes.Length
  if ($context.Request.HttpMethod -ne 'HEAD') { $context.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
}

function Same-Signature([string]$a, [string]$b) {
  if ($a.Length -ne 64 -or $b.Length -ne 64) { return $false }
  [int]$difference = 0
  for ($i = 0; $i -lt 64; $i++) { $difference = $difference -bor ([int][char]$a[$i] -bxor [int][char]$b[$i]) }
  return $difference -eq 0
}

function Check-Path([string]$relative) {
  $rootInfo = Get-Item -LiteralPath $Root -Force
  if (($rootInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $null }
  $candidate = $Root
  foreach ($part in ($relative -split '/')) {
    if (!$part -or $part -eq '.' -or $part -eq '..' -or $part.IndexOfAny([char[]]'\:') -ge 0) { return $null }
    $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($candidate, $part))
    if (!$candidate.StartsWith($Root + [char]92, [StringComparison]::OrdinalIgnoreCase)) { return $null }
    if (Test-Path -LiteralPath $candidate) {
      $item = Get-Item -LiteralPath $candidate -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $null }
    }
  }
  return $candidate
}

$listener = New-Object Net.HttpListener
$listener.Prefixes.Add($Prefix)
$listener.Start()
try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $request = $context.Request
      $response = $context.Response
      $response.Headers['Referrer-Policy'] = 'no-referrer'
      $response.Headers['X-Content-Type-Options'] = 'nosniff'
      if ($request.HttpMethod -ne 'GET' -and $request.HttpMethod -ne 'HEAD') { Send-Plain $context 405 'method not allowed'; continue }
      if ($request.Url.AbsolutePath -eq '/__vch_health') { Send-Plain $context 200 'ok'; continue }

      $expires = $request.QueryString['expires']
      $signature = $request.QueryString['signature']
      [long]$expiry = 0
      $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
      if (![long]::TryParse($expires, [ref]$expiry) -or $expiry -lt $now -or $expiry -gt ($now + 86400) -or $signature -notmatch '^[a-f0-9]{64}$') {
        Send-Plain $context 403 'invalid or expired link'; continue
      }
      $decoded = [Uri]::UnescapeDataString($request.Url.AbsolutePath)
      if (!$decoded.StartsWith('/') -or $decoded.Contains('?') -or $decoded.Contains('#') -or $decoded.Contains([char]0)) {
        Send-Plain $context 400 'invalid path'; continue
      }
      $relative = $decoded.TrimStart('/')
      $target = Check-Path $relative
      if (!$target) { Send-Plain $context 400 'path outside root'; continue }
      $signedPath = '/' + (($relative -split '/') -join '/')
      $hmac = New-Object Security.Cryptography.HMACSHA256(,[Text.Encoding]::UTF8.GetBytes($Secret))
      try { $expected = [BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($signedPath + '.' + $expires))).Replace('-', '').ToLowerInvariant() }
      finally { $hmac.Dispose() }
      if (!(Same-Signature $expected $signature)) { Send-Plain $context 403 'bad signature'; continue }
      if (!(Test-Path -LiteralPath $target -PathType Leaf)) { Send-Plain $context 404 'not found'; continue }

      $stream = New-Object IO.FileStream($target, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      try {
        $finalPath = New-Object Text.StringBuilder 4096
        $finalLength = [VchFinalPath]::GetFinalPathNameByHandle($stream.SafeFileHandle, $finalPath, 4096, 0)
        if ($finalLength -eq 0 -or $finalLength -ge 4096) { Send-Plain $context 400 'invalid final path'; continue }
        $openedPath = $finalPath.ToString()
        if ($openedPath.StartsWith('\\?\', [StringComparison]::Ordinal)) { $openedPath = $openedPath.Substring(4) }
        if (!$openedPath.StartsWith($Root + [char]92, [StringComparison]::OrdinalIgnoreCase)) { Send-Plain $context 400 'path outside root'; continue }
        $size = $stream.Length
        [long]$start = 0
        [long]$end = $size - 1
        $range = $request.Headers['Range']
        if ($range) {
          if ($range -match '^bytes=(\d+)-(\d*)$') {
          $start = [long]$Matches[1]
          if ($Matches[2]) { $end = [long]$Matches[2] }
          } else { Send-Plain $context 416 'invalid range'; continue }
          if ($start -ge $size -or $end -lt $start -or $end -ge $size) { Send-Plain $context 416 'invalid range'; continue }
          $response.StatusCode = 206
          $response.Headers['Content-Range'] = "bytes $start-$end/$size"
        }
        $response.Headers['Accept-Ranges'] = 'bytes'
        $extension = [IO.Path]::GetExtension($target).ToLowerInvariant()
        $types = @{ '.txt'='text/plain; charset=utf-8'; '.html'='text/html; charset=utf-8'; '.pdf'='application/pdf'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.gif'='image/gif'; '.webp'='image/webp'; '.mp4'='video/mp4'; '.mp3'='audio/mpeg' }
        $response.ContentType = if ($types.ContainsKey($extension)) { $types[$extension] } else { 'application/octet-stream' }
        if ($request.QueryString['download'] -eq '1') { $response.Headers['Content-Disposition'] = 'attachment' }
        $response.ContentLength64 = $end - $start + 1
        if ($request.HttpMethod -ne 'HEAD') {
          $stream.Position = $start
          $buffer = New-Object byte[] 65536
          [long]$remaining = $end - $start + 1
          while ($remaining -gt 0) {
            $count = $stream.Read($buffer, 0, [int][Math]::Min($buffer.Length, $remaining))
            if ($count -le 0) { break }
            $response.OutputStream.Write($buffer, 0, $count)
            $remaining -= $count
          }
        }
      } finally { $stream.Dispose() }
    } catch {
      try { Send-Plain $context 500 'gateway error' } catch { }
    } finally {
      try { $context.Response.Close() } catch { }
    }
  }
} finally { $listener.Close() }
`;
}

function encodedCommand(script: string) {
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

export function buildPrepareWindowsDirectGatewayCommand() {
  const prepare = String.raw`$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:ProgramData 'VControlHub\direct-gateway'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
& icacls.exe $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not secure direct gateway script' }
Write-Output ('DIRECT_DIR=' + $dir)
`;
  return encodedCommand(prepare);
}

export function buildInstallWindowsDirectGatewayCommand(input: { publicListen?: boolean }) {
  const install = String.raw`$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:ProgramData 'VControlHub\direct-gateway'
$file = Join-Path $dir '${WINDOWS_GATEWAY_SCRIPT_NAME}'
if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Direct gateway script was not uploaded' }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $file + '"')
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
Stop-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName '${TASK_NAME}'
Remove-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue
${input.publicListen === false ? "" : `New-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${DIRECT_GATEWAY_DEFAULT_PORT} | Out-Null`}
$ready = $false
for ($i = 0; $i -lt 12; $i++) {
  Start-Sleep -Milliseconds 500
  try { if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri 'http://127.0.0.1:${DIRECT_GATEWAY_DEFAULT_PORT}/__vch_health').Content -eq 'ok') { $ready = $true; break } } catch { }
}
if (!$ready) { throw 'Direct gateway did not become healthy on localhost' }
`;
  return encodedCommand(install);
}

export function buildUninstallWindowsDirectGatewayCommand() {
  const uninstall = String.raw`$ErrorActionPreference = 'Stop'
Stop-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue
$dir = Join-Path $env:ProgramData 'VControlHub\direct-gateway'
if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
`;
  return encodedCommand(uninstall);
}
