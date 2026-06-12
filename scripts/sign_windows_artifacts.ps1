param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("prebundle", "bundle")]
  [string]$Phase
)

$ErrorActionPreference = "Stop"

function Fail-Or-Skip {
  param([string]$Message)
  if ($env:WINDOWS_CODESIGN_REQUIRED -eq "true") {
    throw $Message
  }
  Write-Host "$Message; skipping Windows code signing."
  exit 0
}

function Find-SignTool {
  $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (-not (Test-Path -LiteralPath $kitsRoot)) {
    throw "Windows Kits signtool root not found: $kitsRoot"
  }
  $candidate = Get-ChildItem -Path $kitsRoot -Recurse -Filter signtool.exe |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
  if ($null -eq $candidate) {
    throw "signtool.exe x64 not found under $kitsRoot"
  }
  return $candidate.FullName
}

if ([string]::IsNullOrWhiteSpace($env:WINDOWS_CODESIGN_PFX_BASE64)) {
  Fail-Or-Skip "WINDOWS_CODESIGN_PFX_BASE64 is not configured"
}
if ([string]::IsNullOrWhiteSpace($env:WINDOWS_CODESIGN_PASSWORD)) {
  Fail-Or-Skip "WINDOWS_CODESIGN_PASSWORD is not configured"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$pfxPath = Join-Path ([System.IO.Path]::GetTempPath()) "sunvisai-windows-codesign.pfx"
[System.IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($env:WINDOWS_CODESIGN_PFX_BASE64))
$signtool = Find-SignTool

$files = @()
if ($Phase -eq "prebundle") {
  $files += Get-ChildItem -Path (Join-Path $repoRoot "src-tauri\binaries") -Filter "*.exe" -File -ErrorAction SilentlyContinue
  $appExe = Join-Path $repoRoot "src-tauri\target\release\agi-desktop.exe"
  if (Test-Path -LiteralPath $appExe) {
    $files += Get-Item -LiteralPath $appExe
  }
} else {
  $releaseAssets = Join-Path $repoRoot "release-assets"
  if (Test-Path -LiteralPath $releaseAssets) {
    $files += Get-ChildItem -Path $releaseAssets -Include "*.exe","*.msi" -File -Recurse
  }
}

if ($files.Count -eq 0) {
  Fail-Or-Skip "No Windows artifacts found for signing phase $Phase"
}

foreach ($file in $files) {
  Write-Host "Signing $($file.FullName)"
  & $signtool sign /fd SHA256 /f $pfxPath /p $env:WINDOWS_CODESIGN_PASSWORD $file.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "signtool failed for $($file.FullName)"
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  Write-Host "Signature status for $($file.Name): $($signature.Status)"
}

Remove-Item -LiteralPath $pfxPath -Force -ErrorAction SilentlyContinue
