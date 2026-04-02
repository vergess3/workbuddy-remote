$ErrorActionPreference = "Stop"

function Get-WorkBuddyRemoteProjectRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptDir
    )

    return (Resolve-Path -LiteralPath (Join-Path $ScriptDir "..")).Path
}

function Get-WorkBuddyRemoteConfigPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptDir
    )

    return Join-Path (Get-WorkBuddyRemoteProjectRoot -ScriptDir $ScriptDir) "workbuddy-remote.config.json"
}

function Get-WorkBuddyRemoteConfig {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptDir
    )

    $configPath = Get-WorkBuddyRemoteConfigPath -ScriptDir $ScriptDir
    if (-not (Test-Path -LiteralPath $configPath)) {
        return [pscustomobject]@{}
    }

    $raw = Get-Content -LiteralPath $configPath -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return [pscustomobject]@{}
    }

    try {
        return $raw | ConvertFrom-Json
    }
    catch {
        throw "Failed to parse config file: $configPath"
    }
}

function Get-WorkBuddyRemoteConfigString {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $value = $Config.$Name
    if ($value -is [string]) {
        $trimmed = $value.Trim()
        if ($trimmed) {
            return $trimmed
        }
    }

    return $null
}

function Get-WorkBuddyRemoteConfigInt {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [int]$Fallback
    )

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

function Get-WorkBuddyRemoteConfigBool {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Config,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [bool]$Fallback
    )

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

function Find-UpwardFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$StartDir,

        [Parameter(Mandatory = $true)]
        [string]$FileName,

        [int]$MaxLevels = 6
    )

    $currentDir = (Resolve-Path -LiteralPath $StartDir).Path
    for ($level = 0; $level -le $MaxLevels; $level++) {
        $candidate = Join-Path $currentDir $FileName
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }

        $parentDir = Split-Path -Parent $currentDir
        if (-not $parentDir -or $parentDir -eq $currentDir) {
            break
        }

        $currentDir = $parentDir
    }

    return $null
}

function Find-WorkBuddyExecutable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptDir,

        [Parameter(Mandatory = $true)]
        [object]$Config,

        [int]$MaxLevels = 6
    )

    $configuredPath = Get-WorkBuddyRemoteConfigString -Config $Config -Name "workbuddyExePath"
    if ($configuredPath) {
        $projectRoot = Get-WorkBuddyRemoteProjectRoot -ScriptDir $ScriptDir
        $expandedPath = [Environment]::ExpandEnvironmentVariables($configuredPath)
        if (-not [System.IO.Path]::IsPathRooted($expandedPath)) {
            $expandedPath = Join-Path $projectRoot $expandedPath
        }

        $resolvedPath = [System.IO.Path]::GetFullPath($expandedPath)
        if (-not (Test-Path -LiteralPath $resolvedPath)) {
            throw "Configured WorkBuddy executable path not found: $resolvedPath"
        }

        return $resolvedPath
    }

    $exePath = Find-UpwardFile -StartDir $ScriptDir -FileName "WorkBuddy.exe" -MaxLevels $MaxLevels
    if ($exePath) {
        return $exePath
    }

    throw "WorkBuddy.exe not found from script directory upward: $ScriptDir"
}
