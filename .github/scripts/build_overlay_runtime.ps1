# Build the x64 and Win32 overlay backends and a standalone Python helper.
# This script never enables the quarantined D3D12 hook or targets protected games.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location $root

function Invoke-Checked([string]$title, [scriptblock]$script) {
    Write-Host "[NEXUS CI] $title"
    & $script
    if ($LASTEXITCODE -ne 0) { throw "$title failed (exit $LASTEXITCODE)" }
}

$source = 'native/nexus-overlay'
$targets = @('NexusOverlayHook', 'NexusOverlayInjector', 'NexusOpenGLHook', 'NexusD3D9Hook')
foreach ($arch in @('x64', 'Win32')) {
    $buildDir = if ($arch -eq 'x64') { 'native/nexus-overlay/build' } else { 'native/nexus-overlay/build-x86' }
    Invoke-Checked "Configure native $arch" { cmake -S $source -B $buildDir -G 'Visual Studio 17 2022' -A $arch }
    Invoke-Checked "Compile native $arch" { cmake --build $buildDir --config Release --target $targets --parallel 4 }
}

Invoke-Checked 'Install standalone-helper packager' { python -m pip install --disable-pip-version-check 'pyinstaller>=6,<7' }
Invoke-Checked 'Build standalone overlay runner' {
    python -m PyInstaller --noconfirm --clean --onefile --console --name run_overlay_real_game --paths tools --hidden-import nexus_input_bridge --distpath build/pyinstaller-dist --workpath build/pyinstaller-work --specpath build/pyinstaller-work tools/run_overlay_real_game.py
}

$stage = Join-Path $root 'build/overlay-runtime'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'tools') -Force | Out-Null
Copy-Item 'build/pyinstaller-dist/run_overlay_real_game.exe' (Join-Path $stage 'tools/run_overlay_real_game.exe') -Force
foreach ($entry in @(@('x64','build'),@('x86','build-x86'))) {
    $folder = $entry[1]
    $destination = Join-Path $stage "native/nexus-overlay/$folder/bin"
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($name in @('NexusOverlayHook.dll','NexusOverlayInjector.exe','NexusOpenGLHook.dll','NexusD3D9Hook.dll')) {
        $sourceFile = Join-Path $root "native/nexus-overlay/$folder/bin/$name"
        if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) { throw "Missing compiled native artifact: $sourceFile" }
        Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $destination $name) -Force
    }
}
Write-Host '[NEXUS CI] Standalone overlay runtime staged.'
