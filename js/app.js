/* ЛОГИКА СТРАНИЦ: формы, пересчёт на лету, графики и подсказки.
   Каждая HTML-страница сообщает, кто она, атрибутом <body data-page="...">.
   Этот файл рисует для неё форму и результаты, а считает всё через Finance (js/finance.js).

   Введённые числа сохраняются в памяти браузера (localStorage), поэтому:
   • после перезагрузки страницы они не пропадают;
   • цель с главной страницы используется на страницах «Кредит», «Мелкие траты» и «Бюджет». */

(function () {
  "use strict";
  var F = Finance;

  /* ---------------------------------------------------------------- вывод чисел по-русски */
  var NB = " "; // неразрывный пробел: «64 996 ₽» не разорвётся на две строки
  var MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  function group(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NB); }
  function rub(kop) {          // копейки → «64 996 ₽»
    var k = Math.round(kop), r = Math.floor((Math.abs(k) + 50) / 100);
    return (k < 0 && r ? "−" : "") + group(r) + NB + "₽";
  }
  function rub2(kop) {         // копейки → «64 996,18»
    var k = Math.round(kop), a = Math.abs(k);
    return (k < 0 ? "−" : "") + group(Math.floor(a / 100)) + "," + String(a % 100).padStart(2, "0");
  }
  function num(v, d) {
    d = d || 0;
    return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v).replace(/\s/g, NB);
  }
  function shortRub(v) {       // подписи оси: 20 000 → «20 тыс.»
    if (v >= 1e6) return String(+(v / 1e6).toFixed(1)).replace(".", ",") + NB + "млн";
    if (v >= 1000) return group(Math.round(v / 1000)) + NB + "тыс.";
    return group(Math.round(v));
  }
  function plural(n, one, few, many) {   // 1 год, 2 года, 5 лет
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b === 1) return one;
    if (b > 1 && b < 5) return few;
    return many;
  }
  function monthLabel(n) {     // через n месяцев от сегодня → «июль 2028»
    var d = new Date(), idx = d.getMonth() + n;
    return MONTHS[idx % 12] + " " + (d.getFullYear() + Math.floor(idx / 12));
  }
  function monthsText(m) { return m === null ? "больше 50 лет" : m === 0 ? "уже хватает" : m + NB + "мес."; }
  function esc(s) {            // защита: текст пользователя не превратится в HTML-код
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function fv(v) { return typeof v === "number" ? String(v).replace(".", ",") : String(v); }
  function pct(v) { return Math.max(0, Math.min(100, v)).toFixed(2) + "%"; }

  /* ---------------------------------------------------------------- данные (примеры по умолчанию) */
  var DEFAULTS = {
    goal: { name: "Ноутбук", price: 60000, start: 0, monthly: 3000, rate: 10, inflation: 4, target: 12 },
    credit: { amount: 60000, months: 12, rate: 20, extra: 0 },
    expenses: {
      rows: [
        { name: "Перекус в школе", price: 120, times: 5, period: "week" },
        { name: "Напиток по дороге", price: 90, times: 3, period: "week" },
        { name: "Подписка на музыку", price: 199, times: 1, period: "month" },
        { name: "Покупки в играх", price: 300, times: 1, period: "month" },
        { name: "", price: "", times: "", period: "week" },
        { name: "", price: "", times: "", period: "week" },
      ],
      cut: 50,
    },
    deposits: {
      amount: 50000, months: 12, offers: [
        { name: "Вклад 1", rate: 10, cap: "monthly" },
        { name: "Вклад 2", rate: 10.5, cap: "end" },
        { name: "Вклад 3", rate: 9.8, cap: "monthly" },
      ],
    },
    budget: { pocket: 3000, job: 2000, other: 0, needs: 2000, wants: 2000, savings: 1000 },
    inflation: { price: 60000, inflation: 4, years: 10 },
    rates: { amount: null },   // null — взять цену цели со страницы «Накопления»
    goals: {
      draft: { name: "", price: "", saved: "", monthly: "" },
      list: [
        { name: "Наушники", price: 8000, saved: 2500, monthly: 1500 },
        { name: "Велосипед", price: 25000, saved: 4000, monthly: 2000 },
      ],
    },
    quiz: { i: 0, answers: [], best: 0 },
  };
  var KEY = "skolko-do-mechty-v1";
  var S = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && typeof saved === "object") for (var k in DEFAULTS) if (saved[k]) S[k] = Object.assign(S[k], saved[k]);
  } catch (e) { /* память браузера недоступна — работаем с примерами */ }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  // Текст из поля → число. Понимает «60 000» и «4,5»; не пропускает буквы и слишком большие значения.
  function parseNum(raw, def, lo, hi, isInt, errors, label) {
    var t = String(raw == null ? "" : raw).replace(/[\s ]/g, "").replace(",", ".");
    if (t === "") return lo;
    var v = Number(t);
    if (!isFinite(v)) { errors.push("«" + label + "»: введите число"); return def; }
    var c = Math.min(Math.max(v, lo), hi);
    return isInt ? Math.round(c) : c;
  }

  /* ---------------------------------------------------------------- элементы форм */
  function numField(page, name, label, value, unit, wide) {
    var id = page + "-" + name;
    return '<label class="field' + (wide ? " wide" : "") + '" for="' + id + '"><span class="label">' + label + "</span>" +
      '<span class="input"><input id="' + id + '" name="' + name + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(fv(value)) + '">' +
      (unit ? '<span class="unit">' + unit + "</span>" : "") + "</span></label>";
  }
  function textField(page, name, label, value, wide) {
    var id = page + "-" + name;
    return '<label class="field' + (wide ? " wide" : "") + '" for="' + id + '"><span class="label">' + label + "</span>" +
      '<span class="input"><input id="' + id + '" name="' + name + '" type="text" maxlength="40" autocomplete="off" value="' + esc(value) + '"></span></label>';
  }
  function errorsBox(errs) {
    return errs.length ? '<div class="alert" role="alert">' + errs.map(function (e) { return "<p>" + esc(e) + "</p>"; }).join("") + "</div>" : "";
  }
  function val(form, name) { return form.elements[name] ? form.elements[name].value : ""; }
  function goalCtx() { return Object.assign({}, S.goal, { name: S.goal.name || "цель" }); }
  function bar(label, value, max, muted) {
    var w = pct(value / max * 100);
    return '<div class="bar-row"><span class="bar-label">' + label + '</span><span class="bar-track"><span class="bar' + (muted ? " muted" : "") +
      '" style="width:' + w + '"></span><span class="bar-val" style="left:' + w + '">' + rub(value) + "</span></span></div>";
  }

  /* ---------------------------------------------------------------- предложения Сбера
     Ставки банки меняют часто, поэтому здесь нет чисел — только продукты и ссылки
     на официальный сайт. Кнопка «Сравнить» переносит вклад в форму слева. */
  var OUT = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3h7v7M13 3 4 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SBER_FINE = '<p class="fine">Подборка для учебного проекта: не реклама и не предложение заключить договор. Проект SDM не связан с ПАО Сбербанк ' +
    "(генеральная лицензия Банка России №" + NB + "1481). Актуальные ставки и условия — только на сайте банка.</p>";
  var SBER = {
    deposits: [
      { name: "СберВклад", tag: "популярный", url: "https://www.sberbank.ru/promo/vkl",
        text: "Вклад на выбранный срок. В приложении СберБанк Онлайн ставка выше, чем в отделении." },
      { name: "Вклад «Лучший %»", url: "https://www.sberbank.ru/ru/person/contributions/deposits",
        text: "Самая высокая ставка — если общий остаток на счетах и вкладах в Сбере не ниже порога, который назначает банк." },
      { name: "Вклад «Ключевой»", url: "https://www.sberbank.ru/ru/person/contributions/deposits",
        text: "Ставка привязана к ключевой ставке Банка России и меняется вслед за ней." },
    ],
    credit: [
      { name: "Кредитная СберКарта", url: "https://www.sberbank.ru/ru/person/bank_cards/credit_cards",
        text: "Беспроцентный период действует на покупки. На снятие наличных и переводы он обычно не распространяется, и за них берут комиссию." },
      { name: "Кредит наличными", url: "https://www.sberbank.ru/ru/person/credits/money",
        text: "Деньги на любые цели с одинаковыми ежемесячными платежами. Перед оформлением сравните ПСК с предложениями других банков." },
    ],
  };
  function sberHTML(kind) {
    var rows = SBER[kind].map(function (o, i) {
      return '<div class="o-row"><div><p class="o-name">' + o.name + (o.tag ? "<small>" + o.tag + "</small>" : "") + '</p><p class="o-text">' + o.text + "</p></div>" +
        '<div class="o-actions">' + (kind === "deposits" ? '<button type="button" class="btn" data-fill="' + i + '">Сравнить</button>' : "") +
        '<a class="btn primary" href="' + o.url + '" target="_blank" rel="noopener noreferrer">На сайт Сбера' + OUT + "</a></div></div>";
    }).join("");
    var intro = kind === "deposits"
      ? "Ставки меняются почти каждую неделю, поэтому мы их не печатаем. Откройте вклад на сайте Сбера, нажмите «Сравнить» — он появится в форме слева, останется вписать ставку. С 14 лет вклад можно открыть самостоятельно (ст." + NB + "26 ГК РФ)."
      : "Кредиты и кредитные карты выдают только с 18 лет. Прежде чем брать кредит, посмотрите выше, во сколько обойдётся покупка сразу и сколько стоит подождать.";
    return '<div class="card"><div class="card-head"><h2 class="card-title">Предложения Сбера</h2></div><p class="hint" style="margin-bottom:14px">' + intro + "</p>" +
      '<div class="offers-list">' + rows + "</div>" + SBER_FINE + "</div>";
  }

  /* ================================================================ СТРАНИЦЫ
     У каждой страницы три функции:
       form()    — рисует поля формы;
       read()    — читает введённые числа в память;
       results() — считает и возвращает HTML с результатами. */
  var PAGES = {};

  /* ---------- 1. Накопления (главная) ---------- */
  PAGES.goal = {
    form: function () {
      var g = S.goal;
      return textField("goal", "name", "На что копим", g.name, true) +
        numField("goal", "price", "Цена сейчас", g.price, "₽") +
        numField("goal", "start", "Уже накоплено", g.start, "₽") +
        numField("goal", "monthly", "Откладываю каждый месяц", g.monthly, "₽", true) +
        numField("goal", "rate", "Ставка вклада", g.rate, "% год.") +
        numField("goal", "inflation", "Инфляция", g.inflation, "% год.") +
        numField("goal", "target", "Хочу купить через", g.target, "мес.", true) +
        '<p class="hint">Подставлен пример. Замените числа своими — результат пересчитается сразу.</p>';
    },
    read: function (f, e) {
      var g = S.goal;
      g.name = val(f, "name").trim().slice(0, 40);
      g.price = parseNum(val(f, "price"), 60000, 0, 1e8, false, e, "Цена сейчас");
      g.start = parseNum(val(f, "start"), 0, 0, 1e8, false, e, "Уже накоплено");
      g.monthly = parseNum(val(f, "monthly"), 3000, 0, 1e7, false, e, "Откладываю каждый месяц");
      g.rate = parseNum(val(f, "rate"), 10, 0, 100, false, e, "Ставка вклада");
      g.inflation = parseNum(val(f, "inflation"), 4, 0, 100, false, e, "Инфляция");
      g.target = parseNum(val(f, "target"), 12, 1, 600, true, e, "Хочу купить через");
    },
    results: function (errs) {
      var g = goalCtx();
      var r = F.simulate(g.price, g.start, g.monthly, g.rate, g.inflation);
      var p = r.pm, d = r.dm, verdict;
      if (g.monthly === 0 && g.start < g.price) verdict = "Укажите, сколько вы откладываете каждый месяц.";
      else if (p === null && d === null) verdict = "С таким взносом цену не догнать: она растёт быстрее. Увеличьте взнос или выберите цель дешевле.";
      else if (d === 0) verdict = "Денег уже хватает, можно покупать.";
      else if (p === null) verdict = "В копилке не накопить: цена растёт быстрее. На вкладе цель будет через " + d + " мес.";
      else if (d === p) verdict = "Срок одинаковый, но на вкладе останется больше денег.";
      else if (d < p) verdict = "Вклад быстрее копилки на " + (p - d) + " мес.";
      else verdict = "Копилка оказалась быстрее. Проверьте ставку вклада.";
      var win = d !== null && (p === null || d < p) ? "deposit" : p !== null && (d === null || p < d) ? "piggy" : "";
      var need = F.neededMonthly(g.price, g.start, g.rate, g.inflation, g.target);
      var targetPrice = F.priceAt(F.toKop(g.price), g.inflation, g.target);
      function stat(key, label) {
        var m = key === "piggy" ? p : d, sub = "";
        if (m) sub = monthLabel(m) + " · " + (key === "piggy" ? "цена " + rub(r.rows[m].price) : "проценты " + rub(r.rows[m].total));
        else if (m === null) sub = key === "piggy" ? "цена растёт быстрее, чем копилка" : "взноса не хватает";
        return '<div class="stat' + (win === key ? " win" : "") + '"><span class="stat-k"><i class="key ' + key + '"></i>' + label +
          (win === key ? "<em>быстрее</em>" : "") + "</span><strong>" + monthsText(m) + '</strong><span class="stat-sub">' + sub + "</span></div>";
      }
      var table = r.rows.slice(1).map(function (x) {
        return "<tr" + (x.month === d ? ' class="goal"' : "") + "><td>" + x.month + (x.month === d ? " ✓" : "") + "</td><td>" + rub2(x.piggy) +
          "</td><td>" + rub2(x.interest) + "</td><td>" + rub2(x.deposit) + "</td><td>" + rub2(x.price) + "</td></tr>";
      }).join("");
      return errorsBox(errs) +
        '<div class="stats">' + stat("piggy", "Копилка") + stat("deposit", "Вклад") + "</div>" +
        '<p class="verdict">' + verdict + "</p>" + chartHTML(r) +
        '<div class="card plan"><p class="plan-k">Успеть за ' + g.target + " мес. · " + monthLabel(g.target) + "</p>" +
        '<div class="plan-row"><div><span>на вклад</span><strong>' + rub(need[0]) + "</strong></div><div><span>в копилку</span><strong>" + rub(need[1]) +
        "</strong></div><div><span>цена к этому времени</span><strong>" + rub(targetPrice) + "</strong></div></div>" +
        '<p class="hint">Сколько откладывать каждый месяц, чтобы успеть.</p></div>' +
        '<details class="months"><summary>Расчёт по месяцам</summary><div class="table-wrap"><table><thead><tr><th>Месяц</th><th>Копилка</th><th>Проценты</th><th>Вклад</th><th>Цена цели</th></tr></thead><tbody>' +
        table + "</tbody></table></div></details>";
    },
  };

  /* График накоплений: линии в SVG (координаты 0…1000), подписи осей — обычным HTML */
  function niceStep(max) {
    var raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    var ks = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < ks.length; i++) if (raw / p <= ks[i]) return ks[i] * p;
    return 10 * p;
  }
  function chartHTML(r) {
    var rows = r.rows, last = rows.length - 1;
    if (last < 1) return "";
    var top = Math.max.apply(null, rows.map(function (x) { return Math.max(x.deposit, x.piggy, x.price); })) / 100;
    if (top <= 0) return "";
    var step = niceStep(top), ymax = Math.ceil(top / step) * step;
    function X(m) { return m / last * 1000; }
    function Y(k) { return 1000 - (k / 100) / ymax * 1000; }
    function path(key) {
      return rows.map(function (x, i) { return (i ? "L" : "M") + X(x.month).toFixed(1) + "," + Y(x[key]).toFixed(1); }).join(" ");
    }
    var yt = "", grid = "", xt = "", dots = "";
    for (var v = 0; v <= ymax + 1e-9; v += step) {
      var pos = 100 - v / ymax * 100;
      yt += '<span style="top:' + pos.toFixed(2) + '%">' + shortRub(v) + "</span>";
      grid += '<line class="grid" x1="0" x2="1000" y1="' + (pos * 10).toFixed(1) + '" y2="' + (pos * 10).toFixed(1) + '"/>';
    }
    var xs = [1, 2, 3, 6, 12, 24, 60, 120].filter(function (s) { return last / s <= 8; })[0] || 120;
    for (var m = 0; m <= last; m += xs) {
      var align = m === 0 ? "start" : m / last > 0.94 ? "end" : "";
      xt += '<span class="' + align + '" style="left:' + (m / last * 100).toFixed(2) + '%">' + (m === 0 ? "0" : m + NB + "мес.") + "</span>";
    }
    [["piggy", r.pm], ["deposit", r.dm]].forEach(function (pair) {
      var key = pair[0], mm = pair[1];
      if (!mm) return;
      var left = mm / last * 100, topPct = 100 - rows[mm][key] / 100 / ymax * 100;
      dots += '<span class="dot ' + key + '" style="left:' + left.toFixed(2) + "%;top:" + topPct.toFixed(2) + '%"></span>';
      if (key === "deposit") dots += '<span class="dot-label' + (left > 70 ? " left" : "") + '" style="left:' + left.toFixed(2) + "%;top:" + topPct.toFixed(2) + '%">цель · ' + mm + NB + "мес.</span>";
    });
    var w = 1000 / last;
    var hits = rows.map(function (x) {   // невидимые полосы для подсказки при наведении
      return '<rect class="hit" x="' + Math.max(0, X(x.month) - w / 2).toFixed(2) + '" y="0" width="' + w.toFixed(2) + '" height="1000" data-month="' + x.month +
        '" data-deposit="' + rub(x.deposit) + '" data-piggy="' + rub(x.piggy) + '" data-price="' + rub(x.price) + '"></rect>';
    }).join("");
    return '<figure class="card chart-card"><ul class="legend"><li><i class="key deposit"></i>на вкладе</li><li><i class="key piggy"></i>в копилке</li><li><i class="key price"></i>цена цели</li></ul>' +
      '<div class="chart"><div class="y-axis" aria-hidden="true">' + yt + '</div><div class="plot">' +
      '<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label="График накоплений по месяцам">' + grid +
      '<path class="ln price" d="' + path("price") + '"/><path class="ln piggy" d="' + path("piggy") + '"/><path class="ln deposit" d="' + path("deposit") + '"/>' + hits +
      "</svg>" + dots + '</div><div class="x-axis" aria-hidden="true">' + xt + "</div></div></figure>";
  }

  /* ---------- 2. Кредит ---------- */
  PAGES.credit = {
    form: function () {
      var c = S.credit;
      return numField("credit", "amount", "Цена покупки", c.amount, "₽", true) +
        numField("credit", "months", "Срок", c.months, "мес.") +
        numField("credit", "rate", "Ставка", c.rate, "% год.") +
        numField("credit", "extra", "Страховка и комиссии", c.extra, "₽", true) +
        '<p class="hint">Сравнивайте предложения по ПСК — полной стоимости кредита. Её печатают в рамке в правом верхнем углу первой страницы договора.</p>';
    },
    read: function (f, e) {
      var c = S.credit;
      c.amount = parseNum(val(f, "amount"), 60000, 0, 1e8, false, e, "Цена покупки");
      c.months = parseNum(val(f, "months"), 12, 1, 360, true, e, "Срок");
      c.rate = parseNum(val(f, "rate"), 20, 0, 200, false, e, "Ставка");
      c.extra = parseNum(val(f, "extra"), 0, 0, 1e7, false, e, "Страховка и комиссии");
    },
    results: function (errs) {
      var c = S.credit, g = goalCtx(), res = F.credit(c.amount, c.months, c.rate, c.extra);
      var bars = [], saving = null;
      if (c.amount > 0) {
        // что, если ту же сумму платежа каждый месяц класть на вклад?
        var sim = F.simulate(c.amount, 0, res.payment / 100, g.rate, g.inflation);
        bars.push(["Купить сразу в кредит", res.total]);
        if (sim.dm) {
          var row = sim.rows[sim.dm], own = row.price - row.total;
          saving = { months: sim.dm, price: row.price, interest: row.total, diff: res.total - own };
          bars.push(["Накопить на вкладе и купить через " + sim.dm + " мес.", own]);
        }
      }
      var top = Math.max.apply(null, [1].concat(bars.map(function (b) { return b[1]; })));
      var note = "";
      if (saving) {
        note = '<p class="note">Если каждый месяц класть на вклад сумму платежа, покупка случится через ' + saving.months + " мес. Цена вырастет до " + rub(saving.price) +
          ", но " + rub(saving.interest) + " из неё оплатят проценты вклада. " +
          (saving.diff > 0 ? "Кредит дороже на <b>" + rub(saving.diff) + "</b>: это цена того, что вещь ваша сразу." : "В этом случае кредит не дороже накопления.") + "</p>" +
          '<p class="hint">Ставка вклада ' + num(g.rate, 1) + NB + "% и инфляция " + num(g.inflation, 1) + NB + "% взяты со страницы «Накопления».</p>";
      } else if (res.overpay <= 0) {
        note = '<p class="note">Переплаты нет. Проверьте, что цена в рассрочку такая же, как без неё, и нет платной страховки.</p>';
      }
      return errorsBox(errs) +
        '<div class="stats three">' +
        '<div class="stat"><span class="stat-k">Платёж в месяц</span><strong>' + rub2(res.payment) + NB + '₽</strong><span class="stat-sub">' + c.months + " " + plural(c.months, "платёж", "платежа", "платежей") + "</span></div>" +
        '<div class="stat"><span class="stat-k">Всего заплатите</span><strong>' + rub(res.total) + '</strong><span class="stat-sub">вместо ' + rub(c.amount * 100) + "</span></div>" +
        '<div class="stat' + (res.overpay > 0 ? " warn" : "") + '"><span class="stat-k">Переплата</span><strong>' + rub(res.overpay) + '</strong><span class="stat-sub">' + num(res.percent, 1) + NB + "% сверх цены</span></div></div>" +
        (bars.length ? '<div class="card"><h2 class="card-title">Сколько своих денег уйдёт на покупку</h2><div class="bars">' +
          bars.map(function (b) { return bar(b[0], b[1], top); }).join("") + "</div>" + note + "</div>" : "") +
        sberHTML("credit");
    },
  };

  /* ---------- 3. Мелкие траты ---------- */
  PAGES.expenses = {
    form: function () {
      var ex = S.expenses;
      var rows = ex.rows.map(function (r, i) {
        var opts = Object.keys(F.PERIODS).map(function (k) {
          return '<option value="' + k + '"' + (r.period === k ? " selected" : "") + ">" + F.PERIODS[k][0] + "</option>";
        }).join("");
        return '<div class="exp-row">' +
          '<span class="input"><label class="sr" for="exp-name' + i + '">Трата ' + (i + 1) + '</label><input id="exp-name' + i + '" name="name' + i + '" type="text" maxlength="40" autocomplete="off" placeholder="Трата" value="' + esc(r.name) + '"></span>' +
          '<span class="input"><label class="sr" for="exp-price' + i + '">Цена, рублей</label><input id="exp-price' + i + '" name="price' + i + '" type="text" inputmode="decimal" autocomplete="off" placeholder="Цена, ₽" value="' + esc(fv(r.price)) + '"></span>' +
          '<span class="input"><label class="sr" for="exp-times' + i + '">Сколько раз</label><input id="exp-times' + i + '" name="times' + i + '" type="text" inputmode="decimal" autocomplete="off" placeholder="Раз" value="' + esc(fv(r.times)) + '"></span>' +
          '<span class="input sel"><label class="sr" for="exp-period' + i + '">Как часто</label><select id="exp-period' + i + '" name="period' + i + '">' + opts + "</select></span></div>";
      }).join("");
      var cuts = [0, 25, 50, 75, 100].map(function (p) { return '<option value="' + p + '"' + (ex.cut === p ? " selected" : "") + ">" + p + NB + "%</option>"; }).join("");
      return '<div class="exp-head" aria-hidden="true"><span>Трата</span><span>Цена, ₽</span><span>Раз</span><span>Как часто</span></div>' + rows +
        '<label class="field" for="exp-cut" style="margin-top:8px"><span class="label">Сократить траты на</span><span class="input sel"><select id="exp-cut" name="cut">' + cuts + "</select></span></label>" +
        '<p class="hint">Строки заполнены для примера. Впишите свои траты.</p>';
    },
    read: function (f, e) {
      var ex = S.expenses;
      ex.rows = ex.rows.map(function (_, i) {
        var pr = val(f, "price" + i), tm = val(f, "times" + i), per = val(f, "period" + i);
        return {
          name: val(f, "name" + i).slice(0, 40),
          price: pr.trim() === "" ? "" : parseNum(pr, 0, 0, 1e6, false, e, "Цена"),
          times: tm.trim() === "" ? "" : parseNum(tm, 0, 0, 1000, false, e, "Сколько раз"),
          period: F.PERIODS[per] ? per : "week",
        };
      });
      ex.cut = parseNum(val(f, "cut"), 50, 0, 100, true, e, "Сократить");
    },
    results: function (errs) {
      var ex = S.expenses, g = goalCtx();
      var items = ex.rows.filter(function (r) { return r.name.trim() || Number(r.price); }).map(function (r) {
        return { name: r.name.trim() || "Без названия", monthly: F.expenseMonthly(Number(r.price) || 0, Number(r.times) || 0, r.period) };
      });
      var total = items.reduce(function (s, x) { return s + x.monthly; }, 0);
      var top = Math.max.apply(null, [1].concat(items.map(function (x) { return x.monthly; })));
      var ranked = items.slice().sort(function (a, b) { return b.monthly - a.monthly; });   // самые дорогие — сверху
      var extra = total * ex.cut / 100;
      var before = F.simulate(g.price, g.start, g.monthly, g.rate, g.inflation).dm;
      var after = F.simulate(g.price, g.start, g.monthly + extra / 100, g.rate, g.inflation).dm;
      var share = g.price > 0 ? total * 12 / F.toKop(g.price) * 100 : 0;
      var result = ex.cut === 0 || total === 0
        ? '<p class="verdict">Выберите, на сколько сократить траты, чтобы увидеть, как приблизится цель.</p>'
        : '<p class="plan-k">Минус ' + ex.cut + NB + "% трат = плюс " + rub(extra) + " на вклад каждый месяц</p>" +
          '<div class="plan-row"><div><span>сейчас</span><strong>' + monthsText(before) + '</strong></div><div><span>после сокращения</span><strong class="accent">' + monthsText(after) + "</strong></div></div>" +
          '<p class="hint">Срок накопления на «' + esc(g.name) + "» на вкладе. Цель, взнос и ставка взяты со страницы «Накопления».</p>";
      return errorsBox(errs) +
        '<div class="stats"><div class="stat"><span class="stat-k">В месяц</span><strong>' + rub(total) + '</strong><span class="stat-sub">откладываете ' + rub(g.monthly * 100) + "</span></div>" +
        '<div class="stat"><span class="stat-k">За год</span><strong>' + rub(total * 12) + '</strong><span class="stat-sub">' + num(share) + NB + "% цены цели «" + esc(g.name) + "»</span></div></div>" +
        (ranked.length ? '<div class="card"><h2 class="card-title">Куда уходят деньги</h2><div class="bars">' +
          ranked.map(function (x) { return bar(esc(x.name), x.monthly, top); }).join("") +
          '</div><p class="hint" style="margin-top:12px">В месяц. Неделя считается как 52 / 12, день как 365 / 12.</p></div>' : "") +
        '<div class="card result-card">' + result + "</div>";
    },
  };

  /* ---------- 4. Вклады ---------- */
  PAGES.deposits = {
    form: function () {
      var d = S.deposits;
      return numField("dep", "amount", "Сумма вклада", d.amount, "₽", true) +
        numField("dep", "months", "Срок", d.months, "мес.", true) +
        d.offers.map(function (o, i) {
          return '<fieldset class="offer"><legend class="sr">Вклад ' + (i + 1) + "</legend>" +
            textField("dep", "name" + i, "Название вклада", o.name, true) +
            numField("dep", "rate" + i, "Ставка", o.rate, "% годовых", true) +
            '<label class="field wide" for="dep-cap' + i + '"><span class="label">Когда начисляются проценты</span><span class="input sel"><select id="dep-cap' + i + '" name="cap' + i + '">' +
            '<option value="monthly"' + (o.cap === "monthly" ? " selected" : "") + ">каждый месяц</option>" +
            '<option value="end"' + (o.cap === "end" ? " selected" : "") + ">один раз в конце срока</option></select></span></label></fieldset>";
        }).join("") +
        '<p class="hint">Ставки — пример. Подставьте предложения банков.</p>';
    },
    read: function (f, e) {
      var d = S.deposits;
      d.amount = parseNum(val(f, "amount"), 50000, 0, 1e8, false, e, "Сумма вклада");
      d.months = parseNum(val(f, "months"), 12, 1, 120, true, e, "Срок");
      d.offers = d.offers.map(function (o, i) {
        return {
          name: val(f, "name" + i).trim().slice(0, 30) || "Вклад " + (i + 1),
          rate: parseNum(val(f, "rate" + i), o.rate, 0, 100, false, e, "Ставка"),
          cap: val(f, "cap" + i) === "end" ? "end" : "monthly",
        };
      });
    },
    results: function (errs) {
      var d = S.deposits;
      var offers = d.offers.map(function (o) { return Object.assign({}, o, { res: F.depositOffer(d.amount, d.months, o.rate, o.cap) }); });
      var best = offers.reduce(function (a, b) { return b.res.final > a.res.final ? b : a; });   // самый выгодный
      var top = Math.max.apply(null, [1].concat(offers.map(function (o) { return o.res.income; })));
      function capText(c) { return c === "monthly" ? "каждый месяц" : "в конце срока"; }
      var rows = offers.map(function (o) {
        return "<tr" + (o === best ? ' class="goal"' : "") + "><td>" + esc(o.name) + "</td><td>" + num(o.rate, 1) + NB + "%</td><td>" + rub(o.res.income) +
          "</td><td>" + rub(o.res.final) + "</td><td>" + num(o.res.eff, 2) + NB + "%</td></tr>";
      }).join("");
      return errorsBox(errs) +
        '<div class="stats"><div class="stat win"><span class="stat-k">Выгоднее всего<em>лучший</em></span><strong>' + esc(best.name) + '</strong><span class="stat-sub">доход ' + rub(best.res.income) + " за " + d.months + " мес.</span></div>" +
        '<div class="stat"><span class="stat-k">В конце срока</span><strong>' + rub(best.res.final) + '</strong><span class="stat-sub">вместо ' + rub(d.amount * 100) + "</span></div></div>" +
        '<div class="card"><h2 class="card-title">Доход по каждому вкладу</h2><div class="bars">' +
        offers.map(function (o) { return bar(esc(o.name) + "<small>" + num(o.rate, 1) + NB + "%, " + capText(o.cap) + "</small>", o.res.income, top, o !== best); }).join("") + "</div></div>" +
        '<div class="card"><h2 class="card-title">Подробно</h2><div class="table-wrap plain"><table><thead><tr><th>Вклад</th><th>Ставка</th><th>Доход</th><th>Итог</th><th>На самом деле за год</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
        '<p class="hint" style="margin-top:10px">«На самом деле за год» — эффективная ставка: сколько процентов вклад реально приносит за год с учётом того, как начисляются проценты.</p></div>' +
        '<div class="card"><p class="plan-k">Что такое капитализация</p><p class="note">Если проценты начисляются каждый месяц, банк прибавляет их к вкладу, и в следующем месяце проценты считаются уже с большей суммы. Это проценты на проценты. Поэтому вклад с капитализацией может обогнать вклад с более высокой ставкой, но с выплатой в конце срока.</p></div>' +
        sberHTML("deposits");
    },
  };

  /* ---------- 5. Бюджет ---------- */
  var BUDGET_FIELDS = [["pocket", "Карманные деньги"], ["job", "Подработка"], ["other", "Подарки и другое"], ["needs", "Нужное"], ["wants", "Желания"], ["savings", "Откладываю на цель"]];
  PAGES.budget = {
    form: function () {
      var b = S.budget;
      return '<p class="form-group">Доходы в месяц</p>' +
        numField("bud", "pocket", "Карманные деньги", b.pocket, "₽", true) +
        numField("bud", "job", "Подработка", b.job, "₽") +
        numField("bud", "other", "Подарки и другое", b.other, "₽") +
        '<p class="form-group">Расходы в месяц</p>' +
        numField("bud", "needs", "Нужное", b.needs, "₽") +
        numField("bud", "wants", "Желания", b.wants, "₽") +
        numField("bud", "savings", "Откладываю на цель", b.savings, "₽", true) +
        '<p class="hint">Нужное — проезд, обеды, школьные вещи. Желания — развлечения, игры, кафе, подписки. Числа — пример.</p>';
    },
    read: function (f, e) {
      BUDGET_FIELDS.forEach(function (p) { S.budget[p[0]] = parseNum(val(f, p[0]), DEFAULTS.budget[p[0]], 0, 1e7, false, e, p[1]); });
    },
    results: function (errs) {
      var b = S.budget, g = goalCtx();
      var income = F.toKop(b.pocket + b.job + b.other);
      var spent = { needs: F.toKop(b.needs), wants: F.toKop(b.wants), savings: F.toKop(b.savings) };
      var left = income - spent.needs - spent.wants - spent.savings;
      var parts = F.BUDGET_RULE.map(function (r) {
        var key = r[0], share = r[2], actualPct = income ? spent[key] / income * 100 : 0, status;
        if (Math.abs(actualPct - share) <= 5) status = "ok";
        else if (key === "savings") status = actualPct > share ? "ok" : "low";   // откладывать больше нормы — хорошо
        else status = actualPct > share ? "high" : "ok";
        return { key: key, label: r[1], share: share, actual: spent[key], actualPct: actualPct, rec: F.rhu(income * share / 100), status: status };
      });
      var nowM = F.simulate(g.price, g.start, spent.savings / 100, g.rate, g.inflation).dm;
      var ruleM = F.simulate(g.price, g.start, parts[2].rec / 100, g.rate, g.inflation).dm;
      var chip = { ok: "в норме", high: "больше нормы", low: "меньше нормы" };
      var rows = parts.map(function (p) {
        return '<div class="brow"><div class="brow-name"><strong>' + p.label + "</strong><span>" + rub(p.actual) + " · норма " + rub(p.rec) + "</span></div>" +
          '<div class="btrack" title="Сейчас ' + num(p.actualPct) + " %, по правилу " + p.share + ' %"><span class="bfill ' + p.status + '" style="width:' + pct(p.actualPct) + '"></span><span class="bmark" style="left:' + p.share + '%"></span></div>' +
          '<div class="brow-pct"><strong>' + num(p.actualPct) + NB + '%</strong><span class="chip ' + p.status + '">' + chip[p.status] + "</span></div></div>";
      }).join("");
      return errorsBox(errs) +
        '<div class="stats three"><div class="stat"><span class="stat-k">Доходы</span><strong>' + rub(income) + '</strong><span class="stat-sub">в месяц</span></div>' +
        '<div class="stat"><span class="stat-k">Распределено</span><strong>' + rub(income - left) + '</strong><span class="stat-sub">нужное, желания и накопления</span></div>' +
        '<div class="stat' + (left < 0 ? " warn" : left > 0 ? " win" : "") + '"><span class="stat-k">Остаток</span><strong>' + rub(left) + '</strong><span class="stat-sub">' +
        (left < 0 ? "тратите больше, чем получаете" : left > 0 ? "можно добавить в накопления" : "всё распределено") + "</span></div></div>" +
        '<div class="card"><h2 class="card-title">Сравнение с правилом 50/30/20</h2><div class="budget-rows">' + rows + "</div>" +
        '<p class="hint">Полоска показывает, какую долю дохода вы тратите, а вертикальная черта — сколько советует правило.</p></div>' +
        '<div class="card result-card"><p class="plan-k">Цель «' + esc(g.name) + "» на вкладе</p>" +
        '<div class="plan-row"><div><span>откладываете ' + rub(spent.savings) + "</span><strong>" + monthsText(nowM) + "</strong></div>" +
        "<div><span>по правилу 20" + NB + "%: " + rub(parts[2].rec) + '</span><strong class="accent">' + monthsText(ruleM) + "</strong></div></div>" +
        '<p class="hint">Цель, ставка вклада и инфляция взяты со страницы «Накопления».</p></div>';
    },
  };

  /* ---------- 6. Инфляция ---------- */
  PAGES.inflation = {
    form: function () {
      var v = S.inflation;
      return numField("inf", "price", "Цена сейчас", v.price, "₽", true) +
        numField("inf", "inflation", "Инфляция", v.inflation, "% год.") +
        numField("inf", "years", "Лет", v.years, "лет") +
        '<p class="hint">Инфляцию за прошлые годы публикует Росстат, а цель Банка России — около 4' + NB + "% в год.</p>";
    },
    read: function (f, e) {
      var v = S.inflation;
      v.price = parseNum(val(f, "price"), 60000, 0, 1e8, false, e, "Цена сейчас");
      v.inflation = parseNum(val(f, "inflation"), 4, 0, 100, false, e, "Инфляция");
      v.years = parseNum(val(f, "years"), 10, 1, 30, true, e, "Лет");
    },
    results: function (errs) {
      var v = S.inflation, ys = F.inflationYears(v.price, v.inflation, v.years), last = ys[ys.length - 1];
      var top = Math.max.apply(null, [1].concat(ys.map(function (y) { return y.price; })));
      var lost = ys[0].price ? (1 - last.value / ys[0].price) * 100 : 0;
      var step = ys.length <= 12 ? 1 : 5;
      var cols = ys.map(function (y, i) {
        var h = pct(y.price / top * 100), isLast = i === ys.length - 1;
        return '<div class="col" style="--h:' + h + '" title="Через ' + y.year + " " + plural(y.year, "год", "года", "лет") + ": " + rub(y.price) + '">' +
          (i === 0 || isLast ? '<span class="col-val">' + rub(y.price) + "</span>" : "") +
          '<span class="col-fill' + (isLast ? " last" : "") + '" style="height:' + h + '"></span></div>';
      }).join("");
      var labels = ys.map(function (y, i) {
        return "<span>" + (y.year % step === 0 || i === ys.length - 1 ? (y.year === 0 ? "сейчас" : y.year) : "") + "</span>";
      }).join("");
      var table = ys.map(function (y) {
        return "<tr><td>" + (y.year === 0 ? "сейчас" : y.year + " " + plural(y.year, "год", "года", "лет")) + "</td><td>" + rub(y.price) + "</td><td>" + rub(y.value) + "</td></tr>";
      }).join("");
      return errorsBox(errs) +
        '<div class="stats three"><div class="stat warn"><span class="stat-k">Через ' + v.years + " " + plural(v.years, "год", "года", "лет") + " вещь будет стоить</span><strong>" + rub(last.price) + '</strong><span class="stat-sub">сейчас ' + rub(ys[0].price) + "</span></div>" +
        '<div class="stat"><span class="stat-k">Деньги в копилке потеряют</span><strong>' + num(lost) + NB + '%</strong><span class="stat-sub">' + rub(ys[0].price) + " будут стоить как " + rub(last.value) + " сейчас</span></div>" +
        '<div class="stat win"><span class="stat-k">Чтобы не терять</span><strong>от ' + num(F.rateToBeat(v.inflation), 1) + NB + '%</strong><span class="stat-sub">ставка вклада с ежемесячными процентами</span></div></div>' +
        '<div class="card"><h2 class="card-title">Цена по годам</h2><div class="cols" role="img" aria-label="Цена растёт с ' + rub(ys[0].price) + " до " + rub(last.price) + '">' + cols + "</div>" +
        '<div class="col-labels" aria-hidden="true">' + labels + '</div><p class="hint">Годы. Наведите на столбик, чтобы увидеть цену.</p></div>' +
        '<details class="months"><summary>Таблица по годам</summary><div class="table-wrap"><table><thead><tr><th>Через</th><th>Цена вещи</th><th>Сколько стоят отложенные деньги</th></tr></thead><tbody>' + table + "</tbody></table></div></details>";
    },
  };

  /* ---------- 7. Курсы: валюты ЦБ и криптовалюты в прямом эфире ---------- */
  function sparkSVG(arr) {   // маленький график цены за сутки
    if (!arr || arr.length < 2) return '<svg class="spark" viewBox="0 0 96 30" aria-hidden="true"></svg>';
    var lo = Math.min.apply(null, arr), hi = Math.max.apply(null, arr), span = hi - lo || 1;
    var d = arr.map(function (v, i) { return (i ? "L" : "M") + (i / (arr.length - 1) * 96).toFixed(1) + "," + (27 - (v - lo) / span * 24).toFixed(1); }).join(" ");
    return '<svg class="spark ' + (arr[arr.length - 1] >= arr[0] ? "up" : "down") + '" viewBox="0 0 96 30" aria-hidden="true"><path d="' + d + '"/></svg>';
  }
  function coinRows(st) {
    var usdRub = Live.usdRub();
    return '<div class="m-row head"><span>Монета</span><span>Цена, $</span><span class="px-rub">Цена, ₽</span><span>24 ч</span><span class="spark-cell">Сутки</span></div>' +
      Live.COINS.map(function (c) {
        var x = st.coins[c[0]];
        return '<div class="m-row"><span class="coin"><i' + (c[1].length > 3 ? ' class="sm"' : "") + ' style="--c:' + c[4] + '">' + c[1] + "</i><span><b>" + c[1] + "</b><small>" + c[2] + "</small></span></span>" +
          '<span class="px' + (x && x.dir > 0 ? " flash-up" : x && x.dir < 0 ? " flash-down" : "") + '">' + (x ? Live.usd(x.price) : '<span class="wait">…</span>') + "</span>" +
          '<span class="px-rub">' + (x && usdRub ? "≈" + NB + Live.rubles(x.price * usdRub) : "") + "</span>" +
          '<span class="ch ' + (x ? Live.cls(x.change) : "") + '">' + (x ? Live.change(x.change) : "") + "</span>" +
          '<span class="spark-cell">' + sparkSVG(st.spark[c[0]]) + "</span></div>";
      }).join("");
  }
  function fxRows(st) {
    return '<div class="m-row fx head"><span>Валюта</span><span>Курс ЦБ</span><span>За день</span></div>' +
      Live.FIAT.map(function (f) {
        var x = st.fiat && st.fiat[f[0]], d = x ? x.rate - x.prev : 0;
        return '<div class="m-row fx"><span class="coin"><i style="--c:#CFEFDF">' + f[0] + "</i><span><b>" + f[0] + "</b><small>" + f[1] + "</small></span></span>" +
          '<span class="px">' + (x ? Live.fmt(x.rate, x.rate < 1 ? 4 : 2) + NB + "₽" : '<span class="wait">…</span>') + "</span>" +
          '<span class="ch ' + (x ? Live.cls(d) : "") + '">' + (x ? Live.change(d / x.prev * 100) : "") + "</span></div>";
      }).join("");
  }
  function convHTML(st) {   // сумма в долларах, юанях и биткоинах
    var a = S.rates.amount, f = st.fiat, btc = st.coins.BTCUSDT, usdRub = Live.usdRub();
    function cell(label, value, sub, win) {
      return '<div class="stat' + (win ? " win" : "") + '"><span class="stat-k">' + label + "</span><strong>" + value + '</strong><span class="stat-sub">' + sub + "</span></div>";
    }
    return cell("В долларах", f ? "$" + Live.fmt(a / f.USD.rate, 0) : "…", f ? "курс ЦБ " + Live.fmt(f.USD.rate, 2) + NB + "₽" : "загружаем курс") +
      cell("В юанях", f ? "¥" + Live.fmt(a / f.CNY.rate, 0) : "…", f ? "курс ЦБ " + Live.fmt(f.CNY.rate, 2) + NB + "₽" : "загружаем курс") +
      cell("В биткоинах", btc && usdRub ? "₿" + Live.fmt(a / (btc.price * usdRub), 5) : "…", btc ? "по цене биржи прямо сейчас" : "загружаем цену", true);
  }
  function fxDate(st) {
    return st.fiatDate ? "на " + st.fiatDate.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "";
  }
  PAGES.rates = {
    form: function () {
      return numField("rates", "amount", "Сумма", S.rates.amount, "₽", true) +
        '<p class="hint">Сколько это в валюте и в криптовалюте. Сначала подставлена цена цели «' + esc(goalCtx().name) + "» со страницы «Накопления».</p>";
    },
    read: function (f, e) { S.rates.amount = parseNum(val(f, "amount"), 60000, 0, 1e9, false, e, "Сумма"); },
    results: function (errs) {
      var st = Live.state;
      return errorsBox(errs) +
        '<div class="stats three" id="conv">' + convHTML(st) + "</div>" +
        '<div class="card"><div class="card-head"><h2 class="card-title">Криптовалюты</h2><span id="live-status">' + Live.statusHTML() + "</span></div>" +
        '<div class="mkt" id="mkt-coins">' + coinRows(st) + "</div>" +
        '<p class="fine">Цены с биржи Binance приходят каждую секунду, пока страница открыта. Рубли — по курсу доллара ЦБ, поэтому со знаком «≈».</p></div>' +
        '<div class="card"><div class="card-head"><h2 class="card-title">Курсы валют Банка России</h2><span class="hint" id="fx-date">' + fxDate(st) + "</span></div>" +
        '<div class="mkt" id="mkt-fx">' + fxRows(st) + "</div>" +
        '<p class="fine">Официальный курс ЦБ на день. В банке и обменнике валюту продают дороже, а покупают дешевле.</p></div>' +
        '<div class="card"><p class="plan-k">Важно знать</p><p class="note">Цена криптовалюты может за сутки измениться на 5–10' + NB + "% и больше, поэтому копить на мечту в криптовалюте рискованно. " +
        "В России криптовалютой нельзя расплачиваться за товары и услуги (закон №" + NB + "259-ФЗ), а биржи работают только с совершеннолетними. " +
        "Для накоплений надёжнее рубли на вкладе — посчитайте на странице «Вклады».</p>" +
        '<p class="fine">Данные: Банк России (через cbr-xml-daily.ru), биржа Binance, CoinGecko. Не является инвестиционной рекомендацией.</p></div>';
    },
    live: function (st) {   // обновляем только числа, форму не трогаем
      var ids = { conv: convHTML, "mkt-coins": coinRows, "mkt-fx": fxRows, "fx-date": fxDate, "live-status": function () { return Live.statusHTML(); } };
      Object.keys(ids).forEach(function (id) { var el = document.getElementById(id); if (el) el.innerHTML = ids[id](st); });
    },
  };

  /* ---------- 8. Мои цели: несколько целей и прогресс накопления ---------- */
  var GOAL_COLORS = ["#5EEAA8", "#F4CF72", "#6BC1FF", "#FFB067", "#C48CFF", "#7DE3D6"];
  function confetti() {   // праздник, когда цель достигнута
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var box = document.createElement("div"), colors = ["#5EEAA8", "#F4CF72", "#FFFFFF", "#6BC1FF", "#FFB067"];
    box.className = "confetti";
    for (var i = 0; i < 70; i++) {
      var p = document.createElement("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--dx", (Math.random() * 200 - 100) + "px");
      p.style.setProperty("--rot", (Math.random() * 900 - 450) + "deg");
      p.style.setProperty("--t", (1.6 + Math.random() * 1.4) + "s");
      p.style.animationDelay = Math.random() * .4 + "s";
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3600);
  }
  PAGES.goals = {
    form: function () {
      var d = S.goals.draft;
      return '<p class="form-group">Новая цель</p>' +
        textField("goals", "name", "Название", d.name, true) +
        numField("goals", "price", "Цена", d.price, "₽") +
        numField("goals", "saved", "Уже есть", d.saved, "₽") +
        numField("goals", "monthly", "Откладываю в месяц", d.monthly, "₽", true) +
        '<button class="btn primary wide" type="submit">Добавить цель</button>' +
        '<p class="hint">Цели хранятся только в этом браузере. Срок считается с учётом процентов вклада и инфляции со страницы «Накопления».</p>';
    },
    read: function (f) {
      S.goals.draft = { name: val(f, "name").slice(0, 40), price: val(f, "price"), saved: val(f, "saved"), monthly: val(f, "monthly") };
    },
    onSubmit: function (f, errs) {
      var d = S.goals.draft;
      if (!d.name.trim()) { errs.push("Введите название цели"); return; }
      var price = parseNum(d.price, 0, 0, 1e8, false, errs, "Цена");
      if (!price) { errs.push("«Цена»: введите цену больше нуля"); return; }
      if (S.goals.list.length >= 12) { errs.push("Можно добавить до 12 целей"); return; }
      S.goals.list.push({ name: d.name.trim(), price: price, saved: parseNum(d.saved, 0, 0, 1e8, false, errs, "Уже есть"),
        monthly: parseNum(d.monthly, 0, 0, 1e7, false, errs, "Откладываю в месяц") });
      S.goals.draft = { name: "", price: "", saved: "", monthly: "" };
      return true;   // форму нужно очистить
    },
    results: function (errs) {
      var g = S.goal, list = S.goals.list;
      var total = list.reduce(function (s, x) { return s + Math.min(x.saved, x.price); }, 0);
      var soon = null;
      var rows = list.map(function (x, i) {
        var p = x.price ? Math.min(100, x.saved / x.price * 100) : 0, done = x.saved >= x.price;
        var m = done ? 0 : F.simulate(x.price, x.saved, x.monthly, g.rate, g.inflation).dm;
        if (!done && m !== null && (soon === null || m < soon.m)) soon = { m: m, name: x.name };
        var when = done ? '<span class="done-chip">цель достигнута</span>' : m === null ? "взноса не хватает" : "через <b>" + m + NB + "мес.</b> · " + monthLabel(m);
        return '<div class="g-row' + (done ? " done" : "") + '"><p class="g-name"><i style="--c:' + GOAL_COLORS[i % GOAL_COLORS.length] + '">' + esc(x.name.charAt(0).toUpperCase()) +
          "</i><span>" + esc(x.name) + '</span></p><span class="g-pct">' + num(p) + NB + "%</span>" +
          '<div class="g-bar" role="progressbar" aria-valuenow="' + Math.round(p) + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + esc(x.name) + '"><span style="width:' + p.toFixed(1) + '%"></span></div>' +
          '<p class="g-meta"><span>накоплено <b>' + rub(F.toKop(x.saved)) + "</b> из " + rub(F.toKop(x.price)) + "</span><span>" + (done ? "" : "осталось <b>" + rub(F.toKop(x.price - x.saved)) + "</b>") + "</span><span>" + when + "</span></p>" +
          '<div class="g-act"><span class="input"><label class="sr" for="add' + i + '">Сколько внести в «' + esc(x.name) + '»</label><input id="add' + i + '" type="text" inputmode="decimal" placeholder="Сумма" autocomplete="off"><span class="unit">₽</span></span>' +
          '<button type="button" class="btn primary" data-act="add" data-i="' + i + '">Внести</button>' +
          '<button type="button" class="btn" data-act="plan" data-i="' + i + '">Подробный расчёт</button>' +
          '<button type="button" class="btn ghost" data-act="del" data-i="' + i + '" aria-label="Удалить цель «' + esc(x.name) + '»">Удалить</button></div></div>';
      }).join("");
      return errorsBox(errs) +
        '<div class="stats three"><div class="stat"><span class="stat-k">Целей</span><strong>' + list.length + '</strong><span class="stat-sub">' + list.filter(function (x) { return x.saved >= x.price; }).length + " достигнуто</span></div>" +
        '<div class="stat"><span class="stat-k">Накоплено всего</span><strong>' + rub(F.toKop(total)) + '</strong><span class="stat-sub">на все цели</span></div>' +
        '<div class="stat win"><span class="stat-k">Ближайшая цель</span><strong>' + (soon ? soon.m + NB + "мес." : "—") + '</strong><span class="stat-sub">' + (soon ? esc(soon.name) : "добавьте цель") + "</span></div></div>" +
        (list.length ? '<div class="card"><h2 class="card-title">Мои цели</h2><div class="goals">' + rows + "</div></div>"
          : '<div class="card"><p class="verdict">Пока нет целей. Добавьте первую в форме слева.</p></div>');
    },
    onClick: function (ev, rerender) {
      var b = ev.target.closest && ev.target.closest("[data-act]");
      if (!b) return;
      var i = +b.getAttribute("data-i"), x = S.goals.list[i];
      if (!x) return;
      var act = b.getAttribute("data-act");
      if (act === "del") { S.goals.list.splice(i, 1); }
      else if (act === "plan") {   // перенести цель на страницу «Накопления»
        Object.assign(S.goal, { name: x.name, price: x.price, start: x.saved, monthly: x.monthly });
        save(); location.href = "index.html"; return;
      } else if (act === "add") {
        var inp = document.getElementById("add" + i), e = [];
        var v = parseNum(inp ? inp.value : "", 0, 0, 1e8, false, e, "Сумма");
        if (!v) { if (inp) inp.focus(); return; }
        var was = x.saved >= x.price;
        x.saved = Math.round((x.saved + v) * 100) / 100;
        if (!was && x.saved >= x.price) setTimeout(confetti, 50);
      }
      save(); rerender();
    },
  };

  /* ---------- 9. Викторина по финансовой грамотности ---------- */
  var QUIZ = [
    ["Что такое капитализация вклада?", ["Проценты прибавляются к вкладу, и дальше начисляются и на них", "Плата банку за хранение денег", "Запрет снимать деньги до конца срока", "Ставка, которая растёт каждый месяц"], 0,
      "Это «проценты на проценты». Поэтому вклад с капитализацией растёт быстрее, чем с выплатой процентов в конце срока."],
    ["Ноутбук стоит 60 000 ₽, инфляция — 4 % в год. Сколько он будет стоить примерно через год?", ["60 000 ₽", "62 400 ₽", "64 000 ₽", "84 000 ₽"], 1,
      "60 000 × 1,04 = 62 400 ₽. Пока копите, цель тоже дорожает — SDM учитывает это в расчётах."],
    ["Звонят «из службы безопасности банка» и просят назвать код из СМС. Что делать?", ["Назвать код, чтобы спасти деньги", "Положить трубку и позвонить в банк по номеру с карты", "Перевести деньги на «безопасный счёт»", "Назвать только половину кода"], 1,
      "Настоящие сотрудники банка никогда не спрашивают коды из СМС и не просят переводить деньги. Это мошенники."],
    ["Что показывает ПСК в кредитном договоре?", ["Только процентную ставку", "Полную стоимость кредита со всеми обязательными платежами", "Сумму штрафов за просрочку", "Срок кредита"], 1,
      "ПСК — полная стоимость кредита в процентах годовых. Её печатают в рамке на первой странице договора — по ней удобно сравнивать банки."],
    ["По правилу 50/30/20 какую долю дохода советуют откладывать?", ["50 %", "30 %", "20 %", "5 %"], 2,
      "50 % — на нужное, 30 % — на желания, 20 % — на накопления. Проверьте свой бюджет на вкладке «Бюджет»."],
    ["Ставка 10 % годовых. Какой вклад на год принесёт больше?", ["С выплатой процентов в конце срока", "С ежемесячной капитализацией", "Одинаково", "Зависит от суммы"], 1,
      "С капитализацией эффективная ставка — около 10,47 %, а без неё — ровно 10 %."],
    ["С какого возраста можно самостоятельно открыть вклад и распоряжаться им?", ["С 10 лет", "С 14 лет", "С 16 лет", "Только с 18 лет"], 1,
      "По статье 26 Гражданского кодекса с 14 лет можно самостоятельно вносить вклады и распоряжаться своими доходами."],
    ["Что такое аннуитетный платёж по кредиту?", ["Платёж, который уменьшается каждый месяц", "Одинаковый платёж каждый месяц", "Платёж только процентов", "Весь долг одним платежом в конце"], 1,
      "Аннуитет — одинаковая сумма каждый месяц. Именно так считает вкладка «Кредит»."],
    ["Курс доллара — 80 ₽. Сколько долларов можно купить на 8 000 ₽ по этому курсу?", ["10", "100", "1 000", "640"], 1,
      "8 000 / 80 = 100. В обменнике выйдет чуть меньше: валюту там продают дороже курса ЦБ."],
    ["Что лучше всего защищает накопления от инфляции?", ["Копилка дома", "Вклад со ставкой выше инфляции", "Карта без процентов на остаток", "Хранить деньги наличными в кошельке"], 1,
      "Если ставка вклада выше инфляции, деньги не теряют ценность. Нужную ставку показывает вкладка «Инфляция»."],
    ["Почему копить на мечту в криптовалюте рискованно?", ["Её цена может сильно измениться за сутки", "Её нельзя купить в интернете", "Она всегда только дешевеет", "Её запрещено хранить"], 0,
      "Цена может вырасти или упасть на 5–10 % за день. Посмотрите изменения на вкладке «Курсы»."],
    ["Каждый день вы покупаете перекус за 100 ₽. Сколько это примерно за год?", ["3 650 ₽", "12 000 ₽", "36 500 ₽", "100 000 ₽"], 2,
      "100 × 365 = 36 500 ₽. Мелкие траты складываются в большие суммы — проверьте на вкладке «Мелкие траты»."],
  ];
  var LEVELS = [[0, "Новичок", "Почитайте подсказки — и попробуйте ещё раз!"], [5, "Уверенный", "Хорошая база, осталось немного."],
                [9, "Финансист", "Отличный результат!"], [12, "Гуру финансов", "Все ответы верные — вы готовы к своей мечте!"]];
  function quizLevel(score) { var l = LEVELS[0]; LEVELS.forEach(function (x) { if (score >= x[0]) l = x; }); return l; }
  function quizScore() { return S.quiz.answers.filter(function (a, i) { return a === QUIZ[i][2]; }).length; }
  PAGES.quiz = {
    form: function () {
      var q = S.quiz, bars = QUIZ.map(function (x, i) {
        var a = q.answers[i];
        return "<i class=\"" + (a === undefined ? (i === q.i ? "now" : "") : a === x[2] ? "ok" : "no") + "\"></i>";
      }).join("");
      return '<p class="form-group">Прогресс</p><div class="q-progress" aria-hidden="true">' + bars + "</div>" +
        '<div class="field wide"><span class="label">Верных ответов</span><strong style="font-size:1.6rem;font-variant-numeric:tabular-nums">' + quizScore() + " из " + QUIZ.length + "</strong></div>" +
        '<div class="field wide"><span class="label">Лучший результат</span><strong style="font-size:1.1rem">' + q.best + " из " + QUIZ.length + "</strong></div>" +
        '<button class="btn wide" type="button" data-quiz="restart">Начать заново</button>' +
        '<p class="hint">12 вопросов о вкладах, кредитах, инфляции и безопасности денег. Ответы проверяются сразу.</p>';
    },
    read: function () {},
    results: function () {
      var q = S.quiz;
      if (q.i >= QUIZ.length) {
        var sc = quizScore(), lv = quizLevel(sc);
        var review = QUIZ.map(function (x, i) {
          var ok = q.answers[i] === x[2];
          return '<li class="' + (ok ? "ok" : "no") + '"><span>' + (ok ? "✓" : "✗") + "</span><div>" + esc(x[0]) + '<br><small class="hint">Ответ: ' + esc(x[1][x[2]]) + "</small></div></li>";
        }).join("");
        return '<div class="stats"><div class="stat win"><span class="stat-k">Результат</span><strong>' + sc + " из " + QUIZ.length + '</strong><span class="stat-sub">' + lv[1] + "</span></div>" +
          '<div class="stat"><span class="stat-k">Лучший результат</span><strong>' + q.best + '</strong><span class="stat-sub">' + lv[2] + "</span></div></div>" +
          '<div class="card"><div class="card-head"><h2 class="card-title">Разбор ответов</h2><button class="btn primary" type="button" data-quiz="restart">Пройти ещё раз</button></div><ul class="q-review">' + review + "</ul></div>";
      }
      var x = QUIZ[q.i], a = q.answers[q.i], answered = a !== undefined;
      var opts = x[1].map(function (o, k) {
        var cls = answered ? (k === x[2] ? " right" : k === a ? " wrong" : "") : "";
        return '<button type="button" class="q-opt' + cls + '" data-opt="' + k + '"' + (answered ? " disabled" : "") + "><b>" + "АБВГ"[k] + "</b>" + esc(o) + "</button>";
      }).join("");
      return '<div class="card" aria-live="polite"><p class="q-num">Вопрос ' + (q.i + 1) + " из " + QUIZ.length + '</p><h2 class="q-text">' + esc(x[0]) + '</h2><div class="q-opts">' + opts + "</div>" +
        (answered ? '<div class="q-expl"><strong class="' + (a === x[2] ? "accent" : "") + '"' + (a === x[2] ? "" : ' style="color:var(--bad)"') + ">" + (a === x[2] ? "Верно!" : "Не совсем.") + "</strong>" + esc(x[3]) + "</div>" +
          '<button class="btn primary q-next" type="button" data-quiz="next">' + (q.i + 1 < QUIZ.length ? "Следующий вопрос" : "Узнать результат") + "</button>" : "") + "</div>";
    },
    onClick: function (ev, rerender) {
      var q = S.quiz, t = ev.target.closest && ev.target.closest("[data-opt],[data-quiz]");
      if (!t) return;
      if (t.hasAttribute("data-opt")) {
        if (q.answers[q.i] !== undefined) return;
        q.answers[q.i] = +t.getAttribute("data-opt");
      } else if (t.getAttribute("data-quiz") === "next") {
        q.i++;
        if (q.i >= QUIZ.length) { var sc = quizScore(); if (sc > q.best) q.best = sc; if (sc >= 9) setTimeout(confetti, 100); }
      } else if (t.getAttribute("data-quiz") === "restart") {
        q.i = 0; q.answers = [];
      }
      save(); rerender(true);
      var next = document.querySelector(".q-next, .q-opt:not([disabled])");
      if (next && t.getAttribute("data-quiz")) next.focus({ preventScroll: true });
    },
  };

  /* ================================================================ ЗАПУСК СТРАНИЦЫ */
  // Плавный уход со страницы для браузеров без View Transitions (там анимацию делает CSS)
  if (!("onpagereveal" in window)) {
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest && ev.target.closest(".nav a, .brand");
      if (!a || ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || a.getAttribute("aria-current")) return;
      ev.preventDefault();
      document.body.classList.add("leaving");
      setTimeout(function () { location.href = a.href; }, 170);
    });
    window.addEventListener("pageshow", function () { document.body.classList.remove("leaving"); });
  }

  var key = document.body.getAttribute("data-page");
  var page = PAGES[key];
  var form = document.getElementById("form"), box = document.getElementById("results"), tip = document.getElementById("tip");
  if (typeof Live !== "undefined") Live.start({ spark: key === "rates" });   // курсы в строке вверху
  if (!page || !form || !box) return;
  if (S.rates.amount === null) S.rates.amount = S.goal.price;
  if (page.live) Live.on(page.live);

  form.innerHTML = page.form();
  box.innerHTML = page.results([]);

  // «Сравнить» у вклада Сбера: переносим его название в третий вклад формы и ставим курсор в поле ставки
  box.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-fill]");
    if (!b || key !== "deposits") return;
    var o = SBER.deposits[+b.getAttribute("data-fill")], slot = S.deposits.offers.length - 1;
    S.deposits.offers[slot] = { name: o.name.replace(/[«»]/g, "").slice(0, 30), rate: S.deposits.offers[slot].rate, cap: S.deposits.offers[slot].cap };
    save();
    form.innerHTML = page.form();
    box.innerHTML = page.results([]);
    var fs = form.querySelectorAll(".offer")[slot], inp = document.getElementById("dep-rate" + slot);
    if (fs) fs.classList.add("filled");
    if (inp) { inp.focus(); inp.select(); inp.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });

  // пересчёт: читаем форму → сохраняем → рисуем результаты заново
  var timer = null;
  function recalc() {
    var errs = [];
    page.read(form, errs);
    save();
    box.innerHTML = page.results(errs);
    tip.hidden = true;
  }
  form.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(recalc, 200); });
  form.addEventListener("change", recalc);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!page.onSubmit) return recalc();
    var errs = [];
    page.read(form, errs);
    if (page.onSubmit(form, errs)) form.innerHTML = page.form();   // цель добавлена — очищаем форму
    save();
    box.innerHTML = page.results(errs);
  });
  // кнопки внутри результатов (мои цели, викторина) и в форме (викторина: «Начать заново»)
  function rerender(withForm) { if (withForm) form.innerHTML = page.form(); box.innerHTML = page.results([]); }
  if (page.onClick) {
    box.addEventListener("click", function (ev) { page.onClick(ev, rerender); });
    form.addEventListener("click", function (ev) { page.onClick(ev, rerender); });
    box.addEventListener("keydown", function (ev) {   // Enter в поле «Сумма» у цели = «Внести»
      if (ev.key !== "Enter" || !ev.target.id || ev.target.id.indexOf("add") !== 0) return;
      ev.preventDefault();
      var b = box.querySelector('[data-act="add"][data-i="' + ev.target.id.slice(3) + '"]');
      if (b) b.click();
    });
  }

  // подсказка при наведении на график
  function moveTip(ev) {
    var pad = 14, x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + tip.offsetWidth > innerWidth - 8) x = ev.clientX - tip.offsetWidth - pad;
    if (y + tip.offsetHeight > innerHeight - 8) y = ev.clientY - tip.offsetHeight - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  box.addEventListener("pointerover", function (ev) {
    var r = ev.target.closest && ev.target.closest("rect.hit");
    if (!r) return;
    tip.innerHTML = "<b>Месяц " + r.getAttribute("data-month") + "</b>" + [["deposit", "Вклад"], ["piggy", "Копилка"], ["price", "Цена цели"]].map(function (p) {
      return '<div><i class="key ' + p[0] + '"></i>' + p[1] + ": " + r.getAttribute("data-" + p[0]) + "</div>";
    }).join("");
    tip.hidden = false;
    moveTip(ev);
  });
  box.addEventListener("pointermove", function (ev) { if (!tip.hidden) moveTip(ev); });
  box.addEventListener("pointerout", function (ev) { if (ev.target.closest && ev.target.closest("rect.hit")) tip.hidden = true; });
})();
