$ErrorActionPreference = 'Stop'

$harPath = Join-Path $PSScriptRoot '..\gemini.google.com.har'
$configPath = Join-Path $PSScriptRoot 'Data\config.json'
$capturedPath = Join-Path $PSScriptRoot 'Data\curl_request.json'
$responsePath = Join-Path $PSScriptRoot 'Data\curl_gemini_response.txt'

$config = Get-Content $configPath -Raw | ConvertFrom-Json
if (-not $config.gemini.cookies) { throw 'Không tìm thấy cookie Gemini trong config.json.' }

$entry = $null
if (Test-Path $capturedPath) {
    $captured = Get-Content $capturedPath -Raw | ConvertFrom-Json
    $requestUrl = [string]$captured.url
    $requestBody = [string]$captured.body
    $capturedHeaders = $captured.headers
} else {
    $har = Get-Content $harPath -Raw | ConvertFrom-Json
    $entry = @($har.log.entries | Where-Object {
        $_.request.method -eq 'POST' -and $_.request.url -match 'StreamGenerate'
    } | Sort-Object startedDateTime)[-1]
    if (-not $entry) { throw 'Không tìm thấy POST StreamGenerate trong HAR.' }
    $requestUrl = ([string]$entry.request.url).Trim()
    $requestBody = [string]$entry.request.postData.text
    $capturedHeaders = $entry.request.headers
}

$curlArgs = @('-sS', '--globoff', '--url', $requestUrl, '-X', 'POST')
foreach ($headerName in @('Content-Type', 'X-Same-Domain', 'Referer', 'User-Agent')) {
    if ($capturedHeaders -is [hashtable]) {
        $header = $capturedHeaders.PSObject.Properties | Where-Object { $_.Name -ieq $headerName } | Select-Object -First 1
        if ($header) { $curlArgs += @('-H', "$($header.Name): $($header.Value)") }
    } else {
        $header = $capturedHeaders | Where-Object { $_.name -ieq $headerName } | Select-Object -First 1
        if ($header) { $curlArgs += @('-H', "$($header.name): $($header.value)") }
    }
}
$curlArgs += @('-H', "Cookie: $($config.gemini.cookies)")
$curlArgs += @('--data-raw', $requestBody)
$curlArgs += @('--output', $responsePath, '--write-out', '%{http_code}')

$status = (& curl.exe @curlArgs).Trim()
$size = (Get-Item $responsePath).Length
Write-Output "HTTP_STATUS=$status"
Write-Output "RESPONSE_BYTES=$size"
Write-Output "RESPONSE_FILE=$responsePath"
