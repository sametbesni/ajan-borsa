"""Simülatör işçisi: vectorbt ile geçmiş veri testi. stdin'den JSON alır, stdout'a tek satır JSON yazar.

Bu dosya vectorbt-lab sanal ortamıyla çalışır (ana panelden ayrı).
Yalnızca geçmiş veri testidir; al/sat önerisi üretmez.
"""
from __future__ import annotations

import json
import math
import sys
import warnings

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import vectorbt as vbt  # noqa: E402


def yahoo_symbol(sym: str, market: str) -> str:
    s = sym.strip().upper()
    if market == "bist" and not s.endswith(".IS"):
        return s + ".IS"
    if market == "crypto" and "-" not in s:
        return s + "-USD"
    if market == "index":
        return {"XU100": "XU100.IS", "XU030": "XU030.IS", "SP500": "^GSPC", "NASDAQ": "^IXIC"}.get(s, s)
    return s


def clean(x):
    if isinstance(x, (np.floating, float)):
        return None if (math.isnan(x) or math.isinf(x)) else round(float(x), 4)
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (pd.Timestamp,)):
        return x.strftime("%Y-%m-%d")
    if isinstance(x, pd.Timedelta):
        return x.days
    return x


def signals(price: pd.Series, strat: str, p: dict, fast=None, slow=None):
    if strat == "rsi":
        rsi = vbt.RSI.run(price, window=int(p.get("rsi_window", 14)))
        return rsi.rsi_crossed_below(float(p.get("rsi_low", 30))), rsi.rsi_crossed_above(float(p.get("rsi_high", 70)))
    if strat == "bb":
        bb = vbt.BBANDS.run(price, window=int(p.get("bb_window", 20)), alpha=float(p.get("bb_alpha", 2)))
        return price.vbt.crossed_below(bb.lower), price.vbt.crossed_above(bb.upper)
    f = vbt.MA.run(price, int(fast or p.get("fast", 10)))
    s = vbt.MA.run(price, int(slow or p.get("slow", 50)))
    return f.ma_crossed_above(s), f.ma_crossed_below(s)


def portfolio(price, entries, exits, p):
    kw = dict(init_cash=float(p.get("cash", 10000)), fees=float(p.get("fees", 0.1)) / 100,
              slippage=float(p.get("slippage", 0.05)) / 100, freq="1D")
    if float(p.get("sl", 0) or 0) > 0:
        kw["sl_stop"] = float(p["sl"]) / 100
    if float(p.get("tp", 0) or 0) > 0:
        kw["tp_stop"] = float(p["tp"]) / 100
    return vbt.Portfolio.from_signals(price, entries, exits, **kw)


def series_points(s: pd.Series, max_pts=1500):
    if len(s) > max_pts:
        s = s.iloc[:: math.ceil(len(s) / max_pts)]
    return [{"time": t.strftime("%Y-%m-%d"), "value": clean(v)} for t, v in s.items() if clean(v) is not None]


def metrics(pf, price, cash):
    st = pf.stats()
    bh = (price.iloc[-1] / price.iloc[0] - 1) * 100
    g = lambda k: clean(st.get(k)) if k in st.index else None  # noqa: E731
    return {
        "total_return": g("Total Return [%]"), "benchmark_return": clean(bh),
        "max_drawdown": g("Max Drawdown [%]"), "win_rate": g("Win Rate [%]"),
        "sharpe": g("Sharpe Ratio"), "sortino": g("Sortino Ratio"), "trades": g("Total Trades"),
        "profit_factor": g("Profit Factor"), "end_value": g("End Value"), "fees_paid": g("Total Fees Paid"),
        "best_trade": g("Best Trade [%]"), "worst_trade": g("Worst Trade [%]"), "start_value": cash,
        "period_days": int((price.index[-1] - price.index[0]).days),
    }


def trn(x, d=1):
    return f"{x:,.{d}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def yorum(m: dict, strat_name: str) -> list[str]:
    out = []
    tr, bh = m["total_return"] or 0, m["benchmark_return"] or 0
    diff = tr - bh
    if diff >= 0:
        out.append(f"{strat_name} bu dönemde %{trn(tr, 1)} getiri üretti; aynı dönemde 'al ve tut' %{trn(bh, 1)} getirdi. Strateji tutmaya göre {trn(diff, 1)} puan önde.")
    else:
        out.append(f"{strat_name} bu dönemde %{trn(tr, 1)} getiri üretti, ama hiçbir şey yapmadan tutmak %{trn(bh, 1)} getirirdi. Strateji tutmanın {trn(abs(diff), 1)} puan gerisinde kaldı.")
    dd = m["max_drawdown"] or 0
    out.append(f"En kötü anda portföy zirvesinden %{trn(dd, 1)} geriledi. " + (
        "Bu ciddi bir düşüş; psikolojik olarak taşıması zor olabilir." if dd > 30 else
        "Bu orta düzey bir düşüş." if dd > 15 else "Düşüş görece sınırlı kalmış."))
    n = m["trades"] or 0
    wr = m["win_rate"]
    if n:
        out.append(f"Toplam {n} işlem açıldı" + (f"; kârla kapanan işlemlerin oranı %{trn(wr, 0)}." if wr is not None else "."))
    if n < 10:
        out.append("İşlem sayısı az olduğu için sonuçlar istatistiksel olarak zayıf; şansın payı büyük olabilir.")
    sh = m["sharpe"]
    if sh is not None:
        out.append(f"Sharpe oranı {trn(sh, 2)}: " + ("alınan risk başına getiri iyi görünüyor." if sh >= 1 else
                                                 "risk başına getiri vasat." if sh >= 0.5 else "risk başına getiri zayıf."))
    out.append("Not: Bu yalnızca geçmiş veri testidir, yatırım tavsiyesi değildir. Geçmiş performans geleceği garanti etmez.")
    return out


def history(req: dict) -> dict:
    """Grafik için tam günlük OHLC (Borsa MCP yapay zekâ için veriyi seyreltir)."""
    s, market = req.get("symbol", "THYAO").strip().upper(), req.get("market", "bist")
    if market == "crypto" and "-" not in s:
        s = s[:-3] + "-TRY" if s.endswith("TRY") else s[:-4] + "-USD" if s.endswith("USDT") else s + "-USD"
    sym = s if market == "crypto" else yahoo_symbol(s, market)
    import yfinance as yf
    df = yf.Ticker(sym).history(period=req.get("period", "1y"), interval="1d", auto_adjust=False)
    if df is None or df.empty:
        return {"ok": False, "error": f"{sym} için geçmiş veri bulunamadı"}
    df.index = pd.to_datetime(df.index).tz_localize(None)
    rows = [[t.strftime("%Y-%m-%d"), clean(r.Open), clean(r.High), clean(r.Low), clean(r.Close), clean(r.Volume)]
            for t, r in df.iterrows() if not math.isnan(r.Close)]
    return {"ok": True, "symbol": sym, "columns": ["date", "open", "high", "low", "close", "volume"], "rows": rows}


def run(req: dict) -> dict:
    if req.get("mode") == "history":
        return history(req)
    sym = yahoo_symbol(req.get("symbol", "THYAO"), req.get("market", "bist"))
    start, end = req.get("start") or None, req.get("end") or None
    data = vbt.YFData.download(sym, start=start, end=end, missing_index="drop") if start else \
        vbt.YFData.download(sym, period=req.get("period", "5y"), missing_index="drop")
    price = data.get("Close").dropna()
    if isinstance(price, pd.DataFrame):
        price = price.iloc[:, 0]
    if len(price) < 60:
        return {"ok": False, "error": f"{sym} için yeterli veri yok ({len(price)} gün). Sembolü ve tarihleri kontrol et."}
    price.index = pd.to_datetime(price.index).tz_localize(None)
    strat = req.get("strategy", "ma")
    p = req.get("params", {})
    names = {"ma": "Hareketli ortalama kesişimi", "rsi": "RSI stratejisi", "bb": "Bollinger stratejisi"}
    mode = req.get("mode", "single")
    cash = float(p.get("cash", 10000))
    base = {"ok": True, "symbol": sym, "strategy": strat, "strategy_name": names.get(strat, strat), "mode": mode,
            "from": price.index[0].strftime("%Y-%m-%d"), "to": price.index[-1].strftime("%Y-%m-%d")}

    if mode == "sweep":
        windows = list(range(int(p.get("sweep_min", 5)), int(p.get("sweep_max", 100)) + 1, int(p.get("sweep_step", 5))))[:40]
        fast, slow = vbt.MA.run_combs(price, window=windows, r=2, short_names=["fast", "slow"])
        e, x = fast.ma_crossed_above(slow), fast.ma_crossed_below(slow)
        pf = portfolio(price, e, x, p)
        metric = req.get("metric", "total_return")
        vals = pf.sharpe_ratio() if metric == "sharpe" else pf.total_return() * 100
        cells = [{"fast": int(f), "slow": int(s), "v": clean(v)} for (f, s, *_), v in vals.items()]
        best = max((c for c in cells if c["v"] is not None), key=lambda c: c["v"], default=None)
        return {**base, "windows": windows, "metric": metric, "cells": cells, "best": best,
                "benchmark_return": clean((price.iloc[-1] / price.iloc[0] - 1) * 100),
                "notes": ["Isı haritasındaki en parlak kare geçmişe en iyi uyan ayardır; geleceği göstermez.",
                          "Çok fazla kombinasyon denemek, sadece geçmişe uyan 'mükemmel' ayarlar üretir. Aşırı uyum kontrolünü de çalıştır."]}

    if mode == "overfit":
        cut = int(len(price) * 0.7)
        train, test = price.iloc[:cut], price.iloc[cut:]
        windows = list(range(5, 101, 5))
        fast, slow = vbt.MA.run_combs(train, window=windows, r=2, short_names=["fast", "slow"])
        pf_tr = portfolio(train, fast.ma_crossed_above(slow), fast.ma_crossed_below(slow), p)
        sh = pf_tr.sharpe_ratio().replace([np.inf, -np.inf], np.nan).dropna()
        (bf, bs, *_) = sh.idxmax()
        e, x = signals(test, "ma", p, bf, bs)
        pf_te = portfolio(test, e, x, p)
        e2, x2 = signals(train, "ma", p, bf, bs)
        pf_tr_best = portfolio(train, e2, x2, p)
        m_tr, m_te = metrics(pf_tr_best, train, cash), metrics(pf_te, test, cash)
        ok = (m_te["total_return"] or 0) > 0 and (m_te["total_return"] or 0) >= (m_te["benchmark_return"] or 0) * 0.5
        notes = [f"İlk %70'lik bölümde ({base['from']} – {train.index[-1]:%Y-%m-%d}) en iyi ayar: hızlı {bf} / yavaş {bs} gün.",
                 f"Bu ayar eğitim döneminde %{trn(m_tr['total_return'], 1)}, hiç görmediği son %30'luk dönemde %{trn(m_te['total_return'], 1)} getirdi (al ve tut: %{trn(m_te['benchmark_return'], 1)}).",
                 "Sonuç tutarlı görünüyor: ayar yeni veride de işe yaramış." if ok else
                 "Sonuç tutarsız: ayar büyük ihtimalle geçmişe aşırı uymuş. Bu stratejiye fazla güvenme.",
                 "Yatırım tavsiyesi değildir."]
        return {**base, "best": {"fast": int(bf), "slow": int(bs)}, "train": m_tr, "test": m_te, "consistent": ok,
                "split": test.index[0].strftime("%Y-%m-%d"),
                "equity_train": series_points(pf_tr_best.value()), "equity_test": series_points(pf_te.value()),
                "notes": notes}

    entries, exits = signals(price, strat, p)
    pf = portfolio(price, entries, exits, p)
    m = metrics(pf, price, cash)
    bh = cash * price / price.iloc[0]
    trades = []
    try:
        tr = pf.trades.records_readable
        for _, r in tr.tail(200).iterrows():
            trades.append({
                "entry": clean(pd.Timestamp(r["Entry Timestamp"])), "exit": clean(pd.Timestamp(r["Exit Timestamp"])) if r["Status"] == "Closed" else None,
                "entry_price": clean(r["Avg Entry Price"]), "exit_price": clean(r["Avg Exit Price"]),
                "pnl": clean(r["PnL"]), "ret": clean(r["Return"] * 100), "status": "Kapalı" if r["Status"] == "Closed" else "Açık",
            })
    except Exception:  # noqa: BLE001
        pass
    markers = []
    for t in trades:
        markers.append({"time": t["entry"], "position": "belowBar", "color": "#22c55e", "shape": "arrowUp", "text": "G"})
        if t["exit"]:
            markers.append({"time": t["exit"], "position": "aboveBar", "color": "#f43f5e", "shape": "arrowDown", "text": "Ç"})
    return {**base, "metrics": m, "equity": series_points(pf.value()), "benchmark": series_points(bh),
            "price": series_points(price), "drawdown": series_points(pf.drawdown() * 100),
            "markers": sorted(markers, key=lambda x: x["time"]), "trades": trades[::-1],
            "notes": yorum(m, names.get(strat, strat))}


if __name__ == "__main__":
    try:
        result = run(json.loads(sys.stdin.read() or "{}"))
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(json.dumps(result, ensure_ascii=False, default=str) + "\n")
