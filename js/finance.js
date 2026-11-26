/* РАСЧЁТЫ — «мозг» сайта.
   Та же математика, что в finance.py версии на Python, только на JavaScript,
   чтобы всё считалось прямо в браузере, без сервера.

   ГЛАВНОЕ ПРАВИЛО: все деньги внутри хранятся в КОПЕЙКАХ, целыми числами.
   Компьютер хранит дробные числа неточно (0.1 + 0.2 = 0.30000000000000004),
   а целые копейки складываются без ошибок. */

var Finance = (function () {
  "use strict";

  var MAX_MONTHS = 600; // предел расчёта — 50 лет

  // Округление «как в банке»: 2,5 → 3. Сначала убираем мелкий «шум» дробных чисел.
  function rhu(x) { return Math.floor(Math.round(x * 1e6) / 1e6 + 0.5); }
  function toKop(rub) { return rhu(rub * 100); }

  // Цена через month месяцев, если цены растут на infl % в год: цена · (1 + инфляция)^(месяцы/12)
  function priceAt(priceKop, infl, month) { return rhu(priceKop * Math.pow(1 + infl / 100, month / 12)); }

  /* НАЛОГ С ПРОЦЕНТОВ ПО ВКЛАДАМ (НДФЛ, ст. 214.2 НК РФ).
     Без налога — проценты за год до 1 000 000 ₽ × максимальная ключевая ставка ЦБ за этот год
     (за 2025 год — 210 000 ₽, за 2026 год — 160 000 ₽). С превышения — 13 %,
     с части превышения больше 2,4 млн ₽ — 15 %. Банк налог не удерживает:
     налоговая присылает уведомление, заплатить нужно до 1 декабря следующего года.
     Налог есть только на вкладках «Вклады» и «Кредит»: там налог вычитается из вклада раз в 12 месяцев. */
  var TAX = { free: 16000000, step: 240000000, r1: 0.13, r2: 0.15 };   // суммы в копейках
  function setTaxFree(rub) { TAX.free = toKop(Math.max(0, rub)); }
  function interestTax(yearInterest) {     // налог с процентов за один год (копейки)
    var base = Math.max(0, yearInterest - TAX.free), low = Math.min(base, TAX.step);
    return rhu(low * TAX.r1 + (base - low) * TAX.r2);
  }

  /* ЛЬГОТНЫЙ ЗАЁМ ОТ РАБОТОДАТЕЛЯ (ст. 212 НК РФ). Если компания или ИП, где человек работает, даёт в долг
     под ставку ниже 2/3 ключевой ставки ЦБ, «экономия на процентах» считается доходом: НДФЛ 35 %.
     Экономия = остаток долга × (2/3 ключевой − ставка займа) за каждый месяц. Заём от родных и друзей
     и кредит в банке налогом не облагаются. */
  var KEY_RATE = 14;   // ключевая ставка Банка России, % годовых: с 24.07.2026, сохранена 23.10.2026
  function benefitTax(amount, months, rate) {
    var limit = KEY_RATE * 2 / 3, debt = toKop(amount), pay = annuity(amount, months, rate), base = 0;
    if (rate >= limit || debt <= 0) return { limit: limit, base: 0, tax: 0 };
    for (var m = 1; m <= months && debt > 0; m++) {
      base += debt * (limit - rate) / 1200;               // экономия за месяц
      debt -= Math.min(debt, pay - rhu(debt * rate / 1200)); // долг уменьшается на часть платежа без процентов
    }
    base = rhu(base);
    return { limit: limit, base: base, tax: rhu(base * 0.35) };
  }

  /* 1. НАКОПЛЕНИЯ. Главный алгоритм: проходим месяц за месяцем, как настоящий банк.
     Каждый месяц: банк начисляет проценты, человек кладёт взнос,
     цена цели растёт, и мы проверяем, хватает ли уже денег. */
  function simulate(price, start, monthly, rate, infl, withTax) {   // withTax — вычитать налог с процентов (только «Кредит»)
    var priceKop = toKop(price), pay = toKop(monthly), i = rate / 1200; // годовая ставка → за месяц
    var piggy = toKop(start), deposit = piggy, total = 0;
    var rows = [{ month: 0, piggy: piggy, interest: 0, deposit: deposit, price: priceKop, total: 0, tax: 0 }];
    var pm = piggy >= priceKop ? 0 : null, dm = deposit >= priceKop ? 0 : null;
    var yearInt = 0, tax = 0, maxYear = 0;     // проценты за текущий год, весь налог, самые большие проценты за год
    for (var m = 1; m <= MAX_MONTHS; m++) {
      var interest = rhu(deposit * i);         // 1) проценты банка за месяц, до копейки
      deposit += interest + pay;               // 2) вклад: проценты + взнос
      piggy += pay;                            //    копилка: только взнос
      total += interest;
      yearInt += interest;
      if (m % 12 === 0) {                      //    раз в год — налог с процентов сверх необлагаемой суммы
        var t = withTax ? interestTax(yearInt) : 0;
        deposit -= t; tax += t;
        maxYear = Math.max(maxYear, yearInt); yearInt = 0;
      }
      var cur = priceAt(priceKop, infl, m);    // 3) цена цели выросла
      rows.push({ month: m, piggy: piggy, interest: interest, deposit: deposit, price: cur, total: total, tax: tax });
      if (pm === null && piggy >= cur) pm = m; // 4) первый месяц, когда денег хватает
      if (dm === null && deposit >= cur) dm = m;
      if (pm !== null && dm !== null && m >= Math.max(pm, dm) + 2) break; // ещё пара месяцев для графика
    }
    return { rows: rows, pm: pm, dm: dm, tax: tax, maxYear: Math.max(maxYear, yearInt) };
  }

  // Обратная задача: сколько откладывать в месяц, чтобы успеть за months месяцев
  function neededMonthly(price, start, rate, infl, months) {
    var target = price * Math.pow(1 + infl / 100, months / 12), i = rate / 1200, dep;
    if (i === 0) dep = (target - start) / months;
    else { var g = Math.pow(1 + i, months); dep = (target - start * g) * i / (g - 1); }
    var pig = (target - start) / months;
    return [Math.ceil(Math.max(0, dep)) * 100, Math.ceil(Math.max(0, pig)) * 100];
  }

  /* 2. КРЕДИТ. Аннуитетный платёж — одинаковый каждый месяц:
     A = S · i / (1 − (1 + i)^−n) */
  function annuity(amount, months, rate) {
    var i = rate / 1200;
    return toKop(i === 0 ? amount / months : amount * i / (1 - Math.pow(1 + i, -months)));
  }
  function credit(amount, months, rate, extra) {
    var payment = annuity(amount, months, rate);
    var total = payment * months + toKop(extra);       // extra — страховки и комиссии
    var overpay = total - toKop(amount);
    return { payment: payment, total: total, overpay: overpay, percent: amount > 0 ? overpay / toKop(amount) * 100 : 0 };
  }

  /* 3. МЕЛКИЕ ТРАТЫ. Сколько раз период встречается в месяце: 52 недели и 365 дней делим на 12 */
  var PERIODS = { day: ["в день", 365 / 12], week: ["в неделю", 52 / 12], month: ["в месяц", 1] };
  function expenseMonthly(price, times, period) {
    return rhu(price * times * (PERIODS[period] || PERIODS.month)[1] * 100);
  }

  /* 4. ВКЛАДЫ. «каждый месяц» — сложный процент (проценты на проценты),
     «в конце срока» — простой процент только на первоначальную сумму. */
  function depositOffer(amount, months, rate, cap) {
    var start = toKop(amount), final, tax = 0;
    if (cap === "monthly") {
      final = start;
      var yearInt = 0;
      for (var k = 1; k <= months; k++) {
        var it = rhu(final * rate / 1200);
        final += it; yearInt += it;
        if (k % 12 === 0 || k === months) { tax += interestTax(yearInt); yearInt = 0; }   // налог за каждый год
      }
    } else {
      final = start + rhu(start * rate / 100 * months / 12);
      tax = interestTax(final - start);      // проценты в конце срока приходят в одном году
    }
    // эффективная ставка: сколько % вклад на самом деле приносит за год
    var eff = start > 0 && months > 0 ? (Math.pow(final / start, 12 / months) - 1) * 100 : 0;
    return { final: final, income: final - start, eff: eff, tax: tax, net: final - start - tax };
  }

  /* 5. БЮДЖЕТ. Правило 50/30/20: нужное, желания, накопления */
  var BUDGET_RULE = [["needs", "Нужное", 50], ["wants", "Желания", 30], ["savings", "Накопления", 20]];

  /* 6. ИНФЛЯЦИЯ. Рост цены и обесценивание отложенных денег по годам */
  function inflationYears(price, infl, years) {
    var start = toKop(price), out = [];
    for (var y = 0; y <= years; y++) {
      var k = Math.pow(1 + infl / 100, y);
      out.push({ year: y, price: rhu(start * k), value: rhu(start / k) });
    }
    return out;
  }
  // Ставка вклада с ежемесячной капитализацией, при которой деньги не теряют ценность
  function rateToBeat(infl) { return (Math.pow(1 + infl / 100, 1 / 12) - 1) * 1200; }

  return {
    rhu: rhu, toKop: toKop, priceAt: priceAt, simulate: simulate, neededMonthly: neededMonthly,
    annuity: annuity, credit: credit, PERIODS: PERIODS, expenseMonthly: expenseMonthly,
    depositOffer: depositOffer, BUDGET_RULE: BUDGET_RULE, inflationYears: inflationYears, rateToBeat: rateToBeat,
    TAX: TAX, setTaxFree: setTaxFree, interestTax: interestTax,
    KEY_RATE: KEY_RATE, benefitTax: benefitTax,
  };
})();
