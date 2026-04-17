$stop = $false

Register-ObjectEvent -InputObject ([Console]) -EventName CancelKeyPress -Action {
    Write-Host "Stopping..."
    $global:stop = $true
    $listener.Stop()
} | Out-Null

# Create listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://*:8082/")
$listener.Start()

Write-Host "Listening on http://localhost:8082/ ..."

while ($listener.IsListening && -not $stop) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    # Read request info
    $path = $request.Url.AbsolutePath
    $method = $request.HttpMethod

    Write-Host "$method $path"

    # Simple routing
    if ($path -eq "/hello" -and $method -eq "GET") {
        $responseString = '{"message":"Hello from PowerShell API"}' + "`n"
        $response.ContentType = "application/json"
    }
    elseif ($path -eq "/echo" -and $method -eq "POST") {
        $reader = New-Object System.IO.StreamReader($request.InputStream)
        $body = $reader.ReadToEnd()
        $responseString = "{`"you_sent`": $body}" + "`n"
        $response.ContentType = "application/json"
    }
    else {
        $response.StatusCode = 404
        $responseString = '{"error":"Not Found"}' + "`n"
    }

    # Write response
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($responseString)
    $response.ContentLength64 = $buffer.Length
    $response.OutputStream.Write($buffer, 0, $buffer.Length)
    $response.OutputStream.Close()
}

$listener.Stop()