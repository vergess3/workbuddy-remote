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

function Normalize-WorkBuddyPath {
    param(
        [string]$Path
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }

    try {
        return [System.IO.Path]::GetFullPath($Path).TrimEnd('\').ToLowerInvariant()
    }
    catch {
        return $Path.Trim().TrimEnd('\').ToLowerInvariant()
    }
}

function Get-WorkBuddyProcessUserDataDir {
    param(
        [string]$CommandLine
    )

    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return ""
    }

    $match = [regex]::Match($CommandLine, '--user-data-dir="?([^" ]+)')
    if (-not $match.Success) {
        return ""
    }

    return Normalize-WorkBuddyPath -Path $match.Groups[1].Value
}

function Get-WorkBuddyProcessTreeByUserDataDir {
    param(
        [Parameter(Mandatory = $true)]
        [string]$UserDataDir
    )

    $targetUserDataDir = Normalize-WorkBuddyPath -Path $UserDataDir
    if (-not $targetUserDataDir) {
        return @()
    }

    $allProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'WorkBuddy.exe'" -ErrorAction SilentlyContinue)
    if ($allProcesses.Count -eq 0) {
        return @()
    }

    $processById = @{}
    foreach ($process in $allProcesses) {
        $processById[[int]$process.ProcessId] = $process
    }

    $matchedIds = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($process in $allProcesses) {
        $processUserDataDir = Get-WorkBuddyProcessUserDataDir -CommandLine $process.CommandLine
        if ($processUserDataDir -and $processUserDataDir -eq $targetUserDataDir) {
            [void]$matchedIds.Add([int]$process.ProcessId)
        }
    }

    if ($matchedIds.Count -eq 0) {
        return @()
    }

    $expanded = $true
    while ($expanded) {
        $expanded = $false
        foreach ($process in $allProcesses) {
            $parentProcessId = [int]$process.ParentProcessId
            if ($matchedIds.Contains($parentProcessId) -and -not $matchedIds.Contains([int]$process.ProcessId)) {
                [void]$matchedIds.Add([int]$process.ProcessId)
                $expanded = $true
            }
        }
    }

    return @($matchedIds | ForEach-Object { $processById[[int]$_] } | Sort-Object ParentProcessId, ProcessId)
}

function Stop-WorkBuddyProcessTreeByUserDataDir {
    param(
        [Parameter(Mandatory = $true)]
        [string]$UserDataDir
    )

    $processes = @(Get-WorkBuddyProcessTreeByUserDataDir -UserDataDir $UserDataDir)
    if ($processes.Count -eq 0) {
        return
    }

    $processes = $processes | Sort-Object ProcessId -Descending
    foreach ($process in $processes) {
        try {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
        }
        catch {
        }
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

if ($UserDataDir) {
    Stop-WorkBuddyProcessTreeByUserDataDir -UserDataDir $UserDataDir
}
else {
    Stop-WorkBuddyInstance -ProcessId $WorkBuddyPid -Port $CdpPort
}
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
