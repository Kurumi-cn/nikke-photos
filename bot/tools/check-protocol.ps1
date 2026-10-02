<#
  Cross-language check for the NKP2 share code: encode in the browser library (JS),
  decode with the BOT's Python decoder, compare field by field.

  Usage (from PowerShell):
    powershell -File bot/tools/check-protocol.ps1

  The plugin must already be deployed (run deploy.ps1 first) -- this script does not
  upload the plugin, it only pushes the generated vectors and the checker.
#>
param(
  [string]$Plugin = 'astrbot_plugin_nikke_roster'
)

$ErrorActionPreference = 'Stop'

$SshConfig = 'C:/Users/xby/.workbuddy/ssh/tencent-cvm/config'
$SshHost = 'tcvm'
# Host path is for scp; the container sees /AstrBot/data/... -- never mix the two.
$ToolsHostDir = '/home/ubuntu/astrbot/data/nikke_tools'
$ToolsContDir = '/AstrBot/data/nikke_tools'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$vectors = Join-Path $repo 'bot/seed/sharecode-vectors.json'

Write-Host "==> generating vectors (also runs the JS-side self-check)"
node (Join-Path $repo 'app/scripts/check-share-code.mjs') --vectors $vectors
if ($LASTEXITCODE -ne 0) { throw "JS self-check failed" }

Write-Host "==> uploading vectors + checker"
ssh -F $SshConfig $SshHost "mkdir -p $ToolsHostDir"
scp -F $SshConfig $vectors "$SshHost`:$ToolsHostDir/sharecode-vectors.json"
scp -F $SshConfig (Join-Path $PSScriptRoot 'check_share_code.py') "$SshHost`:$ToolsHostDir/check_share_code.py"

Write-Host "==> decoding in the container with core/sharecode.py"
ssh -F $SshConfig $SshHost "sudo -n docker exec astrbot python $ToolsContDir/check_share_code.py $ToolsContDir/sharecode-vectors.json /AstrBot/data/plugins/$Plugin"
if ($LASTEXITCODE -ne 0) {
  Write-Host "==> CROSS-LANGUAGE CHECK FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
} else {
  Write-Host "==> done"
}
