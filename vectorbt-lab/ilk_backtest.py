"""Rehberdeki ilk vectorbt örneği: 10/50 hareketli ortalama kesişimi (yalnızca geçmiş veri testi).

Çalıştırma:  .venv\\Scripts\\python.exe ilk_backtest.py [SEMBOL]
Örnek:       .venv\\Scripts\\python.exe ilk_backtest.py THYAO.IS
Yatırım tavsiyesi değildir.
"""
import sys

import vectorbt as vbt

symbol = sys.argv[1] if len(sys.argv) > 1 else "BTC-USD"
price = vbt.YFData.download(symbol, period="5y").get("Close")
fast = vbt.MA.run(price, 10)
slow = vbt.MA.run(price, 50)
entries = fast.ma_crossed_above(slow)
exits = fast.ma_crossed_below(slow)

pf = vbt.Portfolio.from_signals(price, entries, exits, init_cash=100, fees=0.001)
print(f"=== {symbol} | MA 10/50 | %0,1 komisyon ===")
print(pf.stats())
print(f"\nAl ve tut getirisi: {(price.iloc[-1] / price.iloc[0] - 1):.2%}")
