# Teşekkürler ve Üçüncü Taraf Lisansları

Ajan Borsa, başkalarının açık kaynak emeğinin üzerine kurulmuş **ince bir birleştirme katmanıdır**.
Asıl işi yapan projeler aşağıdakilerdir. Bu depo onların kaynak kodunu **içermez**; `kur.ps1`
betiği her birini kendi resmî deposundan indirir. Lisansları ve telif hakları kendi sahiplerine aittir.

Bu depodaki MIT lisansı yalnızca bu depoda yazılan kodu (panel, başlatıcı, kurulum betikleri) kapsar.

## Ajanların arkasındaki projeler

### Kâşif → Borsa MCP
- **Geliştiren:** Said Sürücü — [@saidsurucu](https://github.com/saidsurucu)
- **Depo:** https://github.com/saidsurucu/borsa-mcp
- **Lisans:** MIT — Copyright (c) 2025 saidsurucu
- **Nasıl kullanılıyor:** `kur.ps1` depoyu `borsa-mcp/` klasörüne klonlar, panel onu yerel MCP sunucusu olarak çalıştırır. Kodu değiştirilmedi.
- **Test edilen sürüm:** commit `e3b45b22dafa703135afa84a1dc92973603a56f1`

### Avcı → day-trader-skill
- **Geliştiren:** Jake Schincariol — [@Jakeschincariol](https://github.com/Jakeschincariol)
- **Depo:** https://github.com/Jakeschincariol/day-trader-skill
- **Lisans:** MIT — Copyright (c) 2026 Jake Schincariol
- **Nasıl kullanılıyor:** `kur.ps1` depoyu `day-trader-skill/` klasörüne klonlar ve skill'leri `.claude/skills/` içine kopyalar. Panel, Python betiklerini (`scan.py`, `news.py`, `timemachine.py`, `ptr.py`, `facts.py`) değiştirmeden çağırır.
- **Test edilen sürüm:** commit `3d0f4ef6986f4984b7c6bd46f7ff4f87744c3abd`

### Simülatör → vectorbt
- **Geliştiren:** Oleg Polakow — [@polakowo](https://github.com/polakowo)
- **Depo:** https://github.com/polakowo/vectorbt
- **Lisans:** Apache License 2.0 + **"Commons Clause" License Condition v1.0**
- **Nasıl kullanılıyor:** PyPI'dan `vectorbt==1.2.1` olarak `vectorbt-lab/.venv` ortamına kurulur; `ajan-merkezi/workers/backtest.py` kütüphaneyi çağırır.
- **Önemli:** Commons Clause, vectorbt'yi veya değeri büyük ölçüde ondan gelen bir ürün/hizmeti **ücret karşılığı satmayı** yasaklar. Bu yüzden Ajan Borsa da ticari olarak satılmamalıdır; kişisel ve eğitim amaçlıdır. Lisans metni: https://github.com/polakowo/vectorbt/blob/master/LICENSE.md

## Panelin kullandığı kütüphaneler

| Kütüphane | Sahibi | Lisans | Kullanım |
|---|---|---|---|
| [FastMCP](https://github.com/PrefectHQ/fastmcp) | Jeremiah Lowin / Prefect | Apache-2.0 | Panelin Borsa MCP'ye bağlandığı MCP istemcisi |
| [Starlette](https://github.com/encode/starlette) | Encode OSS | BSD-3-Clause | Web sunucusu |
| [Uvicorn](https://github.com/encode/uvicorn) | Encode OSS | BSD-3-Clause | ASGI sunucusu |
| [yfinance](https://github.com/ranaroussi/yfinance) | Ran Aroussi | Apache-2.0 | Grafik için günlük fiyat geçmişi |
| [Lightweight Charts](https://github.com/tradingview/lightweight-charts) | TradingView | Apache-2.0 | Fiyat ve getiri grafikleri (unpkg CDN'den yüklenir, grafiklerde TradingView logosu görünür) |
| [Pillow](https://github.com/python-pillow/Pillow) | Pillow ekibi | MIT-CMU | Uygulama simgesini üretmek için |
| [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk), [JetBrains Mono](https://www.jetbrains.com/lp/mono/) | Florian Karsten, JetBrains | SIL OFL 1.1 | Yazı tipleri (Google Fonts) |

Borsa MCP ve day-trader-skill'in kendi bağımlılıkları (borsapy, pandas, httpx vb.) ilgili depoların lisanslarına tabidir.

## Veri kaynakları
Veriler ücretsiz ve herkese açık kaynaklardan gelir: KAP, TCMB, TEFAS, BtcTurk, Coinbase, doviz.com,
Yahoo Finance, Nasdaq Trader sembol listeleri, SEC EDGAR ve ABD Temsilciler Meclisi açıklama arşivi.
Her kaynağın kendi kullanım koşulları geçerlidir. Veriler gecikmeli veya hatalı olabilir.

## Ajan Borsa'nın kendi eklemeleri
- **BIST Zaman Makinesi** (`ajan-merkezi/workers/bist_zaman.py`): day-trader-skill'deki Zaman Makinesi fikrinden esinlenerek
  Borsa İstanbul seansı (10:00–18:00) için sıfırdan yazıldı; day-trader-skill'in kodunu kopyalamaz.
- **Senaryo Haritası** (`ajan-merkezi/workers/scenario.py`): geçmiş getirilerden blok bootstrap ile olasılık konisi üretir; fon verisi Borsa MCP'nin TEFAS kaynağından gelir. Tahmin değil, senaryodur.
- Avcı'nın BIST modundaki tarama, KAP haberleri ve finansallar Borsa MCP araçlarıyla sağlanır.

Bir kaynağı eksik ya da yanlış belirttiysem lütfen bir issue açın, hemen düzeltirim.
