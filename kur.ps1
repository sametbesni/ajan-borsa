<#
.SYNOPSIS
  Ajan Borsa kurulumu: uc ajani kendi resmi depolarindan indirir ve paneli hazirlar.

.DESCRIPTION
  - borsa-mcp        (Said Surucu, MIT)          -> borsa-mcp\
  - day-trader-skill (Jake Schincariol, MIT)     -> day-trader-skill\ ve .claude\skills\
  - vectorbt         (Oleg Polakow, Apache 2.0 + Commons Clause) -> vectorbt-lab\.venv
  - Ajan Merkezi paneli                          -> ajan-merkezi\.venv
  Ayrintilar ve lisanslar: TESEKKURLER.md

.PARAMETER Guncelle
  Ucuncu taraf depolari test edilen surum yerine en son surume gunceller.
.PARAMETER ClaudeKayit
  borsa-mcp'yi Claude Code ve Claude Desktop'a MCP sunucusu olarak kaydeder.
.PARAMETER Kisayol
  Masaustune "Ajan Merkezi" kisayolu ekler.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\kur.ps1 -ClaudeKayit -Kisayol
#>
param([switch]$Guncelle, [switch]$ClaudeKayit, [switch]$Kisayol)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot

# Test edilen surumler (TESEKKURLER.md ile ayni)
$Repos = @(
  @{ Name = 'borsa-mcp';        Url = 'https://github.com/saidsurucu/borsa-mcp.git';             Commit = 'e3b45b22dafa703135afa84a1dc92973603a56f1' },
  @{ Name = 'day-trader-skill'; Url = 'https://github.com/Jakeschincariol/day-trader-skill.git'; Commit = '3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd' }
)

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Test-Cmd($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }
function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments)
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Exe $($Arguments -join ' ') basarisiz oldu (kod $LASTEXITCODE)" }
}

Write-Step 'On kosullar kontrol ediliyor'
foreach ($c in 'git', 'uv') {
  if (-not (Test-Cmd $c)) {
    Write-Host "$c bulunamadi." -ForegroundColor Red
    if ($c -eq 'uv') { Write-Host 'Kurulum: https://docs.astral.sh/uv/getting-started/installation/' }
    if ($c -eq 'git') { Write-Host 'Kurulum: https://git-scm.com/download/win' }
    exit 1
  }
}
Write-Host 'git ve uv hazir.'

foreach ($r in $Repos) {
  $dir = Join-Path $Root $r.Name
  if (-not (Test-Path $dir)) {
    Write-Step "$($r.Name) indiriliyor ($($r.Url))"
    Invoke-Native git @('clone', $r.Url, $dir)
  } else {
    Write-Step "$($r.Name) zaten var, guncelleniyor"
    Invoke-Native git @('-C', $dir, 'fetch', '--quiet', 'origin')
  }
  if ($Guncelle) {
    Invoke-Native git @('-C', $dir, 'checkout', '--quiet', 'origin/HEAD')
    Write-Host "En son surum kullaniliyor."
  } else {
    Invoke-Native git @('-C', $dir, 'checkout', '--quiet', $r.Commit)
    Write-Host "Test edilen surum: $($r.Commit.Substring(0,7))"
  }
}

Write-Step 'borsa-mcp bagimliliklari kuruluyor'
Push-Location (Join-Path $Root 'borsa-mcp'); try { Invoke-Native uv @('sync') } finally { Pop-Location }

Write-Step 'day-trader-skill skilleri .claude\skills klasorune kopyalaniyor'
$skills = Join-Path $Root '.claude\skills'
New-Item -ItemType Directory -Force $skills | Out-Null
Get-ChildItem (Join-Path $Root 'day-trader-skill') -Directory -Filter 'trader-*' | ForEach-Object {
  Copy-Item $_.FullName -Destination $skills -Recurse -Force
}
Write-Host "$((Get-ChildItem $skills -Directory).Count) skill hazir."

Write-Step 'vectorbt ortami kuruluyor (Python 3.12)'
$lab = Join-Path $Root 'vectorbt-lab'
$labPy = Join-Path $lab '.venv\Scripts\python.exe'
if (-not (Test-Path $labPy)) { Invoke-Native uv @('venv', '--python', '3.12', (Join-Path $lab '.venv')) }
Invoke-Native uv @('pip', 'install', '--python', $labPy, '-r', (Join-Path $lab 'requirements.txt'))

Write-Step 'Ajan Merkezi paneli kuruluyor'
Push-Location (Join-Path $Root 'ajan-merkezi'); try { Invoke-Native uv @('sync') } finally { Pop-Location }
$ico = Join-Path $Root 'ajan-merkezi\ajan-merkezi.ico'
if (-not (Test-Path $ico)) { Invoke-Native $labPy @('-I', (Join-Path $Root 'ajan-merkezi\make_icon.py')) }

$borsaExe = Join-Path $Root 'borsa-mcp\.venv\Scripts\borsa-mcp.exe'

if ($ClaudeKayit) {
  Write-Step 'borsa-mcp Claude uygulamalarina kaydediliyor'
  if (Test-Cmd 'claude') {
    $null = & claude mcp get borsa-mcp 2>$null
    if ($LASTEXITCODE -eq 0) { Write-Host 'Claude Code: zaten kayitli.' }
    else { Invoke-Native claude @('mcp', 'add', '-s', 'user', 'borsa-mcp', '--', $borsaExe); Write-Host 'Claude Code: eklendi.' }
  } else { Write-Host 'Claude Code bulunamadi, atlandi.' }

  $cfg = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
  if (Test-Path (Split-Path $cfg)) {
    $script = @'
import json, os, shutil, sys
p, exe = sys.argv[1], sys.argv[2]
c = {}
if os.path.exists(p):
    shutil.copy(p, p + ".ajan-borsa-yedek")
    with open(p, encoding="utf-8-sig") as f:
        c = json.load(f)
c.setdefault("mcpServers", {})["borsa-mcp"] = {"command": exe, "args": []}
with open(p, "w", encoding="utf-8") as f:
    json.dump(c, f, indent=2, ensure_ascii=False)
'@
    $tmp = Join-Path $env:TEMP 'ajan-borsa-desktop-cfg.py'
    Set-Content -Path $tmp -Value $script -Encoding UTF8
    Invoke-Native $labPy @('-I', $tmp, $cfg, $borsaExe)
    Remove-Item $tmp
    Write-Host 'Claude Desktop: eklendi (eski ayar dosyasi .ajan-borsa-yedek olarak saklandi). Desktop uygulamasini yeniden baslat.'
  } else { Write-Host 'Claude Desktop bulunamadi, atlandi.' }
}

if ($Kisayol) {
  Write-Step 'Masaustu kisayolu olusturuluyor'
  $lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Ajan Merkezi.lnk'
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
  $s.TargetPath = Join-Path $Root 'Ajan-Merkezi-Ac.cmd'
  $s.WorkingDirectory = $Root
  $s.IconLocation = "$ico,0"
  $s.WindowStyle = 7
  $s.Description = 'Ajan Borsa Merkezi'
  $s.Save()
  Write-Host "Kisayol: $lnk"
}

Write-Host "`nKurulum tamam. Paneli acmak icin: Ajan-Merkezi-Ac.cmd" -ForegroundColor Green
Write-Host 'Yatirim tavsiyesi degildir. Lisanslar ve emegi gecenler: TESEKKURLER.md'
