"""Senaryo Haritası: geçmiş oynaklıktan olasılık konisi, "ya şöyle olursa" ve benzer geçmiş durumlar.

BU BİR TAHMİN DEĞİLDİR. Fiyatın geleceği bilinemez; bu araç, geçmişte görülen günlük hareketleri
karıştırarak binlerce olası yol üretir ve "geçmiş davranışa göre aralık ne kadar geniş olabilir?"
sorusunu görselleştirir. Savaş, ani karar, gece gelen haber gibi geçmişte görülmemiş olaylar
konide yoktur. Yatırım tavsiyesi değildir.

stdin'den JSON alır, stdout'a tek satır JSON yazar. vectorbt-lab sanal ortamında çalışır.
"""
from __future__ import annotations

import json
import math
import sys
import warnings

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

MAX_H = 252
PCTS = [5, 10, 25, 50, 75, 90, 95]
HORIZONS = [5, 21, 63, 126, 252]
BLOCK = 5


def trn(x, d=1):
    return f"{x:,.{d}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def pc(x, d=1):
    return ("-" if x < 0 else "+") + "%" + trn(abs(x), d)


def yahoo_symbol(sym: str, market: str) -> str:
    s = sym.strip().upper()
    if market == "bist" and not s.endswith(".IS"):
        return s + ".IS"
    if market == "crypto" and "-" not in s:
        return s[:-3] + "-TRY" if s.endswith("TRY") else s + "-USD"
    if market == "index":
        return {"XU100": "XU100.IS", "XU030": "XU030.IS", "XBANK": "XBANK.IS", "SP500": "^GSPC", "NASDAQ": "^IXIC"}.get(s, s)
    return s


def load_prices(req: dict) -> tuple[pd.Series, str]:
    years = int(min(max(float(req.get("years", 3)), 1), 10))
    if req.get("series"):  # fonlar: sunucu TEFAS'tan getirir
        df = pd.DataFrame(req["series"], columns=["date", "close"])
        s = pd.Series(df["close"].astype(float).values, index=pd.to_datetime(df["date"]))
        return s[~s.index.duplicated()].sort_index().dropna(), req.get("symbol", "FON")
    import yfinance as yf
    sym = yahoo_symbol(req.get("symbol", "THYAO"), req.get("market", "bist"))
    df = yf.Ticker(sym).history(period=f"{years}y", interval="1d", auto_adjust=True)
    if df is None or df.empty:
        raise ValueError(f"{sym} için geçmiş veri bulunamadı. Sembolü kontrol et.")
    s = pd.Series(df["Close"].values, index=pd.to_datetime(df.index).tz_localize(None).normalize())
    return s[~s.index.duplicated()].dropna(), sym


def max_drawdown(p: pd.Series) -> float:
    return float(((p / p.cummax()) - 1).min() * 100)


def simulate(r: np.ndarray, req: dict, last: float, rng) -> np.ndarray:
    n = int(min(max(float(req.get("paths", 10000)), 2000), 20000))
    mu = r.mean()
    vol_mult = float(min(max(float(req.get("vol_mult", 1.0)), 0.3), 3.0))
    drift_mode = req.get("drift", "zero")
    if drift_mode == "hist":
        center = mu
    elif drift_mode == "custom":
        center = math.log1p(float(req.get("drift_pct", 0)) / 100) / 252
    else:
        center = 0.0
    adj = center + (r - mu) * vol_mult
    nb = math.ceil(MAX_H / BLOCK)
    starts = rng.integers(0, len(adj) - BLOCK, size=(n, nb))
    idx = (starts[:, :, None] + np.arange(BLOCK)).reshape(n, nb * BLOCK)[:, :MAX_H]
    paths = adj[idx]
    shock = float(req.get("shock_pct", 0) or 0)
    if shock:
        day = int(min(max(float(req.get("shock_day", 1)), 1), MAX_H))
        paths[:, day - 1] += math.log1p(shock / 100)
    return last * np.exp(np.cumsum(paths, axis=1))


def analogs(p: pd.Series, horizon: int, trigger: float) -> dict:
    """Geçmişte son 5 günde en az |trigger|% hareket (aynı yönde) yaşanan günler: sonraki `horizon` günde ne oldu?"""
    look = 5
    back = p / p.shift(look) - 1
    fwd = p.shift(-horizon) / p - 1
    mask = (back <= -abs(trigger) / 100) if trigger < 0 else (back >= trigger / 100)
    cand = back[mask & fwd.notna()].index
    picked, last_i = [], -10**9
    pos = {d: i for i, d in enumerate(p.index)}
    for d in cand:  # örtüşen olayları ele: en az 5 gün arayla
        if pos[d] - last_i >= look:
            picked.append(d)
            last_i = pos[d]
    if not picked:
        return {"count": 0}
    f = np.array([fwd[d] for d in picked]) * 100
    ev = [{"date": d.strftime("%Y-%m-%d"), "before": clean(back[d] * 100), "after": clean(fwd[d] * 100)} for d in picked[-8:]][::-1]
    return {"count": len(picked), "mean": clean(f.mean()), "median": clean(np.median(f)), "pos": clean((f > 0).mean() * 100),
            "p10": clean(np.percentile(f, 10)), "p90": clean(np.percentile(f, 90)), "events": ev, "horizon": horizon, "trigger": trigger}


def clean(x):
    x = float(x)
    return None if (math.isnan(x) or math.isinf(x)) else round(x, 4)


def run(req: dict) -> dict:
    p, label = load_prices(req)
    if len(p) < 120:
        return {"ok": False, "error": f"{label} için yeterli geçmiş yok ({len(p)} gün). En az ~120 işlem günü gerekir."}
    lr = np.log(p / p.shift(1)).dropna()
    lr = lr[lr.abs() < 0.5]  # bariz veri hatalarını ele
    r = lr.values
    last, last_date = float(p.iloc[-1]), p.index[-1]
    horizon = int(min(max(float(req.get("horizon", 63)), 5), MAX_H))
    rng = np.random.default_rng(19)
    sims = simulate(r, req, last, rng)  # (n, MAX_H)

    dates = [last_date.strftime("%Y-%m-%d")] + [d.strftime("%Y-%m-%d") for d in pd.bdate_range(last_date + pd.Timedelta(days=1), periods=MAX_H)]
    bands = {f"p{q}": [round(last, 6)] + [round(float(v), 6) for v in np.percentile(sims, q, axis=0)] for q in PCTS}

    term = sims[:, horizon - 1]
    ret = (term / last - 1) * 100
    hist_bins = np.histogram(ret, bins=40)
    table = []
    for h in HORIZONS:
        t = (sims[:, h - 1] / last - 1) * 100
        table.append({"days": h, "p5": clean(np.percentile(t, 5)), "p25": clean(np.percentile(t, 25)), "p50": clean(np.percentile(t, 50)),
                      "p75": clean(np.percentile(t, 75)), "p95": clean(np.percentile(t, 95)), "p_up": clean((t > 0).mean() * 100)})

    ann_vol = float(r.std() * math.sqrt(252) * 100)
    recent_vol = float(r[-30:].std() * math.sqrt(252) * 100) if len(r) > 40 else ann_vol
    mu_ann = float((math.exp(r.mean() * 252) - 1) * 100)
    shock = float(req.get("shock_pct", 0) or 0)
    trigger = shock if shock else -5.0
    an = analogs(p, horizon, trigger)

    drift_txt = {"zero": "beklenen getiriyi sıfır varsaydım (yalnızca oynaklık)", "hist": f"geçmişin ortalama getirisini (yıllık %{trn(mu_ann, 0)}) sürdürdüm",
                 "custom": f"yıllık %{trn(float(req.get('drift_pct', 0)), 1)} getiri varsaydım"}[req.get("drift", "zero")]
    lo, hi, med = np.percentile(ret, 5), np.percentile(ret, 95), np.percentile(ret, 50)
    notes = [
        f"{label} için son {len(r)} işlem gününün hareketlerinden {sims.shape[0]:,} olası yol ürettim; {drift_txt}.".replace(",", "."),
        f"{horizon} işlem günü sonrası için senaryoların ortası {pc(med)}; %90'ı {pc(lo)} ile {pc(hi)} arasında. Fiyat bugünkü {trn(last, 2)} seviyesinden bu aralığın dışına da çıkabilir.",
        f"Geçmiş yıllık oynaklık %{trn(ann_vol, 0)}; son 30 gündeki ise %{trn(recent_vol, 0)}. " + (
            "Son dönem geçmişten daha hareketli; koni gerçekte daha geniş olabilir." if recent_vol > ann_vol * 1.25 else
            "Son dönem geçmişten daha sakin; koni gerçekte daha dar kalabilir." if recent_vol < ann_vol * 0.75 else "Son dönem geçmişle benzer."),
    ]
    if shock:
        notes.append(f"Varsayım: {int(req.get('shock_day', 1))}. işlem gününde fiyatın bir defaya mahsus {pc(shock)} değişeceğini kendin girdin. Bu bir tahmin değil, senin varsayımın.")
    if an.get("count", 0) >= 5:
        notes.append(f"Geçmişte son 5 günde %{trn(abs(trigger), 0)} {'düşüş' if trigger < 0 else 'yükseliş'} yaşanan {an['count']} benzer durumdan {horizon} gün sonra bakınca, "
                     f"%{trn(an['pos'], 0)}'inde fiyat yükselmiş (ortanca {pc(an['median'])}). Örnek sayısı az olabilir; kalıp tekrarlanmak zorunda değil.")
    elif an.get("count", 0) > 0:
        notes.append(f"Benzer geçmiş durum yalnızca {an['count']} kez görülmüş; istatistik için yetersiz.")
    notes.append("Bu bir tahmin değil, senaryodur. Haber, savaş, ani karar gibi geçmişte görülmemiş olaylar konide yoktur. Yatırım tavsiyesi değildir.")

    return {"ok": True, "symbol": label, "last": round(last, 6), "last_date": dates[0], "horizon": horizon, "dates": dates,
            "history": [{"time": d.strftime("%Y-%m-%d"), "value": round(float(v), 6)} for d, v in p.iloc[-180:].items()],
            "bands": bands, "table": table,
            "hist": {"counts": [int(c) for c in hist_bins[0]], "edges": [round(float(e), 3) for e in hist_bins[1]]},
            "probs": {"up": clean((ret > 0).mean() * 100), "gt10": clean((ret >= 10).mean() * 100), "lt10": clean((ret <= -10).mean() * 100), "lt20": clean((ret <= -20).mean() * 100)},
            "stats": {"ann_vol": clean(ann_vol), "recent_vol": clean(recent_vol), "hist_return_ann": clean(mu_ann), "max_dd": clean(max_drawdown(p)),
                      "worst_day": clean(math.expm1(r.min()) * 100), "best_day": clean(math.expm1(r.max()) * 100), "days": len(r),
                      "from": p.index[0].strftime("%Y-%m-%d"), "to": last_date.strftime("%Y-%m-%d")},
            "analog": an, "notes": notes}


if __name__ == "__main__":
    try:
        out = run(json.loads(sys.stdin.read() or "{}"))
    except Exception as e:  # noqa: BLE001
        out = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    sys.stdout.write(json.dumps(out, ensure_ascii=False, default=str) + "\n")
