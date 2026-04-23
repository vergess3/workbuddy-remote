param(
    [Parameter(Position = 0)]
    [Nullable[int]]$CdpPort = $null,

    [Parameter(Position = 1)]
    [Nullable[int]]$BridgePort = $null,

    [Parameter(Position = 2)]
    [string]$UserDataDir,

    [string]$ListenHost,

    [string]$PasswordHash,

    [switch]$Background,

    [switch]$HiddenChild,

    [switch]$ShowReadyWindow,

    [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
$scriptPath = $MyInvocation.MyCommand.Path
$scriptDir = Split-Path -Parent $scriptPath
. (Join-Path $scriptDir "workbuddy-config.ps1")

$config = Get-WorkBuddyRemoteConfig -ScriptDir $scriptDir
if (-not $PSBoundParameters.ContainsKey("CdpPort")) {
    $CdpPort = Get-WorkBuddyRemoteConfigInt -Config $config -Name "cdpPort" -Fallback 9333
}
if (-not $PSBoundParameters.ContainsKey("BridgePort")) {
    $BridgePort = Get-WorkBuddyRemoteConfigInt -Config $config -Name "bridgePort" -Fallback 8780
}
if (-not $PSBoundParameters.ContainsKey("UserDataDir") -or [string]::IsNullOrWhiteSpace($UserDataDir)) {
    $UserDataDir = Get-WorkBuddyDefaultUserDataDir -ScriptDir $scriptDir -Config $config
}
if (-not $PSBoundParameters.ContainsKey("ListenHost") -or [string]::IsNullOrWhiteSpace($ListenHost)) {
    $configuredListenHost = Get-WorkBuddyRemoteConfigString -Config $config -Name "listenHost"
    $ListenHost = if ($configuredListenHost) { $configuredListenHost } else { "127.0.0.1" }
}
if (-not $PSBoundParameters.ContainsKey("PasswordHash") -or [string]::IsNullOrWhiteSpace($PasswordHash)) {
    $PasswordHash = $env:WORKBUDDY_REMOTE_PASSWORD_HASH
}
$KillWorkBuddyProcessesBeforeStart = Get-WorkBuddyRemoteConfigBool -Config $config -Name "killWorkBuddyProcessesBeforeStart" -Fallback $false
$ShouldShowReadyWindow = if ($PSBoundParameters.ContainsKey("ShowReadyWindow")) {
    $ShowReadyWindow
}
else {
    Get-WorkBuddyRemoteConfigBool -Config $config -Name "showReadyWindow" -Fallback $false
}

$normalizedListenHost = $ListenHost.Trim().ToLowerInvariant()
$ui = @{
    ReadyTitle = "WorkBuddy Remote Ready"
    ReadyIntro = "WorkBuddy Remote has started. You can open the link below directly or copy an address to another browser."
    UrlsLabel = "Available access URLs:"
    OpenButton = "Open"
    CopyPrimaryButton = "Copy Primary URL"
    CopyAllButton = "Copy All URLs"
    OpenLogButton = "Open Log"
    CloseButton = "Close"
    ErrorTitle = "WorkBuddy Remote Failed to Start"
    LogPrefix = "Log"
    RequirePasswordForRemote = "When ListenHost is not localhost, you must set -PasswordHash or WORKBUDDY_REMOTE_PASSWORD_HASH."
}

if ($normalizedListenHost -ne "127.0.0.1" -and $normalizedListenHost -ne "localhost" -and $normalizedListenHost -ne "::1" -and -not $PasswordHash) {
    throw $ui.RequirePasswordForRemote
}

function Start-HiddenBackgroundInstance {
    param(
        [Parameter(Mandatory = $true)]
        [int]$CdpPort,

        [Parameter(Mandatory = $true)]
        [int]$BridgePort,

        [Parameter(Mandatory = $true)]
        [string]$UserDataDir,

        [Parameter(Mandatory = $true)]
        [string]$ListenHost,

        [string]$PasswordHash,

        [switch]$ShowReadyWindow,

        [switch]$OpenBrowser
    )

    $psArgs = @(
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$scriptPath`"",
        "-CdpPort", "$CdpPort",
        "-BridgePort", "$BridgePort",
        "-UserDataDir", "`"$UserDataDir`"",
        "-ListenHost", "`"$ListenHost`"",
        "-HiddenChild"
    )

    if ($PasswordHash) {
        $psArgs += @("-PasswordHash", "`"$PasswordHash`"")
    }

    if ($ShowReadyWindow) {
        $psArgs += "-ShowReadyWindow"
    }

    if ($OpenBrowser) {
        $psArgs += "-OpenBrowser"
    }

    Start-Process `
        -FilePath "powershell.exe" `
        -WindowStyle Hidden `
        -ArgumentList $psArgs | Out-Null
}

if ($Background -and -not $HiddenChild) {
    Write-Host "Starting bridge launcher in hidden background PowerShell..."
    Start-HiddenBackgroundInstance `
        -CdpPort ([int]$CdpPort) `
        -BridgePort ([int]$BridgePort) `
        -UserDataDir $UserDataDir `
        -ListenHost $ListenHost `
        -PasswordHash $PasswordHash `
        -ShowReadyWindow:$ShouldShowReadyWindow `
        -OpenBrowser:$OpenBrowser
    exit 0
}

function Find-NodeExecutable {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command -and $command.Source -and (Test-Path $command.Source)) {
        return $command.Source
    }

    $candidates = @(
        (Join-Path $env:ProgramFiles "nodejs\node.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe")
    ) | Where-Object { $_ }

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "Node.js was not found. Install Node.js first, or add node.exe to PATH."
}

function Test-PortListening {
    param(
        [int]$Port
    )

    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $conn
}

function Stop-PortProcess {
    param(
        [int]$Port
    )

    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force
        Start-Sleep -Seconds 1
    }
}

function Get-ParentProcessId {
    param(
        [int]$ProcessId
    )

    try {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        return [int]$processInfo.ParentProcessId
    }
    catch {
        return 0
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

    Write-Host "Stopping existing WorkBuddy process tree for user data dir: $UserDataDir"
    $processes = $processes | Sort-Object ProcessId -Descending
    foreach ($process in $processes) {
        try {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
        }
        catch {
        }
    }

    Start-Sleep -Seconds 2
}

function Test-BridgeReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$HealthUrl
    )

    try {
        $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    }
    catch {
        return $false
    }
}

function Get-BridgeUrls {
    param(
        [int]$Port,

        [string]$ListenHost
    )

    $urls = [System.Collections.Specialized.OrderedDictionary]::new()
    $localNormalizedHost = $ListenHost.Trim().ToLowerInvariant()
    if ($localNormalizedHost -eq "0.0.0.0") {
        $primaryUrl = "http://127.0.0.1:$Port/agent-manager/"
    }
    else {
        $primaryUrl = "http://$ListenHost`:$Port/agent-manager/"
    }
    $urls[$primaryUrl] = $true

    if ($localNormalizedHost -ne "0.0.0.0") {
        return @($urls.Keys)
    }

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

    return @($urls.Keys)
}

function Show-ErrorDialog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [string]$LogPath
    )

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    $body = $Message
    if ($LogPath) {
        $body += "`r`n`r`n$($ui.LogPrefix): $LogPath"
    }

    [System.Windows.Forms.MessageBox]::Show(
        $body,
        $ui.ErrorTitle,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

function Show-ReadyWindow {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PrimaryUrl,

        [Parameter(Mandatory = $true)]
        [string[]]$Urls,

        [string]$LogPath,

        [switch]$OpenPrimaryInBrowser
    )

    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()

    if ($OpenPrimaryInBrowser) {
        Start-Process $PrimaryUrl | Out-Null
    }

    $form = New-Object System.Windows.Forms.Form
    $form.Text = $ui.ReadyTitle
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $form.Size = New-Object System.Drawing.Size(760, 360)
    $form.MinimumSize = $form.Size
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.TopMost = $true

    $introLabel = New-Object System.Windows.Forms.Label
    $introLabel.Location = New-Object System.Drawing.Point(18, 16)
    $introLabel.Size = New-Object System.Drawing.Size(708, 40)
    $introLabel.Text = $ui.ReadyIntro
    $form.Controls.Add($introLabel)

    $linkLabel = New-Object System.Windows.Forms.LinkLabel
    $linkLabel.Location = New-Object System.Drawing.Point(18, 60)
    $linkLabel.Size = New-Object System.Drawing.Size(708, 24)
    $linkLabel.Text = $PrimaryUrl
    $null = $linkLabel.Links.Add(0, $PrimaryUrl.Length, $PrimaryUrl)
    $linkLabel.Add_LinkClicked({
        param($sender, $eventArgs)
        Start-Process $eventArgs.Link.LinkData | Out-Null
    })
    $form.Controls.Add($linkLabel)

    $urlsLabel = New-Object System.Windows.Forms.Label
    $urlsLabel.Location = New-Object System.Drawing.Point(18, 98)
    $urlsLabel.Size = New-Object System.Drawing.Size(708, 20)
    $urlsLabel.Text = $ui.UrlsLabel
    $form.Controls.Add($urlsLabel)

    $urlsBox = New-Object System.Windows.Forms.TextBox
    $urlsBox.Location = New-Object System.Drawing.Point(18, 122)
    $urlsBox.Size = New-Object System.Drawing.Size(708, 128)
    $urlsBox.Multiline = $true
    $urlsBox.ReadOnly = $true
    $urlsBox.ScrollBars = [System.Windows.Forms.ScrollBars]::Vertical
    $urlsBox.Text = ($Urls -join [Environment]::NewLine)
    $form.Controls.Add($urlsBox)

    $openButton = New-Object System.Windows.Forms.Button
    $openButton.Location = New-Object System.Drawing.Point(18, 266)
    $openButton.Size = New-Object System.Drawing.Size(110, 32)
    $openButton.Text = $ui.OpenButton
    $openButton.Add_Click({
        Start-Process $PrimaryUrl | Out-Null
    })
    $form.Controls.Add($openButton)

    $copyPrimaryButton = New-Object System.Windows.Forms.Button
    $copyPrimaryButton.Location = New-Object System.Drawing.Point(140, 266)
    $copyPrimaryButton.Size = New-Object System.Drawing.Size(130, 32)
    $copyPrimaryButton.Text = $ui.CopyPrimaryButton
    $copyPrimaryButton.Add_Click({
        [System.Windows.Forms.Clipboard]::SetText($PrimaryUrl)
    })
    $form.Controls.Add($copyPrimaryButton)

    $copyAllButton = New-Object System.Windows.Forms.Button
    $copyAllButton.Location = New-Object System.Drawing.Point(282, 266)
    $copyAllButton.Size = New-Object System.Drawing.Size(120, 32)
    $copyAllButton.Text = $ui.CopyAllButton
    $copyAllButton.Add_Click({
        [System.Windows.Forms.Clipboard]::SetText($urlsBox.Text)
    })
    $form.Controls.Add($copyAllButton)

    if ($LogPath) {
        $logButton = New-Object System.Windows.Forms.Button
        $logButton.Location = New-Object System.Drawing.Point(414, 266)
        $logButton.Size = New-Object System.Drawing.Size(100, 32)
        $logButton.Text = $ui.OpenLogButton
        $logButton.Add_Click({
            if (Test-Path $LogPath) {
                Start-Process explorer.exe -ArgumentList "/select,`"$LogPath`"" | Out-Null
            }
        })
        $form.Controls.Add($logButton)
    }

    $closeButton = New-Object System.Windows.Forms.Button
    $closeButton.Location = New-Object System.Drawing.Point(616, 266)
    $closeButton.Size = New-Object System.Drawing.Size(110, 32)
    $closeButton.Text = $ui.CloseButton
    $closeButton.Add_Click({
        $form.Close()
    })
    $form.Controls.Add($closeButton)

    $form.Add_Shown({
        $form.Activate()
        $urlsBox.Focus()
    })

    [void]$form.ShowDialog()
}

try {
    $exePath = Find-WorkBuddyExecutable -ScriptDir $scriptDir -Config $config
    $runtimeRoot = Get-WorkBuddyRemoteRuntimeRoot -ScriptDir $scriptDir -Config $config
    $tmpDir = Get-WorkBuddyRemoteTempDir -ScriptDir $scriptDir -Config $config
    New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
    New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

    $bridgeScript = Join-Path $scriptDir "workbuddy-agentmanager-bridge.mjs"
    $bridgeLog = Join-Path $tmpDir "bridge-$BridgePort.log"
    $bridgeErr = Join-Path $tmpDir "bridge-$BridgePort.err.log"
    $primaryAccessHost = if ($normalizedListenHost -eq "0.0.0.0") { "127.0.0.1" } else { $ListenHost }
    $healthUrl = "http://$primaryAccessHost`:$BridgePort/readyz"
    $primaryUrl = "http://$primaryAccessHost`:$BridgePort/agent-manager/"

    if (-not (Test-Path $UserDataDir)) {
        New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null
    }

    $launcherPid = $PID
    $launcherParentPid = Get-ParentProcessId -ProcessId $launcherPid
    $launcherParentName = (Get-ProcessNameSafe -ProcessId $launcherParentPid).ToLowerInvariant()
    $relaunchShell = if ($HiddenChild) {
        "hidden"
    }
    elseif ($launcherParentName -eq "cmd") {
        "cmd"
    }
    else {
        "powershell"
    }

    Write-Host "Stopping bridge on port $BridgePort (if any)..."
    Stop-PortProcess -Port $BridgePort

    if ($KillWorkBuddyProcessesBeforeStart) {
        Write-Host "Stopping existing WorkBuddy processes..."
        Get-Process WorkBuddy -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2
    }
    else {
        Write-Host "Skipping global WorkBuddy cleanup before launch."
    }

    Stop-WorkBuddyProcessTreeByUserDataDir -UserDataDir $UserDataDir

    Write-Host "Launching WorkBuddy main window with CDP on port $CdpPort..."
    Write-Host "User data dir: $UserDataDir"
    $previousBridgeBrowserFlag = $env:WORKBUDDY_BRIDGE_DISABLE_NATIVE_LOGIN_BROWSER
    $env:WORKBUDDY_BRIDGE_DISABLE_NATIVE_LOGIN_BROWSER = "1"
    $workBuddyProcess = $null
    try {
        $workBuddyProcess = Start-Process -FilePath $exePath -ArgumentList @(
            "--remote-debugging-port=$CdpPort",
            "--user-data-dir=$UserDataDir"
        ) -PassThru
    }
    finally {
        if ($null -eq $previousBridgeBrowserFlag) {
            Remove-Item Env:WORKBUDDY_BRIDGE_DISABLE_NATIVE_LOGIN_BROWSER -ErrorAction SilentlyContinue
        }
        else {
            $env:WORKBUDDY_BRIDGE_DISABLE_NATIVE_LOGIN_BROWSER = $previousBridgeBrowserFlag
        }
    }

    $ready = $false
    for ($i = 0; $i -lt 15; $i++) {
        if (Test-PortListening -Port $CdpPort) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 2
    }

    if (-not $ready) {
        throw "CDP port $CdpPort did not start listening in time."
    }

    Remove-Item $bridgeLog, $bridgeErr -ErrorAction SilentlyContinue

    Write-Host "Starting Agent Manager bridge on port $BridgePort..."
    Write-Host "Bridge listen host: $ListenHost"
    if ($PasswordHash) {
        Write-Host "Bridge password protection: enabled"
    }
    else {
        Write-Host "Bridge password protection: disabled"
    }
    $nodePath = Find-NodeExecutable

    $bridgeArgs = @(
        $bridgeScript,
        "--cdp-port",
        $CdpPort,
        "--host",
        $ListenHost,
        "--port",
        $BridgePort,
        "--user-data-dir",
        $UserDataDir,
        "--workbuddy-pid",
        $workBuddyProcess.Id,
        "--launcher-pid",
        $launcherPid,
        "--launcher-parent-pid",
        $launcherParentPid,
        "--relaunch-shell",
        $relaunchShell
    )
    if ($PasswordHash) {
        $bridgeArgs += @("--password-hash", $PasswordHash)
    }
    if ($ShouldShowReadyWindow) {
        $bridgeArgs += "--show-ready-window"
    }
    if ($OpenBrowser) {
        $bridgeArgs += "--open-browser"
    }

    $previousBridgeUiLang = $env:WORKBUDDY_REMOTE_UI_LANG
    $previousWorkBuddyExePath = $env:WORKBUDDY_EXE_PATH
    $env:WORKBUDDY_REMOTE_UI_LANG = [System.Globalization.CultureInfo]::CurrentUICulture.Name
    $env:WORKBUDDY_EXE_PATH = $exePath
    try {
        $bridgeProcess = Start-Process -FilePath $nodePath -ArgumentList $bridgeArgs -WorkingDirectory $scriptDir -WindowStyle Hidden -RedirectStandardOutput $bridgeLog -RedirectStandardError $bridgeErr -PassThru
    }
    finally {
        if ($null -eq $previousBridgeUiLang) {
            Remove-Item Env:WORKBUDDY_REMOTE_UI_LANG -ErrorAction SilentlyContinue
        }
        else {
            $env:WORKBUDDY_REMOTE_UI_LANG = $previousBridgeUiLang
        }

        if ($null -eq $previousWorkBuddyExePath) {
            Remove-Item Env:WORKBUDDY_EXE_PATH -ErrorAction SilentlyContinue
        }
        else {
            $env:WORKBUDDY_EXE_PATH = $previousWorkBuddyExePath
        }
    }

    $bridgeReady = $false
    for ($i = 0; $i -lt 120; $i++) {
        if ($bridgeProcess.HasExited) {
            $stderr = ""
            if (Test-Path $bridgeErr) {
                $stderr = (Get-Content $bridgeErr -ErrorAction SilentlyContinue | Select-Object -First 20) -join [Environment]::NewLine
            }

            $message = "Bridge process exited unexpectedly."
            if ($stderr) {
                $message += "`r`n`r`n$stderr"
            }

            throw $message
        }

        if (Test-BridgeReady -HealthUrl $healthUrl) {
            $bridgeReady = $true
            break
        }

        Start-Sleep -Milliseconds 500
    }

    if (-not $bridgeReady) {
        throw "Bridge did not become ready in time. Check log: $bridgeErr"
    }

    $urls = Get-BridgeUrls -Port $BridgePort -ListenHost $ListenHost

    if (-not $ShouldShowReadyWindow) {
        Write-Host "Bridge ready: $primaryUrl"
        foreach ($url in $urls) {
            if ($url -ne $primaryUrl) {
                Write-Host "LAN URL: $url"
            }
        }

        if ($OpenBrowser) {
            Start-Process $primaryUrl | Out-Null
        }
    }
    else {
        Show-ReadyWindow -PrimaryUrl $primaryUrl -Urls $urls -LogPath $bridgeLog -OpenPrimaryInBrowser:$OpenBrowser
    }
}
catch {
    $message = if ($_.Exception) { $_.Exception.Message } else { "$_" }
    $logPathForDialog = if ($bridgeErr) { $bridgeErr } else { $null }
    Show-ErrorDialog -Message $message -LogPath $logPathForDialog
    throw
}
