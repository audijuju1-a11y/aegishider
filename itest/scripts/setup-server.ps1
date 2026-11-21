#requires -Version 5.1
<#
.SYNOPSIS
    Prepare (or refresh) the dedicated Paper 1.21.4 integration-test server under
    D:\Aegishider\itest\server.

.DESCRIPTION
    - Ensures the Paper 1.21.4 jar and the full PacketEvents 2.14.0 plugin jar exist
      (copies from D:\Aegishider\.work\server when available, else from itest\.cache,
      else downloads them).
    - (Re)creates server.properties / eula.txt with the fixed test configuration:
      offline mode, port 25599, RCON 25598, flat world, view-distance 24
      (keeps the 336-block far-band scenario inside the send radius) and
      simulation-distance 4.
    - Recreates plugins/ with PacketEvents.jar and the plugin under test.
    - Wipes ONLY itest\server\world* and itest\server\logs (never the paper cache or
      the vanilla server cache, which make reboots fast).

    This script never touches D:\Aegishider\aegishider-integrated - plugin jars are
    copied, never modified.

.PARAMETER Jar
    Path of the plugin jar to install as plugins\Aegishider.jar.

.PARAMETER Baseline
    Install the snapshot of the legacy jar (itest\.cache\baseline-Aegishider.jar). The
    snapshot is created from the integrated target jar when it is missing.

.PARAMETER KeepWorld
    Do not wipe the world directories (default is to wipe them).

.PARAMETER RefreshBaseline
    Re-copy the legacy baseline snapshot from the integrated target jar.
#>
[CmdletBinding()]
param(
    [string]$Jar,
    [switch]$Baseline,
    [switch]$KeepWorld,
    [switch]$RefreshBaseline
)

$ErrorActionPreference = 'Stop'
$Itest = 'D:\Aegishider\itest'
$ServerDir = Join-Path $Itest 'server'
$CacheDir = Join-Path $Itest '.cache'
$PluginsDir = Join-Path $ServerDir 'plugins'
$WorkServer = 'D:\Aegishider\.work\server'
$IntegratedJar = 'D:\Aegishider\aegishider-integrated\target\Aegishider.jar'
if (-not (Test-Path -LiteralPath $IntegratedJar)) {
    $candidate = Get-ChildItem -LiteralPath (Split-Path -Parent $IntegratedJar) -Filter 'Aegishider-*.jar' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike 'original-*' } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($candidate) { $IntegratedJar = $candidate.FullName }
}
$BaselineJar = Join-Path $CacheDir 'baseline-Aegishider.jar'
$PaperJar = Join-Path $ServerDir 'paper-1.21.4.jar'
$PacketEventsJar = Join-Path $CacheDir 'PacketEvents-full.jar'
$PaperCache = Join-Path $CacheDir 'paper-1.21.4.jar'

function Test-Zip([string]$Path, [long]$MinSize = 1024) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $item = Get-Item -LiteralPath $Path
    if ($item.Length -lt $MinSize) { return $false }
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        try {
            $b1 = $fs.ReadByte(); $b2 = $fs.ReadByte()
            return ($b1 -eq 0x50 -and $b2 -eq 0x4B)   # 'PK'
        } finally { $fs.Dispose() }
    } catch { return $false }
}

function Copy-Asset([string]$From, [string]$To, [long]$MinSize = 1024) {
    if (-not (Test-Zip $From $MinSize)) { return $false }
    $toDir = Split-Path -Parent $To
    if (-not (Test-Path -LiteralPath $toDir)) { New-Item -ItemType Directory -Force -Path $toDir | Out-Null }
    if (Test-Path -LiteralPath $To) {
        $a = (Get-Item -LiteralPath $From)
        $b = (Get-Item -LiteralPath $To)
        if ($a.Length -eq $b.Length -and $a.LastWriteTimeUtc -le $b.LastWriteTimeUtc) {
            Write-Host "    reuse $(Split-Path -Leaf $To) ($($b.Length) bytes)"
            return $true
        }
    }
    Copy-Item -LiteralPath $From -Destination $To -Force
    Write-Host "    copied $(Split-Path -Leaf $To) <- $From ($((Get-Item -LiteralPath $To).Length) bytes)"
    return $true
}

function Download-File([string]$Url, [string]$Destination) {
    Write-Host "    downloading $Url"
    $tmp = "$Destination.part"
    Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    curl.exe -sS -L --fail --retry 3 -o $tmp $Url
    if ($LASTEXITCODE -ne 0) { throw "download failed ($LASTEXITCODE): $Url" }
    Move-Item -LiteralPath $tmp -Destination $Destination -Force
}

Write-Host '=== Aegishider iTest: server setup ==='

# --- sanity: everything we write stays inside D:\Aegishider\itest
foreach ($p in @($Itest, $ServerDir, $CacheDir, $PluginsDir)) {
    if (-not ([System.IO.Path]::GetFullPath($p).StartsWith('D:\Aegishider\itest', [System.StringComparison]::OrdinalIgnoreCase))) {
        throw "refusing to operate outside D:\Aegishider\itest: $p"
    }
}
New-Item -ItemType Directory -Force -Path $ServerDir, $CacheDir, $PluginsDir, (Join-Path $Itest 'out') | Out-Null

# --- clear stale harness bookkeeping (never kill, only tidy dead references) --
function Clear-StaleHarnessMarkers {
    $outDir = Join-Path $Itest 'out'
    $pidFile = Join-Path $outDir 'server.pid'
    if (Test-Path -LiteralPath $pidFile) {
        $proc = $null
        $info = $null
        try {
            $info = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
            if ($info.pid) { $proc = Get-Process -Id ([int]$info.pid) -ErrorAction SilentlyContinue }
        } catch { $proc = $null }
        if ($proc) {
            Write-Host "    note: out\server.pid references live PID $($info.pid) - NOT killed by setup (run-itest.ps1 owns teardown)"
        } else {
            Write-Host '    clearing stale out\server.pid'
            Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        }
    }
    $lockFile = Join-Path $outDir 'run.lock'
    if (Test-Path -LiteralPath $lockFile) {
        $lock = $null
        try { $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json } catch { $lock = $null }
        if ($lock -and $lock.pid -and (Get-Process -Id ([int]$lock.pid) -ErrorAction SilentlyContinue)) {
            if ([int]$lock.pid -eq $PID) {
                Write-Host '    out\run.lock is held by this harness run (ok)'
            } else {
                Write-Host "    note: out\run.lock is held by live PID $($lock.pid)"
            }
        } else {
            Write-Host '    clearing stale out\run.lock'
            Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
        }
    }
}
Clear-StaleHarnessMarkers

# --- Paper jar ---------------------------------------------------------------
Write-Host '[*] Paper 1.21.4 server jar'
$paperReady = $false
foreach ($candidate in @((Join-Path $WorkServer 'paper-1.21.4.jar'), $PaperCache)) {
    if (Copy-Asset $candidate $PaperJar 40000000) { $paperReady = $true; break }
}
if (-not $paperReady) {
    Write-Host '    no cached Paper jar - resolving via PaperMC v3 API'
    $latest = Invoke-RestMethod 'https://fill.papermc.io/v3/projects/paper/versions/1.21.4/builds/latest' -TimeoutSec 60
    $dl = $latest.downloads.'server:default'
    if (-not $dl -or -not $dl.url) { throw 'PaperMC v3 API did not return server:default download' }
    Download-File $dl.url $PaperJar
    if (-not (Test-Zip $PaperJar 40000000)) { throw 'downloaded Paper jar is not a valid jar' }
}
Write-Host "    paper jar: $PaperJar ($((Get-Item -LiteralPath $PaperJar).Length) bytes)"

# --- PacketEvents (full distribution jar, NOT the thin maven 'spigot' module) --
Write-Host '[*] PacketEvents 2.14.0 plugin jar'
$peReady = $false
foreach ($candidate in @((Join-Path $WorkServer 'PacketEvents.jar'), $PacketEventsJar)) {
    if (Copy-Asset $candidate $PacketEventsJar 4000000) { $peReady = $true; break }
}
if (-not $peReady) {
    $url = 'https://github.com/retrooper/packetevents/releases/download/v2.14.0/packetevents-spigot-2.14.0.jar'
    Download-File $url $PacketEventsJar
    if (-not (Test-Zip $PacketEventsJar 4000000)) { throw 'downloaded PacketEvents jar is not the full distribution jar' }
}
# Keep the copy under server\plugins in sync when plugins/ is recreated below.
$peSource = $PacketEventsJar

# --- baseline snapshot (legacy jar, read-only source) -----------------------
if ($RefreshBaseline -or -not (Test-Zip $BaselineJar 10000)) {
    if (Test-Path -LiteralPath $IntegratedJar) {
        if (Test-Zip $IntegratedJar 10000) {
            Copy-Item -LiteralPath $IntegratedJar -Destination $BaselineJar -Force
            Write-Host "    baseline snapshot refreshed from $IntegratedJar"
        } else {
            Write-Warning "integrated jar is not a valid jar yet: $IntegratedJar"
        }
    } elseif (-not (Test-Path -LiteralPath $BaselineJar)) {
        Write-Warning "no baseline jar available (neither $IntegratedJar nor $BaselineJar)"
    }
}

# --- resolve plugin under test ---------------------------------------------
if ($Baseline) {
    if (-not (Test-Zip $BaselineJar 10000)) { throw "baseline jar missing: $BaselineJar (run with -RefreshBaseline once the integrated jar exists)" }
    $Jar = $BaselineJar
}
if (-not $Jar) {
    if (Test-Zip $IntegratedJar 10000) { $Jar = $IntegratedJar }
    elseif (Test-Zip $BaselineJar 10000) { $Jar = $BaselineJar }
    else { throw 'no plugin jar: pass -Jar <path>' }
}
$Jar = [System.IO.Path]::GetFullPath($Jar)
if (-not (Test-Zip $Jar 1000)) { throw "plugin jar is missing or not a valid jar: $Jar" }
Write-Host "[*] plugin under test: $Jar ($((Get-Item -LiteralPath $Jar).Length) bytes)"
$jarHash = (Get-FileHash -LiteralPath $Jar -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "    sha256: $jarHash"

# --- recreate plugins dir ---------------------------------------------------
if (Test-Path -LiteralPath $PluginsDir) {
    try {
        Remove-Item -LiteralPath $PluginsDir -Recurse -Force -ErrorAction Stop
    } catch {
        throw "cannot recreate plugins dir (is a Paper server still running from itest\server?): $($_.Exception.Message)"
    }
}
New-Item -ItemType Directory -Force -Path $PluginsDir | Out-Null
Copy-Item -LiteralPath $peSource -Destination (Join-Path $PluginsDir 'PacketEvents.jar') -Force
Copy-Item -LiteralPath $Jar -Destination (Join-Path $PluginsDir 'Aegishider.jar') -Force
# The shipped jar enforces licence activation; the packet harness is a local test
# environment and opts out explicitly so it can exercise protection.
$platformDir = Join-Path $PluginsDir 'Aegishider\platform'
New-Item -ItemType Directory -Force -Path $platformDir | Out-Null
@(
    'enabled: false',
    'api-base-url: ""',
    'product: aegishider',
    'enforcement: warn',
    'telemetry:',
    '  enabled: false'
) | Set-Content -LiteralPath (Join-Path $platformDir 'platform.yml') -Encoding ascii
Write-Host "    plugins/: PacketEvents.jar ($((Get-Item -LiteralPath (Join-Path $PluginsDir 'PacketEvents.jar')).Length) bytes), Aegishider.jar ($((Get-Item -LiteralPath (Join-Path $PluginsDir 'Aegishider.jar')).Length) bytes), licence gate disabled for harness"

# --- wipe world (only inside itest\server) ---------------------------------
if (-not $KeepWorld) {
    Get-ChildItem -LiteralPath $ServerDir -Directory -Force |
        Where-Object { $_.Name -match '^(world|world_nether|world_the_end)$' } |
        ForEach-Object {
            Write-Host "    wiping world dir $($_.FullName)"
            try {
                Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
            } catch {
                throw "cannot wipe world dir $($_.FullName) (is a server still running?): $($_.Exception.Message)"
            }
        }
    foreach ($f in @('usercache.json', 'usernamecache.json', 'banned-players.json', 'banned-ips.json', 'whitelist.json')) {
        Remove-Item -LiteralPath (Join-Path $ServerDir $f) -ErrorAction SilentlyContinue
    }
}
foreach ($dir in @('logs', 'crash-reports')) {
    $p = Join-Path $ServerDir $dir
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
}
Get-ChildItem -LiteralPath $ServerDir -Filter '*.log' -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# --- server.properties / eula ----------------------------------------------
$properties = @"
# Generated by itest/scripts/setup-server.ps1 - do not edit by hand; the harness rewrites it.
server-port=25599
server-ip=127.0.0.1
motd=Aegishider iTest
online-mode=false
enforce-secure-profile=false
network-compression-threshold=-1
max-players=12
# view-distance=24 keeps the three-gap benchmark's 336-block band (chunk 21)
# comfortably inside the send radius instead of on its edge, which made the
# far-chunk assertion flaky. simulation-distance stays low (only ticking radius).
# The capture bot advertises client view-distance 32 so the server does not
# shrink its send radius.
view-distance=24
simulation-distance=4
spawn-protection=0
enable-command-block=false
enable-rcon=true
rcon.port=25598
rcon.password=itest-rcon-pass
broadcast-rcon-to-ops=false
allow-nether=false
allow-end=false
level-name=world
level-seed=123456789
level-type=minecraft\:flat
generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:dirt","height":2},{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains"}
generate-structures=false
difficulty=peaceful
gamemode=creative
force-gamemode=true
# Scenario G summons a zombie, and Paper removes Monster entities immediately in
# a world with spawn-monsters=false. difficulty=peaceful keeps natural monsters
# from spawning in every other scenario.
spawn-monsters=true
spawn-animals=false
spawn-npcs=false
pvp=false
allow-flight=true
white-list=false
sync-chunk-writes=false
max-world-size=29999984
player-idle-timeout=0
op-permission-level=4
function-permission-level=4
entity-broadcast-range-percentage=100
"@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $ServerDir 'server.properties'), $properties, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $ServerDir 'eula.txt'), "eula=true`n", $utf8NoBom)
Write-Host '    wrote server.properties + eula.txt'

# --- summary ---------------------------------------------------------------
$info = [ordered]@{
    serverDir     = $ServerDir
    paperJar      = $PaperJar
    packetEvents  = (Join-Path $PluginsDir 'PacketEvents.jar')
    pluginJar     = (Join-Path $PluginsDir 'Aegishider.jar')
    pluginSource  = $Jar
    pluginSha256  = $jarHash
    baselineJar   = $BaselineJar
    worldWiped    = (-not $KeepWorld)
}
$info | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Itest 'out\setup-info.json') -Encoding utf8
Write-Host '=== setup OK ==='
$info | ConvertTo-Json -Depth 4
