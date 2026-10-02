<#
  Pack app/public assets into a tarball and install them into the plugin's assets/ dir.

  Usage (from PowerShell):
    powershell -File bot/tools/upload-assets.ps1              # reuse the tarball if it exists
    powershell -File bot/tools/upload-assets.ps1 -Rebuild     # rebuild the tarball first
    powershell -File bot/tools/upload-assets.ps1 -Clean       # delete the local tarball and exit

  Why a tarball instead of scp -r: ~1050 files / ~104 MB of tiny webp+png. One tar beats
  a thousand round trips. Stored uncompressed because the images are already compressed
  (gzip buys ~2% and costs minutes of CPU).

  What goes in: avatars/ (201), icons/ (26), ui-assets/ (822) -- i.e. everything the card
  and table renderer needs. ocr/ is excluded (that is the web app's image-recognition
  templates; the BOT does not do recognition).
#>
param(
  [switch]$Rebuild,
  [switch]$Clean,
  [string]$Plugin = 'astrbot_plugin_nikke_roster'
)

$ErrorActionPreference = 'Stop'

$SshConfig = 'C:/Users/xby/.workbuddy/ssh/tencent-cvm/config'
$SshHost = 'tcvm'
$RemoteTar = '/tmp/nikke-assets.tar'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$public = (Resolve-Path (Join-Path $repo 'app/public')).Path
$tarball = Join-Path $repo 'bot/seed/assets.tar'

if ($Clean) {
  if (Test-Path $tarball) { Remove-Item $tarball -Force; Write-Host "removed $tarball" }
  exit 0
}

if ($Rebuild -or -not (Test-Path $tarball)) {
  if (Test-Path $tarball) { Remove-Item $tarball -Force }
  Write-Host "==> packing avatars + icons + ui-assets from $public"
  tar -cf $tarball -C $public avatars icons ui-assets
  if ($LASTEXITCODE -ne 0) { throw "tar failed with exit $LASTEXITCODE" }
}
Write-Host ("==> tarball: {0:N1} MB" -f ((Get-Item $tarball).Length / 1MB))

Write-Host "==> uploading (this takes a while)"
scp -F $SshConfig $tarball "$SshHost`:$RemoteTar"
if ($LASTEXITCODE -ne 0) { throw "scp failed with exit $LASTEXITCODE" }

Write-Host "==> extracting into plugin assets/"
scp -F $SshConfig (Join-Path $PSScriptRoot 'remote-assets.sh') "$SshHost`:/tmp/nikke-assets.sh"
ssh -F $SshConfig $SshHost "bash /tmp/nikke-assets.sh $Plugin"
if ($LASTEXITCODE -ne 0) { Write-Host "==> ASSET INSTALL FAILED (exit $LASTEXITCODE)" -ForegroundColor Red } else { Write-Host "==> done" }
