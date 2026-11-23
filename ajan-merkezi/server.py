"""Ajan Merkezi: üç borsa ajanını tek pencerede toplayan yerel web paneli.

- Kâşif     -> borsa-mcp (BIST, ABD, fon, döviz, kripto, makro verisi; MCP stdio üzerinden)
- Avcı      -> day-trader-skill Python betikleri (ABD gün içi tarama, haber, zaman makinesi, kongre)
- Simülatör -> vectorbt backtest (kendi sanal ortamında çalışan ayrı bir işçi süreç)

Yalnızca 127.0.0.1 üzerinde dinler. Hiçbir araç emir göndermez; yatırım tavsiyesi değildir.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import sys
import time
from pathlib import Path

import uvicorn
from fastmcp import Client
from fastmcp.client.transports import StdioTransport
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent  # D:\Library\Ajan-Borsa
WEB = HERE / "web"
SETTINGS_FILE = HERE / "settings.json"

BORSA_EXE = ROOT / "borsa-mcp" / ".venv" / "Scripts" / "borsa-mcp.exe"
VBT_PY = ROOT / "vectorbt-lab" / ".venv" / "Scripts" / "python.exe"
TRADER_DIR = ROOT / "day-trader-skill"
BACKTEST_WORKER = HERE / "workers" / "backtest.py"

HOST, PORT = "127.0.0.1", int(os.environ.get("AJAN_PORT", "8765"))

# ---------------------------------------------------------------- ayarlar

DEFAULT_SETTINGS = {"sec_user_agent": ""}


def load_settings() -> dict:
    try:
        return {**DEFAULT_SETTINGS, **json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))}
    except (OSError, ValueError):
        return dict(DEFAULT_SETTINGS)


def save_settings(data: dict) -> dict:
    s = load_settings()
    for k in DEFAULT_SETTINGS:
        if k in data and isinstance(data[k], str):
            s[k] = data[k].strip()[:200]
    SETTINGS_FILE.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")
    return s


# ---------------------------------------------------------------- borsa-mcp metin ayrıştırıcı

SECTION_RE = re.compile(r"^#{2,3}\s+(.*)$")
KV_RE = re.compile(r"^\s*([A-Za-z0-9_\-. ]{1,60}):\s?(.*)$")


def _num(v: str):
    t = v.strip()
    if re.fullmatch(r"-?\d+(\.\d+)?([eE][-+]?\d+)?", t):
        try:
            return float(t) if any(c in t for c in ".eE") else int(t)
        except ValueError:
            return t
    return t


def parse_mcp_text(text: str) -> list[dict]:
    """borsa-mcp'nin kompakt markdown çıktısını bölümlere ayırır: anahtar/değer ve TSV tabloları."""
    sections: list[dict] = []
    cur = {"title": "", "kv": [], "tables": [], "lines": []}
    in_tsv, tsv_rows = False, []

    def flush():
        nonlocal cur
        if cur["kv"] or cur["tables"] or cur["lines"]:
            sections.append(cur)
        cur = {"title": "", "kv": [], "tables": [], "lines": []}

    for raw in text.splitlines():
        line = raw.rstrip()
        if in_tsv:
            if line.startswith("```"):
                in_tsv = False
                if tsv_rows:
                    head = tsv_rows[0].split("\t")
                    rows = [[_num(c) for c in r.split("\t")] for r in tsv_rows[1:]]
                    cur["tables"].append({"columns": head, "rows": rows})
                tsv_rows = []
            else:
                tsv_rows.append(line)
            continue
        if line.startswith("```"):
            in_tsv, tsv_rows = True, []
            continue
        m = SECTION_RE.match(line)
        if m:
            flush()
            cur["title"] = m.group(1).strip()
            continue
        if not line.strip():
            continue
        m = KV_RE.match(line)
        if m and not line.lstrip().startswith("-"):
            cur["kv"].append([m.group(1).strip(), _num(m.group(2))])
        else:
            cur["lines"].append(line)
    flush()
    return sections


# ---------------------------------------------------------------- borsa-mcp istemcisi


class BorsaMCP:
    def __init__(self):
        self.client: Client | None = None
        self.tools: list[dict] = []
        self.error: str | None = None
        self._stack: contextlib.AsyncExitStack | None = None
        self._lock = asyncio.Lock()
        self._cache: dict[str, tuple[float, dict]] = {}

    async def start(self):
        if not BORSA_EXE.exists():
            self.error = f"borsa-mcp bulunamadı: {BORSA_EXE}"
            return
        try:
            self._stack = contextlib.AsyncExitStack()
            client = Client(StdioTransport(command=str(BORSA_EXE), args=[], cwd=str(BORSA_EXE.parent)))
            self.client = await self._stack.enter_async_context(client)
            tools = await self.client.list_tools()
            self.tools = [
                {"name": t.name, "description": (t.description or "")[:600],
                 "schema": getattr(t, "input_schema", None) or t.inputSchema}
                for t in tools
            ]
            self.error = None
        except Exception as e:  # noqa: BLE001 - durum ekranda gösterilir
            self.client, self.error = None, f"borsa-mcp başlatılamadı: {e}"

    async def stop(self):
        if self._stack:
            with contextlib.suppress(Exception):
                await self._stack.aclose()

    async def call(self, tool: str, args: dict, ttl: float = 0) -> dict:
        key = json.dumps([tool, args], sort_keys=True, ensure_ascii=False)
        if ttl and key in self._cache and time.time() - self._cache[key][0] < ttl:
            return self._cache[key][1]
        if self.client is None:
            async with self._lock:
                if self.client is None:
                    await self.start()
            if self.client is None:
                return {"ok": False, "error": self.error}
        try:
            r = await asyncio.wait_for(self.client.call_tool(tool, args, raise_on_error=False), timeout=120)
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}
        text = "\n".join(getattr(c, "text", "") for c in (r.content or []))
        out = {"ok": not getattr(r, "is_error", False), "text": text, "sections": parse_mcp_text(text)}
        if not out["ok"]:
            out["error"] = text[:800] or "Araç hata döndürdü"
        if ttl and out["ok"]:
            self._cache[key] = (time.time(), out)
        return out


borsa = BorsaMCP()       # kullanıcı istekleri
borsa_bg = BorsaMCP()    # piyasa bandı (kullanıcıyı bekletmesin diye ayrı süreç)


# ---------------------------------------------------------------- alt süreç yardımcıları


async def run_proc(cmd: list[str], cwd: Path, stdin: bytes | None = None, timeout: float = 240):
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=str(cwd), env=env,
        stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(stdin), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, "", "Zaman aşımı: işlem çok uzun sürdü"
    return proc.returncode, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


def _symbols(v, limit=60) -> list[str]:
    if isinstance(v, str):
        v = re.split(r"[\s,;]+", v)
    out = []
    for s in v or []:
        s = str(s).strip().upper()
        if re.fullmatch(r"[A-Z0-9.\-^=]{1,15}", s):
            out.append(s)
    return out[:limit]


def _f(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


TRADER_DEMO = {
    "timemachine": TRADER_DIR / "tests" / "fixtures" / "trader-timemachine" / "TSLA-60d5m.json.gz",
}


def trader_command(tool: str, a: dict) -> list[str]:
    py = sys.executable
    sec_ua = load_settings().get("sec_user_agent", "")
    if tool == "scanner":
        mode = a.get("mode") if a.get("mode") in ("daily", "orb") else "daily"
        cmd = [py, str(TRADER_DIR / "trader-scanner" / "scan.py"), mode, "--no-write", "--json", "--show", "200"]
        syms = _symbols(a.get("symbols", ""), 300)
        if syms:
            cmd += ["--symbols", ",".join(syms)]
        if _f(a.get("min_price")) is not None:
            cmd += ["--min-price", str(_f(a["min_price"]))]
        return cmd
    if tool == "news":
        syms = _symbols(a.get("symbols", ""), 25) or ["AAPL"]
        cmd = [py, str(TRADER_DIR / "trader-news" / "news.py"), "--tickers", *syms,
               "--dry-run", "--json", "--all", "--hours", str(_f(a.get("hours"), 48))]
        if sec_ua:
            cmd += ["--user-agent", sec_ua]
        else:
            cmd += ["--no-sec"]
        return cmd
    if tool == "analyst":
        syms = _symbols(a.get("symbols", ""), 5) or ["AAPL"]
        return [py, str(TRADER_DIR / "trader-analyst" / "facts.py"), *syms, "--quarters", "6",
                "--json", "--user-agent", sec_ua or "missing"]
    if tool == "pelosi":
        cmd = [py, str(TRADER_DIR / "trader-pelosi" / "ptr.py"), "index", "--json",
               "--limit", str(int(_f(a.get("limit"), 40)))]
        if a.get("member"):
            cmd += ["--member", re.sub(r"[^A-Za-zçğıöşüÇĞİÖŞÜ .\-]", "", str(a["member"]))[:40]]
        return cmd
    if tool == "timemachine":
        sym = (_symbols(a.get("symbol", ""), 1) or ["TSLA"])[0]
        cmd = [py, str(TRADER_DIR / "trader-timemachine" / "timemachine.py"), "run", "--json",
               "--symbol", sym, "--side", "sell" if a.get("side") == "sell" else "buy",
               "--replays", str(int(min(max(_f(a.get("replays"), 10000), 500), 20000)))]
        for k in ("entry", "stop", "target"):
            if _f(a.get(k)) is not None:
                cmd += [f"--{k}", str(_f(a[k]))]
        if a.get("entry_time"):
            cmd += ["--entry-time", re.sub(r"[^0-9: APMapm]", "", str(a["entry_time"]))[:10]]
        if a.get("date") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(a["date"])):
            cmd += ["--date", a["date"]]
        if a.get("demo"):
            cmd = [py, str(TRADER_DIR / "trader-timemachine" / "timemachine.py"), "run", "--json",
                   "--symbol", "TSLA", "--entry", "440", "--stop", "432", "--target", "456",
                   "--date", "2026-10-19", "--entry-time", "10:15 AM",
                   "--offline", str(TRADER_DEMO["timemachine"]), "--replays", "10000"]
        return cmd
    raise ValueError("bilinmeyen araç")


# ---------------------------------------------------------------- uç noktalar


async def index(_: Request):
    return FileResponse(WEB / "index.html")


async def api_status(_: Request):
    return JSONResponse({
        "kasif": {"ok": borsa.client is not None, "error": borsa.error, "tools": len(borsa.tools)},
        "avci": {"ok": TRADER_DIR.exists(), "sec_ua": bool(load_settings().get("sec_user_agent"))},
        "simulator": {"ok": VBT_PY.exists()},
        "port": PORT,
    })


async def api_tools(_: Request):
    return JSONResponse({"tools": borsa.tools, "error": borsa.error})


async def api_mcp(req: Request):
    body = await req.json()
    tool = str(body.get("tool", ""))
    if tool not in {t["name"] for t in borsa.tools}:
        return JSONResponse({"ok": False, "error": f"Bilinmeyen araç: {tool}"}, status_code=400)
    args = body.get("args") or {}
    args = {k: v for k, v in args.items() if v not in (None, "")}
    return JSONResponse(await borsa.call(tool, args, ttl=float(body.get("cache", 0) or 0)))


TAPE_TTL = 120


async def api_tape(_: Request):
    calls = [
        ("get_index_data", {"code": "XU100", "market": "bist"}),
        ("get_quote", {"symbol": ["USD", "EUR", "gram-altin"], "market": "fx"}),
        ("get_quote", {"symbol": "BTCTRY", "market": "crypto", "exchange": "btcturk"}),
        ("get_quote", {"symbol": ["THYAO", "ASELS", "GARAN", "BIMAS", "KCHOL", "TUPRS"], "market": "bist"}),
        ("get_quote", {"symbol": ["AAPL", "NVDA", "TSLA"], "market": "us"}),
    ]
    results = await asyncio.gather(*(borsa_bg.call(t, a, ttl=TAPE_TTL) for t, a in calls), return_exceptions=True)
    items = []

    def kvd(sec):
        return {k: v for k, v in sec["kv"]}

    for (tool, args), res in zip(calls, results):
        if isinstance(res, Exception) or not res.get("ok"):
            continue
        for sec in res["sections"]:
            if sec["title"] == "metadata":
                continue
            d = kvd(sec)
            if tool == "get_index_data" and "value" in d:
                items.append({"s": "BIST 100", "p": d["value"], "c": d.get("change_percent")})
            elif "price" in d and tool == "get_quote" and args["market"] == "crypto":
                items.append({"s": "BTC/TRY", "p": d["price"], "c": None})
            for tbl in sec["tables"]:
                cols = tbl["columns"]
                for row in tbl["rows"]:
                    r = dict(zip(cols, row))
                    name = str(r.get("symbol", ""))
                    price = r.get("last", r.get("current_price", r.get("price")))
                    if name and price not in (None, ""):
                        label = {"gram-altin": "GRAM ALTIN", "USD": "USD/TRY", "EUR": "EUR/TRY"}.get(name, name)
                        items.append({"s": label, "p": price, "c": r.get("change_percent")})
            if tool == "get_quote" and args["market"] in ("bist", "us") and "current_price" in d:
                items.append({"s": d.get("symbol", ""), "p": d["current_price"], "c": None})
    return JSONResponse({"items": items})


async def api_trader(req: Request):
    tool = req.path_params["tool"]
    body = await req.json()
    if tool == "analyst" and not load_settings().get("sec_user_agent"):
        return JSONResponse({"ok": False, "error": "SEC verisi için Ayarlar'a 'Ad Soyad e-posta' biçiminde bir SEC User-Agent girmelisin (SEC bunu zorunlu tutuyor)."})
    try:
        cmd = trader_command(tool, body)
    except ValueError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
    (ROOT / "trader").mkdir(exist_ok=True)
    code, out, err = await run_proc(cmd, ROOT, timeout=300)
    try:
        data = json.loads(out) if out.strip() else None
    except ValueError:
        data = None
    if data is None:
        msg = (err.strip().splitlines() or out.strip().splitlines() or ["Çıktı yok"])[-1]
        return JSONResponse({"ok": False, "error": msg, "stderr": err[-2000:], "stdout": out[-2000:]})
    return JSONResponse({"ok": code == 0, "data": data, "stderr": err[-1500:]})


async def api_backtest(req: Request):
    body = await req.json()
    if not VBT_PY.exists():
        return JSONResponse({"ok": False, "error": "vectorbt ortamı bulunamadı"})
    code, out, err = await run_proc([str(VBT_PY), str(BACKTEST_WORKER)], HERE,
                                    stdin=json.dumps(body).encode(), timeout=600)
    try:
        return JSONResponse(json.loads(out.strip().splitlines()[-1]))
    except (ValueError, IndexError):
        tail = [ln for ln in err.strip().splitlines() if ln.strip()]
        return JSONResponse({"ok": False, "error": tail[-1] if tail else "Backtest çalışmadı", "stderr": err[-2000:]})


BIST_WORKER = HERE / "workers" / "bist_zaman.py"


async def api_bist_timemachine(req: Request):
    body = await req.json()
    clean = {k: body.get(k) for k in ("symbol", "side", "entry", "stop", "target", "entry_time", "replays")}
    clean["symbol"] = (_symbols(clean.get("symbol") or "THYAO", 1) or ["THYAO"])[0]
    code, out, err = await run_proc([str(VBT_PY), str(BIST_WORKER)], HERE, stdin=json.dumps(clean).encode(), timeout=180)
    try:
        data = json.loads(out.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return JSONResponse({"ok": False, "error": "BIST Zaman Makinesi çalışmadı", "stderr": err[-1500:]})
    if not data.get("ok"):
        return JSONResponse({"ok": False, "error": data.get("error")})
    return JSONResponse({"ok": True, "data": data})


SCENARIO_WORKER = HERE / "workers" / "scenario.py"


async def fund_series(code: str, years: int) -> list | str:
    """TEFAS fon geçmişi: uzun aralıklar seyreltildiği için 1'er yıllık parçalar halinde çekilir."""
    from datetime import date, timedelta
    end, rows = date.today(), {}
    for i in range(years):
        e = end - timedelta(days=365 * i)
        s = e - timedelta(days=365)
        r = await borsa.call("get_historical_data", {"symbol": code, "market": "fund", "start_date": s.isoformat(), "end_date": e.isoformat()}, ttl=600)
        if not r.get("ok"):
            if i == 0:
                return r.get("error") or "Fon verisi alınamadı"
            break
        tbl = next((t for sec in r["sections"] for t in sec["tables"] if "close" in t["columns"]), None)
        if not tbl:
            break
        d, c = tbl["columns"].index("date"), tbl["columns"].index("close")
        for row in tbl["rows"]:
            if isinstance(row[c], (int, float)):
                rows[str(row[d])[:10]] = float(row[c])
    if len(rows) < 120:
        return f"{code} fonu için yeterli geçmiş fiyat bulunamadı ({len(rows)} gün)"
    return sorted(rows.items())


async def api_scenario(req: Request):
    body = await req.json()
    market = body.get("market") if body.get("market") in ("bist", "us", "crypto", "index", "fund") else "bist"
    sym = re.sub(r"[^A-Z0-9.\-^=]", "", str(body.get("symbol", "")).upper())[:15]
    if not sym:
        return JSONResponse({"ok": False, "error": "Sembol boş olamaz"})
    clean = {"symbol": sym, "market": market, "horizon": body.get("horizon", 63), "years": body.get("years", 3), "drift": body.get("drift", "zero"),
             "drift_pct": body.get("drift_pct", 0), "shock_pct": body.get("shock_pct", 0), "shock_day": body.get("shock_day", 1), "vol_mult": body.get("vol_mult", 1)}
    for k in ("horizon", "years", "drift_pct", "shock_pct", "shock_day", "vol_mult"):
        clean[k] = _f(clean[k], 0 if k in ("drift_pct", "shock_pct") else 1)
    if clean["drift"] not in ("zero", "hist", "custom"):
        clean["drift"] = "zero"
    if market == "fund":
        res = await fund_series(sym, int(min(max(clean["years"], 1), 5)))
        if isinstance(res, str):
            return JSONResponse({"ok": False, "error": res})
        clean["series"] = res
    code, out, err = await run_proc([str(VBT_PY), str(SCENARIO_WORKER)], HERE, stdin=json.dumps(clean).encode(), timeout=300)
    try:
        return JSONResponse(json.loads(out.strip().splitlines()[-1]))
    except (ValueError, IndexError):
        tail = [ln for ln in err.strip().splitlines() if ln.strip()]
        return JSONResponse({"ok": False, "error": tail[-1] if tail else "Senaryo çalışmadı", "stderr": err[-1500:]})


_hist_cache: dict[str, tuple[float, dict]] = {}


async def api_history(req: Request):
    q = req.query_params
    body = {"mode": "history", "symbol": q.get("symbol", ""), "market": q.get("market", "bist"),
            "period": q.get("period", "1y") if q.get("period") in ("1mo", "3mo", "6mo", "1y", "2y", "5y") else "1y"}
    key = json.dumps(body, sort_keys=True)
    if key in _hist_cache and time.time() - _hist_cache[key][0] < 300:
        return JSONResponse(_hist_cache[key][1])
    code, out, err = await run_proc([str(VBT_PY), str(BACKTEST_WORKER)], HERE, stdin=key.encode(), timeout=120)
    try:
        data = json.loads(out.strip().splitlines()[-1])
    except (ValueError, IndexError):
        data = {"ok": False, "error": "Geçmiş veri alınamadı"}
    if data.get("ok"):
        _hist_cache[key] = (time.time(), data)
    return JSONResponse(data)


async def api_settings(req: Request):
    if req.method == "POST":
        s = save_settings(await req.json())
    else:
        s = load_settings()
    return JSONResponse({"sec_user_agent": s.get("sec_user_agent", "")})


async def api_shutdown(_: Request):
    async def _later():
        await asyncio.sleep(0.4)
        os._exit(0)
    asyncio.get_running_loop().create_task(_later())
    return JSONResponse({"ok": True})


@contextlib.asynccontextmanager
async def lifespan(_app):
    await asyncio.gather(borsa.start(), borsa_bg.start())
    yield
    await borsa.stop()
    await borsa_bg.stop()


class NoCache(BaseHTTPMiddleware):
    """Tarayıcı (özellikle Edge uygulama penceresi) eski arayüz dosyalarını önbellekte tutmasın."""

    async def dispatch(self, request, call_next):
        resp = await call_next(request)
        resp.headers["Cache-Control"] = "no-store"
        return resp


app = Starlette(
    middleware=[Middleware(NoCache)],
    routes=[
        Route("/", index),
        Route("/api/status", api_status),
        Route("/api/tools", api_tools),
        Route("/api/mcp", api_mcp, methods=["POST"]),
        Route("/api/tape", api_tape),
        Route("/api/trader/{tool}", api_trader, methods=["POST"]),
        Route("/api/backtest", api_backtest, methods=["POST"]),
        Route("/api/history", api_history),
        Route("/api/scenario", api_scenario, methods=["POST"]),
        Route("/api/bist/timemachine", api_bist_timemachine, methods=["POST"]),
        Route("/api/settings", api_settings, methods=["GET", "POST"]),
        Route("/api/shutdown", api_shutdown, methods=["POST"]),
        Mount("/static", StaticFiles(directory=WEB), name="static"),
    ],
    lifespan=lifespan,
)

if __name__ == "__main__":
    if sys.stdout is None or sys.stderr is None:  # pythonw ile konsolsuz çalışırken günlüğü dosyaya yaz
        log = open(HERE / "panel.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
        sys.stdout = sys.stderr = log
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
