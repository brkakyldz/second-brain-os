<#
  offsite-bundle.ps1  - B3: weekly off-site snapshot.

  Runs `git bundle create --all` into a destination directory, verifies the
  bundle with `git bundle verify`, then keeps only the last 8 bundle files in
  that directory (deletes older *.bundle files only  - nothing else in the
  destination is touched).

  Destination resolution order:
    1. -Destination parameter
    2. $env:SECOND_BRAIN_BUNDLE_DIR
    3. Placeholder default: %USERPROFILE%\vault-backups

  IMPORTANT: the placeholder default is NOT a real off-site location. You
  must set SECOND_BRAIN_BUNDLE_DIR (or pass -Destination) to an actual
  second location (a different physical/logical drive, ideally a different
  machine or cloud-synced folder) before this job is scheduled for real. See
  scripts/README.md.

  Kill criterion: never; restore-test quarterly (open the newest bundle in a
  scratch clone: `git clone <bundle> scratch-restore-test`).
#>
param(
    [string]$Destination,
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [int]$KeepLast = 8
)

Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'lock.ps1')

if ([string]::IsNullOrWhiteSpace($Destination)) {
    if (-not [string]::IsNullOrWhiteSpace($env:SECOND_BRAIN_BUNDLE_DIR)) {
        $Destination = $env:SECOND_BRAIN_BUNDLE_DIR
    } else {
        $Destination = Join-Path $env:USERPROFILE 'vault-backups'
        Write-Warning "offsite-bundle: SECOND_BRAIN_BUNDLE_DIR is not set  - using placeholder destination '$Destination'. Set the env var (or pass -Destination) to a real off-site location. See scripts/README.md."
    }
}

$lockPath = Get-BrainLockPath -ScriptsDir $PSScriptRoot
$gotLock = Enter-BrainLock -LockPath $lockPath -Owner 'offsite-bundle'
if (-not $gotLock) {
    Write-Host "offsite-bundle: another brain job holds scripts/.brain.lock  - skipping this run."
    exit 0
}

$exitCode = 0
try {
    try {
        New-Item -ItemType Directory -Force -Path $Destination -ErrorAction Stop | Out-Null
    } catch {
        Write-Error "offsite-bundle: cannot create/access destination '$Destination': $($_.Exception.Message)"
        exit 1
    }

    Push-Location $RepoRoot
    try {
        $stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
        $repoName = Split-Path -Leaf $RepoRoot
        $bundleName = "${repoName}_$stamp.bundle"
        $bundlePath = Join-Path $Destination $bundleName

        git bundle create $bundlePath --all
        if ($LASTEXITCODE -ne 0) {
            Write-Error "offsite-bundle: 'git bundle create' failed (exit $LASTEXITCODE)"
            $exitCode = 1
            return
        }

        git bundle verify $bundlePath
        if ($LASTEXITCODE -ne 0) {
            Write-Error "offsite-bundle: 'git bundle verify' failed for $bundlePath (exit $LASTEXITCODE)"
            $exitCode = 1
            return
        }

        Write-Host "offsite-bundle: created and verified $bundlePath"

        # Retention: keep the last $KeepLast bundle files in $Destination.
        $bundles = Get-ChildItem -LiteralPath $Destination -Filter '*.bundle' -File |
            Sort-Object LastWriteTime -Descending
        if ($bundles.Count -gt $KeepLast) {
            $toDelete = $bundles | Select-Object -Skip $KeepLast
            foreach ($b in $toDelete) {
                Remove-Item -LiteralPath $b.FullName -Force
                Write-Host "offsite-bundle: removed old bundle $($b.Name)"
            }
        }
    } finally {
        Pop-Location
    }
} finally {
    Exit-BrainLock -LockPath $lockPath
}

exit $exitCode
