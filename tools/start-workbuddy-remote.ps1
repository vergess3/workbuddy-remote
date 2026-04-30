param(
    [Nullable[int]]$CdpPort = $null,
    [Nullable[int]]$BridgePort = $null,
    [string]$ListenHost,
    [string]$WorkBuddyExePath,
    [string]$UserDataDir,
    [string]$PasswordHash,
    [switch]$KillWorkBuddyProcessesBeforeStart,
    [switch]$HideWorkBuddyWindowAfterStart,
    [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
$scriptPath = $MyInvocation.MyCommand.Path
$scriptDir = Split-Path -Parent $scriptPath
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $scriptDir "..")).Path
$configPath = Join-Path $projectRoot "workbuddy-remote.config.json"

function Show-StartupError {
    param([string]$Message)

    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            $Message,
            "WorkBuddy Remote Failed to Start",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
    catch {
        try {
            [Console]::Error.WriteLine($Message)
        }
        catch {
        }
    }
}

trap {
    $message = if ($_.Exception) { $_.Exception.Message } else { "$_" }
    Show-StartupError -Message $message
    exit 1
}

function Get-Config {
    if (-not (Test-Path -LiteralPath $configPath)) {
        return [pscustomobject]@{}
    }
    $raw = Get-Content -LiteralPath $configPath -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return [pscustomobject]@{}
    }
    return $raw | ConvertFrom-Json
}

function Resolve-ProjectPath {
    param([string]$PathValue)
    $expanded = [Environment]::ExpandEnvironmentVariables($PathValue)
    if (-not [System.IO.Path]::IsPathRooted($expanded)) {
        $expanded = Join-Path $projectRoot $expanded
    }
    return [System.IO.Path]::GetFullPath($expanded)
}

function Get-ConfigString {
    param([object]$Config, [string]$Name)
    $value = $Config.$Name
    if ($value -is [string] -and -not [string]::IsNullOrWhiteSpace($value)) {
        return $value.Trim()
    }
    return $null
}

function Get-ConfigInt {
    param([object]$Config, [string]$Name, [int]$Fallback)
    $value = $Config.$Name
    if ($value -is [int] -and $value -gt 0) {
        return $value
    }
    if ($value -is [long] -and $value -gt 0) {
        return [int]$value
    }
    if ($value -is [string]) {
        $parsed = 0
        if ([int]::TryParse($value.Trim(), [ref]$parsed) -and $parsed -gt 0) {
            return $parsed
        }
    }
    return $Fallback
}

function Get-ConfigBool {
    param([object]$Config, [string]$Name, [bool]$Fallback)
    $value = $Config.$Name
    if ($value -is [bool]) {
        return $value
    }
    if ($value -is [string]) {
        $normalized = $value.Trim().ToLowerInvariant()
        if ($normalized -in @("1", "true", "yes", "on")) {
            return $true
        }
        if ($normalized -in @("0", "false", "no", "off")) {
            return $false
        }
    }
    return $Fallback
}

function Find-NodeExecutable {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source)) {
        return $command.Source
    }

    $candidates = @()
    if ($env:ProgramFiles) {
        $candidates += Join-Path $env:ProgramFiles "nodejs\node.exe"
    }
    if (${env:ProgramFiles(x86)}) {
        $candidates += Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe"
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "Node.js was not found. Install Node.js first, or add node.exe to PATH."
}

function Find-NpmExecutable {
    $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source)) {
        return $command.Source
    }

    $command = Get-Command npm -ErrorAction SilentlyContinue
    if ($command -and $command.Source -and (Test-Path -LiteralPath $command.Source)) {
        return $command.Source
    }

    $candidates = @()
    if ($env:ProgramFiles) {
        $candidates += Join-Path $env:ProgramFiles "nodejs\npm.cmd"
    }
    if (${env:ProgramFiles(x86)}) {
        $candidates += Join-Path ${env:ProgramFiles(x86)} "nodejs\npm.cmd"
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "npm was not found. Install Node.js first, or add npm.cmd to PATH."
}

function Ensure-NodeDependencies {
    param([string]$TempDir)

    $packageDir = Join-Path $projectRoot "node_modules\ws"
    if (Test-Path -LiteralPath $packageDir) {
        return
    }

    $npmPath = Find-NpmExecutable
    $installLog = Join-Path $TempDir "npm-install.log"
    $installErr = Join-Path $TempDir "npm-install.err.log"
    Remove-Item $installLog, $installErr -ErrorAction SilentlyContinue

    Write-Host "Installing Node dependencies..."
    $installProcess = Start-Process `
        -FilePath $npmPath `
        -ArgumentList @("install", "--omit=dev") `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $installLog `
        -RedirectStandardError $installErr `
        -Wait `
        -PassThru

    if ($installProcess.ExitCode -ne 0) {
        $stderr = ""
        if (Test-Path -LiteralPath $installErr) {
            $stderr = (Get-Content -LiteralPath $installErr -ErrorAction SilentlyContinue | Select-Object -First 30) -join [Environment]::NewLine
        }
        throw "npm install failed. Check log: $installErr`r`n$stderr"
    }

    if (-not (Test-Path -LiteralPath $packageDir)) {
        throw "Dependency ws is still missing after npm install. Check log: $installLog"
    }
}

function Find-WorkBuddyExecutable {
    param([object]$Config)

    if (-not [string]::IsNullOrWhiteSpace($WorkBuddyExePath)) {
        $resolved = Resolve-ProjectPath $WorkBuddyExePath
        if (-not (Test-Path -LiteralPath $resolved)) {
            throw "WorkBuddy executable path not found: $resolved"
        }
        return $resolved
    }

    $configuredPath = Get-ConfigString -Config $Config -Name "workbuddyExePath"
    if ($configuredPath) {
        $resolved = Resolve-ProjectPath $configuredPath
        if (-not (Test-Path -LiteralPath $resolved)) {
            throw "Configured WorkBuddy executable path not found: $resolved"
        }
        return $resolved
    }

    $projectParent = Split-Path -Parent $projectRoot
    $candidates = @(
        (Join-Path $projectParent "WorkBuddy\WorkBuddy.exe"),
        (Join-Path $projectParent "workbuddy\WorkBuddy.exe")
    )
    if ($env:LOCALAPPDATA) {
        $candidates += Join-Path $env:LOCALAPPDATA "Programs\WorkBuddy\WorkBuddy.exe"
    }
    if ($env:ProgramFiles) {
        $candidates += Join-Path $env:ProgramFiles "WorkBuddy\WorkBuddy.exe"
    }
    if (${env:ProgramFiles(x86)}) {
        $candidates += Join-Path ${env:ProgramFiles(x86)} "WorkBuddy\WorkBuddy.exe"
    }

    try {
        $siblingDirs = Get-ChildItem -LiteralPath $projectParent -Directory -ErrorAction Stop |
            Where-Object { $_.Name -match "workbuddy" -and $_.FullName -ne $projectRoot }
        foreach ($dir in $siblingDirs) {
            $candidates += Join-Path $dir.FullName "WorkBuddy.exe"
        }
    }
    catch {
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }

    throw "WorkBuddy.exe was not found. Set workbuddyExePath in workbuddy-remote.config.json or pass -WorkBuddyExePath."
}

function Test-PortListening {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $conn
}

function Stop-PortProcess {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Write-Host "Stopping process $($conn.OwningProcess) on port $Port..."
        Stop-Process -Id $conn.OwningProcess -Force
        Start-Sleep -Seconds 1
    }
}

function Test-BridgeReady {
    param([string]$HealthUrl)
    try {
        $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    }
    catch {
        return $false
    }
}

function Initialize-WindowMenuInterop {
    if ("WorkBuddyRemote.NativeWindow" -as [type]) {
        return
    }

    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace WorkBuddyRemote {
    public static class NativeWindow {
        [DllImport("user32.dll")]
        public static extern IntPtr GetMenu(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetMenu(IntPtr hWnd, IntPtr hMenu);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool DrawMenuBar(IntPtr hWnd);
    }
}
"@
}

function Hide-WorkBuddyNativeMenuBar {
    param(
        [int]$ProcessId = 0,
        [int]$Retries = 30,
        [int]$DelayMilliseconds = 250
    )

    try {
        Initialize-WindowMenuInterop
    }
    catch {
        Write-Host "Could not initialize native menu hider: $($_.Exception.Message)"
        return
    }

    for ($i = 0; $i -lt $Retries; $i++) {
        if ($ProcessId -gt 0) {
            $processes = @(Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
        }
        else {
            $processes = @(Get-Process WorkBuddy -ErrorAction SilentlyContinue)
        }

        $removedAny = $false
        foreach ($process in $processes) {
            $windowHandle = $process.MainWindowHandle
            if (-not $windowHandle -or $windowHandle -eq [IntPtr]::Zero) {
                continue
            }

            $menuHandle = [WorkBuddyRemote.NativeWindow]::GetMenu($windowHandle)
            if (-not $menuHandle -or $menuHandle -eq [IntPtr]::Zero) {
                continue
            }

            [WorkBuddyRemote.NativeWindow]::SetMenu($windowHandle, [IntPtr]::Zero) | Out-Null
            [WorkBuddyRemote.NativeWindow]::DrawMenuBar($windowHandle) | Out-Null
            $removedAny = $true
        }

        if ($removedAny) {
            return
        }

        Start-Sleep -Milliseconds $DelayMilliseconds
    }
}

function Open-BridgeUrlSafely {
    param([string]$Url)

    try {
        Start-Process -FilePath $Url | Out-Null
        return
    }
    catch {
    }

    $rundll32Path = Join-Path $env:SystemRoot "System32\rundll32.exe"
    if (Test-Path -LiteralPath $rundll32Path) {
        try {
            Start-Process -FilePath $rundll32Path -ArgumentList @("url.dll,FileProtocolHandler", $Url) -WindowStyle Hidden | Out-Null
            return
        }
        catch {
        }
    }

    $explorerPath = Join-Path $env:SystemRoot "explorer.exe"
    if (Test-Path -LiteralPath $explorerPath) {
        try {
            Start-Process -FilePath $explorerPath -ArgumentList @($Url) | Out-Null
            return
        }
        catch {
        }
    }

    Write-Host "Bridge is ready, but the browser could not be opened automatically: $Url"
}

function Get-BridgeUrls {
    param([int]$Port, [string]$ListenAddress)
    $urls = [System.Collections.Specialized.OrderedDictionary]::new()
    $normalizedHost = $ListenAddress.Trim().ToLowerInvariant()
    $primaryHost = if ($normalizedHost -eq "0.0.0.0") { "127.0.0.1" } else { $ListenAddress }
    $primaryUrl = "http://$primaryHost`:$Port/agent-manager/"
    $urls[$primaryUrl] = $true

    if ($normalizedHost -eq "0.0.0.0") {
        try {
            $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.IPAddress -and
                    $_.IPAddress -ne "127.0.0.1" -and
                    $_.IPAddress -notlike "169.254.*"
                } |
                Sort-Object -Property IPAddress -Unique
            foreach ($entry in $addresses) {
                $url = "http://$($entry.IPAddress):$Port/agent-manager/"
                if (-not $urls.Contains($url)) {
                    $urls[$url] = $true
                }
            }
        }
        catch {
        }
    }

    return @($urls.Keys)
}

$config = Get-Config
if (-not $PSBoundParameters.ContainsKey("CdpPort")) {
    $CdpPort = Get-ConfigInt -Config $config -Name "cdpPort" -Fallback 9333
}
if (-not $PSBoundParameters.ContainsKey("BridgePort")) {
    $BridgePort = Get-ConfigInt -Config $config -Name "bridgePort" -Fallback 8780
}
if (-not $PSBoundParameters.ContainsKey("ListenHost") -or [string]::IsNullOrWhiteSpace($ListenHost)) {
    $configuredListenHost = Get-ConfigString -Config $config -Name "listenHost"
    $ListenHost = if ($configuredListenHost) { $configuredListenHost } else { "127.0.0.1" }
}
if (-not $PSBoundParameters.ContainsKey("UserDataDir") -or [string]::IsNullOrWhiteSpace($UserDataDir)) {
    $configuredUserDataDir = Get-ConfigString -Config $config -Name "workbuddyUserDataDir"
    $UserDataDir = if ($configuredUserDataDir) {
        Resolve-ProjectPath $configuredUserDataDir
    }
    else {
        Join-Path $env:APPDATA "WorkBuddy"
    }
}
if (-not $PSBoundParameters.ContainsKey("PasswordHash") -or [string]::IsNullOrWhiteSpace($PasswordHash)) {
    $PasswordHash = $env:WORKBUDDY_REMOTE_PASSWORD_HASH
}
if (-not $PSBoundParameters.ContainsKey("KillWorkBuddyProcessesBeforeStart")) {
    $KillWorkBuddyProcessesBeforeStart = Get-ConfigBool -Config $config -Name "killWorkBuddyProcessesBeforeStart" -Fallback $false
}
if (-not $PSBoundParameters.ContainsKey("HideWorkBuddyWindowAfterStart")) {
    $HideWorkBuddyWindowAfterStart = Get-ConfigBool -Config $config -Name "hideWorkBuddyWindowAfterStart" -Fallback $false
}

$normalizedListenHost = $ListenHost.Trim().ToLowerInvariant()
if ($normalizedListenHost -notin @("127.0.0.1", "localhost", "::1") -and -not $PasswordHash) {
    throw "When ListenHost is not localhost, set -PasswordHash or WORKBUDDY_REMOTE_PASSWORD_HASH."
}

$runtimeRoot = Get-ConfigString -Config $config -Name "runtimeRootDir"
if ($runtimeRoot) {
    $runtimeRoot = Resolve-ProjectPath $runtimeRoot
}
else {
    $runtimeRoot = Join-Path $projectRoot "output\runtime"
}
$tempDir = Join-Path $runtimeRoot "temp"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
Ensure-NodeDependencies -TempDir $tempDir

$bridgeLog = Join-Path $tempDir "bridge-$BridgePort.log"
$bridgeErr = Join-Path $tempDir "bridge-$BridgePort.err.log"
$bridgeEvents = Join-Path $tempDir "bridge-$BridgePort.events.log"
Remove-Item $bridgeLog, $bridgeErr, $bridgeEvents -ErrorAction SilentlyContinue

Write-Host "Stopping bridge on port $BridgePort (if any)..."
Stop-PortProcess -Port ([int]$BridgePort)

$exePath = Find-WorkBuddyExecutable -Config $config
$workBuddyPid = 0
if ($KillWorkBuddyProcessesBeforeStart) {
    Write-Host "Stopping existing WorkBuddy processes..."
    Get-Process WorkBuddy -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
}

if (Test-PortListening -Port ([int]$CdpPort)) {
    Write-Host "Reusing existing WorkBuddy CDP port $CdpPort."
    Hide-WorkBuddyNativeMenuBar -Retries 12
}
else {
    Write-Host "Launching WorkBuddy with CDP on port $CdpPort..."
    Write-Host "User data dir: $UserDataDir"
    $workBuddyProcess = Start-Process -FilePath $exePath -ArgumentList @(
        "--remote-debugging-port=$CdpPort",
        "--user-data-dir=$UserDataDir"
    ) -PassThru
    $workBuddyPid = $workBuddyProcess.Id

    $cdpReady = $false
    for ($i = 0; $i -lt 30; $i++) {
        if (Test-PortListening -Port ([int]$CdpPort)) {
            $cdpReady = $true
            break
        }
        Start-Sleep -Seconds 1
    }
    if (-not $cdpReady) {
        throw "CDP port $CdpPort did not start listening in time."
    }
    Hide-WorkBuddyNativeMenuBar -ProcessId $workBuddyPid
}

$nodePath = Find-NodeExecutable
$mainScript = Join-Path $projectRoot "src\main.mjs"
$bridgeArgs = @(
    $mainScript,
    "--cdp-port", "$CdpPort",
    "--host", "$ListenHost",
    "--port", "$BridgePort",
    "--user-data-dir", "$UserDataDir",
    "--workbuddy-pid", "$workBuddyPid",
    "--log-path", "$bridgeEvents"
)
if ($PasswordHash) {
    $bridgeArgs += @("--password-hash", "$PasswordHash")
}
if ($OpenBrowser) {
    $bridgeArgs += "--open-browser"
}
if ($HideWorkBuddyWindowAfterStart) {
    $bridgeArgs += "--hide-workbuddy-window-after-start"
}

$previousWorkBuddyExePath = $env:WORKBUDDY_EXE_PATH
$previousBridgeEventLogPath = $env:WORKBUDDY_REMOTE_EVENT_LOG_PATH
$previousBridgeUiLang = $env:WORKBUDDY_REMOTE_UI_LANG
$env:WORKBUDDY_EXE_PATH = $exePath
$env:WORKBUDDY_REMOTE_EVENT_LOG_PATH = $bridgeEvents
$env:WORKBUDDY_REMOTE_UI_LANG = [System.Globalization.CultureInfo]::CurrentUICulture.Name
try {
    Write-Host "Starting lightweight bridge on $ListenHost`:$BridgePort..."
    $bridgeProcess = Start-Process `
        -FilePath $nodePath `
        -ArgumentList $bridgeArgs `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $bridgeLog `
        -RedirectStandardError $bridgeErr `
        -PassThru
}
finally {
    if ($null -eq $previousWorkBuddyExePath) {
        Remove-Item Env:WORKBUDDY_EXE_PATH -ErrorAction SilentlyContinue
    }
    else {
        $env:WORKBUDDY_EXE_PATH = $previousWorkBuddyExePath
    }

    if ($null -eq $previousBridgeEventLogPath) {
        Remove-Item Env:WORKBUDDY_REMOTE_EVENT_LOG_PATH -ErrorAction SilentlyContinue
    }
    else {
        $env:WORKBUDDY_REMOTE_EVENT_LOG_PATH = $previousBridgeEventLogPath
    }

    if ($null -eq $previousBridgeUiLang) {
        Remove-Item Env:WORKBUDDY_REMOTE_UI_LANG -ErrorAction SilentlyContinue
    }
    else {
        $env:WORKBUDDY_REMOTE_UI_LANG = $previousBridgeUiLang
    }
}

$primaryHost = if ($normalizedListenHost -eq "0.0.0.0") { "127.0.0.1" } else { $ListenHost }
$readyUrl = "http://$primaryHost`:$BridgePort/readyz"
$bridgeReady = $false
for ($i = 0; $i -lt 120; $i++) {
    if ($bridgeProcess.HasExited) {
        $stderr = ""
        if (Test-Path -LiteralPath $bridgeErr) {
            $stderr = (Get-Content -LiteralPath $bridgeErr -ErrorAction SilentlyContinue | Select-Object -First 30) -join [Environment]::NewLine
        }
        throw "Bridge process exited unexpectedly.`r`n$stderr"
    }

    if (Test-BridgeReady -HealthUrl $readyUrl) {
        $bridgeReady = $true
        break
    }

    Start-Sleep -Milliseconds 500
}

if (-not $bridgeReady) {
    throw "Bridge did not become ready in time. Check log: $bridgeErr"
}

$urls = Get-BridgeUrls -Port ([int]$BridgePort) -ListenAddress $ListenHost
$primaryUrl = $urls[0]
Write-Host "Bridge ready: $primaryUrl"
foreach ($url in $urls) {
    if ($url -ne $primaryUrl) {
        Write-Host "LAN URL: $url"
    }
}
Write-Host "Log: $bridgeEvents"

if ($OpenBrowser) {
    Open-BridgeUrlSafely -Url $primaryUrl
}
