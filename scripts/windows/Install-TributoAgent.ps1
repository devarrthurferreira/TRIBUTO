#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ApiBaseUrl,

    [string]$InstallRoot = (Join-Path $env:ProgramData 'TRIBUTO'),
    [string]$TaskName = 'TRIBUTO Agent',
    [string]$NodePath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Set-ExactAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [bool]$ServiceWritable = $false
    )
    $item = Get-Item -LiteralPath $Target -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Reparse point não permitido em $Target"
    }
    $acl = Get-Acl -LiteralPath $Target
    # Remove inherited *and* explicit entries, including unknown SIDs left by
    # an earlier installation. /grant:r alone would retain those grants.
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.PurgeAccessRules($rule.IdentityReference) }

    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $admins = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $localService = [Security.Principal.SecurityIdentifier]::new('S-1-5-19')
    $acl.SetOwner($admins)
    $inherit = [Security.AccessControl.InheritanceFlags]::None
    if ($item.PSIsContainer) {
        $inherit = ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit)
    }
    $propagate = [Security.AccessControl.PropagationFlags]::None
    $allow = [Security.AccessControl.AccessControlType]::Allow
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $system, [Security.AccessControl.FileSystemRights]::FullControl, $inherit, $propagate, $allow
    ))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $admins, [Security.AccessControl.FileSystemRights]::FullControl, $inherit, $propagate, $allow
    ))
    $serviceRights = [Security.AccessControl.FileSystemRights]::ReadAndExecute
    if ($ServiceWritable) { $serviceRights = [Security.AccessControl.FileSystemRights]::Modify }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        $localService, $serviceRights, $inherit, $propagate, $allow
    ))
    Set-Acl -LiteralPath $Target -AclObject $acl
}

function Protect-InstallTree {
    param([string]$Root, [string]$State, [string]$Logs)
    Set-ExactAcl -Target $Root
    $statePrefix = $State.TrimEnd([char[]]@('\', '/')) + '\'
    $logsPrefix = $Logs.TrimEnd([char[]]@('\', '/')) + '\'
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Root)
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($item in (Get-ChildItem -LiteralPath $directory -Force)) {
            $name = $item.FullName
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Reparse point não permitido em $name"
            }
            $writable = ($name -ieq $State -or $name -ieq $Logs -or
                $name.StartsWith($statePrefix, [StringComparison]::OrdinalIgnoreCase) -or
                $name.StartsWith($logsPrefix, [StringComparison]::OrdinalIgnoreCase))
            Set-ExactAcl -Target $name -ServiceWritable $writable
            if ($item.PSIsContainer) { $pending.Push($name) }
        }
    }
}

$apiUri = $null
if (-not [Uri]::TryCreate($ApiBaseUrl, [UriKind]::Absolute, [ref]$apiUri) -or
    $apiUri.Scheme -ne 'https' -or
    $apiUri.AbsolutePath -ne '/' -or
    $apiUri.Query -or $apiUri.Fragment -or $apiUri.UserInfo) {
    throw 'ApiBaseUrl deve ser a origem HTTPS da API, sem caminho, consulta ou credenciais.'
}
$ApiBaseUrl = $apiUri.GetLeftPart([UriPartial]::Authority)

if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = [IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'node.exe não encontrado.' }
$nodeVersion = (& $NodePath --version).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 20) { throw 'Instale Node.js 20 ou superior.' }

$sourceAgent = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\src\agent\agent.mjs'))
$sourceRunner = Join-Path $PSScriptRoot 'Run-TributoAgent.ps1'
if (-not (Test-Path -LiteralPath $sourceAgent -PathType Leaf) -or
    -not (Test-Path -LiteralPath $sourceRunner -PathType Leaf)) {
    throw 'Execute este instalador a partir de um checkout completo do TRIBUTO.'
}

Write-Host 'Digite o token individual criado no painel TRIBUTO. Ele não aparecerá na tela.'
$secureToken = Read-Host 'Token do agente' -AsSecureString
$tokenBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$plainToken = $null
$tokenBytes = $null
try {
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenBstr)
    if ($plainToken -cnotmatch '^[A-Za-z0-9._~-]{32,256}$') { throw 'O token não tem o formato esperado.' }
    # Fail before changing the scheduled task if the URL or token cannot authenticate.
    $headers = @{ Authorization = "Bearer $plainToken" }
    $preflight = Invoke-WebRequest -Uri "$ApiBaseUrl/v1/agent/jobs" -Method Get -Headers $headers `
        -TimeoutSec 20 -MaximumRedirection 0 -UseBasicParsing
    if ([int]$preflight.StatusCode -ne 200 -or $preflight.Headers['Content-Type'] -notlike 'application/json*') {
        throw 'A API não confirmou o token do agente com resposta JSON 200.'
    }
    $headers.Clear()

    $InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
    if ($InstallRoot -notmatch '^[A-Za-z]:\\' -or
        [IO.Path]::GetFileName($InstallRoot.TrimEnd([char[]]@('\', '/'))) -ine 'TRIBUTO') {
        throw 'InstallRoot deve ser uma pasta local chamada TRIBUTO (ex.: C:\ProgramData\TRIBUTO).'
    }
    $binDir = Join-Path $InstallRoot 'bin'
    $stateDir = Join-Path $InstallRoot 'state'
    $logsDir = Join-Path $InstallRoot 'logs'
    $null = New-Item -ItemType Directory -Path $InstallRoot -Force
    # Restrict the parent before creating any token-bearing file. DPAPI
    # LocalMachine relies on this ACL to limit which accounts can read it.
    Protect-InstallTree -Root $InstallRoot -State $stateDir -Logs $logsDir
    foreach ($directory in @($binDir, $stateDir, $logsDir)) {
        $null = New-Item -ItemType Directory -Path $directory -Force
    }

    $agentPath = Join-Path $binDir 'agent.mjs'
    $runnerPath = Join-Path $InstallRoot 'Run-TributoAgent.ps1'
    Copy-Item -LiteralPath $sourceAgent -Destination $agentPath -Force
    Copy-Item -LiteralPath $sourceRunner -Destination $runnerPath -Force

    $settings = [ordered]@{
        ApiBaseUrl = $ApiBaseUrl
        NodePath = $NodePath
        AgentPath = $agentPath
        StateDir = $stateDir
        LogsDir = $logsDir
    }
    $settingsPath = Join-Path $InstallRoot 'settings.json'
    $settings | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $settingsPath -Encoding UTF8

    Add-Type -AssemblyName System.Security
    $tokenBytes = [Text.Encoding]::UTF8.GetBytes($plainToken)
    $entropy = [Text.Encoding]::UTF8.GetBytes('TRIBUTO-AGENT-V1')
    $protectedToken = [Security.Cryptography.ProtectedData]::Protect(
        $tokenBytes, $entropy, [Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    $secretPath = Join-Path $InstallRoot 'agent-token.dpapi'
    [IO.File]::WriteAllBytes($secretPath, $protectedToken)

    # Config/code/secret: read by LocalService, writable only by SYSTEM/admins.
    # State/queue/logs: write by LocalService, kept out of the repository.
    Protect-InstallTree -Root $InstallRoot -State $stateDir -Logs $logsDir

    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

    $powerShellExe = Join-Path $PSHOME 'powershell.exe'
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $runnerPath
    $action = New-ScheduledTaskAction -Execute $powerShellExe -Argument $arguments -WorkingDirectory $InstallRoot
    $trigger = New-ScheduledTaskTrigger -AtStartup
    # Daily fallback starts a stopped task after the finite restart budget;
    # IgnoreNew prevents a second agent when the original is still running.
    $fallbackTrigger = New-ScheduledTaskTrigger -Daily -At '03:00'
    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
    $settingsTask = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($trigger, $fallbackTrigger) `
        -Principal $principal -Settings $settingsTask -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Agente instalado: tarefa '$TaskName' como LocalService."
    Write-Host "Estado e fila: $stateDir"
    Write-Host "Logs: $logsDir"
} finally {
    if ($tokenBytes) { [Array]::Clear($tokenBytes, 0, $tokenBytes.Length) }
    if ($tokenBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenBstr) }
    $plainToken = $null
}
