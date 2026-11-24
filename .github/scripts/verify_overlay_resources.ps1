# Verify both x86 and x64 backends exist outside app.asar.
param(
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$PackagedApp
)
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path $Root).Path
$items = @('tools/run_overlay_real_game.exe','native/nexus-overlay/build/bin/NexusProcessProbe.exe')
foreach ($arch in @('build','build-x86')) {
    foreach ($name in @('NexusOverlayHook.dll','NexusOverlayInjector.exe','NexusOpenGLHook.dll','NexusD3D9Hook.dll')) {
        $items += "native/nexus-overlay/$arch/bin/$name"
    }
}
foreach ($item in $items) {
    $file = Join-Path $resolved $item
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing packaged overlay file: $item" }
    if ((Get-Item -LiteralPath $file).Length -lt 1024) { throw "Invalid/empty overlay file: $item" }
    Write-Host "[PASS] $item"
}
# Own the .NET process directly. Windows PowerShell Start-Process with
# redirected streams can return a process object whose ExitCode is unavailable.
# Drain both pipes concurrently; never assume a missing exit code means zero.
function Invoke-CapturedSmoke([string]$File, [string[]]$Arguments = @()) {
    # All smoke-test arguments are fixed, single tokens. FileName is separate
    # so executable paths containing spaces are safe without manual quoting.
    foreach ($argument in $Arguments) {
        if ([string]::IsNullOrEmpty($argument) -or $argument -match '[\s"]') {
            throw 'Smoke test argument is not a nonempty single token'
        }
    }
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = ($Arguments -join ' ')
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $info.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $child = New-Object System.Diagnostics.Process
    $child.StartInfo = $info
    $started = $false
    try {
        $started = $child.Start()
        if (-not $started) { throw "Could not start smoke executable: $File" }
        # Keep the process handle alive, including for very short-lived probes.
        $null = $child.Handle
        $stdoutTask = $child.StandardOutput.ReadToEndAsync()
        $stderrTask = $child.StandardError.ReadToEndAsync()
        if (-not $child.WaitForExit(20000)) { throw "Packaged runtime smoke test timed out: $File" }
        $tasks = [System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask)
        if (-not [System.Threading.Tasks.Task]::WaitAll($tasks, 5000)) {
            throw "Packaged runtime output did not close: $File"
        }
        $code = $child.ExitCode
        if ($null -eq $code) { throw "Packaged runtime exit code unavailable: $File" }
        [pscustomobject]@{ Code = [int]$code; Stdout = $stdoutTask.Result; Stderr = $stderrTask.Result }
    } finally {
        try {
            if ($started -and -not $child.HasExited) {
                $child.Kill()
                $null = $child.WaitForExit(5000)
            }
        } finally {
            $child.Dispose()
        }
    }
}
# Confirm the PyInstaller runtime starts without system Python.
$runnerExe = Join-Path $resolved 'tools/run_overlay_real_game.exe'
$helpResult = Invoke-CapturedSmoke -File $runnerExe -Arguments @('--help')
if ($helpResult.Code -ne 0 -or $helpResult.Stdout -notmatch '--managed-session-id') {
    throw "Standalone helper --help failed (exit $($helpResult.Code))"
}
Write-Host '[PASS] Frozen Python runner launches without system Python'
# Only the current PowerShell PID is required in the read-only snapshot.
$probeExe = Join-Path $resolved 'native/nexus-overlay/build/bin/NexusProcessProbe.exe'
$probeResult = Invoke-CapturedSmoke -File $probeExe
if ($probeResult.Code -ne 0) { throw "Native process probe failed (exit $($probeResult.Code)): $($probeResult.Stderr)" }
$rows = @($probeResult.Stdout | ConvertFrom-Json)
if (@($rows | Where-Object { $_.pid -eq $PID -and $_.path }).Count -eq 0) {
    throw 'Native process probe did not return the current PowerShell PID and executable path'
}
Write-Host '[PASS] Packaged x64 native process probe executes and returns a usable snapshot'
# Reject PID zero before any process access. A malformed CLI can also exit 2;
# require the specific validation message rather than merely the exit code.
$cli = Invoke-CapturedSmoke -File $runnerExe -Arguments @('--pid','0','--exe','C:\NexusSmokeTest\invalid.exe','--overlay-shortcut','Ctrl+F1','--quick-escape','--quick-start','--disable-overlay-keyboard-nav','--disable-overlay-gamepad-nav','--managed','--managed-game-id','smoke','--managed-session-id','smoke','--managed-actions-pipe','smoke','--managed-actions-token','smoke','--library','C:\NexusSmokeTest\games.json','--session-file','C:\NexusSmokeTest\session.json')
if ($cli.Code -ne 2 -or $cli.Stderr -notmatch 'PID must be a positive Windows DWORD' -or $cli.Stderr -match 'unrecognized arguments') {
    throw 'Frozen runner managed CLI parsing not verified'
}
Write-Host '[PASS] Frozen runner managed CLI parses all options and safely rejects PID zero'

if ($PackagedApp) {
    $exe = (Resolve-Path $PackagedApp).Path
    $asar = Join-Path (Split-Path $resolved -Parent) 'app.asar'
    if (-not (Test-Path $asar)) { throw 'Electron app.asar not found next to overlay resources' }
    # A deliberately invalid PID must exit with code 2 from the OSR helper,
    # proving the installed app routed to host.cjs rather than opening Nexus UI.
    $hostResult = Invoke-CapturedSmoke -File $exe -Arguments @('--nexus-overlay-helper', '--pid', 'invalid')
    if ($hostResult.Code -ne 2) { throw "Electron helper route not verified (exit $($hostResult.Code), expected 2)" }
    Write-Host '[PASS] Packaged Electron helper dispatch (invalid PID exits 2)'
}
Write-Host '[NEXUS CI] Overlay runtime package checks passed.'
