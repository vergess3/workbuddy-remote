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

    [switch]$ShowReadyWindow,

    [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startupScript = Join-Path $scriptDir "workbuddy-start-main-window-bridge.ps1"

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
        return
    }

    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        if ($process.MainWindowHandle -and $process.CloseMainWindow()) {
            Start-Sleep -Milliseconds 800
            $process.Refresh()
        }
    }
    catch {
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    }
    catch {
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
        Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList $startupArgs | Out-Null
        break
    }
    "cmd" {
        $command = ($startupArgs | ForEach-Object { Quote-CmdArgument -Value $_ }) -join " "
        Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", "powershell $command") | Out-Null
        break
    }
    default {
        Start-Process -FilePath "powershell.exe" -ArgumentList $startupArgs | Out-Null
        break
    }
}
