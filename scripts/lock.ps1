# scripts/lock.ps1  - shared lockfile helper for Second Brain automation scripts.
#
# Dot-source this file from any script that writes to the vault or the git
# repo, e.g.:
#
#   . (Join-Path $PSScriptRoot 'lock.ps1')
#   $lockPath = Get-BrainLockPath -ScriptsDir $PSScriptRoot
#   if (-not (Enter-BrainLock -LockPath $lockPath -Owner 'my-script')) {
#       Write-Host "my-script: lock held by another job  - skipping this run."
#       exit 0
#   }
#   try {
#       # ... do work ...
#   } finally {
#       Exit-BrainLock -LockPath $lockPath
#   }
#
# Lock file: scripts/.brain.lock  - single line "<PID> <ISO-8601 UTC timestamp> <owner>".
# A lock older than 2 hours, or owned by a PID that no longer exists, is
# treated as stale and is broken automatically by the next script that tries
# to acquire it. This is a cooperative, best-effort lock (no atomic
# filesystem primitive is used)  - good enough for "two scheduled jobs on one
# machine", not a distributed lock.
#
# Scripts that must respect this lock (per the Phase B plan): B1
# (verify-backup.ps1), B3 (offsite-bundle.ps1), B5 (weekly-maintenance.ps1).
# B6 (daily3-resurface.mjs) is Node, not PowerShell, so it re-implements the
# same tiny protocol inline against the same .brain.lock file rather than
# dot-sourcing this file.

$script:BrainLockStaleHours = 2

function Get-BrainLockPath {
    param([string]$ScriptsDir = $PSScriptRoot)
    return (Join-Path $ScriptsDir '.brain.lock')
}

function Test-BrainLockStale {
    param([Parameter(Mandatory)] [string]$LockPath)
    if (-not (Test-Path -LiteralPath $LockPath)) { return $true }
    try {
        $raw = (Get-Content -LiteralPath $LockPath -Raw -ErrorAction Stop).Trim()
        if ($raw -eq '') { return $true }
        $parts = $raw -split '\s+', 3
        if ($parts.Count -lt 2) { return $true }

        $lockPid = 0
        if (-not [int]::TryParse($parts[0], [ref]$lockPid)) { return $true }

        $ts = [datetime]::MinValue
        if (-not [datetime]::TryParse($parts[1], [ref]$ts)) { return $true }

        $ageHours = ((Get-Date).ToUniversalTime() - $ts.ToUniversalTime()).TotalHours
        if ($ageHours -ge $script:BrainLockStaleHours) { return $true }

        $proc = Get-Process -Id $lockPid -ErrorAction SilentlyContinue
        if (-not $proc) { return $true }

        return $false
    } catch {
        return $true
    }
}

function Enter-BrainLock {
    <#
      Tries to acquire the shared brain lock. Returns $true if acquired,
      $false if another live job already holds it (caller should back off  -
      skip the run rather than wait/retry). Automatically breaks stale locks.
    #>
    param(
        [string]$LockPath = (Get-BrainLockPath),
        [string]$Owner = 'unknown'
    )
    if ((Test-Path -LiteralPath $LockPath) -and -not (Test-BrainLockStale -LockPath $LockPath)) {
        return $false
    }

    $line = "$PID $(([datetime]::UtcNow).ToString('o')) $Owner"
    try {
        Set-Content -LiteralPath $LockPath -Value $line -Encoding utf8 -Force
    } catch {
        return $false
    }

    # Narrow the race window between two processes both seeing a stale/absent
    # lock at the same time: re-read after a short delay and only proceed if
    # our own PID is still the one on disk.
    Start-Sleep -Milliseconds 50
    try {
        $confirm = (Get-Content -LiteralPath $LockPath -Raw -ErrorAction Stop).Trim()
        if (-not $confirm.StartsWith("$PID ")) { return $false }
    } catch {
        return $false
    }

    return $true
}

function Exit-BrainLock {
    param([string]$LockPath = (Get-BrainLockPath))
    if (-not (Test-Path -LiteralPath $LockPath)) { return }
    try {
        $raw = (Get-Content -LiteralPath $LockPath -Raw -ErrorAction Stop).Trim()
        if ($raw.StartsWith("$PID ")) {
            Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
        }
        # If it's not our PID, another job must have broken our (apparently
        # stale) lock and taken over  - leave it alone.
    } catch {
        # Best-effort release; a stuck lock older than 2h self-heals on the
        # next run via Test-BrainLockStale.
    }
}
