#requires -Version 5.1
<#
.SYNOPSIS
    One-command end-to-end integration test for the Aegishider Paper 1.21.4 plugin.

.DESCRIPTION
    Reproducible harness, safe to re-run:

      1. kills only harness-owned leftovers (its own Paper server / capture bots,
         identified by command line, never foreign processes)
      2. (re)builds itest\server: fresh server.properties/eula/plugins and a wiped
         world; copies - never modifies - the plugin jar
      3. boots Paper 1.21.4 on port 25599 (offline, flat, RCON 25598)
      4. connects TestBot + TestBot2 (headless minecraft-protocol clients), records
         every received packet as NDJSON
      5. runs scenarios A (hidden item), B (visible item), C (chunk-level chest
         hiding with palette-decoded chunk data), D (chest block-entity leak at
         160/336 blocks), E (client block-entity registry / pie-ray scan),
         F (Bobby/Distant Horizons cache replay), G (vertical entity band:
         a y=-50 base and a y=64 surface stay mutually invisible for players,
         monsters and animals, including the 24..96 block viewer-join sweep), and
         H (base-marker block states/entities plus plain BOOKSHELF, with a sign
         control and no beacon beam source), and I (indexed plain BOOKSHELF
         reveal/re-hide) over RCON-created fixtures
      6. writes out\report-<timestamp>.json and prints a PASS/FAIL summary
      7. always tears the server down and verifies the ports are free

.PARAMETER Jar
    Plugin jar to test. Defaults to the newest Aegishider-*.jar in
    D:\Aegishider\aegishider-integrated\target (falling back to Aegishider.jar
    or the cached baseline snapshot).

.PARAMETER Baseline
    Run the legacy baseline jar instead (a snapshot of the integrated target jar
    taken the first time the harness ran). In baseline mode the harness EXPECTS
    scenario A and scenario C to LEAK; that validates the detector itself.

.PARAMETER ProtectionDisabled
    Run the selected jar as a leak control with world protection switched off for
    the run: the driver sets every worlds.<name>.enabled to false in
    server\plugins\Aegishider\config.yml and restores the original file afterwards
    (also when boot or a scenario fails, and on SIGINT/SIGTERM). Leaks are
    EXPECTED -> PASS proves the detectors still see the real information. Use it
    with -Jar to pick the build under test.

.PARAMETER KeepServer
    Leave the Paper server running after the run (debugging only; ports stay busy).

.PARAMETER SkipSetup
    Reuse the existing server directory (keeps world/state); still validated.

.PARAMETER BootTimeoutSec
    Boot timeout, default 240 s (first ever boot downloads the vanilla server jar).

.PARAMETER ForceCleanup
    Kill a stale/hung harness driver (scenario-driver.js) before starting. Without
    this switch a second simultaneous run is refused with a clear message, because
    both runs would share the fixed test ports.

.EXAMPLE
    pwsh -File D:\Aegishider\itest\run-itest.ps1 -Baseline
    pwsh -File D:\Aegishider\itest\run-itest.ps1 -Jar D:\Aegishider\aegishider-integrated\target\Aegishider.jar
    pwsh -File D:\Aegishider\itest\run-itest.ps1 -ProtectionDisabled -Scenarios 'A,C'
#>
[CmdletBinding()]
param(
    [string]$Jar,
    [switch]$Baseline,
    [switch]$ProtectionDisabled,
    [switch]$KeepServer,
    [switch]$SkipSetup,
    [switch]$ForceCleanup,
    [string]$Scenarios,
    [int]$BootTimeoutSec = 240
)

$ErrorActionPreference = 'Stop'
$Itest = 'D:\Aegishider\itest'
$ServerDir = Join-Path $Itest 'server'
$BotDir = Join-Path $Itest 'bot'
$OutDir = Join-Path $Itest 'out'
$CacheDir = Join-Path $Itest '.cache'
$IntegratedJar = 'D:\Aegishider\aegishider-integrated\target\Aegishider.jar'
if (-not (Test-Path -LiteralPath $IntegratedJar)) {
    $candidate = Get-ChildItem -LiteralPath (Split-Path -Parent $IntegratedJar) -Filter 'Aegishider-*.jar' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike 'original-*' } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($candidate) { $IntegratedJar = $candidate.FullName }
}
$BaselineJar = Join-Path $CacheDir 'baseline-Aegishider.jar'
$Driver = Join-Path $BotDir 'scenario-driver.js'
$ServerPort = 25599
$RconPort = 25598

# --- environment (each pwsh invocation is a fresh process) -------------------
$JdkHome = 'C:\Users\audim_r0h5i\.jdks\jdk-21.0.13+9'
if (-not (Test-Path -LiteralPath (Join-Path $JdkHome 'bin\java.exe'))) {
    throw "JDK 21 not found at $JdkHome"
}
$env:JAVA_HOME = $JdkHome
$env:PATH = (Join-Path $JdkHome 'bin') + ';' + $env:PATH

$NodeCandidates = @(
    $env:ITEST_NODE,
    'C:\Users\audim_r0h5i\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
) | Where-Object { $_ }
$Node = $null
foreach ($candidate in $NodeCandidates) {
    if (Test-Path -LiteralPath $candidate) { $Node = $candidate; break }
}
if (-not $Node) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $Node = $cmd.Source }
}
if (-not $Node) { throw 'Node.js not found: set $env:ITEST_NODE to the bundled node.exe path' }
New-Item -ItemType Directory -Force -Path $OutDir, $CacheDir | Out-Null

function Test-PortBusy([int]$Port) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(400)
        if ($ok) { $c.EndConnect($iar) }
        $c.Close()
        return $ok
    } catch { return $false }
}

function Get-PortOwners([int]$Port) {
    $owners = @()
    try {
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" -ErrorAction SilentlyContinue
            $owners += [pscustomobject]@{ Pid = $_.OwningProcess; CommandLine = if ($proc) { $proc.CommandLine } else { '' } }
        }
    } catch { }
    return $owners
}

function Test-IsHarnessProcess([string]$CommandLine, [int]$ProcessId = 0) {
    $pidFromFile = Get-HarnessServerPid
    if ($ProcessId -gt 0 -and $pidFromFile -and $ProcessId -eq $pidFromFile) { return $true }
    if (-not $CommandLine) { return $false }
    $cl = $CommandLine.ToLowerInvariant()
    return ($cl.Contains('d:\aegishider\itest\server') -or $cl.Contains('itest\server\paper-1.21.4.jar') -or
            $cl.Contains('d:\aegishider\itest\bot') -or $cl.Contains('itest\bot\capture-bot.js') -or
            $cl.Contains('scenario-driver.js'))
}

function Get-HarnessServerPid {
    $pidFile = Join-Path $OutDir 'server.pid'
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    try {
        $info = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        $processId = [int]$info.pid
        if ($processId -gt 0 -and (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
            return $processId
        }
    } catch { }
    # Stale/corrupt pid file: the recorded process is gone - clean it up and pretend unset.
    Write-Host "[cleanup] removing stale out\server.pid (process no longer exists)"
    Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue
    return $null
}

function Remove-StalePidFile {
    [void](Get-HarnessServerPid)
    $lockFile = Join-Path $OutDir 'run.lock'
    if (Test-Path -LiteralPath $lockFile) {
        try {
            $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
            if (-not ($lock.pid -and (Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue))) {
                Write-Host '[cleanup] removing stale out\run.lock (owner no longer exists)'
                Remove-Item -LiteralPath $lockFile -ErrorAction SilentlyContinue
            }
        } catch {
            Remove-Item -LiteralPath $lockFile -ErrorAction SilentlyContinue
        }
    }
}

# Tolerant process kill: a PID can die between discovery and taskkill, which must
# never abort the run (this was the "The process ... not found" failure mode).
function Stop-ProcessTolerant([int]$ProcessId, [string]$What = 'harness process') {
    if (-not $ProcessId) { return }
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        Write-Host "[cleanup] $What PID $ProcessId already exited (stale pid, nothing to do)"
        return
    }
    try {
        $output = & taskkill.exe /PID $ProcessId /T /F 2>&1
        $code = $LASTEXITCODE
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            Write-Host "[cleanup] killed $What PID $ProcessId"
            return
        }
        Write-Warning "could not kill $What PID $ProcessId (taskkill exit $code): $(@($output) -join ' ')"
    } catch {
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            Write-Host "[cleanup] $What PID $ProcessId exited during cleanup"
        } else {
            Write-Warning "cleanup kill of $What PID $ProcessId failed: $($_.Exception.Message)"
        }
    }
}

function Find-LiveHarnessDrivers {
    $list = @()
    foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)) {
        if ($proc.ProcessId -eq $PID) { continue }
        if ($proc.CommandLine -and $proc.CommandLine.Contains('scenario-driver.js')) { $list += $proc }
    }
    return $list
}

# Two harness runs cannot share ports 25598/25599: the second run would kill the
# first one's server as a "leftover". Detect that up-front and refuse loudly
# instead of corrupting both runs' results.
function Assert-NoConcurrentRun {
    $live = @(Find-LiveHarnessDrivers)
    if ($live.Count -gt 0 -and $ForceCleanup) {
        foreach ($proc in $live) {
            Write-Host "[cleanup] -ForceCleanup: killing live/stale harness driver PID $($proc.ProcessId)"
            Stop-ProcessTolerant $proc.ProcessId 'harness driver'
        }
        Start-Sleep -Seconds 2
        $live = @(Find-LiveHarnessDrivers)
    }
    if ($live.Count -gt 0) {
        throw ("another harness run is already in progress (node PID $($live[0].ProcessId) running scenario-driver.js). " +
               "Both runs use the fixed test ports 25598/25599, so they cannot overlap. Wait for it to finish, " +
               "or re-run with -ForceCleanup if that process is a stale hung run.")
    }
}

function Enter-RunLock {
    $lockFile = Join-Path $OutDir 'run.lock'
    if (Test-Path -LiteralPath $lockFile) {
        $lock = $null
        try { $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json } catch { }
        if ($lock -and $lock.pid -and (Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue)) {
            throw ("another harness run is already in progress (lock owner PID $($lock.pid), started $($lock.startedAt)); " +
                   "refusing to start a second run on the same ports.")
        }
        Write-Host '[cleanup] removing stale out\run.lock'
        Remove-Item -LiteralPath $lockFile -ErrorAction SilentlyContinue
    }
    @{ pid = $PID; startedAt = (Get-Date).ToString('o'); jar = $Jar } | ConvertTo-Json | Set-Content -LiteralPath $lockFile -Encoding utf8
}

function Exit-RunLock {
    $lockFile = Join-Path $OutDir 'run.lock'
    if (-not (Test-Path -LiteralPath $lockFile)) { return }
    try {
        $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
        if ([int]$lock.pid -eq $PID) { Remove-Item -LiteralPath $lockFile -ErrorAction SilentlyContinue }
    } catch {
        Remove-Item -LiteralPath $lockFile -ErrorAction SilentlyContinue
    }
}

function Stop-HarnessLeftovers {
    Remove-StalePidFile
    # 1) anything listening on our two ports that belongs to this harness
    foreach ($port in @($ServerPort, $RconPort)) {
        foreach ($owner in @(Get-PortOwners $port)) {
            if (Test-IsHarnessProcess $owner.CommandLine $owner.Pid) {
                Write-Host "[cleanup] killing leftover harness process PID $($owner.Pid) on port $port"
                Stop-ProcessTolerant $owner.Pid 'harness port owner'
            } else {
                throw "port $port is in use by a process that does not belong to this harness (PID $($owner.Pid): $($owner.CommandLine)). Refusing to kill it; stop it manually and re-run."
            }
        }
    }
    # 2) orphaned Paper servers / bots / drivers started from itest
    $harnessServerPid = Get-HarnessServerPid
    foreach ($proc in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        if ($proc.ProcessId -eq $PID) { continue }
        $cl = $proc.CommandLine
        if (-not $cl) { continue }
        $clLower = $cl.ToLowerInvariant()
        if ($proc.Name -eq 'java.exe' -and (($harnessServerPid -and $proc.ProcessId -eq $harnessServerPid) -or $clLower.Contains('itest\server\paper-1.21.4.jar'))) {
            Write-Host "[cleanup] killing leftover Paper server PID $($proc.ProcessId)"
            Stop-ProcessTolerant $proc.ProcessId 'Paper server'
        } elseif ($proc.Name -in @('node.exe', 'pwsh.exe') -and ($clLower.Contains('capture-bot.js') -or $clLower.Contains('scenario-driver.js'))) {
            Write-Host "[cleanup] killing leftover harness helper PID $($proc.ProcessId)"
            Stop-ProcessTolerant $proc.ProcessId 'harness helper'
        }
    }
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-PortBusy $ServerPort) -and -not (Test-PortBusy $RconPort)) { break }
        Start-Sleep -Milliseconds 250
    }
    foreach ($port in @($ServerPort, $RconPort)) {
        if (Test-PortBusy $port) { throw "port $port is still in use after cleanup" }
    }
    Remove-Item -LiteralPath (Join-Path $OutDir 'server.pid') -ErrorAction SilentlyContinue
    Write-Host "[cleanup] ports $ServerPort and $RconPort are free"
}

function Resolve-PluginJar {
    if ($Baseline) {
        if (Test-Path -LiteralPath $BaselineJar) { return $BaselineJar }
        if (Test-Path -LiteralPath $IntegratedJar) {
            New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
            Copy-Item -LiteralPath $IntegratedJar -Destination $BaselineJar -Force
            return $BaselineJar
        }
        throw "-Baseline requested but no baseline jar exists (neither $BaselineJar nor $IntegratedJar)"
    }
    if ($Jar) {
        $resolved = [System.IO.Path]::GetFullPath($Jar)
        if (-not (Test-Path -LiteralPath $resolved)) { throw "plugin jar not found: $resolved" }
        return $resolved
    }
    if (Test-Path -LiteralPath $IntegratedJar) {
        if (-not (Test-Path -LiteralPath $BaselineJar)) {
            New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
            Copy-Item -LiteralPath $IntegratedJar -Destination $BaselineJar -Force
        }
        return $IntegratedJar
    }
    if (Test-Path -LiteralPath $BaselineJar) { return $BaselineJar }
    throw "no plugin jar available: build $IntegratedJar or pass -Jar <path>"
}

$exitCode = 2
$started = Get-Date
$lockAcquired = $false
Write-Host ''
Write-Host '################################################################'
Write-Host '#  Aegishider Paper 1.21.4 end-to-end integration test harness  #'
Write-Host '################################################################'
Write-Host "  jar arg      : $(if ($Jar) { $Jar } else { '(default)' })"
Write-Host "  baseline mode: $([bool]$Baseline)"
Write-Host "  protection off: $([bool]$ProtectionDisabled)"
Write-Host "  node         : $Node"
Write-Host "  java         : $JdkHome"
Write-Host ''

try {
    Assert-NoConcurrentRun
    Enter-RunLock
    $lockAcquired = $true
    Stop-HarnessLeftovers
    # Never show a stale report from a previous run if this run dies early.
    Remove-Item -LiteralPath (Join-Path $OutDir 'latest-report.json') -ErrorAction SilentlyContinue

    $pluginJar = Resolve-PluginJar
    Write-Host "[setup] plugin jar: $pluginJar"
    if (-not $Baseline -and $pluginJar -eq $BaselineJar) { $Baseline = $true }
    if (-not $SkipSetup) {
        $setupArgs = @{ Jar = $pluginJar }
        if ($Baseline) { $setupArgs['Baseline'] = $true }
        & (Join-Path $Itest 'scripts\setup-server.ps1') @setupArgs
        if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "setup-server.ps1 failed with exit code $LASTEXITCODE" }
    } else {
        Write-Host '[setup] -SkipSetup: reusing existing server directory'
    }

    if (-not (Test-Path -LiteralPath $Driver)) { throw "scenario driver missing: $Driver" }
    $driverArgs = @($Driver, '--jar', $pluginJar, '--boot-timeout-ms', [string]($BootTimeoutSec * 1000))
    if ($Baseline) { $driverArgs += '--baseline' }
    if ($ProtectionDisabled) { $driverArgs += '--protection-disabled' }
    if ($KeepServer) { $driverArgs += '--keep-server' }
    if ($Scenarios) { $driverArgs += @('--scenarios', $Scenarios) }
    Write-Host "[run] node $($driverArgs -join ' ')"
    Write-Host ''
    & $Node @driverArgs
    $driverExit = $LASTEXITCODE
    if ($null -eq $driverExit) { $driverExit = 1 }
    $exitCode = $driverExit
} catch {
    Write-Host ''
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 2
} finally {
    # Only clean up when this run actually owns the harness lock. A second run
    # that was refused due to concurrency must never touch the active run's server.
    if ($lockAcquired -and -not $KeepServer) {
        try { Stop-HarnessLeftovers } catch { Write-Warning "final cleanup: $($_.Exception.Message)" }
    }
    if ($lockAcquired) { Exit-RunLock }
    if ($lockAcquired -and -not $KeepServer -and (Test-PortBusy $ServerPort)) { $exitCode = 2 }
}

$report = Join-Path $OutDir 'latest-report.json'
$elapsed = (Get-Date) - $started
$duration = [int]$elapsed.TotalSeconds
Write-Host ''
Write-Host '################################################################'
if ($exitCode -eq 0) {
    Write-Host "#  RESULT: PASS  ($duration s)" -ForegroundColor Green
    if ($Baseline) { Write-Host '#  (baseline mode: expected item/chest leaks were detected - harness validated)' }
    if ($ProtectionDisabled) { Write-Host '#  (protection disabled: expected leaks were detected - detector validated, config restored)' }
} elseif ($exitCode -eq 1) {
    Write-Host "#  RESULT: FAIL  ($duration s) - scenario expectation not met" -ForegroundColor Red
} else {
    Write-Host "#  RESULT: ERROR ($duration s) - harness/server/fixture problem" -ForegroundColor Yellow
}
if (Test-Path -LiteralPath $report) {
    $rep = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
    if ($null -ne $rep.plugin) {
        Write-Host "#  plugin : $([System.IO.Path]::GetFileName($rep.plugin.jarPath)) sha256=$($rep.plugin.sha256.Substring(0, 16))..."
    }
    Write-Host "#  report : $($rep.artifacts.reportPath)"
    if ($rep.server -and $rep.server.logPath) { Write-Host "#  server : $($rep.server.logPath)" }
    if ($rep.artifacts -and $rep.artifacts.captures) {
        foreach ($p in $rep.artifacts.captures.PSObject.Properties) {
            Write-Host "#  capture: $($p.Name) -> $($p.Value)"
        }
    }
    foreach ($sc in @('A', 'B', 'C', 'D', 'E', 'F')) {
        $r = $rep.scenarios.$sc
        if (-not $r) { continue }
        $state = if ($r.pass) { 'PASS' } elseif ($r.outcome -in @('ERROR', 'INCONCLUSIVE')) { 'ERROR' } else { 'FAIL' }
        Write-Host "#  scenario ${sc}: $state (expected $($r.expectation), observed $($r.outcome))"
    }
    if ($rep.errors -and @($rep.errors).Count -gt 0) {
        Write-Host '#  harness errors:'
        foreach ($e in @($rep.errors)) { Write-Host "#    - $e" }
    }
} else {
    Write-Host '#  no report file was written'
}
Write-Host '################################################################'
exit $exitCode
