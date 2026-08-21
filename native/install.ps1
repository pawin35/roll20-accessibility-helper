# Install the NVDA silencer host - plain Windows, no WSL, no .NET SDK.
#
# ASCII only, and saved with a UTF-8 BOM. Windows PowerShell 5.1 decodes a .ps1
# as the system ANSI code page unless it finds a BOM, so a stray em dash in a
# string is a parse error on someone else's machine and not on yours. Keep both
# properties if you edit this file.
#
# This is the counterpart to install.sh. install.sh builds from source and is
# what the developer runs; this one installs an already-built host and is what
# ships to someone else. It needs nothing but Windows PowerShell.
#
# Run it from the folder it lives in:
#
#     powershell -ExecutionPolicy Bypass -File install.ps1
#
# Expects beside it: roll20-a11y-silencer.exe, nvdaControllerClient.dll, and
# the extension's manifest.json one directory up (so the extension id can be
# derived from its pinned key rather than typed in).
#
# Uninstall:
#     powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall

[CmdletBinding()]
param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$HostName    = 'com.roll20a11y.silencer'
$ExeName     = 'roll20-a11y-silencer.exe'
$ClientName  = 'nvdaControllerClient.dll'
$RegistryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"

$Here       = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = Join-Path $env:LOCALAPPDATA 'Roll20A11y'

# --- Uninstall --------------------------------------------------------------

if ($Uninstall) {
    if (Test-Path $RegistryKey) {
        Remove-Item $RegistryKey -Force
        Write-Host "removed $RegistryKey"
    }
    if (Test-Path $InstallDir) {
        Remove-Item $InstallDir -Recurse -Force
        Write-Host "removed $InstallDir"
    }
    Write-Host ''
    Write-Host 'Done. The extension keeps working; dialogs just cost the'
    Write-Host 'screen-reader chatter again. Remove the extension itself at'
    Write-Host 'chrome://extensions.'
    return
}

# --- The extension id, derived from manifest.json's pinned key --------------
#
# The host manifest's allowed_origins needs an exact extension id, and an
# unpacked extension's id normally comes from its path - which is why
# manifest.json pins it with a "key". Deriving the id from that same key here
# means the two cannot disagree, whatever folder the extension is loaded from.

function Get-ExtensionId {
    param([string]$ManifestPath)

    $key = (Get-Content -Raw -Encoding UTF8 $ManifestPath | ConvertFrom-Json).key
    if (-not $key) {
        throw "manifest.json has no 'key' field; the extension id is not pinned"
    }

    $der = [Convert]::FromBase64String($key)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash($der) } finally { $sha.Dispose() }

    # First 128 bits, each hex digit mapped 0-9a-f -> a-p.
    $id = ''
    foreach ($byte in $hash[0..15]) {
        $id += [char](97 + ($byte -shr 4))
        $id += [char](97 + ($byte -band 0x0F))
    }
    return $id
}

$manifestPath = Join-Path (Split-Path -Parent $Here) 'manifest.json'
if (-not (Test-Path $manifestPath)) {
    $manifestPath = Join-Path $Here 'manifest.json'
}
if (-not (Test-Path $manifestPath)) {
    throw "could not find the extension's manifest.json near $Here"
}

$extensionId = Get-ExtensionId $manifestPath
Write-Host "extension id: $extensionId"

# --- Install ----------------------------------------------------------------

foreach ($required in @($ExeName, $ClientName)) {
    if (-not (Test-Path (Join-Path $Here $required))) {
        throw "missing $required beside this script - is this the packaged build?"
    }
}

# Everything beside this script except the script itself. Copying only the exe
# would be enough for a self-contained build, but a framework-dependent one is
# also a .dll, a .deps.json and a .runtimeconfig.json, and it will not start
# without all four.
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Get-ChildItem -Path $Here -File |
    Where-Object { $_.Name -ne 'install.ps1' } |
    ForEach-Object { Copy-Item $_.FullName $InstallDir -Force }
Write-Host "installed to $InstallDir"

$hostManifest = Join-Path $InstallDir "$HostName.json"
@{
    name           = $HostName
    description    = 'Roll20 Accessibility Helper NVDA silencer host'
    type           = 'stdio'
    path           = (Join-Path $InstallDir $ExeName)
    allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json | Set-Content -Path $hostManifest -Encoding UTF8
Write-Host "wrote $hostManifest"

# The default value of this key is the full path to the host manifest. Chrome
# reads it when the extension first connects, so no browser restart is needed.
New-Item -Path $RegistryKey -Force | Out-Null
Set-ItemProperty -Path $RegistryKey -Name '(Default)' -Value $hostManifest
Write-Host "registered $RegistryKey"

# --- Smoke test -------------------------------------------------------------
#
# Speaks the wire protocol directly, so a failure here is the host's and not
# Chrome's: 4-byte little-endian length, then UTF-8 JSON, both directions.

function Invoke-Host {
    param([string]$Exe, [string]$Json)

    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $Exe
    $psi.RedirectStandardInput  = $true
    $psi.RedirectStandardOutput = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow  = $true

    $process = [Diagnostics.Process]::Start($psi)
    $body    = [Text.Encoding]::UTF8.GetBytes($Json)
    $stdin   = $process.StandardInput.BaseStream
    $stdin.Write([BitConverter]::GetBytes([int]$body.Length), 0, 4)
    $stdin.Write($body, 0, $body.Length)
    $stdin.Flush()
    $stdin.Close()

    $stdout = $process.StandardOutput.BaseStream
    $header = [byte[]]::new(4)
    if ($stdout.Read($header, 0, 4) -ne 4) { return $null }
    $length = [BitConverter]::ToInt32($header, 0)
    $reply  = [byte[]]::new($length)
    $read   = 0
    while ($read -lt $length) {
        $got = $stdout.Read($reply, $read, $length - $read)
        if ($got -le 0) { break }
        $read += $got
    }
    $process.WaitForExit(30000) | Out-Null
    return [Text.Encoding]::UTF8.GetString($reply) | ConvertFrom-Json
}

$reply = Invoke-Host (Join-Path $InstallDir $ExeName) '{"type":"ping"}'
if (-not $reply -or -not $reply.ok) {
    throw 'the host did not answer a ping'
}

$nvda = if ($reply.nvda) { 'detected' } else { 'NOT RUNNING' }
Write-Host "host answered: version $($reply.version), NVDA $nvda, startup $($reply.startupMs) ms"
Write-Host "  using $($reply.helper)"

if (-not $reply.nvda) {
    Write-Host ''
    Write-Host 'NVDA is not running right now, which is fine at install time -' -ForegroundColor Yellow
    Write-Host 'but it is also what a broken silencer looks like. Start NVDA and' -ForegroundColor Yellow
    Write-Host 're-run this script to confirm.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Done. Now load the extension:'
Write-Host '  1. chrome://extensions'
Write-Host '  2. turn on Developer mode'
Write-Host '  3. Load unpacked, and pick the folder holding manifest.json'
Write-Host "  4. confirm the id shown is $extensionId"
