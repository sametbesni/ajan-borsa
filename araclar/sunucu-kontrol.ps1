<#
Ajan Merkezi sunucusunun durumunu kontrol eder (Ajan-Merkezi-Ac.cmd tarafindan kullanilir).
Cikis kodlari:
  0 = sunucu calisiyor ve kod guncel
  1 = sunucu calismiyor
  2 = sunucu calisiyor ama kod dosyalari sunucudan daha yeni (eski surum aciliyor demektir)
#>
param([int]$Port = 8765)

try {
  Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/status" -TimeoutSec 2 | Out-Null
} catch { exit 1 }

$root = Join-Path $PSScriptRoot '..\ajan-merkezi'
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) { exit 0 }
$started = (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue).StartTime
if (-not $started) { exit 0 }

$files = @(Get-Item (Join-Path $root 'server.py'))
$files += Get-ChildItem (Join-Path $root 'web') -File
$files += Get-ChildItem (Join-Path $root 'workers') -Filter '*.py' -File
$newest = ($files | Measure-Object LastWriteTime -Maximum).Maximum
if ($newest -gt $started) { exit 2 }
exit 0
