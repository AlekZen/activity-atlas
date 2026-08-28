[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('follow-up', 'fallback')]
    [string]$Stage,

    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$trackingUrl = 'https://github.com/AlekZen/activity-atlas/issues/1'

$reminders = @{
    'follow-up' = @{
        Title = 'Activity Atlas: revisar autorización'
        Message = "Han pasado 30 días desde la solicitud pública. Revisa si @kains2866 respondió y, si sigue en silencio, deja un único seguimiento cortés. $trackingUrl"
    }
    'fallback' = @{
        Title = 'Activity Atlas: revisar publicación en Obsidian'
        Message = "Revisa si Vault Change Feed lleva seis meses sin actualizaciones. Si también pasaron 30 días sin respuesta, prepara la excepción de Obsidian. $trackingUrl"
    }
}

$reminder = $reminders[$Stage]

if ($DryRun) {
    Write-Output ("{0}: {1}" -f $reminder.Title, $reminder.Message)
    return
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$notification = [System.Windows.Forms.NotifyIcon]::new()
try {
    $notification.Icon = [System.Drawing.SystemIcons]::Information
    $notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $notification.BalloonTipTitle = $reminder.Title
    $notification.BalloonTipText = $reminder.Message
    $notification.Visible = $true
    $notification.ShowBalloonTip(20000)
    Start-Sleep -Seconds 22
}
finally {
    $notification.Dispose()
}
