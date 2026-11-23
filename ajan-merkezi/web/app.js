/* Ajan Borsa Merkezi — arayüz */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}
const svgUse = (id, cls) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("class", cls); const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + id); s.append(u); return s; };
const isNum = (v) => typeof v === "number" && isFinite(v);
function fmt(v, d = 2) {
  if (!isNum(v)) return v == null ? "—" : String(v);
  const a = Math.abs(v);
  if (a >= 1e12) return (v / 1e12).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " trn";
  if (a >= 1e9) return (v / 1e9).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " mr";
  if (a >= 1e7) return (v / 1e6).toLocaleString("tr-TR", { maximumFractionDigits: 1 }) + " mn";
  return v.toLocaleString("tr-TR", { maximumFractionDigits: a < 1 ? 4 : d });
}
const pct = (v, d = 1) => (isNum(v) ? (v > 0 ? "+" : "") + v.toLocaleString("tr-TR", { maximumFractionDigits: d }) + "%" : "—");
const cls = (v) => (isNum(v) ? (v > 0 ? "up" : v < 0 ? "down" : "") : "");
const LABELS = {
  current_price: "Fiyat", price: "Fiyat", volume: "Hacim", market_cap: "Piyasa değeri", pe_ratio: "F/K", pb_ratio: "PD/DD",
  week_52_high: "52h en yüksek", week_52_low: "52h en düşük", change_percent: "Değişim %", change: "Değişim", open: "Açılış",
  high: "Yüksek", low: "Düşük", close: "Kapanış", previous_close: "Önceki kapanış", currency: "Para birimi", name: "Ad",
  sector: "Sektör", industry: "Endüstri", dividend_yield: "Temettü verimi", value: "Değer", bid: "Alış", ask: "Satış",
  volume_24h: "24s hacim", high_24h: "24s yüksek", low_24h: "24s düşük", last: "Son",
};
const label = (k) => LABELS[k] || String(k).replace(/_/g, " ");

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok && r.status >= 500) throw new Error("Sunucu hatası " + r.status);
  return r.json();
}
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 3200); }
function loader(mascot, msg) { return h("div", { class: "loader busy" }, svgUse(mascot, ""), h("p", {}, msg, h("span", { class: "dots" }))); }
function errorBox(msg) { return h("div", { class: "error-box" }, "⚠ ", msg || "Bir şeyler ters gitti"); }

/* ---------------------------------------------------------------- grafik */
const CHART_BASE = {
  layout: { background: { type: "solid", color: "transparent" }, textColor: "#8a97b1", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
  grid: { vertLines: { color: "rgba(148,163,184,.07)" }, horzLines: { color: "rgba(148,163,184,.07)" } },
  rightPriceScale: { borderColor: "rgba(148,163,184,.2)" }, timeScale: { borderColor: "rgba(148,163,184,.2)" },
  crosshair: { mode: 0 }, autoSize: true,
  localization: { locale: "tr-TR", priceFormatter: (p) => fmt(p) },
};
function makeChart(el) {
  if (!window.LightweightCharts) { el.append(h("p", { class: "muted" }, "Grafik kütüphanesi yüklenemedi (internet bağlantısını kontrol et).")); return null; }
  return LightweightCharts.createChart(el, CHART_BASE);
}
const toTime = (d) => String(d).slice(0, 10);
function candleFromTable(tbl) {
  const ix = (n) => tbl.columns.indexOf(n);
  const [d, o, hi, lo, c] = ["date", "open", "high", "low", "close"].map(ix);
  const seen = new Set(), out = [];
  for (const r of tbl.rows) {
    const t = toTime(r[d]); if (seen.has(t)) continue; seen.add(t);
    if (o >= 0 && hi >= 0 && lo >= 0) out.push({ time: t, open: r[o], high: r[hi], low: r[lo], close: r[c] });
    else out.push({ time: t, value: r[c] });
  }
  return out.sort((a, b) => (a.time < b.time ? -1 : 1));
}
function priceChart(el, tbl) {
  const ch = makeChart(el); if (!ch) return;
  const data = candleFromTable(tbl);
  if (data.length && "open" in data[0]) {
    const s = ch.addCandlestickSeries({ upColor: "#22c55e", downColor: "#f43f5e", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#f43f5e" });
    s.setData(data);
  } else {
    const s = ch.addAreaSeries({ lineColor: "#2dd4bf", topColor: "rgba(45,212,191,.3)", bottomColor: "rgba(45,212,191,0)" });
    s.setData(data);
  }
  ch.timeScale().fitContent();
}

/* ---------------------------------------------------------------- genel çıktı çizimi */
function kvGrid(pairs) {
  return h("div", { class: "kv-grid" }, pairs.map(([k, v]) => h("div", { class: "kv" }, h("small", { title: k }, label(k)), h("b", { class: /change|pct|percent/.test(k) ? cls(v) : "" }, isNum(v) ? fmt(v) : String(v)))));
}
function table(columns, rows, opts = {}) {
  const t = h("table");
  const thead = h("thead", {}, h("tr", {}, columns.map((c, i) => h("th", { onclick: () => sortBy(i) }, label(c)))));
  const tbody = h("tbody");
  let data = rows.slice(0, opts.max || 500), dir = 1;
  const draw = () => { tbody.replaceChildren(...data.map((r) => h("tr", {}, r.map((v, i) => {
    const c = columns[i];
    if (opts.link && opts.link[c]) return h("td", {}, h("a", { href: v, target: "_blank", rel: "noopener" }, "PDF ↗"));
    return h("td", { class: isNum(v) ? "num " + (/change|pct|return|getiri|pnl/.test(c) ? cls(v) : "") : "" }, isNum(v) ? fmt(v) : v == null ? "—" : String(v));
  })))); };
  function sortBy(i) { dir = -dir; data.sort((a, b) => (a[i] > b[i] ? dir : a[i] < b[i] ? -dir : 0)); draw(); }
  draw(); t.append(thead, tbody);
  return h("div", { class: "tbl-wrap" }, t);
}
function rawTable(headers, rows) {
  return h("div", { class: "tbl-wrap" }, h("table", {}, h("thead", {}, h("tr", {}, headers.map((x) => h("th", {}, x)))),
    h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c) => (c instanceof Node ? c : h("td", {}, String(c)))))))));
}
const numCell = (v, d = 1) => h("td", { class: "num " + cls(v) }, pct(v, d));
function renderSections(sections, rawText) {
  const box = h("div");
  for (const s of sections) {
    const isMeta = s.title === "metadata";
    if (isMeta) {
      const meta = Object.fromEntries(s.kv);
      box.append(h("p", { class: "muted", style: "font-size:12px;margin:0 0 6px" }, `Kaynak: ${meta.source || "?"} · ${meta.timestamp ? new Date(meta.timestamp).toLocaleString("tr-TR") : ""}`));
      continue;
    }
    const sec = h("div", { class: "sec" });
    if (s.title) sec.append(h("h4", {}, label(s.title)));
    if (s.kv.length) sec.append(kvGrid(s.kv));
    for (const tbl of s.tables) {
      if (tbl.columns.includes("date") && tbl.columns.includes("close") && tbl.rows.length > 2) {
        const cb = h("div", { class: "chart-box sm card", style: "margin-bottom:10px;padding:8px" }); sec.append(cb);
        requestAnimationFrame(() => priceChart(cb, tbl));
      }
      sec.append(table(tbl.columns, tbl.rows));
    }
    if (s.lines.length) sec.append(h("div", { class: "raw" }, s.lines.join("\n")));
    box.append(sec);
  }
  if (rawText) box.append(h("details", {}, h("summary", {}, "Ham çıktıyı göster"), h("div", { class: "raw" }, rawText)));
  return box;
}
function renderJSON(obj, depth = 0) {
  if (Array.isArray(obj)) {
    if (!obj.length) return h("p", { class: "muted" }, "Sonuç yok.");
    if (typeof obj[0] === "object" && obj[0]) {
      const cols = [...new Set(obj.flatMap((o) => Object.keys(o).filter((k) => typeof o[k] !== "object" || o[k] === null || Array.isArray(o[k]))))];
      return table(cols, obj.map((o) => cols.map((c) => (Array.isArray(o[c]) ? o[c].join(", ") : o[c]))), { link: { url: true } });
    }
    return h("div", { class: "raw" }, obj.join(", "));
  }
  if (obj && typeof obj === "object") {
    const box = h("div");
    const scal = Object.entries(obj).filter(([, v]) => v === null || typeof v !== "object");
    if (scal.length) box.append(kvGrid(scal));
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && depth < 3) {
        if (Array.isArray(v) && v.length && typeof v[0] !== "object") { box.append(h("div", { class: "sec" }, h("h4", {}, label(k)), h("div", { class: "raw" }, JSON.stringify(v)))); continue; }
        box.append(h("div", { class: "sec" }, h("h4", {}, label(k)), renderJSON(v, depth + 1)));
      }
    }
    return box;
  }
  return h("div", { class: "raw" }, String(obj));
}

/* ---------------------------------------------------------------- yönlendirme */
const VIEWS = ["home", "kasif", "avci", "sim"];
function route() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
  $$(".view").forEach((s) => (s.hidden = s.dataset.view !== v));
  $$(".dock-btn[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === v));
  $("#main").scrollTop = 0;
  if (v === "kasif") Kasif.init();
  if (v === "avci") Avci.init();
}
window.addEventListener("hashchange", route);
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input,textarea,select") || e.ctrlKey || e.metaKey || e.altKey) return;
  const m = { 0: "home", 1: "kasif", 2: "avci", 3: "sim" }[e.key];
  if (m) location.hash = m;
});

/* ---------------------------------------------------------------- saat, durum, bant */
function marketOpen(tz, [oh, om], [ch, cm]) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  if (["Sat", "Sun"].includes(p.weekday)) return false;
  const mins = (+p.hour % 24) * 60 + +p.minute;
  return mins >= oh * 60 + om && mins < ch * 60 + cm;
}
function tickClock() {
  const f = (tz) => new Date().toLocaleTimeString("tr-TR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  $("#clk-ist").textContent = f("Europe/Istanbul");
  $("#clk-ny").textContent = f("America/New_York");
  const bist = marketOpen("Europe/Istanbul", [10, 0], [18, 0]), ny = marketOpen("America/New_York", [9, 30], [16, 0]);
  $("#bist-dot").classList.toggle("open", bist); $("#bist-dot").title = bist ? "BIST açık" : "BIST kapalı";
  $("#nyse-dot").classList.toggle("open", ny); $("#nyse-dot").title = ny ? "New York açık" : "New York kapalı";
  const isBist = typeof Avci === "undefined" || Avci.market === "bist", openNow = isBist ? bist : ny;
  const pill = $("#ny-status"); pill.textContent = (isBist ? "BIST " : "New York ") + (openNow ? "● seans açık" : "○ seans kapalı"); pill.classList.toggle("open", openNow);
  $("#hero-date").textContent = new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long" });
}
async function refreshStatus() {
  try {
    const s = await api("/api/status");
    if (s.boot) { if (window.__boot && window.__boot !== s.boot) { location.reload(); return; } window.__boot = s.boot; }
    for (const [k, v] of Object.entries(s)) $$(`[data-status="${k}"]`).forEach((el) => { el.className = "status " + (v.ok ? "ok" : "err"); el.title = v.ok ? "Hazır" : v.error || "Hazır değil"; });
  } catch { /* sunucu kapanmış olabilir */ }
}
async function refreshTape() {
  try {
    const { items } = await api("/api/tape");
    if (!items.length) return;
    const node = (i) => h("span", { class: "tape-item" }, h("b", {}, i.s), fmt(i.p), isNum(i.c) ? h("span", { class: cls(i.c) }, (i.c > 0 ? "▲ " : i.c < 0 ? "▼ " : "") + pct(i.c, 2)) : null);
    $("#tape").replaceChildren(...items.map(node), ...items.map(node));
    $("#market-strip").replaceChildren(...items.slice(0, 12).map((i) => h("div", { class: "mini" }, h("small", {}, i.s), h("b", {}, fmt(i.p)), isNum(i.c) ? h("span", { class: cls(i.c) }, pct(i.c, 2)) : null)));
  } catch { /* yoksay */ }
}

let TOOLS_P = null;
const loadTools = () => (TOOLS_P ||= api("/api/tools").then((r) => r.tools || []).catch(() => []));

/* ---------------------------------------------------------------- KÂŞİF */
const Kasif = {
  ready: false, tools: [], active: null,
  ctx() { return { symbol: $("#k-symbol").value.trim().toUpperCase(), market: $("#k-market").value }; },
  enumOf(tool, prop) {
    const t = this.tools.find((x) => x.name === tool); const p = t?.schema?.properties?.[prop]; if (!p) return [];
    return p.enum || (p.anyOf || []).flatMap((a) => a.enum || []);
  },
  tasks() {
    const sm = (allowed, fallback) => (m) => (allowed.includes(m) ? m : fallback);
    return [
      { id: "ta", ico: "📈", t: "Teknik analiz", d: "RSI, MACD, hareketli ortalamalar", tool: "get_technical_analysis",
        f: [{ n: "timeframe", l: "Zaman dilimi", o: ["1d", "1h", "4h", "1W", "15m"] }], a: (c, v) => ({ symbol: c.symbol, market: sm(["bist", "us", "crypto"], "bist")(c.market), timeframe: v.timeframe, include_pivots: true }) },
      { id: "ratios", ico: "🧮", t: "Finansal oranlar", d: "Değerleme, Buffett, sağlık", tool: "get_financial_ratios",
        f: [{ n: "ratio_set", l: "Set", o: ["valuation", "buffett", "core_health", "advanced", "comprehensive"] }], a: (c, v) => ({ symbol: c.symbol, market: sm(["bist", "us"], "bist")(c.market), ratio_set: v.ratio_set }) },
      { id: "fs", ico: "📑", t: "Finansal tablolar", d: "Bilanço, gelir, nakit akışı", tool: "get_financial_statements",
        f: [{ n: "statement_type", l: "Tablo", o: ["income", "balance", "cashflow", "all"] }, { n: "period", l: "Dönem", o: ["annual", "quarterly"] }],
        a: (c, v) => ({ symbol: c.symbol, market: sm(["bist", "us"], "bist")(c.market), statement_type: v.statement_type, period: v.period, last_n: 4 }) },
      { id: "analyst", ico: "🎯", t: "Analist beklentileri", d: "Hedef fiyat ve tavsiye dağılımı", tool: "get_analyst_data", a: (c) => ({ symbol: c.symbol, market: sm(["bist", "us"], "bist")(c.market) }) },
      { id: "earn", ico: "🗓️", t: "Bilanço takvimi", d: "Geçmiş ve gelecek kazanç tarihleri", tool: "get_earnings", a: (c) => ({ symbol: c.symbol, market: sm(["bist", "us"], "bist")(c.market) }) },
      { id: "profile", ico: "🏢", t: "Şirket profili", d: "Sektör, açıklama, katılım uyumu", tool: "get_profile", a: (c) => ({ symbol: c.symbol, market: sm(["bist", "us", "fund"], "bist")(c.market), include_islamic: true }) },
      { id: "corp", ico: "💸", t: "Temettü ve sermaye", d: "Temettü, bedelsiz, bölünme", tool: "get_corporate_actions", a: (c) => ({ symbol: c.symbol, market: sm(["bist", "us"], "bist")(c.market) }) },
      { id: "news", ico: "📰", t: "KAP ve haberler", d: "Son bildirimler", tool: "get_news", f: [{ n: "limit", l: "Adet", o: ["10", "20", "30"] }], a: (c, v) => ({ symbol: c.symbol, limit: +v.limit }) },
      { id: "sector", ico: "🧭", t: "Sektör karşılaştırma", d: "Rakiplere göre konum", tool: "get_sector_comparison", a: (c) => ({ symbol: c.symbol, market: sm(["bist", "us"], "bist")(c.market) }) },
      { id: "scan", ico: "🔭", t: "BIST teknik tarama", d: "Endeks içinde sinyal avı", tool: "scan_stocks",
        f: [{ n: "index", l: "Endeks", o: () => this.enumOf("scan_stocks", "index") }, { n: "preset", l: "Hazır tarama", o: () => this.enumOf("scan_stocks", "preset") }], a: (c, v) => ({ index: v.index, preset: v.preset }) },
      { id: "screen", ico: "🧲", t: "Hisse eleme", d: "Değer, büyüme, temettü…", tool: "screen_securities",
        f: [{ n: "market", l: "Piyasa", o: ["bist", "us"] }, { n: "preset", l: "Hazır filtre", o: () => this.enumOf("screen_securities", "preset") }], a: (c, v) => ({ market: v.market, preset: v.preset, limit: 25 }) },
      { id: "funds", ico: "🏦", t: "Fon tarama (TEFAS)", d: "Getiriye göre sıralı fonlar", tool: "screen_funds",
        f: [{ n: "fund_type", l: "Tür", o: ["YAT", "EMK"] }, { n: "sort_by", l: "Sırala", o: ["return_1y", "return_1m", "return_3m", "return_6m", "return_3y", "weekly_return"] }], a: (c, v) => ({ fund_type: v.fund_type, sort_by: v.sort_by, limit: 25 }) },
      { id: "compare", ico: "⚖️", t: "Varlık karşılaştır", d: "Hisse, altın, döviz, kripto, fon", tool: "compare_assets",
        f: [{ n: "assets", l: "Varlıklar (virgülle)", v: "THYAO, gram-altin, USD, BTCTRY" }, { n: "start_date", l: "Başlangıç", type: "date", v: new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10) }, { n: "base_currency", l: "Para birimi", o: ["TRY", "USD"] }],
        a: (c, v) => ({ assets: v.assets.split(/[,;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 10), start_date: v.start_date, base_currency: v.base_currency, initial_amount: 10000 }) },
      { id: "index", ico: "🧱", t: "Endeks ve bileşenleri", d: "XU100, XU030, sektör endeksleri", tool: "get_index_data",
        f: [{ n: "code", l: "Endeks kodu", v: "XU030" }], a: (c, v) => ({ code: v.code.toUpperCase(), market: "bist", include_components: true }) },
      { id: "infl", ico: "🔥", t: "Enflasyon (TÜFE/ÜFE)", d: "TCMB verisi", tool: "get_macro_data",
        f: [{ n: "inflation_type", l: "Tür", o: ["tufe", "ufe"] }], a: (c, v) => ({ data_type: "inflation", inflation_type: v.inflation_type, limit: 24 }) },
      { id: "cal", ico: "📅", t: "Ekonomik takvim", d: "Bu haftanın önemli verileri", tool: "get_economic_calendar",
        f: [{ n: "country", l: "Ülke", o: ["TR", "US", "EU", "DE", "GB", "JP", "CN"] }, { n: "importance", l: "Önem", o: ["high", "medium", "low"] }], a: (c, v) => ({ country: v.country, importance: v.importance }) },
      { id: "bond", ico: "🏛️", t: "Tahvil faizleri", d: "Getiri eğrisi", tool: "get_bond_yields", f: [{ n: "country", l: "Ülke", v: "TR" }], a: (c, v) => ({ country: v.country }) },
      { id: "crypto", ico: "🪙", t: "Kripto piyasası", d: "BtcTurk / Coinbase", tool: "get_crypto_market",
        f: [{ n: "symbol", l: "Parite", v: "BTCTRY" }, { n: "exchange", l: "Borsa", o: ["btcturk", "coinbase"] }, { n: "data_type", l: "Veri", o: ["ticker", "orderbook", "trades", "ohlc"] }], a: (c, v) => ({ symbol: v.symbol.toUpperCase(), exchange: v.exchange, data_type: v.data_type }) },
      { id: "adv", ico: "🛠️", t: "Tüm araçlar", d: "Her araç, serbest parametreyle", tool: null },
    ];
  },
  async init() {
    if (this.ready) return; this.ready = true;
    $("#k-search").addEventListener("submit", (e) => { e.preventDefault(); this.overview(); });
    this.tools = await loadTools();
    if (this.tools.length) $("#k-toolcount").textContent = this.tools.length;
    $("#k-tasks").replaceChildren(...this.tasks().map((t) => h("button", { class: "task", "data-id": t.id, onclick: () => this.open(t) }, h("span", { class: "ico" }, t.ico), h("span", {}, h("b", {}, t.t), h("small", {}, t.d)))));
    this.overview();
  },
  async overview() {
    const c = this.ctx(), box = $("#k-overview"), period = $("#k-period").value;
    if (!c.symbol) return;
    box.replaceChildren(loader("m-kasif", `${c.symbol} için veri toplanıyor`));
    let quoteCall;
    if (c.market === "fund") quoteCall = { tool: "get_fund_data", args: { symbol: c.symbol } };
    else if (c.market === "crypto") quoteCall = { tool: "get_quote", args: { symbol: c.symbol, market: "crypto", exchange: c.symbol.endsWith("TRY") ? "btcturk" : "coinbase" } };
    else quoteCall = { tool: "get_quote", args: { symbol: c.symbol, market: c.market } };
    const histArgs = { symbol: c.symbol, market: c.market, period };
    if (c.market === "crypto") histArgs.exchange = quoteCall.args.exchange;
    const yahooOk = ["bist", "us", "crypto"].includes(c.market);
    const histReq = yahooOk
      ? api(`/api/history?symbol=${encodeURIComponent(c.symbol)}&market=${c.market}&period=${period}`).then((d) => (d.ok ? { ok: true, sections: [{ title: "", kv: [], lines: [], tables: [{ columns: d.columns, rows: d.rows }] }] } : d))
      : api("/api/mcp", { tool: "get_historical_data", args: histArgs, cache: 300 });
    const [q, hist] = await Promise.all([api("/api/mcp", { ...quoteCall, cache: 60 }), histReq]).catch((e) => [{ ok: false, error: e.message }, { ok: false }]);
    if (!q.ok && !hist.ok) { box.replaceChildren(errorBox(q.error || hist.error)); return; }
    const kv = Object.fromEntries((q.sections || []).filter((s) => s.title !== "metadata").flatMap((s) => s.kv));
    const price = kv.current_price ?? kv.price ?? kv.last ?? kv.value ?? kv.price_try;
    const card = h("div", { class: "card quote-card" }, h("div", { class: "qsym" }, c.symbol), h("small", { class: "muted" }, kv.name && kv.name !== c.symbol ? kv.name : c.market.toUpperCase()),
      h("div", { class: "qprice" }, fmt(price), " ", h("small", { class: "muted", style: "font-size:14px" }, kv.currency || "")),
      kvGrid(Object.entries(kv).filter(([k]) => !["symbol", "name", "market", "currency", "current_price", "price"].includes(k)).slice(0, 10)));
    if (!q.ok) card.append(errorBox(q.error));
    const chartCard = h("div", { class: "card" }, h("div", { class: "res-head" }, h("h3", {}, "Fiyat grafiği"), h("small", { class: "muted" }, period)));
    const cb = h("div", { class: "chart-box" }); chartCard.append(cb);
    box.replaceChildren(card, chartCard);
    const tbl = (hist.sections || []).flatMap((s) => s.tables).find((t) => t.columns.includes("close"));
    if (tbl) priceChart(cb, tbl); else cb.append(h("p", { class: "muted" }, hist.error || "Bu varlık için geçmiş fiyat bulunamadı."));
  },
  open(t) {
    $$("#k-tasks .task").forEach((b) => b.classList.toggle("active", b.dataset.id === t.id));
    const res = $("#k-result");
    if (!t.tool) return this.advanced(res);
    const form = h("form", { class: "task-form" });
    for (const f of t.f || []) {
      const opts = typeof f.o === "function" ? f.o() : f.o;
      const inp = opts ? h("select", { name: f.n }, opts.map((o) => h("option", { value: o }, label(o)))) : h("input", { name: f.n, value: f.v || "", type: f.type || "text" });
      form.append(h("label", {}, f.l, inp));
    }
    form.append(h("button", { class: "btn primary" }, "Çalıştır"));
    const out = h("div");
    res.replaceChildren(h("div", { class: "card" }, h("div", { class: "res-head" }, h("h3", {}, t.ico + " " + t.t), h("small", { class: "muted" }, "Sembol: " + this.ctx().symbol + " · araç: " + t.tool)), form, out));
    const run = async (e) => {
      e?.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      out.replaceChildren(loader("m-kasif", "Kâşif veriyi getiriyor"));
      try {
        const r = await api("/api/mcp", { tool: t.tool, args: t.a(this.ctx(), v) });
        out.replaceChildren(r.ok ? renderSections(r.sections, r.text) : errorBox(r.error));
      } catch (err) { out.replaceChildren(errorBox(err.message)); }
    };
    form.addEventListener("submit", run);
    if (!(t.f || []).length) run();
    res.scrollIntoView({ behavior: "smooth", block: "start" });
  },
  advanced(res) {
    const sel = h("select", {}, this.tools.map((t) => h("option", { value: t.name }, t.name)));
    const desc = h("p", { class: "muted", style: "font-size:13px;white-space:pre-wrap" });
    const ta = h("textarea", { rows: 6, style: "width:100%;font-family:var(--mono)" });
    const out = h("div");
    const fill = () => {
      const t = this.tools.find((x) => x.name === sel.value); if (!t) return;
      desc.textContent = t.description;
      const args = {}; const c = this.ctx();
      for (const r of t.schema.required || []) args[r] = r === "symbol" ? c.symbol : r === "market" ? c.market : "";
      ta.value = JSON.stringify(args, null, 2);
    };
    sel.addEventListener("change", fill); fill();
    const btn = h("button", { class: "btn primary", onclick: async () => {
      let args; try { args = JSON.parse(ta.value || "{}"); } catch { return toast("Parametreler geçerli JSON değil"); }
      out.replaceChildren(loader("m-kasif", "Çalışıyor"));
      const r = await api("/api/mcp", { tool: sel.value, args });
      out.replaceChildren(r.ok ? renderSections(r.sections, r.text) : errorBox(r.error));
    } }, "Çalıştır");
    res.replaceChildren(h("div", { class: "card" }, h("div", { class: "res-head" }, h("h3", {}, "🛠️ Tüm araçlar")), h("div", { class: "task-form" }, h("label", {}, "Araç", sel), btn), desc, h("label", { class: "muted", style: "font-size:12px" }, "Parametreler (JSON)"), ta, out));
  },
};

/* ---------------------------------------------------------------- AVCI */
const PRESETS = {
  "Dev 30": "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,AVGO,BRK-B,JPM,LLY,V,UNH,XOM,MA,COST,HD,PG,JNJ,NFLX,ABBV,BAC,CRM,ORCL,AMD,KO,PEP,WMT,ADBE,DIS",
  "Yarı iletken": "NVDA,AMD,AVGO,INTC,QCOM,MU,TSM,ASML,AMAT,LRCX,KLAC,MRVL,ON,TXN,ADI,SMCI,ARM",
  "Popüler": "TSLA,PLTR,SOFI,AMD,NIO,RIVN,COIN,MARA,HOOD,UBER,SHOP,SNAP,RBLX,AFRM,DKNG,NVDA,AAPL",
};
const Avci = {
  ready: false, tab: "scanner", market: "bist",
  async init() {
    if (this.ready) return; this.ready = true;
    $$("#a-flow li").forEach((li) => li.addEventListener("click", () => this.show(li.dataset.tab)));
    $$("#a-market button").forEach((b) => b.addEventListener("click", () => this.setMarket(b.dataset.m)));
    Kasif.tools = Kasif.tools.length ? Kasif.tools : await loadTools();
    this.setMarket("bist");
  },
  setMarket(m) {
    this.market = m;
    $$("#a-market button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    $$("#a-flow small[data-us]").forEach((s) => (s.textContent = s.dataset[m === "bist" ? "bist" : "us"]));
    $("#a-sub").firstChild.textContent = m === "bist"
      ? "Borsa İstanbul gün içi masası · seans 10:00–18:00. "
      : "ABD gün içi masası · New York seansı TR saatiyle 17:30–00:00 (kış saati). ";
    tickClock();
    this.show(this.tab);
  },
  show(tab) {
    this.tab = tab;
    $$("#a-flow li").forEach((li) => li.classList.toggle("on", li.dataset.tab === tab));
    $("#a-result").replaceChildren();
    const fn = this.market === "bist" && this[tab + "B"] ? this[tab + "B"] : this[tab];
    $("#a-panel").replaceChildren(fn.call(this));
  },
  /* ---- BIST modu: Borsa MCP + BIST Zaman Makinesi */
  async mcp(title, tool, args) {
    const out = $("#a-result");
    out.replaceChildren(loader("m-avci", "Avcı Borsa İstanbul'u tarıyor"));
    try {
      const r = await api("/api/mcp", { tool, args });
      out.replaceChildren(h("div", { class: "card" }, h("div", { class: "res-head" }, h("h3", {}, title), h("small", { class: "muted" }, "kaynak: Borsa MCP · " + tool)), r.ok ? renderSections(r.sections, r.text) : errorBox(r.error)));
    } catch (e) { out.replaceChildren(errorBox(e.message)); }
  },
  sel(name, opts, val) { return h("select", { name }, opts.map((o) => h("option", { value: o, selected: o === val }, label(o)))); },
  scannerB() {
    const idx = Kasif.enumOf("scan_stocks", "index"), pre = Kasif.enumOf("scan_stocks", "preset");
    const f = h("form", { class: "card task-form" },
      h("label", {}, "Endeks", this.sel("index", idx.length ? idx : ["XU100", "XU030"], "XU100")),
      h("label", {}, "Hazır tarama", this.sel("preset", pre.length ? pre : ["oversold", "bullish_momentum"], "bullish_momentum")),
      h("label", {}, "Zaman dilimi", this.sel("timeframe", ["1d", "4h", "1h", "1W"], "1d")),
      h("button", { class: "btn primary" }, "Taramayı başlat"));
    f.addEventListener("submit", (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); this.mcp(`🎯 ${v.index} · ${label(v.preset)}`, "scan_stocks", v); });
    return h("div", {}, f, h("p", { class: "hint", style: "margin:8px 4px 0" }, "RSI, MACD, Supertrend ve T3 göstergelerine göre BIST hisselerini tarar. Tarama, kurala uyan grafiklerin listesidir; alınacak hisse listesi değildir."));
  },
  newsB() {
    const f = h("form", { class: "card task-form" },
      h("label", {}, "Hisse", h("input", { name: "symbol", value: "THYAO", style: "width:120px" })),
      h("label", {}, "Adet", this.sel("limit", ["10", "20", "30"], "20")),
      h("button", { class: "btn primary" }, "KAP bildirimlerini getir"));
    f.addEventListener("submit", (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); this.mcp(`📰 ${v.symbol.toUpperCase()} · KAP ve haberler`, "get_news", { symbol: v.symbol.toUpperCase(), limit: +v.limit }); });
    return f;
  },
  timemachineB() {
    const f = h("form", { class: "card task-form" },
      h("label", {}, "Hisse", h("input", { name: "symbol", value: "THYAO", style: "width:100px" })),
      h("label", {}, "Yön", h("select", { name: "side" }, h("option", { value: "buy" }, "Alış"), h("option", { value: "sell" }, "Satış"))),
      h("label", {}, "Giriş ₺", h("input", { name: "entry", type: "number", step: "0.01", placeholder: "son fiyat", style: "width:110px" })),
      h("label", {}, "Stop ₺", h("input", { name: "stop", type: "number", step: "0.01", placeholder: "-%2", style: "width:100px" })),
      h("label", {}, "Hedef ₺", h("input", { name: "target", type: "number", step: "0.01", placeholder: "+%4", style: "width:100px" })),
      h("label", {}, "Giriş saati", h("input", { name: "entry_time", value: "11:00", style: "width:80px" })),
      h("button", { class: "btn primary" }, "Simüle et"));
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = $("#a-result");
      out.replaceChildren(loader("m-avci", "Avcı son 60 seansın mumlarıyla 10.000 gün kuruyor"));
      try {
        const r = await api("/api/bist/timemachine", Object.fromEntries(new FormData(f)));
        out.replaceChildren(r.ok ? this.tmRender(r.data) : errorBox(r.error));
      } catch (err) { out.replaceChildren(errorBox(err.message)); }
    });
    return h("div", {}, f, h("p", { class: "hint", style: "margin:8px 4px 0" }, "Boş bırakılan alanlar son fiyat, %2 stop ve %4 hedef olarak doldurulur. Seans kapalıyken de çalışır; geçmiş 5 dakikalık mumlardan senaryo üretir."));
  },
  pelosiB() {
    const f = h("form", { class: "card task-form" },
      h("label", {}, "Endeks", this.sel("index", ["XU100", "XU030", "XBANK", "XUSIN", "XUTEK"], "XU100")),
      h("label", {}, "Liste", h("select", { name: "preset" }, h("option", { value: "big_gainers" }, "En çok yükselenler"), h("option", { value: "big_losers" }, "En çok düşenler"), h("option", { value: "high_volume" }, "Hacmi patlayanlar"))),
      h("button", { class: "btn primary" }, "Getir"));
    f.addEventListener("submit", (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); this.mcp(`📊 ${v.index} · günün hareketlileri`, "scan_stocks", v); });
    return h("div", {}, f, h("p", { class: "hint", style: "margin:8px 4px 0" }, "ABD'deki Kongre bildirimlerinin Türkiye'de birebir karşılığı yok; bu sekme BIST'te günün öne çıkan hisselerini listeler."));
  },
  analystB() {
    const f = h("form", { class: "card task-form" },
      h("label", {}, "Hisse", h("input", { name: "symbol", value: "THYAO", style: "width:120px" })),
      h("label", {}, "Rapor", h("select", { name: "kind" }, h("option", { value: "income" }, "Gelir tablosu"), h("option", { value: "balance" }, "Bilanço"), h("option", { value: "cashflow" }, "Nakit akışı"), h("option", { value: "earnings" }, "Bilanço tarihleri"))),
      h("label", {}, "Dönem", h("select", { name: "period" }, h("option", { value: "quarterly" }, "Çeyreklik"), h("option", { value: "annual" }, "Yıllık"))),
      h("button", { class: "btn primary" }, "Getir"));
    f.addEventListener("submit", (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(f)); const s = v.symbol.toUpperCase();
      if (v.kind === "earnings") this.mcp(`🗓️ ${s} · bilanço takvimi`, "get_earnings", { symbol: s, market: "bist" });
      else this.mcp(`📑 ${s} · ${label(v.kind)}`, "get_financial_statements", { symbol: s, market: "bist", statement_type: v.kind, period: v.period, last_n: 4 }); });
    return f;
  },
  brokerB() {
    return h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "🔒 BIST'te emir desteği yok"),
      h("p", { class: "muted" }, "Alpaca yalnızca ABD hisselerinde çalışır ve Türk aracı kurumlarının Claude'a bağlanan resmî bir bağlantısı bu sistemde yok. BIST işlemlerini kendi aracı kurumunun uygulamasından, kendi kararınla yapmalısın. Panel hiçbir koşulda emir göndermez."));
  },
  async run(tool, body, render) {
    const out = $("#a-result");
    out.replaceChildren(loader("m-avci", tool === "timemachine" ? "Avcı 10.000 seansı yeniden oynatıyor" : "Avcı iz sürüyor"));
    try {
      const r = await api("/api/trader/" + tool, body);
      if (!r.data) return out.replaceChildren(errorBox(r.error));
      out.replaceChildren(render(r.data));
      if (!r.ok && r.stderr) out.append(h("details", {}, h("summary", {}, "Uyarılar"), h("div", { class: "raw" }, r.stderr)));
    } catch (e) { out.replaceChildren(errorBox(e.message)); }
  },
  symbolsBox(def) {
    const ta = h("textarea", { name: "symbols", rows: 2, style: "min-width:340px;flex:1" }, def);
    const chips = h("div", { class: "chips" }, Object.entries(PRESETS).map(([k, v]) => h("span", { class: "chip", onclick: () => (ta.value = v) }, k)));
    return h("label", { style: "flex:1" }, h("span", {}, "Semboller ", chips), ta);
  },
  scanner() {
    const f = h("form", { class: "card task-form" },
      h("label", {}, "Tarama", h("select", { name: "mode" }, h("option", { value: "daily" }, "Günlük kurulumlar (seans öncesi)"), h("option", { value: "orb" }, "Açılış aralığı kırılımı (seans içi)"))),
      this.symbolsBox(PRESETS["Dev 30"]),
      h("label", {}, "Min fiyat $", h("input", { name: "min_price", type: "number", value: 5, style: "width:90px" })),
      h("button", { class: "btn primary" }, "Taramayı başlat"));
    f.addEventListener("submit", (e) => { e.preventDefault(); this.run("scanner", Object.fromEntries(new FormData(f)), (d) => {
      const hits = d.hits || [];
      return h("div", { class: "card" }, h("div", { class: "res-head" }, h("h3", {}, `🎯 ${hits.length} kurulum bulundu`), h("small", { class: "muted" }, `${d.scanned ?? "?"} sembol tarandı · ${d.as_of || ""}`)),
        hits.length ? renderJSON(hits.map((x) => ({ symbol: x.symbol, setups: (x.setups || []).join(", "), ...Object.fromEntries(Object.entries(x).filter(([k, v]) => !["symbol", "setups"].includes(k) && (v === null || typeof v !== "object"))) }))) : h("p", { class: "muted" }, "Bu kurala uyan grafik yok. Seans kapalıyken 'Açılış aralığı' modu boş döner."),
        h("p", { class: "hint", style: "margin-top:10px" }, "Tarama, bir kurala uyan grafiklerin listesidir; alınacak hisse listesi değildir."));
    }); });
    return f;
  },
  news() {
    const f = h("form", { class: "card task-form" },
      h("label", { style: "flex:1" }, "Semboller", h("input", { name: "symbols", value: "AAPL, TSLA, NVDA" })),
      h("label", {}, "Son kaç saat", h("input", { name: "hours", type: "number", value: 48, style: "width:90px" })),
      h("button", { class: "btn primary" }, "Haberleri getir"));
    f.addEventListener("submit", (e) => { e.preventDefault(); this.run("news", Object.fromEntries(new FormData(f)), (d) => {
      const moves = h("div", { class: "market-strip", style: "margin:0 0 14px" }, (d.moves || []).map((m) => h("div", { class: "mini" }, h("small", {}, m.ticker + (m.moving ? " · hareketli" : "")), h("b", {}, fmt(m.price)), h("span", { class: cls(m.pct) }, pct(m.pct, 2)))));
      const items = (d.items || []).map((i) => h("div", { class: "news-item" }, h("div", { class: "chips", style: "margin-bottom:4px" }, h("span", { class: "chip" }, i.ticker), h("span", { class: "chip" }, i.kind || i.source), ...(i.tags || []).map((t) => h("span", { class: "chip" }, t))),
        h("a", { href: i.link || i.url || "#", target: "_blank", rel: "noopener" }, i.title), h("p", {}, (i.published || i.time || "") + (i.summary ? " · " + i.summary.slice(0, 220) + "…" : ""))));
      return h("div", { class: "card" }, h("div", { class: "res-head" }, h("h3", {}, "📰 Haber akışı"), h("small", { class: "muted" }, (d.items || []).length + " başlık")), moves, items.length ? items : h("p", { class: "muted" }, "Bu aralıkta haber yok."));
    }); });
    return f;
  },
  timemachine() {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const f = h("form", { class: "card task-form" },
      h("label", {}, "Sembol", h("input", { name: "symbol", value: "TSLA", style: "width:90px" })),
      h("label", {}, "Yön", h("select", { name: "side" }, h("option", { value: "buy" }, "Alış (long)"), h("option", { value: "sell" }, "Satış (short)"))),
      h("label", {}, "Giriş $", h("input", { name: "entry", type: "number", step: "0.01", style: "width:100px" })),
      h("label", {}, "Stop $", h("input", { name: "stop", type: "number", step: "0.01", style: "width:100px" })),
      h("label", {}, "Hedef $", h("input", { name: "target", type: "number", step: "0.01", style: "width:100px" })),
      h("label", {}, "Giriş saati (NY)", h("input", { name: "entry_time", placeholder: "10:15 AM", style: "width:100px" })),
      h("label", {}, "Gün", h("input", { name: "date", type: "date", value: today })),
      h("button", { class: "btn primary" }, "Simüle et"),
      h("button", { class: "btn", type: "button", onclick: () => this.run("timemachine", { demo: true }, (d) => this.tmRender(d, true)) }, "Örnek veriyle dene"));
    f.addEventListener("submit", (e) => { e.preventDefault(); this.run("timemachine", Object.fromEntries(new FormData(f)), (d) => this.tmRender(d)); });
    return h("div", {}, f, h("p", { class: "hint", style: "margin:8px 4px 0" }, "Zaman Makinesi gerçek seans verisi ister; borsa kapalıyken 'Örnek veriyle dene' butonu kayıtlı bir TSLA gününü kullanır."));
  },
  tmRender(d, demo) {
    const mc = d.mc || {}, plan = d.plan || {};
    const probs = [["Önce hedefe ulaştı", mc.p_target, "#22c55e"], ["Önce stop oldu", mc.p_stop, "#f43f5e"], ["Kapanışta hâlâ açık", mc.p_neither, "#94a3b8"], ["Kapanış girişin üstünde", mc.p_green, "#fb923c"]];
    const box = h("div", { class: "card" }, h("div", { class: "res-head" }, h("h3", {}, `⏳ ${plan.symbol} · ${plan.date}${demo ? " (örnek veri)" : ""}`), h("small", { class: "muted" }, `${fmt(mc.replays, 0)} simülasyon · giriş ${fmt(plan.entry)} · stop ${fmt(plan.stop)} · hedef ${fmt(plan.target)}`)));
    const grid = h("div", { class: "grid2" });
    const pbox = h("div", {}, h("h4", { class: "section-title", style: "margin-top:0" }, "Olasılıklar"), probs.map(([l, p, c]) => h("div", { class: "prob" }, h("span", {}, l), h("div", { class: "bar" }, h("i", { style: `width:0;background:${c}`, "data-w": ((p || 0) * 100).toFixed(1) })), h("b", { style: "font-family:var(--mono)" }, isNum(p) ? (p * 100).toFixed(1) + "%" : "—"))),
      kvGrid([["Medyan kapanış", mc.median_close], ["%5 kötü senaryo", mc.p5_close], ["%95 iyi senaryo", mc.p95_close], ["Ortalama R", mc.avg_R]]));
    grid.append(pbox, h("div", { class: "fan" }, h("h4", { class: "section-title", style: "margin-top:0" }, "Olası fiyat yolları (yelpaze)"), this.fan(mc.bands || [], plan)));
    box.append(grid);
    const rest = Object.fromEntries(Object.entries(d).filter(([k]) => !["mc", "plan", "data", "created_by", "created_at", "ok"].includes(k)));
    if (Object.keys(rest).length) box.append(h("div", { class: "sec" }, h("h4", {}, "Geçmiş günlerde aynı kural"), renderJSON(rest)));
    box.append(h("p", { class: "hint", style: "margin-top:12px" }, "Simülasyon tahmin değildir; son ~60 günün mumlarından üretilir. Hedef ≈ stop ise bu yazı-tura demektir."));
    requestAnimationFrame(() => $$(".bar i[data-w]", box).forEach((i) => (i.style.width = i.dataset.w + "%")));
    return box;
  },
  fan(bands, plan) {
    const W = 560, H = 280, P = 36;
    if (!bands.length) return h("p", { class: "muted" }, "Yelpaze verisi yok.");
    const vals = bands.flat().concat([plan.stop, plan.target].filter(isNum));
    const lo = Math.min(...vals), hi = Math.max(...vals), n = bands.length;
    const x = (i) => P + (i / (n - 1)) * (W - P - 8), y = (v) => 22 + (1 - (v - lo) / (hi - lo || 1)) * (H - 44);
    const area = (a, b) => bands.map((r, i) => `${x(i)},${y(r[a])}`).join(" ") + " " + bands.map((r, i) => `${x(n - 1 - i)},${y(bands[n - 1 - i][b])}`).join(" ");
    const line = (k) => bands.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r[k])}`).join("");
    const hl = (v, c, t) => (isNum(v) ? `<line x1="${P}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="${c}" stroke-dasharray="5 5" stroke-width="1.3"/><text x="${W - 10}" y="${y(v) - 5}" fill="${c}" text-anchor="end" font-size="11" font-family="JetBrains Mono">${t} ${fmt(v)}</text>` : "");
    const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <polygon points="${area(0, 4)}" fill="rgba(251,146,60,.13)"/><polygon points="${area(1, 3)}" fill="rgba(251,146,60,.26)"/>
      <path d="${line(2)}" stroke="#fb923c" stroke-width="2.2" fill="none"/>
      ${hl(plan.target, "#22c55e", "hedef")}${hl(plan.stop, "#f43f5e", "stop")}${hl(plan.entry, "#94a3b8", "giriş")}
      <text x="${P}" y="${H - 4}" fill="#8a97b1" font-size="11" font-family="JetBrains Mono">giriş anı</text><text x="${W - 10}" y="${H - 4}" fill="#8a97b1" font-size="11" text-anchor="end" font-family="JetBrains Mono">kapanış</text></svg>`;
    return h("div", { html: svg });
  },
  pelosi() {
    const f = h("form", { class: "card task-form" },
      h("label", {}, "Üye (soyad, isteğe bağlı)", h("input", { name: "member", placeholder: "Pelosi" })),
      h("label", {}, "Kaç kayıt", h("input", { name: "limit", type: "number", value: 40, style: "width:90px" })),
      h("button", { class: "btn primary" }, "Bildirimleri getir"));
    f.addEventListener("submit", (e) => { e.preventDefault(); this.run("pelosi", Object.fromEntries(new FormData(f)), (d) => {
      const rows = (Array.isArray(d) ? d : d.filings || []).map((x) => ({ filed: x.filed, name: x.name, district: x.district, type_name: x.type_name, doc_id: x.doc_id, url: x.url }));
      return h("div", { class: "card" }, h("div", { class: "res-head" }, h("h3", {}, "🏛️ ABD Kongresi işlem bildirimleri"), h("small", { class: "muted" }, rows.length + " kayıt")), renderJSON(rows),
        h("p", { class: "hint", style: "margin-top:10px" }, "Bildirimler işlemden 30–45 gün sonra yayımlanabilir. PDF'i açınca hangi hisselerin alınıp satıldığı görünür."));
    }); });
    return f;
  },
  analyst() {
    const f = h("form", { class: "card task-form" },
      h("label", { style: "flex:1" }, "Semboller (en fazla 5)", h("input", { name: "symbols", value: "AAPL" })),
      h("button", { class: "btn primary" }, "Bilançoyu oku"));
    f.addEventListener("submit", (e) => { e.preventDefault(); this.run("analyst", Object.fromEntries(new FormData(f)), (d) => h("div", { class: "card" }, h("div", { class: "res-head" }, h("h3", {}, "📊 SEC bilanço özeti")), renderJSON(d))); });
    return h("div", {}, f, h("p", { class: "hint", style: "margin:8px 4px 0" }, "SEC, kim olduğunu belirten bir User-Agent ister. Ayarlar'dan 'Ad Soyad e-posta' girmen gerekir. BIST bilançoları için Kâşif'i kullan."));
  },
  broker() {
    return h("div", { class: "card" }, h("h3", { style: "margin-top:0" }, "🔒 Emir adımı bu panelde kapalı"),
      h("p", { class: "muted" }, "Panel hiçbir koşulda emir göndermez. Emir adımı yalnızca Claude Code içinde, /trader-risk kontrolünden ve senin açık 'evet' onayından sonra, Alpaca paper (sanal para) hesabına gider."),
      h("ol", { class: "muted" }, h("li", {}, "alpaca.markets'ta hesap aç, panelde Paper Trading hesabına geç."), h("li", {}, "API Keys → Generate New Keys. Anahtarları sohbete ya da bu panele yazma; Windows ortam değişkenlerine kendin ekle."), h("li", {}, "D:\\Library\\Ajan-Borsa klasöründe Claude Code'u aç ve /trader-broker yaz.")));
  },
};

/* ---------------------------------------------------------------- SİMÜLATÖR */
const Sim = {
  mode: "single",
  init() {
    $$("#s-mode button").forEach((b) => b.addEventListener("click", () => this.setMode(b.dataset.mode)));
    $("#s-strategy").addEventListener("change", () => this.toggle());
    $("#s-form").addEventListener("submit", (e) => { e.preventDefault(); this.run(); });
    $("#s-drift").addEventListener("change", () => ($("#s-drift-custom").hidden = $("#s-drift").value !== "custom"));
    $("#s-vm").addEventListener("input", () => ($("#s-vm-out").textContent = (+$("#s-vm").value).toLocaleString("tr-TR", { minimumFractionDigits: 1 }) + "×"));
    this.toggle();
  },
  setMode(m) { this.mode = m; $$("#s-mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m)); this.toggle(); },
  toggle() {
    const st = $("#s-strategy").value;
    $$(".only-single").forEach((el) => (el.hidden = this.mode !== "single" || (el.dataset.for && el.dataset.for !== st)));
    $$(".only-sweep").forEach((el) => (el.hidden = this.mode !== "sweep"));
    $$(".only-scenario").forEach((el) => (el.hidden = this.mode !== "scenario"));
    $$(".hide-scenario").forEach((el) => (el.hidden = this.mode === "scenario"));
  },
  async run() {
    const v = Object.fromEntries(new FormData($("#s-form")));
    const body = { symbol: v.symbol, market: v.market, strategy: this.mode === "single" ? v.strategy : "ma", mode: this.mode, start: v.start, end: v.end, metric: v.metric, params: v };
    const out = $("#s-out"), btn = $("#s-form button[type=submit]");
    btn.disabled = true;
    out.replaceChildren(loader("m-sim", this.mode === "sweep" ? "Simülatör yüzlerce kombinasyonu deniyor" : this.mode === "scenario" ? "Simülatör 10.000 olası yolu çiziyor" : "Simülatör geçmişi yeniden oynatıyor"));
    try {
      if (this.mode === "scenario") {
        const r = await api("/api/scenario", { symbol: v.symbol, market: v.market, horizon: +v.horizon, years: +v.years, drift: v.drift, drift_pct: +v.drift_pct, shock_pct: +v.shock_pct, shock_day: +v.shock_day, vol_mult: +v.vol_mult });
        out.replaceChildren(r.ok ? this.scenario(r) : errorBox(r.error));
      } else if (v.market === "fund") {
        out.replaceChildren(errorBox("Fonlar için yalnızca Senaryo modu kullanılabilir (backtest verisi borsa hisseleri içindir)."));
      } else {
        const r = await api("/api/backtest", body);
        if (!r.ok) out.replaceChildren(errorBox(r.error));
        else out.replaceChildren(this.mode === "sweep" ? this.sweep(r) : this.mode === "overfit" ? this.overfit(r) : this.single(r));
      }
    } catch (e) { out.replaceChildren(errorBox(e.message)); }
    btn.disabled = false;
  },
  metric(lbl, val, sub, c = "") { return h("div", { class: "metric" }, h("small", {}, lbl), h("b", { class: c }, val), sub ? h("em", {}, sub) : null); },
  speech(notes) { return h("div", { class: "speech agent-sim" }, svgUse("m-sim", ""), h("div", { class: "bubble" }, notes.map((n) => h("p", {}, n)))); },
  scenario(r) {
    const hz = r.horizon, last = r.last, B = r.bands;
    const at = (k) => (B[k][hz] / last - 1) * 100;
    const box = h("div");
    box.append(h("div", { class: "res-head" }, h("h3", {}, `${r.symbol} · Senaryo Haritası`), h("small", { class: "muted" }, `son fiyat ${fmt(last)} (${r.last_date}) · ufuk ${hz} işlem günü`)));
    box.append(h("div", { class: "verdict warn" }, "Bu bir tahmin değil, senaryodur. Geçmişte görülen hareketlerden üretilmiş olası yollardır; geçmişte hiç yaşanmamış olayları içermez."));
    box.append(h("div", { class: "metrics" },
      this.metric("Ortanca senaryo", pct(at("p50")), `${fmt(B.p50[hz])} civarı`, cls(at("p50"))),
      this.metric("%90 aralığı", `${pct(at("p5"), 0)} / ${pct(at("p95"), 0)}`, `${fmt(B.p5[hz])} – ${fmt(B.p95[hz])}`),
      this.metric("Yükselme olasılığı", "%" + fmt(r.probs.up, 0), "bugünkü fiyatın üstünde bitme"),
      this.metric("≥ +%10 olasılığı", "%" + fmt(r.probs.gt10, 0), "güçlü yükseliş senaryosu", "up"),
      this.metric("≤ −%10 olasılığı", "%" + fmt(r.probs.lt10, 0), "−%20 ve altı: %" + fmt(r.probs.lt20, 0), "down"),
      this.metric("Yıllık oynaklık", "%" + fmt(r.stats.ann_vol, 0), "son 30 gün: %" + fmt(r.stats.recent_vol, 0)),
      this.metric("Geçmiş maks. düşüş", pct(r.stats.max_dd, 0), `${r.stats.from} → ${r.stats.to}`, "down"),
      this.metric("En kötü / en iyi gün", `${pct(r.stats.worst_day, 1)} / ${pct(r.stats.best_day, 1)}`, `${fmt(r.stats.days, 0)} işlem günü`)));
    box.append(this.speech(r.notes));

    const lg = (bg, lbl, hgt) => h("span", {}, h("i", { style: `background:${bg};${hgt ? "height:9px" : ""}` }), lbl);
    const coneWrap = h("div", { class: "cone-wrap" });
    box.append(h("div", { class: "card", style: "margin-bottom:14px" }, h("h4", { class: "section-title", style: "margin:0 0 8px" }, "Olasılık konisi"),
      h("div", { class: "legend" }, lg("#e2e8f0", "Geçmiş fiyat"), lg("#a78bfa", "Ortanca senaryo"), lg("rgba(167,139,250,.55)", "%50 aralık", 1), lg("rgba(167,139,250,.22)", "%90 aralık", 1)), coneWrap));
    const histWrap = h("div", { class: "cone-wrap" });
    box.append(h("div", { class: "card", style: "margin-bottom:14px" }, h("h4", { class: "section-title", style: "margin:0 0 8px" }, `${hz} işlem günü sonraki olası getiri dağılımı`), histWrap));
    this.drawCone(coneWrap, r);
    this.drawHist(histWrap, r, at("p50"));

    const HZ = { 5: "1 hafta (5 gün)", 21: "1 ay (21 gün)", 63: "3 ay (63 gün)", 126: "6 ay (126 gün)", 252: "1 yıl (252 gün)" };
    box.append(h("div", { class: "sec" }, h("h4", { style: "color:var(--sim)" }, "Ufka göre olası getiri aralıkları"),
      rawTable(["Ufuk", "Kötü (%5)", "%25", "Ortanca", "%75", "İyi (%95)", "Yükselme olasılığı"],
        r.table.map((t) => [HZ[t.days] || t.days + " gün", numCell(t.p5), numCell(t.p25), numCell(t.p50), numCell(t.p75), numCell(t.p95), h("td", { class: "num" }, "%" + fmt(t.p_up, 0))]))));

    const a = r.analog || { count: 0 };
    const ac = h("div", { class: "card", style: "margin-top:14px" }, h("h4", { class: "section-title", style: "margin:0 0 8px" }, "Benzer geçmiş durumlar"));
    if (a.count > 0) {
      ac.append(h("p", { class: "hint" }, `Geçmişte son 5 işlem gününde %${fmt(Math.abs(a.trigger), 0)} ve üzeri ${a.trigger < 0 ? "düşüş" : "yükseliş"} yaşanan ${a.count} durum bulundu; ${a.horizon} işlem günü sonrasına bakıldı. Örnek sayısı azsa sonuca güvenme.`));
      ac.append(h("div", { class: "metrics", style: "margin-top:10px" },
        this.metric("Benzer durum", fmt(a.count, 0), "birbirinden ≥5 gün ayrı"), this.metric("Sonra yükselen", "%" + fmt(a.pos, 0), "durumların oranı"),
        this.metric("Ortanca sonuç", pct(a.median), "ortalama " + pct(a.mean), cls(a.median)), this.metric("Dağılım", `${pct(a.p10, 0)} / ${pct(a.p90, 0)}`, "%10 – %90")));
      ac.append(rawTable(["Tarih", "Önceki 5 gün", `Sonraki ${a.horizon} gün`], a.events.map((e) => [e.date, numCell(e.before), numCell(e.after)])));
    } else ac.append(h("p", { class: "muted" }, "Bu eşikte geçmişte benzer bir durum bulunamadı."));
    box.append(ac);
    box.append(h("p", { class: "hint", style: "margin-top:12px" }, "Seans takvimi hafta sonlarını atlar, resmî tatiller hesaba katılmaz; tarihler yaklaşıktır. Bu sayfa yatırım tavsiyesi değildir."));
    return box;
  },
  drawCone(wrap, r) {
    const W = 920, H = 380, L = 12, R = 74, T = 14, Bt = 30;
    const hz = r.horizon, nh = Math.min(90, r.history.length), hist = r.history.slice(-nh), total = nh - 1 + hz;
    const F = {}; for (const k of ["p5", "p25", "p50", "p75", "p95"]) F[k] = r.bands[k].slice(0, hz + 1);
    const x = (i) => L + (i / total) * (W - L - R), xf = (j) => x(nh - 1 + j);
    const all = [...hist.map((p) => p.value), ...F.p5, ...F.p95];
    let lo = Math.min(...all), hi = Math.max(...all); const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - Bt);
    const f1 = (n) => n.toFixed(1);
    const band = (a, b) => F[a].map((v, j) => `${f1(xf(j))},${f1(y(v))}`).join(" ") + " " + F[b].map((_, j) => { const jj = hz - j; return `${f1(xf(jj))},${f1(y(F[b][jj]))}`; }).join(" ");
    const path = (arr, X) => arr.map((v, i) => `${i ? "L" : "M"}${f1(X(i))},${f1(y(v))}`).join("");
    let grid = "";
    for (let t = 0; t <= 4; t++) { const v = lo + ((hi - lo) * t) / 4; grid += `<line x1="${L}" x2="${W - R}" y1="${f1(y(v))}" y2="${f1(y(v))}" stroke="rgba(148,163,184,.10)"/><text x="${W - R + 6}" y="${f1(y(v) + 4)}">${fmt(v)}</text>`; }
    const endLbl = (k, c) => `<text x="${f1(xf(hz) + 6)}" y="${f1(y(F[k][hz]) + 4)}" style="fill:${c}">${fmt(F[k][hz])}</text>`;
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Olasılık konisi">${grid}
      <polygon points="${band("p5", "p95")}" fill="rgba(167,139,250,.16)"/><polygon points="${band("p25", "p75")}" fill="rgba(167,139,250,.30)"/>
      <line x1="${f1(xf(0))}" x2="${f1(xf(0))}" y1="${T}" y2="${H - Bt}" stroke="rgba(148,163,184,.45)" stroke-dasharray="4 4"/>
      <path d="${path(hist.map((p) => p.value), x)}" stroke="#e2e8f0" stroke-width="1.8" fill="none"/>
      <path d="${path(F.p50, xf)}" stroke="#a78bfa" stroke-width="2.4" fill="none"/>
      ${endLbl("p95", "#86efac")}${endLbl("p50", "#c4b5fd")}${endLbl("p5", "#fda4af")}
      <text x="${f1(x(0))}" y="${H - 8}">${hist[0].time}</text><text x="${f1(xf(0))}" y="${H - 8}" text-anchor="middle">bugün</text><text x="${f1(xf(hz))}" y="${H - 8}" text-anchor="end">${r.dates[hz]}</text>
      <line id="cone-v" x1="0" x2="0" y1="${T}" y2="${H - Bt}" stroke="rgba(226,232,240,.5)" style="display:none"/>
      <rect id="cone-hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - Bt}" fill="transparent"/></svg>`;
    wrap.innerHTML = svg;
    const tip = h("div", { class: "cone-tip" }); wrap.append(tip);
    const el = $("svg", wrap), vl = $("#cone-v", wrap);
    $("#cone-hit", wrap).addEventListener("mousemove", (e) => {
      const rc = el.getBoundingClientRect(), mx = ((e.clientX - rc.left) / rc.width) * W;
      const i = Math.max(0, Math.min(total, Math.round(((mx - L) / (W - L - R)) * total)));
      vl.style.display = ""; vl.setAttribute("x1", x(i)); vl.setAttribute("x2", x(i));
      if (i < nh) tip.innerHTML = `${hist[i].time}<br>fiyat <b>${fmt(hist[i].value)}</b>`;
      else { const j = i - (nh - 1); tip.innerHTML = `${r.dates[j]} · ${j}. gün<br>iyi (%95) <b>${fmt(F.p95[j])}</b><br>ortanca <b>${fmt(F.p50[j])}</b><br>kötü (%5) <b>${fmt(F.p5[j])}</b>`; }
      tip.style.display = "block";
      const wr = wrap.getBoundingClientRect(), px = e.clientX - wr.left;
      tip.style.left = (px > wr.width * 0.65 ? px - tip.offsetWidth - 14 : px + 14) + "px";
    });
    $("#cone-hit", wrap).addEventListener("mouseleave", () => { vl.style.display = "none"; tip.style.display = "none"; });
  },
  drawHist(wrap, r, med) {
    const W = 920, H = 210, L = 12, R = 12, T = 26, Bt = 30, c = r.hist.counts, e = r.hist.edges, mx = Math.max(...c);
    const x = (v) => L + ((v - e[0]) / (e[e.length - 1] - e[0])) * (W - L - R), f1 = (n) => n.toFixed(1);
    let bars = "";
    c.forEach((n, i) => { const x0 = x(e[i]), w = x(e[i + 1]) - x0 - 1, hh = (n / mx) * (H - T - Bt); bars += `<rect x="${f1(x0)}" y="${f1(H - Bt - hh)}" width="${f1(Math.max(w, 1))}" height="${f1(hh)}" rx="2" fill="${(e[i] + e[i + 1]) / 2 >= 0 ? "rgba(34,197,94,.72)" : "rgba(244,63,94,.72)"}"><title>${pct(e[i], 0)} ile ${pct(e[i + 1], 0)}: ${n} yol</title></rect>`; });
    const zero = e[0] < 0 && e[e.length - 1] > 0 ? `<line x1="${f1(x(0))}" x2="${f1(x(0))}" y1="${T}" y2="${H - Bt}" stroke="rgba(226,232,240,.6)" stroke-dasharray="4 4"/><text x="${f1(x(0))}" y="${H - 10}" text-anchor="middle">0 (bugünkü fiyat)</text>` : "";
    const m = med >= e[0] && med <= e[e.length - 1] ? `<line x1="${f1(x(med))}" x2="${f1(x(med))}" y1="${T}" y2="${H - Bt}" stroke="#a78bfa" stroke-width="2"/><text x="${f1(x(med))}" y="${T - 10}" text-anchor="middle" style="fill:#c4b5fd">ortanca ${pct(med, 1)}</text>` : "";
    wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Getiri dağılımı">${bars}${zero}${m}<text x="${L}" y="${H - 10}">${pct(e[0], 0)}</text><text x="${W - R}" y="${H - 10}" text-anchor="end">${pct(e[e.length - 1], 0)}</text></svg>`;
  },
  single(r) {
    const m = r.metrics, box = h("div");
    box.append(h("div", { class: "res-head" }, h("h3", {}, `${r.symbol} · ${r.strategy_name}`), h("small", { class: "muted" }, `${r.from} → ${r.to}`)));
    box.append(h("div", { class: "metrics" },
      this.metric("Toplam getiri", pct(m.total_return), "Al ve tut: " + pct(m.benchmark_return), cls(m.total_return)),
      this.metric("Maks. düşüş", pct(-Math.abs(m.max_drawdown || 0)), "zirveden en büyük erime", "down"),
      this.metric("Kazanma oranı", isNum(m.win_rate) ? "%" + fmt(m.win_rate, 0) : "—", `${fmt(m.trades, 0)} işlem`),
      this.metric("Sharpe", fmt(m.sharpe), "1 üstü genelde iyi", m.sharpe >= 1 ? "up" : ""),
      this.metric("Son değer", fmt(m.end_value, 0), "başlangıç " + fmt(m.start_value, 0)),
      this.metric("Kâr faktörü", fmt(m.profit_factor), "kazanç / kayıp"),
      this.metric("En iyi işlem", pct(m.best_trade), "en kötü " + pct(m.worst_trade)),
      this.metric("Ödenen komisyon", fmt(m.fees_paid, 0), "kayma dahil değil")));
    box.append(this.speech(r.notes));
    const c1 = h("div", { class: "chart-box" }), c2 = h("div", { class: "chart-box sm" }), c3 = h("div", { class: "chart-box sm" });
    box.append(h("div", { class: "card", style: "margin-bottom:14px" }, h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:#a78bfa" }), "Strateji"), h("span", {}, h("i", { style: "background:#64748b" }), "Al ve tut")), c1));
    box.append(h("div", { class: "grid2" }, h("div", { class: "card" }, h("h4", { class: "section-title", style: "margin:0 0 8px" }, "Fiyat ve işlemler (G: giriş, Ç: çıkış)"), c2), h("div", { class: "card" }, h("h4", { class: "section-title", style: "margin:0 0 8px" }, "Düşüş (%)"), c3)));
    if (r.trades.length) box.append(h("div", { class: "sec" }, h("h4", { style: "color:var(--sim)" }, `İşlem listesi (${r.trades.length})`), table(["entry", "exit", "entry_price", "exit_price", "pnl", "ret", "status"], r.trades.map((t) => [t.entry, t.exit, t.entry_price, t.exit_price, t.pnl, t.ret, t.status]))));
    requestAnimationFrame(() => {
      const a = makeChart(c1); if (!a) return;
      a.addAreaSeries({ lineColor: "#a78bfa", topColor: "rgba(167,139,250,.35)", bottomColor: "rgba(167,139,250,0)", lineWidth: 2 }).setData(r.equity);
      a.addLineSeries({ color: "#64748b", lineWidth: 2, lineStyle: 2 }).setData(r.benchmark); a.timeScale().fitContent();
      const b = makeChart(c2); const ps = b.addLineSeries({ color: "#e2e8f0", lineWidth: 1.5 }); ps.setData(r.price); ps.setMarkers(r.markers.filter((x) => x.time)); b.timeScale().fitContent();
      const d = makeChart(c3); d.addAreaSeries({ lineColor: "#f43f5e", topColor: "rgba(244,63,94,0)", bottomColor: "rgba(244,63,94,.35)", invertFilledArea: true }).setData(r.drawdown.map((p) => ({ time: p.time, value: -Math.abs(p.value) }))); d.timeScale().fitContent();
    });
    return box;
  },
  sweep(r) {
    const W = r.windows, cs = 22, pad = 44, size = W.length * cs;
    const map = new Map(r.cells.map((c) => [c.fast + "-" + c.slow, c.v]));
    const vals = r.cells.map((c) => c.v).filter(isNum), mx = Math.max(...vals.map(Math.abs), 1e-9);
    const col = (v) => { if (!isNum(v)) return "transparent"; const t = Math.min(Math.abs(v) / mx, 1); return v >= 0 ? `rgba(34,197,94,${0.12 + t * 0.85})` : `rgba(244,63,94,${0.12 + t * 0.85})`; };
    let cells = "";
    W.forEach((f, i) => W.forEach((s, j) => { if (s <= f) return; const v = map.get(f + "-" + s);
      cells += `<rect class="cell" data-f="${f}" data-s="${s}" x="${pad + j * cs}" y="${pad + i * cs}" width="${cs - 2}" height="${cs - 2}" rx="4" fill="${col(v)}"><title>Hızlı ${f} / Yavaş ${s}: ${r.metric === "sharpe" ? fmt(v) : pct(v)}</title></rect>`; }));
    const axis = W.map((w, i) => `<text x="${pad + i * cs + cs / 2}" y="${pad - 8}" text-anchor="middle">${w}</text><text x="${pad - 8}" y="${pad + i * cs + cs / 2 + 3}" text-anchor="end">${w}</text>`).join("");
    const svg = `<svg width="${size + pad + 10}" height="${size + pad + 10}">${axis}${cells}<text x="${pad + size / 2}" y="12" text-anchor="middle" style="fill:#e6ebf5">Yavaş MA →</text><text x="10" y="${pad + size / 2}" transform="rotate(-90 10 ${pad + size / 2})" text-anchor="middle" style="fill:#e6ebf5">Hızlı MA →</text></svg>`;
    const heat = h("div", { class: "heat", html: svg });
    heat.addEventListener("click", (e) => { const c = e.target.closest("rect.cell"); if (!c) return;
      const f = $("#s-form"); f.fast.value = c.dataset.f; f.slow.value = c.dataset.s; f.strategy.value = "ma"; this.setMode("single"); toast(`Hızlı ${c.dataset.f} / Yavaş ${c.dataset.s} tekli teste aktarıldı`); this.run(); });
    return h("div", {}, h("div", { class: "res-head" }, h("h3", {}, `${r.symbol} · MA parametre ısı haritası`), h("small", { class: "muted" }, `${r.cells.length} kombinasyon · ${r.from} → ${r.to}`)),
      h("div", { class: "metrics" }, this.metric("En iyi ayar", r.best ? `${r.best.fast} / ${r.best.slow}` : "—", "hızlı / yavaş"), this.metric(r.metric === "sharpe" ? "En iyi Sharpe" : "En iyi getiri", r.best ? (r.metric === "sharpe" ? fmt(r.best.v) : pct(r.best.v)) : "—", "", "up"), this.metric("Al ve tut", pct(r.benchmark_return), "aynı dönem")),
      h("div", { class: "card" }, h("p", { class: "hint", style: "margin:0 0 8px" }, "Yeşil = kâr, kırmızı = zarar. Bir kareye tıklarsan o ayar tekli testte çalışır."), heat), this.speech(r.notes));
  },
  overfit(r) {
    const c = h("div", { class: "chart-box" });
    const box = h("div", {}, h("div", { class: "res-head" }, h("h3", {}, `${r.symbol} · Aşırı uyum kontrolü`), h("small", { class: "muted" }, `Eğitim → ${r.split} → Test`)),
      h("div", { class: "verdict " + (r.consistent ? "good" : "bad") }, r.consistent ? "✓ Tutarlı: seçilen ayar görmediği veride de çalıştı." : "✗ Tutarsız: ayar büyük olasılıkla geçmişe aşırı uymuş."),
      h("div", { class: "metrics" }, this.metric("Seçilen ayar", `${r.best.fast} / ${r.best.slow}`, "ilk %70'te en iyi Sharpe"), this.metric("Eğitim getirisi", pct(r.train.total_return), "al-tut " + pct(r.train.benchmark_return), cls(r.train.total_return)),
        this.metric("Test getirisi", pct(r.test.total_return), "al-tut " + pct(r.test.benchmark_return), cls(r.test.total_return)), this.metric("Test düşüşü", pct(-Math.abs(r.test.max_drawdown || 0)), `${fmt(r.test.trades, 0)} işlem`, "down")),
      h("div", { class: "card" }, h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:#a78bfa" }), "Eğitim (%70)"), h("span", {}, h("i", { style: "background:#2dd4bf" }), "Test (%30)")), c), this.speech(r.notes));
    requestAnimationFrame(() => { const ch = makeChart(c); if (!ch) return; ch.addLineSeries({ color: "#a78bfa", lineWidth: 2 }).setData(r.equity_train); ch.addLineSeries({ color: "#2dd4bf", lineWidth: 2 }).setData(r.equity_test); ch.timeScale().fitContent(); });
    return box;
  },
};

/* ---------------------------------------------------------------- ayarlar ve kapanış */
$("#btn-settings").addEventListener("click", async () => {
  try { $("#set-ua").value = (await api("/api/settings")).sec_user_agent || ""; } catch { /* */ }
  $("#settings").showModal();
});
$("#set-save").addEventListener("click", async () => { await api("/api/settings", { sec_user_agent: $("#set-ua").value }); toast("Ayarlar kaydedildi"); refreshStatus(); });
$("#btn-quit").addEventListener("click", async () => {
  if (!confirm("Ajan Merkezi kapatılsın mı? (Arka plandaki sunucu da durur.)")) return;
  try { await api("/api/shutdown", {}); } catch { /* */ }
  document.body.innerHTML = '<div class="empty-state" style="height:100vh;justify-content:center"><h2>Ajan Merkezi kapatıldı</h2><p>Bu pencereyi kapatabilirsin. Tekrar açmak için Ajan-Merkezi-Ac.cmd dosyasına çift tıkla.</p></div>';
  setTimeout(() => window.close(), 800);
});

/* ---------------------------------------------------------------- başlat */
Sim.init();
tickClock(); setInterval(tickClock, 15000);
refreshStatus(); setInterval(refreshStatus, 8000);
refreshTape(); setInterval(refreshTape, 120000);
route();
