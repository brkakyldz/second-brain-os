<#
  weekly-maintenance.ps1  - B5: weekly headless /triage then /curator pass.

  Runs `claude -p "/triage then /curator"` headless, from the vault root,
  guarded by scripts/.brain.lock so it never runs concurrently with B1/B3/B6
  (or a second copy of itself). /triage empties inbox/, /curator consolidates
  and proposes destructive changes as a table rather than applying them.

  DO NOT run this ad hoc during testing  - it spawns a real headless Claude
  Code session against the live vault. It is safe to *register* on Task
  Scheduler (see register-tasks.ps1, run manually by you).

  Kill criterion (per the Phase B plan): approval backlog exceeding 1 week  -
  if proposals pile up unreviewed, the cadence or scope needs to change.
#>
param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'lock.ps1')

$lockPath = Get-BrainLockPath -ScriptsDir $PSScriptRoot
$gotLock = Enter-BrainLock -LockPath $lockPath -Owner 'weekly-maintenance'
if (-not $gotLock) {
    Write-Host "weekly-maintenance: another brain job holds scripts/.brain.lock  - skipping this run."
    exit 0
}

$logDir = Join-Path $RepoRoot '_brain\logs'
if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}
$automationLog = Join-Path $logDir '.automation.log'

function Write-AutomationLog {
    param([string]$Message)
    $line = "[$(([datetime]::UtcNow).ToString('o'))] weekly-maintenance: $Message"
    Add-Content -LiteralPath $automationLog -Value $line -Encoding utf8
}

$exitCode = 0
try {
    Push-Location $RepoRoot
    try {
        Write-AutomationLog "starting headless '/triage then /curator'"
        claude -p "/triage then /curator"
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) {
            Write-AutomationLog "completed successfully"
        } else {
            Write-AutomationLog "claude -p exited with code $exitCode"
        }
    } finally {
        Pop-Location
    }
} finally {
    Exit-BrainLock -LockPath $lockPath
}

exit $exitCode
