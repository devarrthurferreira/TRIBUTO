#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$settingsPath = Join-Path $PSScriptRoot 'settings.json'
$secretPath = Join-Path $PSScriptRoot 'agent-token.dpapi'
$settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$null = New-Item -ItemType Directory -Path $settings.LogsDir -Force
$logFile = Join-Path $settings.LogsDir ('agent-{0:yyyy-MM-dd}.log' -f (Get-Date))
$tokenBytes = $null
try {
    Add-Type -AssemblyName System.Security
    $protectedToken = [IO.File]::ReadAllBytes($secretPath)
    $entropy = [Text.Encoding]::UTF8.GetBytes('TRIBUTO-AGENT-V1')
    $tokenBytes = [Security.Cryptography.ProtectedData]::Unprotect(
        $protectedToken, $entropy, [Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    $env:AGENT_TOKEN = [Text.Encoding]::UTF8.GetString($tokenBytes)
    $env:API_BASE_URL = $settings.ApiBaseUrl
    $env:AGENT_STATE_DIR = $settings.StateDir
    & $settings.NodePath $settings.AgentPath *>> $logFile
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) { $exitCode = 1 }
} catch {
    # Never include exception details: they may contain a URL or secret-bearing context.
    Add-Content -LiteralPath $logFile -Value ('{0:o} Agente não iniciou; confira configuração e permissões.' -f (Get-Date))
    $exitCode = 1
} finally {
    Remove-Item Env:\AGENT_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:\API_BASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\AGENT_STATE_DIR -ErrorAction SilentlyContinue
    if ($tokenBytes) { [Array]::Clear($tokenBytes, 0, $tokenBytes.Length) }
}
exit $exitCode
