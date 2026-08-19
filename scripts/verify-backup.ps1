<#
  verify-backup.ps1  - B1: daily backup/push verify.

  What it checks:
    1. Remote 'origin' is reachable (git ls-remote).
    2. Local HEAD is in sync with origin/<branch> (not ahead, not behind).
    3. No uncommitted changes older than 12 hours (a sign the checkpoint
       hooks stopped firing, or a session ended mid-edit without checkpointing).

  Behavior: silent on success (exit 0, no output, no file written). On any
  failure: prints a clear alert line to stdout, writes a note file to
  _brain/logs/YYYY-MM-DD_backup-alert.md, and exits non-zero.

  Kill criterion (per the Phase B plan): never  - this job stays as long as
  the vault has a remote to verify against.
#>
param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'lock.ps1')

$failures = New-Object System.Collections.Generic.List[string]

Push-Location $RepoRoot
try {
    $lockPath = Get-BrainLockPath -ScriptsDir $PSScriptRoot
    $gotLock = Enter-BrainLock -LockPath $lockPath -Owner 'verify-backup'
    if (-not $gotLock) {
        Write-Host "verify-backup: another brain job holds scripts/.brain.lock  - skipping this run (not a failure)."
        exit 0
    }

    try {
        # --- 1. Remote reachable -------------------------------------------------
        $remoteOk = $true
        try {
            git ls-remote --exit-code origin *> $null
            if ($LASTEXITCODE -ne 0) { $remoteOk = $false }
        } catch {
            $remoteOk = $false
        }
        if (-not $remoteOk) {
            $failures.Add("remote 'origin' unreachable (git ls-remote failed)") | Out-Null
        }

        # --- 2. Local vs origin sync status --------------------------------------
        if ($remoteOk) {
            try { git fetch --quiet origin *> $null } catch { }

            $branch = (git rev-parse --abbrev-ref HEAD 2>$null)
            if ($LASTEXITCODE -ne 0 -or -not $branch) {
                $failures.Add("could not determine current branch (git rev-parse --abbrev-ref HEAD failed)") | Out-Null
            } else {
                $branch = $branch.Trim()
                $upstream = "origin/$branch"
                git rev-parse --verify $upstream *> $null
                $hasUpstream = ($LASTEXITCODE -eq 0)

                if (-not $hasUpstream) {
                    $failures.Add("branch '$branch' has no upstream tracking ref ($upstream not found)") | Out-Null
                } else {
                    $ahead = (git rev-list --count "$upstream..HEAD" 2>$null)
                    $behind = (git rev-list --count "HEAD..$upstream" 2>$null)
                    $aheadN = 0; $behindN = 0
                    [void][int]::TryParse(("$ahead").Trim(), [ref]$aheadN)
                    [void][int]::TryParse(("$behind").Trim(), [ref]$behindN)

                    if ($aheadN -gt 0) {
                        $failures.Add("local branch '$branch' is $aheadN commit(s) ahead of $upstream  - push needed") | Out-Null
                    }
                    if ($behindN -gt 0) {
                        $failures.Add("local branch '$branch' is $behindN commit(s) behind $upstream  - pull needed") | Out-Null
                    }
                }
            }
        }

        # --- 3. Uncommitted changes older than 12h -------------------------------
        $statusLines = git status --porcelain 2>$null
        if ($statusLines) {
            $cutoff = (Get-Date).AddHours(-12)
            $staleFiles = New-Object System.Collections.Generic.List[string]
            foreach ($line in $statusLines) {
                if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -lt 4) { continue }
                $relPath = $line.Substring(3).Trim()
                if ($relPath -match '->') {
                    $relPath = ($relPath -split '->')[-1].Trim()
                }
                $relPath = $relPath.Trim('"')
                $fullPath = Join-Path $RepoRoot $relPath
                if (Test-Path -LiteralPath $fullPath) {
                    $mtime = (Get-Item -LiteralPath $fullPath -Force).LastWriteTime
                    if ($mtime -lt $cutoff) {
                        $staleFiles.Add("$relPath (modified $mtime)") | Out-Null
                    }
                }
            }
            if ($staleFiles.Count -gt 0) {
                $failures.Add("uncommitted changes older than 12h: " + ($staleFiles -join '; ')) | Out-Null
            }
        }
    } finally {
        Exit-BrainLock -LockPath $lockPath
    }
} finally {
    Pop-Location
}

if ($failures.Count -eq 0) {
    exit 0
}

$today = Get-Date -Format 'yyyy-MM-dd'
$logDir = Join-Path $RepoRoot '_brain\logs'
if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}
$alertPath = Join-Path $logDir "${today}_backup-alert.md"

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# Backup verify alert  - $today") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("Generated by ``scripts/verify-backup.ps1`` (B1). Investigate and resolve, then re-run the script to confirm.") | Out-Null
$lines.Add("") | Out-Null
foreach ($f in $failures) { $lines.Add("- $f") | Out-Null }
$lines.Add("") | Out-Null

Set-Content -LiteralPath $alertPath -Value ($lines -join "`r`n") -Encoding utf8

Write-Host "BACKUP VERIFY FAILED: $($failures.Count) issue(s)  - see $alertPath"
foreach ($f in $failures) { Write-Host " - $f" }

exit 1
