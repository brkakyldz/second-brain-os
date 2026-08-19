<#
  ############################################################################
  #  DO NOT RUN THIS SCRIPT AUTOMATICALLY OR AS PART OF ANY AGENT SESSION.
  #
  #  This script is for you to read, review, and run BY HAND, once, from an
  #  interactive PowerShell prompt on the machine that should own these
  #  scheduled jobs. It registers real Windows Task Scheduler entries that
  #  will keep running unattended after this session ends. No hook, script,
  #  or CI job in this repo invokes it  - it is only ever run on purpose.
  ############################################################################

  register-tasks.ps1  - creates Windows Task Scheduler entries for the Phase B
  automation roster:

    B1  verify-backup.ps1       daily    07:00
    B2  link-sweep.mjs          weekly   Sunday 07:15
    B3  offsite-bundle.ps1      weekly   Sunday 07:30
    B5  weekly-maintenance.ps1  weekly   Sunday 08:00  (runs claude -p  - check
                                                         SECOND_BRAIN_BUNDLE_DIR
                                                         and PAT setup first)
    B6  daily3-resurface.mjs    daily    21:00

  All tasks run under the current user's account (no elevation required for
  the trigger itself; Register-ScheduledTask may prompt once). Times are
  spaced out and B2/B3/B5 are staggered on Sunday morning so B5's lockfile
  wait never collides with B1's daily run.

  To run:  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-tasks.ps1

  To review afterwards:  Get-ScheduledTask -TaskPath '\SecondBrain\'
  To remove everything:  Get-ScheduledTask -TaskPath '\SecondBrain\' | Unregister-ScheduledTask -Confirm:$false
#>
param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [string]$TaskFolder = '\SecondBrain\'
)

Set-StrictMode -Version Latest

Write-Host "This script registers 5 Windows Task Scheduler entries. It does NOT run automatically." -ForegroundColor Yellow
Write-Host "Repo root: $RepoRoot"
Write-Host "Task folder: $TaskFolder"
Write-Host ""

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCmd) { $nodeCmd.Source } else { 'node.exe' }

$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
$shellExe = if ($pwshCmd) { $pwshCmd.Source } else { (Get-Command powershell).Source }

function Register-BrainTask {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$Execute,
        [Parameter(Mandatory)] [string]$Arguments,
        [Parameter(Mandatory)] $Trigger,
        [Parameter(Mandatory)] [string]$Description
    )
    $action = New-ScheduledTaskAction -Execute $Execute -Argument $Arguments -WorkingDirectory $RepoRoot
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
        -ExecutionTimeLimit (New-TimeSpan -Hours 2) -RestartCount 1 -RestartInterval (New-TimeSpan -Minutes 15)
    Register-ScheduledTask -TaskName $Name -TaskPath $TaskFolder -Action $action -Trigger $Trigger `
        -Settings $settings -Description $Description -Force | Out-Null
    Write-Host "Registered: $TaskFolder$Name"
}

$dailyB1Trigger = New-ScheduledTaskTrigger -Daily -At '07:00'
$weeklyB2Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '07:15'
$weeklyB3Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '07:30'
$weeklyB5Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '08:00'
$dailyB6Trigger = New-ScheduledTaskTrigger -Daily -At '21:00'

Register-BrainTask -Name 'B1-verify-backup' `
    -Execute $shellExe -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$RepoRoot\scripts\verify-backup.ps1`"" `
    -Trigger $dailyB1Trigger -Description 'B1: daily backup/push verify (silent on success, alerts to _brain/logs on failure).'

Register-BrainTask -Name 'B2-link-sweep' `
    -Execute $nodeExe -Arguments "`"$RepoRoot\scripts\link-sweep.mjs`"" `
    -Trigger $weeklyB2Trigger -Description 'B2: weekly broken-link/orphan/dangling-pointer sweep, report to _brain/logs.'

Register-BrainTask -Name 'B3-offsite-bundle' `
    -Execute $shellExe -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$RepoRoot\scripts\offsite-bundle.ps1`"" `
    -Trigger $weeklyB3Trigger -Description 'B3: weekly git bundle --all snapshot to SECOND_BRAIN_BUNDLE_DIR, retains last 8.'

Register-BrainTask -Name 'B5-weekly-maintenance' `
    -Execute $shellExe -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$RepoRoot\scripts\weekly-maintenance.ps1`"" `
    -Trigger $weeklyB5Trigger -Description 'B5: weekly headless claude -p "/triage then /curator", lockfile-guarded.'

Register-BrainTask -Name 'B6-daily3-resurface' `
    -Execute $nodeExe -Arguments "`"$RepoRoot\scripts\daily3-resurface.mjs`"" `
    -Trigger $dailyB6Trigger -Description 'B6: daily-3 weighted-random resurfacing appended to today''s daily note.'

Write-Host ""
Write-Host "Done. Review with: Get-ScheduledTask -TaskPath '$TaskFolder'" -ForegroundColor Green
