param(
  [string]$SshUser = $env:OCI_SSH_USER,
  [string]$SshHost = $env:OCI_SSH_HOST,
  [string]$SshKey = $env:OCI_SSH_KEY,
  [int]$LocalPort = 1521,
  [string]$RemoteHost = $(if ($env:OCI_REMOTE_HOST) { $env:OCI_REMOTE_HOST } else { "localhost" }),
  [int]$RemotePort = 1521
)

$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env.local"
if (Test-Path -LiteralPath $envFile) {
  Get-Content -LiteralPath $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
    $idx = $line.IndexOf("=")
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim().Trim('"').Trim("'")
    if (-not [Environment]::GetEnvironmentVariable($key, "Process")) {
      [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
  }
}

if (-not $SshUser) { $SshUser = $env:OCI_SSH_USER }
if (-not $SshHost) { $SshHost = $env:OCI_SSH_HOST }
if (-not $SshKey) { $SshKey = $env:OCI_SSH_KEY }
if ($env:OCI_LOCAL_PORT) { $LocalPort = [int]$env:OCI_LOCAL_PORT }
if ($env:OCI_REMOTE_HOST) { $RemoteHost = $env:OCI_REMOTE_HOST }
if ($env:OCI_REMOTE_PORT) { $RemotePort = [int]$env:OCI_REMOTE_PORT }

if (-not $SshUser -or -not $SshHost) {
  throw "Set OCI_SSH_USER and OCI_SSH_HOST, or pass -SshUser and -SshHost."
}

$target = "$SshUser@$SshHost"
$forward = "${LocalPort}:${RemoteHost}:${RemotePort}"
$args = @("-N", "-L", $forward)

if ($SshKey) {
  $args += @("-i", $SshKey)
}

$args += $target

Write-Host "Opening SSH tunnel: localhost:$LocalPort -> $RemoteHost`:$RemotePort via $target"
Write-Host "Leave this window open while running NextAI. Press Ctrl+C to stop the tunnel."
ssh @args
