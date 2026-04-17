# Create listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://*:8082/")
$listener.Start()

Write-Host "Listening on http://localhost:8082/ ... (Press Ctrl+C to stop)"

try {
    while ($listener.IsListening) {

        $asyncResult = $listener.BeginGetContext($null, $null)

        # Wait in small intervals so Ctrl+C can be processed
        while (-not $asyncResult.IsCompleted) {
            Start-Sleep -Milliseconds 100
        }

        $context = $listener.EndGetContext($asyncResult)
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.AbsolutePath
        $method = $request.HttpMethod

        Write-Host "$method $path"

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

        $buffer = [System.Text.Encoding]::UTF8.GetBytes($responseString)
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.OutputStream.Close()
    }
}
finally {
    Write-Host "Shutting down..."
    $listener.Stop()
}