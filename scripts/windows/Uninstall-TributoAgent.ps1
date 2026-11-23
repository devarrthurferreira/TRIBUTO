#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:ProgramData 'TRIBUTO'),
    [string]$TaskName = 'TRIBUTO Agent'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if ($InstallRoot -notmatch '^[A-Za-z]:\\' -or
    [IO.Path]::GetFileName($InstallRoot.TrimEnd([char[]]@('\', '/'))) -ine 'TRIBUTO') {
    throw 'InstallRoot deve ser uma pasta local chamada TRIBUTO.'
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
# Delete the installation's token and executable/configuration, but preserve
# queue, checkpoints, quarantine and logs for recovery or audit.
foreach ($name in @('agent-token.dpapi', 'settings.json', 'Run-TributoAgent.ps1')) {
    Remove-Item -LiteralPath (Join-Path $InstallRoot $name) -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath (Join-Path $InstallRoot 'bin') -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Tarefa '$TaskName' removida e token local apagado."
Write-Host "Estado, fila e logs preservados em $InstallRoot para recuperação."
