param(
    [Parameter(Mandatory = $true)]
    [string]$AppRoot,
    [int]$Port = 8012
)

$ErrorActionPreference = 'Stop'
$resolvedAppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
$resourcesDir = Join-Path $resolvedAppRoot 'resources'
$runtimeDir = Join-Path $resourcesDir 'watermark-runtime'
$appExe = Join-Path $resolvedAppRoot 'Google Search App.exe'
$backendExe = Join-Path $resourcesDir 'bin\backend_server.exe'
$gwrScript = Join-Path $runtimeDir 'node_modules\@pilio\gemini-watermark-remover\bin\gwr.mjs'
$browserDir = Join-Path $runtimeDir 'node_modules\playwright-core\.local-browsers'

@($appExe, $backendExe, $gwrScript, $browserDir) | ForEach-Object {
    if (-not (Test-Path -LiteralPath $_)) {
        throw "Missing packaged watermark resource: $_"
    }
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$smokeRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot ("google-search-watermark-smoke-" + [guid]::NewGuid().ToString('N'))))
if (-not $smokeRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe smoke test directory: $smokeRoot"
}

$inputDir = Join-Path $smokeRoot 'input files'
$stdout = Join-Path $smokeRoot 'backend.stdout.log'
$stderr = Join-Path $smokeRoot 'backend.stderr.log'
$backendProcess = $null

try {
    New-Item -ItemType Directory -Force -Path $inputDir | Out-Null
    Add-Type -AssemblyName System.Drawing
    $inputPath = Join-Path $inputDir 'watermark sample.png'
    $bitmap = New-Object System.Drawing.Bitmap 1024, 1024
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::FromArgb(18, 36, 54))
        $bitmap.Save($inputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }

    $env:APP_DATA_DIR = Join-Path $smokeRoot 'app-data'
    $env:HOST = '127.0.0.1'
    $env:PORT = [string]$Port
    $env:WATERMARK_NODE_PATH = $appExe
    $env:WATERMARK_NODE_IS_ELECTRON = '1'
    $env:WATERMARK_GWR_SCRIPT = $gwrScript
    $env:WATERMARK_PLAYWRIGHT_BROWSERS_PATH = $browserDir
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

    $backendProcess = Start-Process -FilePath $backendExe -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr

    $baseUrl = "http://127.0.0.1:$Port"
    $checkDeadline = (Get-Date).AddMinutes(2)
    $check = $null
    do {
        if ($backendProcess.HasExited) {
            throw "Packaged backend exited early with code $($backendProcess.ExitCode)"
        }
        try {
            $check = Invoke-RestMethod -Uri "$baseUrl/api/watermark/check" -TimeoutSec 3
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while (-not $check -and (Get-Date) -lt $checkDeadline)

    if (-not $check) {
        throw 'Packaged backend watermark check timed out'
    }
    if (-not $check.gwr_available -or -not $check.video_available -or $check.runtime -ne 'bundled') {
        throw "Unexpected packaged runtime status: $($check | ConvertTo-Json -Compress)"
    }

    $payload = @{ paths = @($inputPath) } | ConvertTo-Json
    $queued = Invoke-RestMethod -Uri "$baseUrl/api/watermark/process" -Method Post `
        -ContentType 'application/json' -Body $payload
    $jobDeadline = (Get-Date).AddMinutes(2)
    $job = $null
    do {
        Start-Sleep -Milliseconds 500
        $job = Invoke-RestMethod -Uri "$baseUrl/api/watermark/jobs/$($queued.job_id)" -TimeoutSec 3
    } while ($job.status -notin @('done', 'error') -and (Get-Date) -lt $jobDeadline)

    if ($job.status -ne 'done' -or $job.done -ne 1) {
        throw "Packaged watermark job failed: $($job | ConvertTo-Json -Depth 5 -Compress)"
    }

    Write-Host "Packaged backend watermark smoke passed: $($check | ConvertTo-Json -Compress)"
} finally {
    if ($backendProcess -and -not $backendProcess.HasExited) {
        $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
        $killProcess = Start-Process -FilePath $taskkill `
            -ArgumentList @('/PID', [string]$backendProcess.Id, '/T', '/F') `
            -PassThru -Wait -WindowStyle Hidden
        if ($killProcess.ExitCode -ne 0 -and -not $backendProcess.HasExited) {
            throw "Could not stop packaged backend process tree: $($backendProcess.Id)"
        }
    }
    if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout }
    if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr }
    if (Test-Path -LiteralPath $smokeRoot) {
        for ($attempt = 0; $attempt -lt 10; $attempt++) {
            try {
                Remove-Item -LiteralPath $smokeRoot -Recurse -Force
                break
            } catch {
                if ($attempt -eq 9) { throw }
                Start-Sleep -Milliseconds 250
            }
        }
    }
}
