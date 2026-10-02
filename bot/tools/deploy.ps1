<#
  Sync the plugin source to the Tencent Cloud server, reload AstrBot, and smoke-test it.

  Usage (from PowerShell):
    powershell -File bot/tools/deploy.ps1               # sync + compile check + restart + smoke test
    powershell -File bot/tools/deploy.ps1 -NoRestart    # sync only
    powershell -File bot/tools/deploy.ps1 -Seed         # also push bot/seed/*.json into plugin_data
    powershell -File bot/tools/deploy.ps1 -CheckOnly    # just report plugin/log state on the server

  Why this file is ASCII-only: Windows PowerShell 5.1 reads .ps1 as GBK unless the
  file has a BOM, so Chinese text here breaks parsing. The remote logic lives in
  remote-*.sh (bash, UTF-8) and is uploaded as-is.

  Why a script instead of an inline ssh command: PowerShell strips "$VAR" and any
  quotes inside arguments passed to native commands. That once made a deploy
  command expand to "/" and copy the plugin files into the server's filesystem
  root. Keeping every variable inside the uploaded bash script removes that whole
  class of accident -- so do NOT put variables or quotes into the ssh lines below.
#>
param(
  [switch]$NoRestart,
  [switch]$CheckOnly,
  [switch]$Seed,
  [string]$Plugin = 'astrbot_plugin_nikke_roster'
)

$ErrorActionPreference = 'Stop'

$SshConfig = 'C:/Users/xby/.workbuddy/ssh/tencent-cvm/config'
$SshHost = 'tcvm'
$RemoteTmp = '/tmp/nikke_deploy'

$tools = $PSScriptRoot

if ($CheckOnly) {
  scp -F $SshConfig (Join-Path $tools 'remote-check.sh') "$SshHost`:/tmp/nikke-check.sh"
  ssh -F $SshConfig $SshHost "bash /tmp/nikke-check.sh $Plugin"
  exit $LASTEXITCODE
}

$localPlugin = (Resolve-Path (Join-Path $tools "..\$Plugin")).Path
$seedDir = (Resolve-Path (Join-Path $tools '../seed')).Path
$mode = if ($NoRestart) { 'norestart' } else { 'restart' }

Write-Host "==> cleaning $RemoteTmp on server"
ssh -F $SshConfig $SshHost "rm -rf $RemoteTmp; mkdir -p $RemoteTmp"

Write-Host "==> uploading $Plugin"
scp -F $SshConfig -r $localPlugin "$SshHost`:$RemoteTmp/"
scp -F $SshConfig (Join-Path $tools 'remote-install.sh') "$SshHost`:/tmp/nikke-install.sh"

Write-Host "==> installing (mode: $mode)"
ssh -F $SshConfig $SshHost "bash /tmp/nikke-install.sh $Plugin $mode"

if ($Seed) {
  Write-Host "==> pushing seed files into plugin_data"
  ssh -F $SshConfig $SshHost "rm -rf /tmp/nikke_seed; mkdir -p /tmp/nikke_seed"
  scp -F $SshConfig (Join-Path $seedDir '*.json') "$SshHost`:/tmp/nikke_seed/"
  scp -F $SshConfig (Join-Path $tools 'remote-seed.sh') "$SshHost`:/tmp/nikke-seed.sh"
  ssh -F $SshConfig $SshHost "bash /tmp/nikke-seed.sh /tmp/nikke_seed"
}

Write-Host "==> smoke test (roster load + name/alias resolution + assets)"
# The container only mounts data/, so the script has to live there, not in /tmp.
ssh -F $SshConfig $SshHost "mkdir -p /home/ubuntu/astrbot/data/nikke_tools"
scp -F $SshConfig (Join-Path $tools 'smoke.py') "$SshHost`:/home/ubuntu/astrbot/data/nikke_tools/smoke.py"
ssh -F $SshConfig $SshHost "sudo -n docker exec astrbot python /AstrBot/data/nikke_tools/smoke.py /AstrBot/data/plugins/$Plugin"
if ($LASTEXITCODE -ne 0) {
  Write-Host "==> SMOKE TEST FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host "==> command smoke test (help/import/list/panel/stats/edit)"
scp -F $SshConfig (Join-Path $tools 'command-smoke.py') "$SshHost`:/home/ubuntu/astrbot/data/nikke_tools/command-smoke.py"
scp -F $SshConfig (Join-Path $seedDir 'sharecode-vectors.json') "$SshHost`:/home/ubuntu/astrbot/data/nikke_tools/sharecode-vectors.json"
ssh -F $SshConfig $SshHost "sudo -n docker exec astrbot python /AstrBot/data/nikke_tools/command-smoke.py /AstrBot/data/plugins/$Plugin /AstrBot/data/nikke_tools/sharecode-vectors.json"
if ($LASTEXITCODE -ne 0) {
  Write-Host "==> COMMAND SMOKE TEST FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
} else {
  Write-Host "==> done"
}
