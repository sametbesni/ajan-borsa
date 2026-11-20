<#
.SYNOPSIS
  Alpaca PAPER (sanal para) API anahtarlarini dogrular ve Claude Desktop'a Alpaca MCP sunucusunu ekler.

.DESCRIPTION
  Bu betigi KENDIN calistir. Anahtarlari yalnizca bu pencereye yazarsin; ekranda gorunmezler,
  sohbete veya bu depoya gitmezler. Betik:
    1. Anahtarlari Alpaca'nin PAPER sunucusunda dener (canli hesap anahtarlari burada calismaz,
       bu da yanlislikla canli anahtar girmeni engeller).
    2. Claude Desktop ayar dosyasini yedekler ve "alpaca" MCP sunucusunu ALPACA_PAPER_TRADE=true ile ekler.
  Alpaca MCP sunucusu: https://github.com/alpacahq/alpaca-mcp-server (MIT, Alpaca)
  Kurulum tarifi day-trader-skill'in trader-broker/SKILL.md dosyasindan alinmistir.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\araclar\alpaca-baglanti-kur.ps1
#>
$ErrorActionPreference = 'Stop'

function ConvertFrom-Secure([Security.SecureString]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

Write-Host ''
Write-Host 'Alpaca PAPER baglantisi' -ForegroundColor Cyan
Write-Host 'Anahtarlari Alpaca panelinde Paper hesabindayken "API Keys > Generate New Keys" ile al.'
Write-Host 'Yazdiklarin ekranda gorunmeyecek. Iptal icin Ctrl+C.'
Write-Host ''

$key = ConvertFrom-Secure (Read-Host 'API Key ID' -AsSecureString)
$secret = ConvertFrom-Secure (Read-Host 'Secret Key' -AsSecureString)
if (-not $key -or -not $secret) { Write-Host 'Anahtar bos olamaz.' -ForegroundColor Red; exit 1 }

Write-Host "`nPaper hesabi kontrol ediliyor..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
  $acct = Invoke-RestMethod -Uri 'https://paper-api.alpaca.markets/v2/account' -Headers @{ 'APCA-API-KEY-ID' = $key; 'APCA-API-SECRET-KEY' = $secret } -TimeoutSec 20
} catch {
  Write-Host 'Anahtarlar paper hesabinda calismadi.' -ForegroundColor Red
  Write-Host 'Kontrol et: Alpaca panelinde sol ustte "Paper" hesabi secili miydi? Anahtari dogru kopyaladin mi?'
  exit 1
}
Write-Host ("Baglandi: hesap durumu {0}, sanal nakit {1} {2}" -f $acct.status, $acct.cash, $acct.currency) -ForegroundColor Green

$cfgDir = Join-Path $env:APPDATA 'Claude'
$cfg = Join-Path $cfgDir 'claude_desktop_config.json'
if (-not (Test-Path $cfgDir)) { Write-Host 'Claude Desktop ayar klasoru bulunamadi. Claude Desktop kurulu mu?' -ForegroundColor Red; exit 1 }
if (Test-Path $cfg) { Copy-Item $cfg "$cfg.alpaca-yedek" -Force }

$py = Join-Path $PSScriptRoot '..\vectorbt-lab\.venv\Scripts\python.exe'
$script = @'
import json, os, sys
p = sys.argv[1]
c = json.load(open(p, encoding="utf-8-sig")) if os.path.exists(p) else {}
c.setdefault("mcpServers", {})["alpaca"] = {
    "command": "uvx",
    "args": ["alpaca-mcp-server"],
    "env": {
        "ALPACA_API_KEY": os.environ["AJAN_ALPACA_KEY"],
        "ALPACA_SECRET_KEY": os.environ["AJAN_ALPACA_SECRET"],
        "ALPACA_PAPER_TRADE": "true",
        "ALPACA_TOOLSETS": "account,trading,stock-data",
    },
}
json.dump(c, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
'@
$tmp = Join-Path $env:TEMP 'ajan-borsa-alpaca.py'
Set-Content -Path $tmp -Value $script -Encoding UTF8
$env:AJAN_ALPACA_KEY = $key; $env:AJAN_ALPACA_SECRET = $secret
try { & $py -I $tmp $cfg; if ($LASTEXITCODE -ne 0) { throw 'Ayar dosyasi yazilamadi' } }
finally { Remove-Item $tmp -ErrorAction SilentlyContinue; Remove-Item Env:AJAN_ALPACA_KEY, Env:AJAN_ALPACA_SECRET -ErrorAction SilentlyContinue }
$key = $null; $secret = $null

Write-Host "`nClaude Desktop'a 'alpaca' sunucusu eklendi (paper modu)." -ForegroundColor Green
Write-Host 'Siradaki adimlar:'
Write-Host '  1. Claude Desktop uygulamasini tamamen kapatip yeniden ac.'
Write-Host '  2. Ayarlar > Connectors > alpaca: place_stock_order ve emir degistiren araclari "Needs approval" yap.'
Write-Host '     Opsiyon, kripto ve "hepsini kapat" araclarini "Blocked" yap. Asla "Always allow" verme.'
Write-Host '  3. Claude''a "Alpaca hesap bilgimi goster" yaz ve panelde Paper hesabi oldugunu dogrula.'
Write-Host 'Anahtarlarin yalnizca bu bilgisayardaki Claude Desktop ayar dosyasinda duruyor; o dosyayi kimseyle paylasma.'
