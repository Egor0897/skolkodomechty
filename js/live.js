/* ПРЯМОЙ ЭФИР: курсы валют и цены криптовалют.
   • Валюты — официальный курс Банка России на сегодня (файл с сайта cbr-xml-daily.ru,
     который каждый день переписывает данные ЦБ в удобный для программ вид).
   • Криптовалюты — биржа Binance: сначала загружаем цены один раз,
     потом открываем WebSocket — постоянное соединение, по которому биржа
     сама присылает новую цену каждую секунду.
   • Если биржа недоступна, раз в минуту берём цены с CoinGecko.
   Другие файлы подписываются на обновления: Live.on(функция). */

var Live = (function () {
  "use strict";

  var COINS = [  // символ на бирже, тикер, название, id на CoinGecko, цвет значка
    ["BTCUSDT", "BTC", "Bitcoin", "bitcoin", "#F7A93B"],
    ["ETHUSDT", "ETH", "Ethereum", "ethereum", "#A8B5FF"],
    ["TONUSDT", "TON", "Toncoin", "the-open-network", "#5CC4FF"],
    ["SOLUSDT", "SOL", "Solana", "solana", "#C48CFF"],
    ["BNBUSDT", "BNB", "BNB", "binancecoin", "#F3D46B"],
    ["XRPUSDT", "XRP", "XRP", "ripple", "#D7E2DD"],
    ["DOGEUSDT", "DOGE", "Dogecoin", "dogecoin", "#E6C97A"],
  ];
  var FIAT = [["USD", "Доллар США"], ["EUR", "Евро"], ["CNY", "Китайский юань"], ["GBP", "Фунт стерлингов"],
              ["TRY", "Турецкая лира"], ["KZT", "Казахстанский тенге"], ["BYN", "Белорусский рубль"], ["AED", "Дирхам ОАЭ"]];

  var CBR = "https://www.cbr-xml-daily.ru/daily_json.js";
  var REST = "https://data-api.binance.vision/api/v3/";
  var WS = "wss://data-stream.binance.vision/stream?streams=";
  var GECKO = "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_24hr_change=true&ids=";

  var state = {
    fiat: null,        // { USD: {rate, prev, nominal}, ... } — рублей за 1 единицу
    fiatDate: null,
    coins: {},         // { BTCUSDT: {price, change, dir} }
    spark: {},         // { BTCUSDT: [цены за последние 24 часа] }
    mode: "wait",      // wait — загрузка, live — эфир, slow — обновление раз в минуту, off — нет связи
    updated: null,
  };
  var listeners = [], ws = null, wsFails = 0, pollTimer = null, started = false, pending = false, gaveUp = false, watchdog = null;

  function emit() {   // объединяем частые обновления в одно перерисовывание за кадр
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      pending = false;
      listeners.forEach(function (fn) { try { fn(state); } catch (e) { /* ошибка одного не мешает другим */ } });
    });
  }
  function getJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function setCoin(sym, price, change) {
    var old = state.coins[sym];
    state.coins[sym] = { price: price, change: change, dir: old ? (price > old.price ? 1 : price < old.price ? -1 : old.dir) : 0 };
    var sp = state.spark[sym];
    if (sp && sp.length) sp[sp.length - 1] = price;   // последняя точка графика — текущая цена
  }

  /* ---------- валюты ЦБ (запоминаем на 30 минут, чтобы не скачивать на каждой странице) ---------- */
  function loadFiat() {
    var KEY = "sdm-cbr";
    try {
      var c = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (c && Date.now() - c.t < 30 * 60 * 1000) { applyFiat(c.d); return; }
    } catch (e) {}
    getJSON(CBR).then(function (d) {
      applyFiat(d);
      try { sessionStorage.setItem(KEY, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
    }).catch(function () { if (!state.fiat) emit(); });
  }
  function applyFiat(d) {
    var out = { RUB: { rate: 1, prev: 1, nominal: 1 } };
    Object.keys(d.Valute || {}).forEach(function (k) {
      var v = d.Valute[k];
      out[k] = { rate: v.Value / v.Nominal, prev: v.Previous / v.Nominal, nominal: v.Nominal };
    });
    state.fiat = out;
    state.fiatDate = d.Date ? new Date(d.Date) : null;
    emit();
  }

  /* ---------- криптовалюты ---------- */
  function symbolsParam() {
    return encodeURIComponent(JSON.stringify(COINS.map(function (c) { return c[0]; })));
  }
  function loadRest() {
    return getJSON(REST + "ticker/24hr?symbols=" + symbolsParam()).then(function (arr) {
      arr.forEach(function (t) { setCoin(t.symbol, +t.lastPrice, +t.priceChangePercent); });
      state.updated = new Date();
      emit();
    });
  }
  function loadGecko() {
    return getJSON(GECKO + COINS.map(function (c) { return c[3]; }).join(",")).then(function (d) {
      COINS.forEach(function (c) { var x = d[c[3]]; if (x && x.usd) setCoin(c[0], x.usd, x.usd_24h_change || 0); });
      state.updated = new Date();
      state.mode = "slow";
      emit();
    });
  }
  function loadSpark() {   // 24 часовые свечи на каждую монету → маленький график
    COINS.forEach(function (c) {
      getJSON(REST + "klines?symbol=" + c[0] + "&interval=1h&limit=24").then(function (k) {
        state.spark[c[0]] = k.map(function (x) { return +x[4]; });
        if (state.coins[c[0]]) state.spark[c[0]][state.spark[c[0]].length - 1] = state.coins[c[0]].price;
        emit();
      }).catch(function () {});
    });
  }
  function connect() {
    if (ws || document.hidden) return;
    var url = WS + COINS.map(function (c) { return c[0].toLowerCase() + "@miniTicker"; }).join("/");
    try { ws = new WebSocket(url); } catch (e) { return fallback(); }
    // если за 12 секунд биржа не прислала ни одной цены — переходим на обновление раз в минуту
    clearTimeout(watchdog);
    watchdog = setTimeout(function () { if (state.mode !== "live") fallback(); }, 12000);
    ws.onmessage = function (ev) {
      var m = JSON.parse(ev.data), d = m.data || m;
      if (!d || !d.s) return;
      var c = +d.c, o = +d.o;
      setCoin(d.s, c, o ? (c - o) / o * 100 : 0);   // изменение за 24 часа
      state.mode = "live";
      state.updated = new Date();
      wsFails = 0;
      emit();
    };
    ws.onclose = function () {
      ws = null;
      if (document.hidden || gaveUp) return;
      wsFails++;
      if (wsFails >= 3) return fallback();
      setTimeout(connect, 2000 * wsFails);   // пробуем переподключиться
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  function fallback() {   // без WebSocket: обновляем раз в минуту
    gaveUp = true;
    clearTimeout(watchdog);
    if (ws) { var w = ws; ws = null; w.onclose = null; try { w.close(); } catch (e) {} }
    if (pollTimer) return;
    state.mode = "slow";
    emit();
    var tick = function () { loadRest().then(function () { state.mode = "slow"; emit(); }).catch(function () { loadGecko().catch(function () { state.mode = "off"; emit(); }); }); };
    tick();
    pollTimer = setInterval(tick, 60000);
  }

  // когда вкладка скрыта, отключаемся — не тратим интернет и батарею
  document.addEventListener("visibilitychange", function () {
    if (!started) return;
    if (document.hidden) { clearTimeout(watchdog); if (ws) { var w = ws; ws = null; w.onclose = null; w.close(); } }
    else if (!gaveUp) { loadRest().catch(function () {}); connect(); }
  });

  function start(opts) {
    if (started) return;
    started = true;
    loadFiat();
    loadRest().catch(function () {
      return loadGecko().catch(function () { state.mode = "off"; emit(); });
    }).then(function () { if (opts && opts.spark) loadSpark(); });
    if (typeof WebSocket !== "undefined") connect(); else fallback();
  }

  /* ---------- оформление чисел ---------- */
  var NB = " ";
  function fmt(v, d) {
    return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v).replace(/\s/g, NB);
  }
  function usd(v) { return "$" + fmt(v, v >= 1000 ? 0 : v >= 1 ? 2 : 4); }
  function rubles(v) { return fmt(v, v >= 1000 ? 0 : 2) + NB + "₽"; }
  function change(v) { return (v > 0 ? "▲" + NB : v < 0 ? "▼" + NB : "") + fmt(Math.abs(v), Math.abs(v) < 10 ? 2 : 1) + NB + "%"; }
  function cls(v) { return v > 0 ? "up" : v < 0 ? "down" : ""; }
  function usdRub() { return state.fiat && state.fiat.USD ? state.fiat.USD.rate : null; }
  function statusText() {
    return { wait: "загрузка…", live: "в эфире", slow: "раз в минуту", off: "нет связи" }[state.mode];
  }
  function statusHTML() {
    return '<span class="live ' + (state.mode === "live" ? "on" : state.mode === "slow" ? "slow" : "") + '" data-live-status><i></i>' + statusText() + "</span>";
  }

  /* ---------- строка курсов вверху каждой страницы ---------- */
  function paintTicker() {
    var box = document.getElementById("ticker-items");
    if (!box) return;
    var parts = [statusHTML()];
    ["USD", "EUR", "CNY"].forEach(function (k) {
      var f = state.fiat && state.fiat[k];
      parts.push('<span class="t-item"><b>' + k + "</b><span>" + (f ? fmt(f.rate, 2) + NB + "₽" : "…") + "</span>" +
        (f ? '<span class="t-ch ' + cls(f.rate - f.prev) + '">' + change((f.rate - f.prev) / f.prev * 100) + "</span>" : "") + "</span>");
    });
    COINS.slice(0, 4).forEach(function (c) {
      var x = state.coins[c[0]];
      parts.push('<span class="t-item"><b>' + c[1] + '</b><span class="' + (x && x.dir > 0 ? "flash-up" : x && x.dir < 0 ? "flash-down" : "") + '">' + (x ? usd(x.price) : "…") + "</span>" +
        (x ? '<span class="t-ch ' + cls(x.change) + '">' + change(x.change) + "</span>" : "") + "</span>");
    });
    box.innerHTML = parts.join("");
  }
  listeners.push(paintTicker);

  return {
    COINS: COINS, FIAT: FIAT, state: state, start: start,
    on: function (fn) { listeners.push(fn); },
    fmt: fmt, usd: usd, rubles: rubles, change: change, cls: cls, usdRub: usdRub, statusHTML: statusHTML,
  };
})();
