# SPDX-License-Identifier: MIT
#Requires -Version 7.0

param(
    [Parameter(Mandatory)][ValidateSet('Quick', 'Development', 'Integration')][string]$Mode,
    [Parameter(Mandatory)][string]$DataRoot,
    [Parameter(Mandatory)][string]$CacheRoot,
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$GitPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$GitSha256,
    [string]$RepositoryRoot = (Split-Path $PSScriptRoot -Parent),
    [switch]$FullControlTests,
    [switch]$Plan
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$savedEnvironment = @{}
$exitCode = 2
$summary = $null
$runRoot = $null

# Reject junctions as well as lexical C-drive paths before creating anything.
function Get-SafePath([string]$Value) {
    if ($Value -notmatch '^[eE]:[\\/]' -or $Value -match '["%&|<>!^\r\n]') {
        throw "Expected an absolute E-drive path without shell metacharacters: $Value"
    }
    $full = [IO.Path]::GetFullPath($Value)
    if ($full -notmatch '^[eE]:\\' -or $full.Substring(2).Contains(':')) { throw "Invalid path: $Value" }
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -Force -LiteralPath $cursor
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse-point path is not allowed: $cursor" }
        }
        $parent = Split-Path $cursor -Parent
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
    return $full
}

function Set-ChildEnvironment([string]$Name, [string]$Value) {
    if (-not $savedEnvironment.ContainsKey($Name)) {
        $savedEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
    }
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Write-RunSummary {
    $destination = Join-Path $runRoot 'check-summary.json'
    $temporary = "$destination.tmp"
    [IO.File]::WriteAllText($temporary, ($summary | ConvertTo-Json -Depth 20) + "`n", [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $destination -Force
}

function Invoke-Check([string]$Name, [string]$Executable, [string[]]$CommandArguments) {
    $logPath = Join-Path $runRoot "$Name.log"
    $step = [ordered]@{name=$Name; executable=$Executable; arguments=$CommandArguments; log=$logPath; status='planned'; exitCode=$null}
    $summary.steps.Add($step)
    if ($Plan) { return }
    Write-Host "Running $Name"
    & $Executable @CommandArguments 2>&1 | Tee-Object -FilePath $logPath | Out-Host
    $nativeExit = $LASTEXITCODE
    $step.exitCode = $nativeExit
    $step.status = if ($nativeExit -eq 0) { 'passed' } else { 'failed' }
    Write-RunSummary
    if ($nativeExit -ne 0) {
        $script:exitCode = $nativeExit
        throw "$Name failed with exit $nativeExit; see $logPath"
    }
}

try {
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Windows host required' }
    $RepositoryRoot = Get-SafePath $RepositoryRoot
    $DataRoot = Get-SafePath $DataRoot
    $CacheRoot = Get-SafePath $CacheRoot
    $NodePath = Get-SafePath $NodePath
    $GitPath = Get-SafePath $GitPath
    if ($DataRoot -eq 'E:\' -or $DataRoot -eq $RepositoryRoot -or $DataRoot.StartsWith($RepositoryRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'DataRoot must be a dedicated directory outside the source repository, not a drive root'
    }
    $launcher = Join-Path $RepositoryRoot 'eng/tsfg-build.cmd'
    $launcherText = [IO.File]::ReadAllText($launcher)
    $nodeIdentity = [regex]::Match($launcherText, 'set "TSFG_NODE_ID=([a-f0-9]{64})"').Groups[1].Value
    if (-not $nodeIdentity -or (Get-FileHash -LiteralPath $NodePath -Algorithm SHA256).Hash -ine $nodeIdentity) {
        throw 'Node does not match the pinned Windows launcher identity'
    }
    if ((Get-FileHash -LiteralPath $GitPath -Algorithm SHA256).Hash -ine $GitSha256) { throw 'Bootstrap Git digest mismatch' }
    $runRoot = Join-Path $DataRoot ("$($Mode.ToLowerInvariant())-" + [guid]::NewGuid().ToString('N'))
    $temporaryRoot = Join-Path $runRoot 'temp'
    $profileRoot = Join-Path $runRoot 'profile'
    New-Item -ItemType Directory -Path $temporaryRoot, $profileRoot | Out-Null
    foreach ($name in @('TEMP','TMP','TMPDIR')) { Set-ChildEnvironment $name $temporaryRoot }
    foreach ($name in @('USERPROFILE','APPDATA','LOCALAPPDATA')) { Set-ChildEnvironment $name $profileRoot }
    Set-ChildEnvironment 'PSModuleAnalysisCachePath' (Join-Path $profileRoot 'powershell-module-cache')
    foreach ($name in @('NODE_OPTIONS','NODE_PATH','NODE_COMPILE_CACHE','TSFG_WINDOWS_ACCEPTANCE_ROOT','TSFG_WINDOWS_CLOSURE_CACHE','TSFG_RUNTIME_CACHE','TSFG_RUNTIME_LOCK','TSFG_RUNTIME_PLATFORM','TSFG_WINDOWS_OFFLINE_ACTIVE','TSFG_WINDOWS_BOUNDARY_ERROR')) { Set-ChildEnvironment $name $null }
    foreach ($name in @([Environment]::GetEnvironmentVariables('Process').Keys)) {
        if ($name -like 'GIT_TRACE*') { Set-ChildEnvironment $name $null }
    }
    Set-ChildEnvironment 'NODE_DISABLE_COMPILE_CACHE' '1'
    Set-ChildEnvironment 'GIT_CONFIG_NOSYSTEM' '1'
    Set-ChildEnvironment 'GIT_CONFIG_GLOBAL' 'NUL'
    Set-ChildEnvironment 'GIT_TERMINAL_PROMPT' '0'
    Set-ChildEnvironment 'GIT_OPTIONAL_LOCKS' '0'
    Set-ChildEnvironment 'PATH' ((Split-Path $NodePath -Parent), (Split-Path $GitPath -Parent), "$env:SystemRoot\System32", $PSHOME -join ';')
    Set-ChildEnvironment 'TSFG_GIT' $GitPath
    Set-ChildEnvironment 'TSFG_BOOTSTRAP_GIT' $GitPath
    Set-ChildEnvironment 'TSFG_BOOTSTRAP_GIT_SHA256' $GitSha256.ToLowerInvariant()
    Set-ChildEnvironment 'TSFG_CACHE_DIR' $CacheRoot
    $gitRoot = & $GitPath -C $RepositoryRoot rev-parse --show-toplevel
    if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($gitRoot) -ine $RepositoryRoot) { throw 'RepositoryRoot must be a Git repository root' }
    $revision = & $GitPath -C $RepositoryRoot rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read repository revision' }
    $dirty = @(& $GitPath -C $RepositoryRoot status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect repository state' }
    $summary = [ordered]@{
        schemaVersion='1'; kind='windows-check-orchestration'; mode=$Mode; status='running'; planOnly=[bool]$Plan; fullControlTests=[bool]$FullControlTests
        repository=$RepositoryRoot; revision=$revision; dirty=($dirty.Count -gt 0)
        driverSha256=(Get-FileHash -LiteralPath $PSCommandPath).Hash.ToLowerInvariant()
        nodeSha256=$nodeIdentity; gitSha256=$GitSha256.ToLowerInvariant()
        paths=[ordered]@{run=$runRoot; temp=$temporaryRoot; profile=$profileRoot; toolCache=$CacheRoot; node=$NodePath; git=$GitPath}
        steps=[Collections.Generic.List[object]]::new()
    }
    Push-Location -LiteralPath $RepositoryRoot
    try {
        if ($Mode -eq 'Quick') {
            Invoke-Check 'format' $GitPath @('diff','--check')
            Invoke-Check 'typecheck' $NodePath @('node_modules/typescript/bin/tsc','--noEmit')
            $focusedTests = @('windows-check.test.mjs','windows-launcher-regressions.test.mjs','toolchain-lock.test.mjs','contract-compatibility-cli.test.mjs','product-pr-ci.test.mjs','repro-check-cli.test.mjs')
            $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $RepositoryRoot 'tests/r00') -Filter '*.test.mjs' | Where-Object { $FullControlTests -or $_.Name -in $focusedTests } | Sort-Object Name | ForEach-Object { $_.FullName })
            if (-not $testFiles.Count) { throw 'No control-plane tests found' }
            Invoke-Check 'control-tests' $NodePath (@('--test','--test-concurrency=1') + $testFiles)
        } else {
            $profiles = if ($Mode -eq 'Integration') { @('debug','release') } else { @('debug') }
            foreach ($profile in $profiles) {
                $output = Join-Path $runRoot "$profile-build"
                $package = Join-Path $runRoot "$profile-package"
                $common = @('--target','windows-x86_64-msvc','--profile',$profile,'--workspace',$RepositoryRoot)
                $development = if ($Mode -eq 'Development') { @('--dev') } else { @() }
                foreach ($operation in @('build','test')) {
                    Invoke-Check "$profile-$operation" $launcher (@($operation) + $development + $common + @('--out',$output,'--report',(Join-Path $runRoot "$profile-$operation.json")))
                }
                if ($Mode -eq 'Integration') {
                    Invoke-Check "$profile-package" $launcher (@('package') + $common + @('--input',$output,'--out',$package,'--report',(Join-Path $runRoot "$profile-package.json")))
                    Invoke-Check "$profile-runtime" $launcher (@('test') + $common + @('--package',$package,'--report',(Join-Path $runRoot "$profile-runtime.json")))
                }
            }
        }
    } finally { Pop-Location }
    $summary.status = if ($Plan) { 'planned' } else { 'passed' }
    $exitCode = 0
} catch {
    if ($summary) { $summary.status = 'failed'; $summary.error = $_.Exception.Message }
    [Console]::Error.WriteLine($_.Exception.Message)
} finally {
    if ($summary) { Write-RunSummary; Write-Host (Join-Path $runRoot 'check-summary.json') }
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
exit $exitCode
