$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDir "workbuddy-config.ps1")

$config = Get-WorkBuddyRemoteConfig -ScriptDir $scriptDir
$exePath = Find-WorkBuddyExecutable -ScriptDir $scriptDir -Config $config

$port = if ($args.Length -gt 0) {
    [int]$args[0]
}
else {
    Get-WorkBuddyRemoteConfigInt -Config $config -Name "cdpPort" -Fallback 9333
}

$userDataDir = if ($args.Length -gt 1) {
    [string]$args[1]
}
else {
    ""
}

$launchArgs = @(
    "--remote-debugging-port=$port"
)

if ($userDataDir) {
    $launchArgs += "--user-data-dir=$userDataDir"
}

Write-Host "Launching WorkBuddy with CDP on port $port"
Write-Host "Command: $exePath $($launchArgs -join ' ')"

Start-Process -FilePath $exePath -ArgumentList $launchArgs | Out-Null
