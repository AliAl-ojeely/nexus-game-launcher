# Verify both x86 and x64 backends exist outside app.asar.
param(
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$PackagedApp
)
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path $Root).Path
$items = @('tools/run_overlay_real_game.exe')
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
# Confirm the PyInstaller runtime starts without system Python.
$runnerExe = Join-Path $resolved 'tools/run_overlay_real_game.exe'
$runnerProc = Start-Process -FilePath $runnerExe -ArgumentList @('--help') -PassThru -WindowStyle Hidden
try {
    if (-not $runnerProc.WaitForExit(20000)) { throw 'Standalone overlay helper did not start within 20 seconds' }
    if ($runnerProc.ExitCode -ne 0) { throw "Standalone helper --help failed (exit $($runnerProc.ExitCode))" }
    Write-Host '[PASS] Frozen Python runner launches without system Python'
} finally {
    if (-not $runnerProc.HasExited) { Stop-Process -Id $runnerProc.Id -Force -ErrorAction SilentlyContinue }
}
if ($PackagedApp) {
    $exe = (Resolve-Path $PackagedApp).Path
    $asar = Join-Path (Split-Path $resolved -Parent) 'app.asar'
    if (-not (Test-Path $asar)) { throw 'Electron app.asar not found next to overlay resources' }
    # A deliberately invalid PID must exit with code 2 from the OSR helper,
    # proving the installed app routed to host.cjs rather than opening Nexus UI.
    $proc = Start-Process -FilePath $exe -ArgumentList @('--nexus-overlay-helper', '--pid', 'invalid') -PassThru -WindowStyle Hidden
    try {
        if (-not $proc.WaitForExit(20000)) { throw 'Installed Electron helper did not exit within 20 seconds' }
        if ($proc.ExitCode -ne 2) { throw "Electron helper route not verified (exit $($proc.ExitCode), expected 2)" }
        Write-Host '[PASS] Packaged Electron helper dispatch (invalid PID exits 2)'
    } finally {
        if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    }
}
Write-Host '[NEXUS CI] Overlay runtime package checks passed.'
