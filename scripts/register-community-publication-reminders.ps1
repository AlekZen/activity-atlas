[CmdletBinding()]
param(
    [datetime]$FollowUpAt = [datetime]'2026-09-27T09:00:00',
    [datetime]$FallbackAt = [datetime]'2027-01-27T09:00:00'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$notifierPath = Join-Path $PSScriptRoot 'show-community-publication-reminder.ps1'
if (-not (Test-Path -LiteralPath $notifierPath -PathType Leaf)) {
    throw "No se encontró el notificador: $notifierPath"
}

$pwshPath = (Get-Command pwsh.exe -ErrorAction Stop).Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

function Register-Reminder {
    param(
        [Parameter(Mandatory)]
        [string]$TaskName,

        [Parameter(Mandatory)]
        [datetime]$At,

        [Parameter(Mandatory)]
        [ValidateSet('follow-up', 'fallback')]
        [string]$Stage,

        [Parameter(Mandatory)]
        [string]$Description
    )

    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "{0}" -Stage {1}' -f $notifierPath, $Stage
    $action = New-ScheduledTaskAction -Execute $pwshPath -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -Once -At $At

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description $Description `
        -Force | Out-Null
}

Register-Reminder `
    -TaskName 'ActivityAtlas-Permission-FollowUp' `
    -At $FollowUpAt `
    -Stage 'follow-up' `
    -Description 'Revisar la solicitud pública de autorización después de 30 días.'

Register-Reminder `
    -TaskName 'ActivityAtlas-Directory-Fallback' `
    -At $FallbackAt `
    -Stage 'fallback' `
    -Description 'Revisar la excepción de Obsidian por seis meses de inactividad del proyecto base.'

Write-Output ("ActivityAtlas-Permission-FollowUp: {0}" -f $FollowUpAt.ToString('yyyy-MM-dd HH:mm zzz'))
Write-Output ("ActivityAtlas-Directory-Fallback: {0}" -f $FallbackAt.ToString('yyyy-MM-dd HH:mm zzz'))
