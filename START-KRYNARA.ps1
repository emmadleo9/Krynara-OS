$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runtime = Join-Path $env:LOCALAPPDATA 'Krynara-OS\runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null

# --- Free the required ports (2785, 2786, 2787, 5173) -------------------------------
# Uses PowerShell-native checks only (Get-NetTCPConnection), never findstr/netstat,
# so a FREE port can never look like a failed command in the VS Code terminal.
foreach ($port in @(2785, 2786, 2787, 5173)) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        $killedPids = @()
        foreach ($connection in $connections) {
            $owningPid = $connection.OwningProcess
            if ($owningPid -and $owningPid -ne $PID -and $killedPids -notcontains $owningPid) {
                $killedPids += $owningPid
                Stop-Process -Id $owningPid -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Seconds 1
        Write-Host "[Krynara-OS] Port $port was busy, killed old process, now free" -ForegroundColor Yellow
    } else {
        Write-Host "[Krynara-OS] Port $port is FREE - ready" -ForegroundColor Green
    }
}

# --- Prerequisites -----------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required. Install Node.js (>=22.19), then run MASTER START Krynara-OS V.04.bat again.'
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw 'npm.cmd was not found. Repair the Node.js installation and try again.'
}

$nodeVersionText = (& node --version).Trim().TrimStart('v')
try {
    $nodeVersion = [version]$nodeVersionText
} catch {
    throw "Could not read the installed Node.js version: $nodeVersionText"
}
if ($nodeVersion -lt [version]'22.19') {
    throw "Node.js 22.19 or newer is required; found $nodeVersionText."
}

# --- Install dependencies if missing -----------------------------------------
foreach ($directory in @('gateway', 'console')) {
    $project = Join-Path $root $directory
    $modules = Join-Path $project 'node_modules'
    if (-not (Test-Path $modules)) {
        Write-Host "[Krynara-OS] Installing missing $directory dependencies..."
        Push-Location $project
        try {
            & npm.cmd ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) {
                throw "Dependency installation failed for $directory (exit $LASTEXITCODE)."
            }
        } finally {
            Pop-Location
        }
    }
}

# --- Build OpenWA if needed --------------------------------------------------
$gatewayDir = Join-Path $root 'gateway'
$openwaMain = Join-Path $gatewayDir 'dist\main.js'
if (-not (Test-Path -LiteralPath $openwaMain)) {
    Write-Host '[Krynara-OS] Building OpenWA gateway...'
    Push-Location $gatewayDir
    try {
        & npm.cmd run build --silent
        if ($LASTEXITCODE -ne 0) {
            throw 'OpenWA build failed.'
        }
    } finally {
        Pop-Location
    }
}

# --- Start the coordinator launcher ------------------------------------------
$launcher = Join-Path $root 'scripts\start-singularity.js'
Write-Host '[Krynara-OS] Starting the gateway first, then waiting for its API health check before starting the console.'
& node $launcher
if ($LASTEXITCODE -ne 0) {
    throw "KRYNARA master startup failed (exit $LASTEXITCODE). Check the error above and verify ports 2785 and 5173."
}

Write-Host '[Krynara-OS] Startup complete.'
Write-Host '[Krynara-OS] Krynara-OS started - Open http://localhost:5173' -ForegroundColor Green
Write-Host '[Krynara-OS] Console: http://localhost:5173'
Write-Host '[Krynara-OS] Gateway: http://127.0.0.1:2785'
