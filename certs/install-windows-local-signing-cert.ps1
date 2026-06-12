param(
  [ValidateSet("LocalMachine", "CurrentUser")]
  [string]$StoreScope = "LocalMachine"
)

$ErrorActionPreference = "Stop"

if ($StoreScope -eq "LocalMachine") {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "LocalMachine certificate trust requires an elevated PowerShell session. Re-run as Administrator or pass -StoreScope CurrentUser."
  }
}

$rootCert = Join-Path $PSScriptRoot "sunvisai-local-root-ca.cer"
$publisherCert = Join-Path $PSScriptRoot "sunvisai-local-code-signing.cer"

if (-not (Test-Path -LiteralPath $rootCert)) {
  throw "Root certificate not found: $rootCert"
}
if (-not (Test-Path -LiteralPath $publisherCert)) {
  throw "Code signing certificate not found: $publisherCert"
}

Import-Certificate -FilePath $rootCert -CertStoreLocation "Cert:\$StoreScope\Root" | Out-Null
Import-Certificate -FilePath $publisherCert -CertStoreLocation "Cert:\$StoreScope\TrustedPublisher" | Out-Null

Write-Host "Installed Sunvisai local signing trust into $StoreScope Root and TrustedPublisher."
Write-Host "Restart the app after installing trust. If Code Integrity still blocks hostd.exe, the active WDAC policy must also allow this signer."
