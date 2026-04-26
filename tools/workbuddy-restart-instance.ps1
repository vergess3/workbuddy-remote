param(
    [Parameter(Mandatory = $true)]
    [int]$CurrentBridgePid,

    [Parameter(Mandatory = $true)]
    [int]$CdpPort,

    [Parameter(Mandatory = $true)]
    [int]$BridgePort,

    [string]$UserDataDir,

    [string]$ListenHost = "127.0.0.1",

    [string]$PasswordHash,

    [int]$WorkBuddyPid = 0,

    [int]$LauncherPid = 0,

    [int]$LauncherParentPid = 0,

    [string]$RelaunchShell = "powershell",

    [string]$LogPath,

    [switch]$ShowReadyWindow,

    [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startupScript = Join-Path $scriptDir "workbuddy-start-main-window-bridge.ps1"

function Write-BridgeRestartLog {
    param(
        [string]$Level = "info",
        [Parameter(Mandatory = $true)]
        [string]$Event,
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [hashtable]$Details = @{}
    )

    if ([string]::IsNullOrWhiteSpace($LogPath)) {
        return
    }

    try {
        $entry = [ordered]@{
            ts = (Get-Date).ToUniversalTime().ToString("o")
            level = $Level
            event = $Event
            message = $Message
            pid = $PID
            details = $Details
        }
        $line = $entry | ConvertTo-Json -Compress -Depth 8
        Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    }
    catch {
    }
}

function Get-ProcessNameSafe {
    param(
        [int]$ProcessId
    )

    if ($ProcessId -le 0) {
        return ""
    }

    try {
        return (Get-Process -Id $ProcessId -ErrorAction Stop).ProcessName
    }
    catch {
        return ""
    }
}

function Stop-ProcessTreeMember {
    param(
        [int]$ProcessId,
        [string[]]$AllowedNames = @()
    )

    if ($ProcessId -le 0 -or $ProcessId -eq $PID) {
        return
    }

    $processName = Get-ProcessNameSafe -ProcessId $ProcessId
    if (-not $processName) {
        return
    }

    if ($AllowedNames.Count -gt 0 -and -not ($AllowedNames | Where-Object { $_ -eq $processName.ToLowerInvariant() })) {
        Write-BridgeRestartLog -Event "process.restart.stop_skipped" -Message "Skipped process stop because the process name is not allowed." -Details @{
            targetPid = $ProcessId
            processName = $processName
            allowedNames = $AllowedNames
        }
        return
    }

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        Write-BridgeRestartLog -Event "process.restart.stopping" -Message "Stopping process during restart." -Details @{
            targetPid = $ProcessId
            processName = $processName
            hasMainWindow = [bool]$process.MainWindowHandle
        }
        if ($process.MainWindowHandle -and $process.CloseMainWindow()) {
            Start-Sleep -Milliseconds 800
            $process.Refresh()
        }
    }
    catch {
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        Write-BridgeRestartLog -Event "process.restart.stopped" -Message "Stopped process during restart." -Details @{
            targetPid = $ProcessId
            processName = $processName
        }
    }
    catch {
        Write-BridgeRestartLog -Level "warn" -Event "process.restart.stop_error" -Message "Failed to stop process during restart." -Details @{
            targetPid = $ProcessId
            processName = $processName
            error = $_.Exception.Message
        }
    }
}

function Stop-WorkBuddyInstance {
    param(
        [int]$ProcessId,
        [int]$Port
    )

    $targetPid = $ProcessId
    if ($targetPid -le 0) {
        try {
            $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
            if ($connection) {
                $targetPid = [int]$connection.OwningProcess
            }
        }
        catch {
        }
    }

    Stop-ProcessTreeMember -ProcessId $targetPid -AllowedNames @("workbuddy")
}

function Build-StartupArgumentList {
    $args = @(
        "-STA",
        "-ExecutionPolicy", "Bypass",
        "-File", $startupScript,
        "-CdpPort", "$CdpPort",
        "-BridgePort", "$BridgePort"
    )

    if ($UserDataDir) {
        $args += @("-UserDataDir", $UserDataDir)
    }
    if ($ListenHost) {
        $args += @("-ListenHost", $ListenHost)
    }
    if ($PasswordHash) {
        $args += @("-PasswordHash", $PasswordHash)
    }
    if ($ShowReadyWindow) {
        $args += "-ShowReadyWindow"
    }
    if ($LogPath) {
        $args += @("-EventLogPath", $LogPath)
    }
    if ($OpenBrowser) {
        $args += "-OpenBrowser"
    }

    return $args
}

function Quote-CmdArgument {
    param(
        [string]$Value
    )

    if ($null -eq $Value) {
        return '""'
    }

    if ($Value -notmatch '[\s"]') {
        return $Value
    }

    return '"' + ($Value -replace '"', '\"') + '"'
}

Start-Sleep -Milliseconds 700

Write-BridgeRestartLog -Event "restart_helper.start" -Message "Restart helper started." -Details @{
    currentBridgePid = $CurrentBridgePid
    workBuddyPid = $WorkBuddyPid
    launcherPid = $LauncherPid
    launcherParentPid = $LauncherParentPid
    cdpPort = $CdpPort
    bridgePort = $BridgePort
    relaunchShell = $RelaunchShell
}

Stop-WorkBuddyInstance -ProcessId $WorkBuddyPid -Port $CdpPort
Stop-ProcessTreeMember -ProcessId $CurrentBridgePid -AllowedNames @("node")
Stop-ProcessTreeMember -ProcessId $LauncherPid -AllowedNames @("powershell", "pwsh")

if ($RelaunchShell -eq "cmd") {
    Stop-ProcessTreeMember -ProcessId $LauncherParentPid -AllowedNames @("cmd")
}

Start-Sleep -Milliseconds 800

$startupArgs = Build-StartupArgumentList

switch ($RelaunchShell) {
    "hidden" {
        Write-BridgeRestartLog -Event "restart_helper.relaunch" -Message "Relaunching bridge in hidden PowerShell." -Details @{
            startupScript = $startupScript
            shell = "hidden"
        }
        Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList $startupArgs | Out-Null
        break
    }
    "cmd" {
        $command = ($startupArgs | ForEach-Object { Quote-CmdArgument -Value $_ }) -join " "
        Write-BridgeRestartLog -Event "restart_helper.relaunch" -Message "Relaunching bridge in cmd." -Details @{
            startupScript = $startupScript
            shell = "cmd"
        }
        Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", "powershell $command") | Out-Null
        break
    }
    default {
        Write-BridgeRestartLog -Event "restart_helper.relaunch" -Message "Relaunching bridge in PowerShell." -Details @{
            startupScript = $startupScript
            shell = "powershell"
        }
        Start-Process -FilePath "powershell.exe" -ArgumentList $startupArgs | Out-Null
        break
    }
}
