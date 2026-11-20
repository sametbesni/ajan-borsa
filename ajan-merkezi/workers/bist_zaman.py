"""BIST Zaman Makinesi: Borsa İstanbul için gün içi senaryo simülasyonu.

Fikir day-trader-skill'in trader-timemachine aracından gelir (Jake Schincariol, MIT);
o araç yalnızca New York seansında çalıştığı için BIST seansına (10:00-18:00) göre
bağımsız olarak yeniden yazılmıştır.

Yöntem: hissenin son ~60 işlem gününün 5 dakikalık mumları alınır. Girişten seans
sonuna kadar her 5 dakikalık dilim için, geçmiş günlerin aynı saat (± pencere) dilimlerinden
rastgele getiri seçilerek binlerce olası gün kurulur. Ayrıca aynı kural (yüzde olarak aynı
stop/hedef uzaklığı) geçmiş günlerin her birinde gerçek mumlarla tekrar oynatılır.

stdin'den JSON alır, stdout'a tek satır JSON yazar. Tahmin değildir, yatırım tavsiyesi değildir.
"""
from __future__ import annotations

import json
import sys
import warnings
from datetime import datetime

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import yfinance as yf  # noqa: E402

OPEN_MIN, CLOSE_MIN, BAR = 10 * 60, 18 * 60, 5
SLOTS = (CLOSE_MIN - OPEN_MIN) // BAR  # 96 dilim


def fnum(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def load_sessions(symbol: str):
    df = yf.Ticker(symbol).history(period="60d", interval="5m", auto_adjust=False)
    if df is None or df.empty:
        raise ValueError(f"{symbol} için 5 dakikalık veri bulunamadı")
    idx = pd.to_datetime(df.index)
    idx = idx.tz_convert("Europe/Istanbul") if idx.tz is not None else idx.tz_localize("Europe/Istanbul")
    df.index = idx
    sessions = {}
    for day, g in df.groupby(df.index.date):
        mins = g.index.hour * 60 + g.index.minute
        g = g[(mins >= OPEN_MIN) & (mins < CLOSE_MIN)]
        if g.empty:
            continue
        slot = ((g.index.hour * 60 + g.index.minute - OPEN_MIN) // BAR).astype(int)
        close = pd.Series(g["Close"].values, index=slot).groupby(level=0).last().reindex(range(SLOTS)).ffill().bfill()
        high = pd.Series(g["High"].values, index=slot).groupby(level=0).max().reindex(range(SLOTS)).fillna(close)
        low = pd.Series(g["Low"].values, index=slot).groupby(level=0).min().reindex(range(SLOTS)).fillna(close)
        if g.shape[0] >= SLOTS * 0.8:  # yarım/eksik seansları dışarıda bırak
            sessions[day] = (close.values, high.values, low.values)
    if len(sessions) < 15:
        raise ValueError(f"{symbol} için yeterli tam seans yok ({len(sessions)})")
    return sessions


def run(req: dict) -> dict:
    sym = str(req.get("symbol", "THYAO")).strip().upper()
    ysym = sym if sym.endswith(".IS") else sym + ".IS"
    sessions = load_sessions(ysym)
    days = sorted(sessions)
    side = -1 if req.get("side") == "sell" else 1

    t = str(req.get("entry_time") or "10:30").strip()
    try:
        hh, mm = (int(x) for x in t.replace(".", ":").split(":")[:2])
    except ValueError:
        hh, mm = 10, 30
    k = max(0, min(SLOTS - 2, (hh * 60 + mm - OPEN_MIN) // BAR - 1))  # giriş mumunun kapanışı

    last_close = float(sessions[days[-1]][0][-1])
    entry = fnum(req.get("entry")) or last_close
    stop = fnum(req.get("stop")) or entry * (1 - side * 0.02)
    target = fnum(req.get("target")) or entry * (1 + side * 0.04)
    risk = abs(entry - stop)
    if risk <= 0 or (target - entry) * side <= 0 or (entry - stop) * side <= 0:
        return {"ok": False, "error": "Stop ve hedef, giriş fiyatının doğru taraflarında olmalı (alışta stop altta, hedef üstte)."}

    # Dilim başına getiri havuzu: geçmiş günlerin aynı saatleri (± pencere)
    closes = np.array([sessions[d][0] for d in days])
    highs = np.array([sessions[d][1] for d in days])
    lows = np.array([sessions[d][2] for d in days])
    rets = closes[:, 1:] / closes[:, :-1] - 1
    hi_ex = highs[:, 1:] / closes[:, :-1] - 1
    lo_ex = lows[:, 1:] / closes[:, :-1] - 1
    window = int(req.get("window", 2))
    n = int(min(max(fnum(req.get("replays"), 10000), 500), 20000))
    rng = np.random.default_rng(19)

    steps = SLOTS - 1 - k
    price = np.full(n, entry)
    status = np.zeros(n, dtype=int)  # 0 açık, 1 hedef, -1 stop
    bands = [[round(entry, 4)] * 5]
    for s in range(steps):
        j = k + s  # rets[:, j] = j -> j+1 dilimi
        lo_j, hi_j = max(0, j - window), min(rets.shape[1] - 1, j + window)
        dd = rng.integers(0, len(days), n)
        jj = rng.integers(lo_j, hi_j + 1, n)
        r, rh, rl = rets[dd, jj], hi_ex[dd, jj], lo_ex[dd, jj]
        bar_hi, bar_lo = price * (1 + rh), price * (1 + rl)
        open_ = status == 0
        if side == 1:
            hit_stop = open_ & (bar_lo <= stop)
            hit_tgt = open_ & ~hit_stop & (bar_hi >= target)
        else:
            hit_stop = open_ & (bar_hi >= stop)
            hit_tgt = open_ & ~hit_stop & (bar_lo <= target)
        status[hit_stop], status[hit_tgt] = -1, 1
        price = price * (1 + r)
        bands.append([round(float(x), 4) for x in np.percentile(price, [5, 25, 50, 75, 95])])

    final_r = np.where(status == 1, (target - entry) * side / risk,
                       np.where(status == -1, -1.0, (price - entry) * side / risk))
    mc = {
        "replays": n, "seed": 19, "window": window, "bars_left": steps,
        "p_target": round(float((status == 1).mean()), 4), "p_stop": round(float((status == -1).mean()), 4),
        "p_neither": round(float((status == 0).mean()), 4), "p_green": round(float(((price - entry) * side > 0).mean()), 4),
        "median_close": round(float(np.median(price)), 4), "p5_close": round(float(np.percentile(price, 5)), 4),
        "p95_close": round(float(np.percentile(price, 95)), 4), "avg_R": round(float(final_r.mean()), 3),
        "r_at_target": round(abs(target - entry) / risk, 2), "bands": bands,
    }

    # Aynı kuralı geçmiş günlerde gerçek mumlarla oyna (yüzde uzaklıklar korunur)
    sp, tp = (stop / entry - 1), (target / entry - 1)
    hist = {"hedef": 0, "stop": 0, "kapanista_acik": 0}
    for d in days:
        c, hgh, low = sessions[d]
        e = c[k]
        st, tg = e * (1 + sp), e * (1 + tp)
        res = "kapanista_acik"
        for i in range(k + 1, SLOTS):
            if (side == 1 and low[i] <= st) or (side == -1 and hgh[i] >= st):
                res = "stop"
                break
            if (side == 1 and hgh[i] >= tg) or (side == -1 and low[i] <= tg):
                res = "hedef"
                break
        hist[res] += 1

    hh_e, mm_e = divmod(OPEN_MIN + BAR * (k + 1), 60)
    return {
        "ok": True, "created_by": "ajan-merkezi bist_zaman", "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "plan": {"symbol": sym, "side": "sell" if side == -1 else "buy", "date": str(days[-1]),
                 "entry": round(entry, 4), "entry_time": f"{hh_e:02d}:{mm_e:02d}", "stop": round(stop, 4),
                 "target": round(target, 4), "risk_per_share": round(risk, 4), "market": "BIST"},
        "mc": mc,
        "gecmis_gunler": {"incelenen_gun": len(days), "ilk_gun": str(days[0]), "son_gun": str(days[-1]), **hist},
    }


if __name__ == "__main__":
    try:
        out = run(json.loads(sys.stdin.read() or "{}"))
    except Exception as e:  # noqa: BLE001
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(json.dumps(out, ensure_ascii=False, default=str) + "\n")
