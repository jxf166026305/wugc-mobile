/* =====================================================================
 * 放量涨停研究（移植自 网页评分.ps1 4132–5470）
 * 数据：东财 push2ex 涨停/炸板/跌停/昨日涨停/涨跌分布池 + 腾讯实时行情 + 东财日K
 * 说明：只做机械统计，不构成投资建议
 * ===================================================================== */
(function (root) {
  'use strict';

  var UT = '7eea3edcaed734bea9cbfc24409ed989';
  var cache = { date: '', t: 0, data: null };
  var detailCache = {};

  function num(v) {
    if (v === null || v === undefined || v === '' || v === '-') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // PowerShell [math]::Round 是银行家舍入
  function banker(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return null;
    var f = Math.pow(10, d || 0);
    var s = x * f;
    var fl = Math.floor(s);
    var diff = s - fl;
    var r;
    if (Math.abs(diff - 0.5) < 1e-9) r = (fl % 2 === 0) ? fl : fl + 1;
    else r = Math.round(s);
    return r / f;
  }
  function R1(x) { return x === null || x === undefined || !isFinite(x) ? null : banker(x, 1); }
  function R2(x) { return x === null || x === undefined || !isFinite(x) ? null : banker(x, 2); }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function limitPctFor(code, name) {
    if (/ST/i.test(String(name || ''))) return 5.0;
    if (/^(30|68)/.test(String(code))) return 20.0;
    if (/^(4|8|92)/.test(String(code))) return 30.0;
    return 10.0;
  }

  function sealTime(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (s === '' || s === '0') return '';
    while (s.length < 6) s = '0' + s;
    if (s.length < 6) return s;
    return s.slice(0, 2) + ':' + s.slice(2, 4) + ':' + s.slice(4, 6);
  }

  function sealMinutes(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (s === '' || s === '0') return null;
    while (s.length < 6) s = '0' + s;
    if (s.length < 6) return null;
    var h = Number(s.slice(0, 2)), m = Number(s.slice(2, 4)), sec = Number(s.slice(4, 6));
    if (!isFinite(h) || !isFinite(m) || !isFinite(sec)) return null;
    return h * 60 + m + sec / 60 - (9 * 60 + 30);
  }

  async function emPool(endpoint, date, sort) {
    var url = 'https://push2ex.eastmoney.com/' + endpoint +
      '?ut=' + UT + '&dpt=wz.ztzt&Pageindex=0&pagesize=1000';
    if (sort) url += '&sort=' + sort;
    url += '&date=' + date;
    try {
      var r = await fetch(url, { referrerPolicy: 'no-referrer', cache: 'no-store' });
      var j = await r.json();
      return j.data || null;
    } catch (e) { return null; }
  }

  function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }

  async function tradeDate() {
    for (var back = 0; back <= 12; back++) {
      var d = new Date();
      d.setDate(d.getDate() - back);
      if (isWeekend(d)) continue;
      var ds = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
      var zt = await emPool('getTopicZTPool', ds, 'fbt:asc');
      if (zt && zt.pool && zt.pool.length > 0) return { date: ds, zt: zt, isToday: back === 0 };
    }
    return null;
  }

  function breadth(fenbu) {
    var up = 0, down = 0, flat = 0;
    (fenbu || []).forEach(function (b) {
      if (!b) return;
      Object.keys(b).forEach(function (k) {
        var key = Number(k), v = Number(b[k]);
        if (!isFinite(key) || !isFinite(v)) return;
        if (key > 0) up += v; else if (key < 0) down += v; else flat += v;
      });
    });
    var total = up + down + flat;
    return { up: up, down: down, flat: flat, upRate: total > 0 ? R1(100 * up / total) : null };
  }

  // 昨日涨停股今日表现
  function yesterdayStats(pool) {
    var n = 0, sum = 0, up = 0, big = 0, lim = 0;
    (pool || []).forEach(function (x) {
      var c = String(x.c || '');
      if (!/^\d{6}$/.test(c)) return;
      var p = Number(x.zdp);
      if (!isFinite(p)) return;
      n++; sum += p;
      if (p > 0) up++;
      if (p >= 5.0) big++;
      if (p >= limitPctFor(c, x.n) - 0.3) lim++;
    });
    return {
      count: n,
      avgPct: n > 0 ? R2(sum / n) : null,
      upRate: n > 0 ? R1(100 * up / n) : null,
      big5Rate: n > 0 ? R1(100 * big / n) : null,
      limitRate: n > 0 ? R1(100 * lim / n) : null,
      upCount: up, big5Count: big, limitCount: lim
    };
  }

  function quickScore(item, indCount, sent) {
    var seal = 10.0, sr = item.sealRatio;
    if (sr !== null) {
      if (sr >= 3.0) seal = 40.0;
      else if (sr >= 2.0) seal = 36.0;
      else if (sr >= 1.0) seal = 30.0;
      else if (sr >= 0.5) seal = 22.0;
      else if (sr >= 0.2) seal = 14.0;
      else seal = 6.0;
    }
    var fm = item.firstSealMin;
    if (fm !== null) {
      if (fm <= 5.0) seal += 4.0;
      else if (fm <= 60.0) seal += 2.0;
      else if (fm >= 270.0) seal -= 6.0;
      else if (fm >= 240.0) seal -= 3.0;
    }
    var oc = item.openCount || 0;
    if (oc > 0) seal -= Math.min(12.0, oc * 3.0);
    if (item.oneWord) seal += 3.0;
    seal = Math.max(0.0, Math.min(40.0, seal));

    var vol = 12.0, vr = item.volRatio;
    if (vr !== null) {
      if (vr >= 2.0 && vr < 5.0) vol = 30.0;
      else if (vr >= 5.0 && vr < 8.0) vol = 24.0;
      else if (vr >= 1.5 && vr < 2.0) vol = 18.0;
      else if (vr >= 8.0 && vr < 12.0) vol = 16.0;
      else if (vr >= 12.0) vol = 10.0;
      else vol = 8.0;
    }
    var turn = item.turnover === null ? 0 : item.turnover;
    if (turn >= 5.0 && turn <= 15.0) vol += 4.0;
    else if (turn > 15.0 && turn <= 25.0) vol += 1.0;
    else if (turn > 30.0) vol -= 6.0;
    else if (turn < 2.0) vol -= 4.0;
    vol = Math.max(0.0, Math.min(30.0, vol));

    var board = 12.0, st = item.streak || 1;
    if (st <= 1) board = 12.0;
    else if (st === 2) board = 18.0;
    else if (st === 3) board = 16.0;
    else if (st === 4) board = 11.0;
    else board = 6.0;
    if (indCount >= 5) board += 6.0;
    else if (indCount >= 3) board += 4.0;
    else if (indCount >= 2) board += 2.0;
    board = Math.max(0.0, Math.min(20.0, board));

    var sentScore = 5.0;
    if (sent) {
      if (sent.sealRate !== null && sent.sealRate !== undefined) {
        var srate = Number(sent.sealRate);
        if (srate >= 75.0) sentScore = 10.0;
        else if (srate >= 60.0) sentScore = 7.0;
        else if (srate >= 50.0) sentScore = 4.0;
        else sentScore = 1.0;
      }
      if (sent.yztAvg !== null && sent.yztAvg !== undefined) {
        var ya = Number(sent.yztAvg);
        if (ya < 0) sentScore -= 2.0;
        else if (ya >= 3.0) sentScore += 1.0;
      }
    }
    sentScore = Math.max(0.0, Math.min(10.0, sentScore));

    return {
      total: R1(seal + vol + board + sentScore),
      seal: R1(seal), volume: R1(vol), board: R1(board), sent: R1(sentScore)
    };
  }

  async function raw(force) {
    if (!force && cache.data && (Date.now() - cache.t) < 45000) return cache.data;
    var res = await tradeDate();
    if (!res) {
      return {
        ok: false, error: '没有获取到涨停池数据（可能是非交易日，或东方财富接口暂时不可用）。',
        asOf: todayStr(), date: '', items: []
      };
    }
    var date = res.date;
    var zb = await emPool('getTopicZBPool', date, 'fbt:asc');
    var dt = await emPool('getTopicDTPool', date, 'fund:asc');
    var yzt = await emPool('getYesterdayZTPool', date, 'zs:desc');
    var fb = await emPool('getTopicZDFenBu', date, '');

    var ztPool = (res.zt && res.zt.pool) ? res.zt.pool : [];
    var zbPool = (zb && zb.pool) ? zb.pool : [];
    var dtPool = (dt && dt.pool) ? dt.pool : [];
    var yztPool = (yzt && yzt.pool) ? yzt.pool : [];
    var fbPool = (fb && fb.fenbu) ? fb.fenbu : [];

    var indCounts = {}, maxStreak = 0, first = 0, second = 0, thirdPlus = 0;
    ztPool.forEach(function (x) {
      var ind = String(x.hybk || '');
      if (ind) indCounts[ind] = (indCounts[ind] || 0) + 1;
      var lb = Number(x.lbc);
      if (!isFinite(lb) || lb < 1) lb = 1;
      if (lb > maxStreak) maxStreak = lb;
      if (lb <= 1) first++; else if (lb === 2) second++; else thirdPlus++;
    });

    var ztCount = ztPool.length, zbCount = zbPool.length, dtCount = dtPool.length;
    var sealRate = null, brokenRate = null;
    if (ztCount + zbCount > 0) {
      sealRate = R1(100 * ztCount / (ztCount + zbCount));
      brokenRate = R1(100 * zbCount / (ztCount + zbCount));
    }
    var ys = yesterdayStats(yztPool);
    var br = breadth(fbPool);

    var sent = {
      ztCount: ztCount, zbCount: zbCount, dtCount: dtCount,
      sealRate: sealRate, brokenRate: brokenRate,
      maxStreak: maxStreak, firstCount: first, secondCount: second, thirdPlus: thirdPlus,
      yztCount: ys.count, yztAvg: ys.avgPct, yztUpRate: ys.upRate,
      yztBig5Rate: ys.big5Rate, yztLimitRate: ys.limitRate,
      yztLimitCount: ys.limitCount, yztBig5Count: ys.big5Count,
      upCount: br.up, downCount: br.down, flatCount: br.flat, breadthUpRate: br.upRate
    };

    var indList = Object.keys(indCounts).map(function (k) { return { name: k, count: indCounts[k] }; });
    indList.sort(function (a, b) { return b.count - a.count; });
    var indTop = indList.slice(0, 8);

    var codes = [];
    ztPool.forEach(function (x) { var c = String(x.c || ''); if (/^\d{6}$/.test(c) && codes.indexOf(c) < 0) codes.push(c); });
    var qmap = {};
    try {
      if (root.DataLayer && root.DataLayer.quotes && codes.length) {
        var qs = await root.DataLayer.quotes(codes);
        var arr = Array.isArray(qs) ? qs : (qs && qs.items ? qs.items : []);
        arr.forEach(function (q) { if (q && q.code) qmap[String(q.code)] = q; });
      }
    } catch (e) {}

    var items = [];
    ztPool.forEach(function (x) {
      var code = String(x.c || '');
      if (!/^\d{6}$/.test(code)) return;
      var q = qmap[code] || null;
      var name = String(x.n || code);
      var price = num(x.p) === null ? 0 : num(x.p) / 1000.0;
      var changePct = num(x.zdp) === null ? 0 : num(x.zdp);
      var amount = num(x.amount) === null ? 0 : num(x.amount);
      var turnover = num(x.hs) === null ? 0 : num(x.hs);
      var volRatio = null;
      var open = 0, low = 0;
      if (q) {
        if (num(q.price) > 0) price = num(q.price);
        if (num(q.changePct) !== null) changePct = num(q.changePct);
        if (num(q.amount) > 0) amount = num(q.amount) * 10000.0;
        if (num(q.turnover) > 0) turnover = num(q.turnover);
        if (num(q.volRatio) > 0) volRatio = num(q.volRatio);
        open = num(q.open) || 0;
        low = num(q.low) || 0;
      }
      var seal = num(x.fund) === null ? 0 : num(x.fund);
      var ltsz = num(x.ltsz) === null ? 0 : num(x.ltsz);
      var tshare = num(x.tshare) === null ? 0 : num(x.tshare);
      var sealRatio = ltsz > 0 ? 100.0 * seal / ltsz : null;
      var sealAmtRatio = amount > 0 ? 100.0 * seal / amount : null;
      var streak = 1;
      if (num(x.lbc) !== null && num(x.lbc) >= 1) streak = Math.floor(num(x.lbc));
      var openCount = num(x.zbc) === null ? 0 : Math.floor(num(x.zbc));
      var firstSeal = sealTime(x.fbt);
      var lastSeal = sealTime(x.lbt);
      var firstMin = sealMinutes(x.fbt);
      var oneWord = (open > 0 && low > 0 && Math.abs(open - price) <= 0.011 && Math.abs(low - price) <= 0.011);
      var tWord = (open > 0 && low > 0 && Math.abs(open - price) <= 0.011 && low < (price - 0.011));
      var ind = String(x.hybk || '');
      var indCount = ind ? (indCounts[ind] || 0) : 0;
      var days = 0, zttjCt = 0;
      if (x.zttj) { days = num(x.zttj.days) || 0; zttjCt = num(x.zttj.ct) || 0; }

      var tags = [];
      tags.push(streak <= 1 ? '首板' : (streak + '连板'));
      if (oneWord) tags.push('一字板');
      else if (tWord) tags.push('T字板');
      if (firstMin !== null && firstMin <= 1.0) tags.push('秒板');
      if (firstMin !== null && firstMin >= 270.0) tags.push('尾盘板');
      if (openCount > 0) tags.push('炸板' + openCount + '次');
      if (sealRatio !== null) {
        if (sealRatio >= 2.0) tags.push('封单强');
        else if (sealRatio < 0.3) tags.push('封单薄');
      }
      if (volRatio !== null) {
        if (volRatio >= 8.0) tags.push('巨量');
        else if (volRatio >= 2.0) tags.push('放量');
      }
      if (indCount >= 3) tags.push('板块效应');

      var item = {
        code: code, name: name,
        market: /^6|^9/.test(code) ? 'sh' : (/^(4|8|92)/.test(code) ? 'bj' : 'sz'),
        price: R2(price), changePct: R2(changePct), amount: R2(amount),
        floatCap: R2(ltsz), totalCap: R2(tshare), turnover: R2(turnover),
        volRatio: volRatio === null ? null : R2(volRatio),
        limitPct: R1(limitPctFor(code, name)),
        streak: streak, firstSeal: firstSeal, lastSeal: lastSeal,
        firstSealMin: firstMin === null ? null : R1(firstMin),
        openCount: openCount, sealAmount: R2(seal),
        sealRatio: sealRatio === null ? null : R2(sealRatio),
        sealAmtRatio: sealAmtRatio === null ? null : R2(sealAmtRatio),
        industry: ind, industryCount: indCount,
        ztDays: days, ztCount: zttjCt,
        oneWord: !!oneWord, tWord: !!tWord, tags: tags
      };
      var sc = quickScore(item, indCount, sent);
      item.score = sc.total;
      item.scoreParts = sc;
      items.push(item);
    });

    var dateLabel = date;
    try { dateLabel = date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8); } catch (e) {}

    var out = {
      ok: true, asOf: todayStr(), date: date, dateLabel: dateLabel, isToday: !!res.isToday,
      source: 'eastmoney+tencent', rawCount: items.length, quoteCount: Object.keys(qmap).length,
      sentiment: sent, industryTop: indTop, items: items
    };
    cache = { date: date, t: Date.now(), data: out };
    return out;
  }

  function filterList(o) {
    var minVolRatio = Number(o.get('minVolRatio')); if (!isFinite(minVolRatio)) minVolRatio = 2;
    var minTurnover = Number(o.get('minTurnover')); if (!isFinite(minTurnover)) minTurnover = 5;
    var minAmount = Number(o.get('minAmount')); if (!isFinite(minAmount)) minAmount = 1;
    var board = o.get('board') || 'all';
    var sealed = o.get('sealed') === '1';
    var sort = o.get('sort') || 'score';
    var force = o.get('refresh') === '1';
    return { minVolRatio: minVolRatio, minTurnover: minTurnover, minAmount: minAmount, board: board, sealed: sealed, sort: sort, force: force };
  }

  async function list(searchParams) {
    var f = filterList(searchParams);
    var r = await raw(f.force);
    if (!r.ok) return r;
    var items = r.items.slice();
    if (f.minVolRatio > 0) items = items.filter(function (x) { return x.volRatio !== null && x.volRatio >= f.minVolRatio; });
    if (f.minTurnover > 0) items = items.filter(function (x) { return x.turnover >= f.minTurnover; });
    if (f.minAmount > 0) items = items.filter(function (x) { return (x.amount / 100000000.0) >= f.minAmount; });
    if (f.board === 'first') items = items.filter(function (x) { return x.streak <= 1; });
    else if (f.board === 'multi') items = items.filter(function (x) { return x.streak >= 2; });
    if (f.sealed) items = items.filter(function (x) { return x.openCount === 0; });

    var key = f.sort;
    items.sort(function (a, b) {
      if (key === 'volRatio') return (b.volRatio === null ? -1 : b.volRatio) - (a.volRatio === null ? -1 : a.volRatio);
      if (key === 'sealRatio') return (b.sealRatio === null ? -1 : b.sealRatio) - (a.sealRatio === null ? -1 : a.sealRatio);
      if (key === 'amount') return b.amount - a.amount;
      if (key === 'firstSeal') return (a.firstSealMin === null ? 9999 : a.firstSealMin) - (b.firstSealMin === null ? 9999 : b.firstSealMin);
      if (key === 'streak') return b.streak - a.streak;
      return b.score - a.score;
    });

    return {
      ok: true, asOf: r.asOf, date: r.date, dateLabel: r.dateLabel, isToday: r.isToday,
      source: r.source, rawCount: r.rawCount, quoteCount: r.quoteCount, total: items.length,
      sentiment: r.sentiment, industryTop: r.industryTop,
      filters: { minVolRatio: f.minVolRatio, minTurnover: f.minTurnover, minAmount: f.minAmount, board: f.board, sealedOnly: f.sealed, sort: f.sort },
      items: items
    };
  }

  /* ---------------- 统计工具（对照 网页评分.ps1 4650–4743） ---------------- */
  async function getBars(code, limit) {
    if (!root.DataLayer || !root.DataLayer.kline) return [];
    try {
      var r = await root.DataLayer.kline(code, 'day', limit || 800);
      if (!r || !r.ok || !r.bars) return [];
      return r.bars;
    } catch (e) { return []; }
  }

  function wilson(success, total, z) {
    if (!total || total <= 0) return null;
    z = z || 1.96;
    var p = success / total, z2 = z * z;
    var den = 1 + z2 / total;
    var center = (p + z2 / (2 * total)) / den;
    var inner = p * (1 - p) / total + z2 / (4 * total * total);
    if (inner < 0) inner = 0;
    var margin = z * Math.sqrt(inner) / den;
    var lo = center - margin, hi = center + margin;
    if (lo < 0) lo = 0;
    if (hi > 1) hi = 1;
    return { low: R1(lo * 100), high: R1(hi * 100) };
  }

  function smoothedRate(success, total, basePct, prior, defBase) {
    var b = defBase;
    if (basePct !== null && basePct !== undefined) {
      var v = Number(basePct);
      b = isFinite(v) ? v : defBase;
    }
    if (b < 0) b = 0;
    if (b > 100) b = 100;
    return R1(((success + prior * b / 100.0) / (total + prior)) * 100.0);
  }

  function evStats(list) {
    var n = list.length, lim = 0, big = 0, up = 0, h5 = 0, l5 = 0;
    var so = 0, sh = 0, sl = 0, sc = 0, maxC = null, minC = null;
    list.forEach(function (e) {
      if (e.nextLimit) lim++;
      if (e.nextBig5) big++;
      if (e.nextUp) up++;
      if (e.nextHigh5) h5++;
      if (e.nextLow5) l5++;
      so += e.nextOpenPct; sh += e.nextHighPct; sl += e.nextLowPct; sc += e.nextClosePct;
      if (maxC === null || e.nextClosePct > maxC) maxC = e.nextClosePct;
      if (minC === null || e.nextClosePct < minC) minC = e.nextClosePct;
    });
    var ciL = n > 0 ? wilson(lim, n) : null;
    var ciB = n > 0 ? wilson(big, n) : null;
    return {
      n: n, limitCount: lim,
      limitRate: n > 0 ? R1(100.0 * lim / n) : null,
      limitCiLow: ciL ? ciL.low : null, limitCiHigh: ciL ? ciL.high : null,
      big5Count: big, big5Rate: n > 0 ? R1(100.0 * big / n) : null,
      big5CiLow: ciB ? ciB.low : null, big5CiHigh: ciB ? ciB.high : null,
      upCount: up, upRate: n > 0 ? R1(100.0 * up / n) : null,
      high5Count: h5, high5Rate: n > 0 ? R1(100.0 * h5 / n) : null,
      low5Count: l5, low5Rate: n > 0 ? R1(100.0 * l5 / n) : null,
      avgOpen: n > 0 ? R2(so / n) : null, avgHigh: n > 0 ? R2(sh / n) : null,
      avgLow: n > 0 ? R2(sl / n) : null, avgClose: n > 0 ? R2(sc / n) : null,
      maxClose: maxC === null ? null : R2(maxC), minClose: minC === null ? null : R2(minC)
    };
  }

  function probBlockOf(stats, baseLimit, baseBig5, baseUp) {
    if (!stats) return null;
    var out = {};
    ['n', 'limitCount', 'limitRate', 'limitCiLow', 'limitCiHigh', 'big5Count', 'big5Rate', 'big5CiLow', 'big5CiHigh',
      'upCount', 'upRate', 'high5Count', 'high5Rate', 'low5Count', 'low5Rate', 'avgOpen', 'avgHigh', 'avgLow', 'avgClose', 'maxClose', 'minClose'
    ].forEach(function (k) { out[k] = stats[k]; });
    out.smoothedLimit = smoothedRate(stats.limitCount, stats.n, baseLimit, 5.0, 25.0);
    out.smoothedBig5 = smoothedRate(stats.big5Count, stats.n, baseBig5, 5.0, 40.0);
    out.smoothedUp = smoothedRate(stats.upCount, stats.n, baseUp, 5.0, 50.0);
    var conf = '无样本';
    if (stats.n >= 20) conf = '较高';
    else if (stats.n >= 10) conf = '中等';
    else if (stats.n >= 5) conf = '偏低';
    else if (stats.n > 0) conf = '很低';
    out.confidence = conf;
    return out;
  }

  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ---------------- 历史样本（对照 4745–4923） ---------------- */
  function historyOf(code, name, minVol, bars) {
    var n = bars.length;
    var limitPct = limitPctFor(code, name);
    var tstr = todayLocal();
    var events = [], skippedToday = 0;

    if (n >= 8) {
      for (var i = 5; i < n - 1; i++) {
        var b = bars[i], pc = num(bars[i - 1].c);
        if (!(pc > 0)) continue;
        var c = num(b.c), h = num(b.h);
        if (!(c > 0) || !(h > 0)) continue;
        var pct = (c - pc) / pc * 100.0;
        if (pct < limitPct - 0.35) continue;
        if (((h - c) / c * 100.0) > 0.5) continue;
        var next = bars[i + 1];
        if (String(next.d) === tstr) { skippedToday++; continue; }
        var no = num(next.o), nh = num(next.h), nl = num(next.l), nc = num(next.c);
        if (!(no > 0) || !(nc > 0)) continue;

        var volSum = 0;
        for (var j = i - 5; j <= i - 1; j++) volSum += num(bars[j].v) || 0;
        var avgVol = volSum / 5.0;
        var vr = avgVol > 0 ? (num(b.v) || 0) / avgVol : null;

        var streak = 1, j2 = i - 1;
        while (j2 >= 1) {
          var ppc = num(bars[j2 - 1].c);
          if (!(ppc > 0)) break;
          var p2 = (num(bars[j2].c) - ppc) / ppc * 100.0;
          var h2 = num(bars[j2].h), c2 = num(bars[j2].c);
          if (p2 >= limitPct - 0.35 && c2 > 0 && ((h2 - c2) / c2 * 100.0) <= 0.5) { streak++; j2--; }
          else break;
        }

        var nextPct = (nc - c) / c * 100.0;
        events.push({
          date: String(b.d), close: R2(c), pct: R2(pct),
          volRatio: vr === null ? null : R2(vr), streak: streak,
          nextOpenPct: R2((no - c) / c * 100.0),
          nextHighPct: R2((nh - c) / c * 100.0),
          nextLowPct: R2((nl - c) / c * 100.0),
          nextClosePct: R2(nextPct),
          nextLimit: nextPct >= limitPct - 0.35,
          nextBig5: nextPct >= 5.0,
          nextHigh5: ((nh - c) / c * 100.0) >= 5.0,
          nextLow5: ((nl - c) / c * 100.0) <= -5.0,
          nextUp: nc > c
        });
      }
    }

    var all = events;
    var vol = all.filter(function (e) { return e.volRatio !== null && e.volRatio >= minVol; });
    var firstVol = vol.filter(function (e) { return e.streak <= 1; });
    var multiVol = vol.filter(function (e) { return e.streak >= 2; });

    function bucket(defs, subFn) {
      return defs.map(function (d) {
        var sub = all.filter(subFn(d));
        var st = evStats(sub);
        return { label: d.label, n: st.n, limitRate: st.limitRate, big5Rate: st.big5Rate, upRate: st.upRate, avgClose: st.avgClose };
      });
    }

    var volBuckets = bucket([
      { label: '<1.5', min: 0.0, max: 1.5 }, { label: '1.5~2', min: 1.5, max: 2.0 },
      { label: '2~3', min: 2.0, max: 3.0 }, { label: '3~5', min: 3.0, max: 5.0 },
      { label: '≥5', min: 5.0, max: 999.0 }
    ], function (d) {
      return function (e) { return e.volRatio !== null && e.volRatio >= d.min && e.volRatio < d.max; };
    });

    var streakBuckets = bucket([
      { label: '首板', min: 1, max: 1 }, { label: '2连板', min: 2, max: 2 }, { label: '3板及以上', min: 3, max: 99 }
    ], function (d) {
      return function (e) { return e.streak >= d.min && e.streak <= d.max; };
    });

    var scenarioBase = vol.length >= 4 ? vol : all;
    var openBuckets = [
      { label: '高开 ≥5%', min: 5.0, max: 999.0 }, { label: '高开 2%~5%', min: 2.0, max: 5.0 },
      { label: '平开 -2%~2%', min: -2.0, max: 2.0 }, { label: '低开 -5%~-2%', min: -5.0, max: -2.0 },
      { label: '低开 < -5%', min: -999.0, max: -5.0 }
    ].map(function (d) {
      var sub = scenarioBase.filter(function (e) { return e.nextOpenPct >= d.min && e.nextOpenPct < d.max; });
      var st = evStats(sub);
      return { label: d.label, n: st.n, limitRate: st.limitRate, big5Rate: st.big5Rate, upRate: st.upRate, avgClose: st.avgClose };
    });

    var recent = [];
    for (var k = all.length - 1; k >= 0 && recent.length < 6; k--) recent.push(all[k]);

    return {
      ok: true, code: code, name: name, limitPct: R1(limitPct), bars: n,
      firstDate: all.length ? String(all[0].date) : null,
      lastDate: all.length ? String(all[all.length - 1].date) : null,
      minVolRatio: minVol, eventCount: all.length, volCount: vol.length,
      firstVolCount: firstVol.length, multiVolCount: multiVol.length, skippedToday: skippedToday,
      allStats: evStats(all), volStats: evStats(vol),
      firstVolStats: evStats(firstVol), multiVolStats: evStats(multiVol),
      volBuckets: volBuckets, streakBuckets: streakBuckets, openBuckets: openBuckets, recent: recent,
      method: '样本来自该股近 3 年日 K（前复权）。涨停按代码所属板块识别；放量按「当日成交量 / 前 5 日均量 ≥ ' + minVol + '」识别；已剔除次日为今日的未完成 K 线。'
    };
  }

  /* ---------------- 技术位置（对照 4925–5027） ---------------- */
  function maAt(closes, n, period) {
    if (n < period) return null;
    var sum = 0;
    for (var i = n - period; i < n; i++) sum += closes[i];
    return sum / period;
  }

  function techOf(code, bars, priceIn) {
    var n = bars.length;
    if (n < 20) return { ok: false, bars: n, error: '日 K 数据不足 20 根，无法计算技术位置。' };
    var closes = bars.map(function (b) { return num(b.c) || 0; });
    var price = closes[n - 1];
    if (priceIn > 0) price = priceIn;
    var m5 = maAt(closes, n, 5), m10 = maAt(closes, n, 10), m20 = maAt(closes, n, 20), m60 = maAt(closes, n, 60);
    var maBull = (m5 !== null && m10 !== null && m20 !== null && m60 !== null &&
      m5 > m10 && m10 > m20 && m20 > m60);

    var gain20 = null;
    var c20 = n >= 21 ? num(bars[n - 21].c) : 0;
    if (n >= 21 && c20 > 0) gain20 = R2((price / c20 - 1.0) * 100.0);
    var gain60 = null;
    var c60 = n >= 61 ? num(bars[n - 61].c) : 0;
    if (n >= 61 && c60 > 0) gain60 = R2((price / c60 - 1.0) * 100.0);

    var hiStart = Math.max(0, n - 250), high250 = 0.0, low250 = Infinity;
    for (var i = hiStart; i < n; i++) {
      var hh = num(bars[i].h) || 0, ll = num(bars[i].l) || 0;
      if (hh > high250) high250 = hh;
      if (ll > 0 && ll < low250) low250 = ll;
    }
    if (low250 === Infinity) low250 = price;

    var priorStart = Math.max(0, n - 61), priorHigh60 = 0.0;
    for (var i2 = priorStart; i2 <= n - 2; i2++) {
      var hh2 = num(bars[i2].h) || 0;
      if (hh2 > priorHigh60) priorHigh60 = hh2;
    }
    var hi60Start = Math.max(0, n - 60), high60 = 0.0;
    for (var i3 = hi60Start; i3 < n; i3++) {
      var hh3 = num(bars[i3].h) || 0;
      if (hh3 > high60) high60 = hh3;
    }
    var newHigh60 = price >= high60 - 0.001;
    var newHigh250 = price >= high250 - 0.001;
    var breakout60 = priorHigh60 > 0 && price >= priorHigh60;

    var dayVolRatio = null;
    if (n >= 6) {
      var pv = 0.0;
      for (var j = n - 6; j <= n - 2; j++) pv += num(bars[j].v) || 0;
      if (pv > 0) dayVolRatio = R2((num(bars[n - 1].v) || 0) / (pv / 5.0));
    }
    var tv = num(bars[n - 1].turn);
    var turn = tv !== null && tv > 0 ? R2(tv) : null;

    var high250Dist = high250 > 0 ? R2((price / high250 - 1.0) * 100.0) : null;
    var rangePos = null;
    if (high250 - low250 > 0.001) rangePos = R1((price - low250) / (high250 - low250) * 100.0);

    return {
      ok: true, bars: n, price: R2(price),
      ma5: m5 === null ? null : R2(m5), ma10: m10 === null ? null : R2(m10),
      ma20: m20 === null ? null : R2(m20), ma60: m60 === null ? null : R2(m60),
      ma5Dist: (m5 !== null && m5 > 0) ? R2((price / m5 - 1.0) * 100.0) : null,
      ma10Dist: (m10 !== null && m10 > 0) ? R2((price / m10 - 1.0) * 100.0) : null,
      ma20Dist: (m20 !== null && m20 > 0) ? R2((price / m20 - 1.0) * 100.0) : null,
      ma60Dist: (m60 !== null && m60 > 0) ? R2((price / m60 - 1.0) * 100.0) : null,
      maBull: !!maBull, gain20: gain20, gain60: gain60,
      high250: R2(high250), low250: R2(low250), high250Dist: high250Dist,
      rangePos: rangePos, priorHigh60: R2(priorHigh60), high60: R2(high60),
      newHigh60: !!newHigh60, newHigh250: !!newHigh250, breakout60: !!breakout60,
      dayVolRatio: dayVolRatio, turnover: turn
    };
  }

  /* ---------------- 概率（对照 5029–5086） ---------------- */
  function probabilityOf(hist, sent, minVol) {
    var baseLimit = null, baseBig5 = null, baseUp = null, baseN = 0;
    if (sent) {
      if (sent.yztLimitRate !== undefined && sent.yztLimitRate !== null) baseLimit = sent.yztLimitRate;
      if (sent.yztBig5Rate !== undefined && sent.yztBig5Rate !== null) baseBig5 = sent.yztBig5Rate;
      if (sent.yztUpRate !== undefined && sent.yztUpRate !== null) baseUp = sent.yztUpRate;
      baseN = sent.yztCount || 0;
    }
    return {
      minVolRatio: minVol,
      baseline: {
        limitRate: baseLimit, big5Rate: baseBig5, upRate: baseUp, sample: baseN,
        note: '当前市场基准 = 昨日涨停股今日再涨停率 / 收盘≥5%率 / 收涨率'
      },
      vol: hist ? probBlockOf(hist.volStats, baseLimit, baseBig5, baseUp) : null,
      all: hist ? probBlockOf(hist.allStats, baseLimit, baseBig5, baseUp) : null,
      firstVol: hist ? probBlockOf(hist.firstVolStats, baseLimit, baseBig5, baseUp) : null,
      multiVol: hist ? probBlockOf(hist.multiVolStats, baseLimit, baseBig5, baseUp) : null,
      method: '历史频率 + 小样本平滑：平滑值 = (命中次数 + 5 × 市场基准) / (样本数 + 5)。样本少于 10 次时参考性有限，不构成预测。'
    };
  }

  /* ---------------- 风险（对照 5088–5207） ---------------- */
  function risksOf(item, tech, prob, sent) {
    var list = [];
    if (!item) return { items: list, highCount: 0, midCount: 0, lowCount: 0 };
    var name = String(item.name || ''), lp = item.limitPct;

    if (/ST/i.test(name)) list.push({ level: 'high', text: 'ST / *ST 股票，涨跌幅和流动性规则不同，波动与退市风险更高' });
    if (lp >= 29.0) list.push({ level: 'high', text: '北交所 30% 涨跌幅品种，单日波动和回撤风险显著高于主板' });

    var oc = item.openCount || 0;
    if (oc >= 3) list.push({ level: 'high', text: '盘中炸板 ' + oc + ' 次，封板反复被打开，筹码分歧较大' });
    else if (oc >= 1) list.push({ level: 'mid', text: '盘中炸板 ' + oc + ' 次，封板质量一般' });

    var sr = item.sealRatio;
    if (sr !== null) {
      if (sr < 0.2) list.push({ level: 'high', text: '封单额仅占流通市值 ' + R2(sr) + '%，封板很薄，次日容易被砸开' });
      else if (sr < 0.5) list.push({ level: 'mid', text: '封单额占流通市值 ' + R2(sr) + '%，封单偏薄' });
    }

    var fm = item.firstSealMin;
    if (fm !== null) {
      if (fm >= 270.0) list.push({ level: 'high', text: '首次封板在 ' + item.firstSeal + '，尾盘板，次日承接不确定性高' });
      else if (fm >= 180.0) list.push({ level: 'mid', text: '首次封板在 ' + item.firstSeal + '，下午才封板，主动性一般' });
    }

    var turn = item.turnover || 0;
    if (turn >= 30.0) list.push({ level: 'high', text: '换手率 ' + R2(turn) + '%，筹码交换过于剧烈，次日分歧大' });
    else if (turn >= 20.0) list.push({ level: 'mid', text: '换手率 ' + R2(turn) + '%，换手偏高' });

    var vr = item.volRatio;
    if (vr !== null) {
      if (vr >= 10.0) list.push({ level: 'high', text: '量比 ' + R2(vr) + '，成交异常放大，需警惕高位换手或出货' });
      else if (vr >= 8.0) list.push({ level: 'mid', text: '量比 ' + R2(vr) + '，放量幅度很大，次日波动可能加大' });
    }

    var st = item.streak || 0;
    if (st >= 5) list.push({ level: 'high', text: st + ' 连板，处于高位接力阶段，一旦断板回撤空间大' });
    else if (st >= 4) list.push({ level: 'mid', text: st + ' 连板，位置偏高，注意情绪退潮' });

    if (tech && tech.ok) {
      if (tech.gain20 !== null) {
        if (tech.gain20 >= 60.0) list.push({ level: 'high', text: '近 20 日涨幅 ' + R2(tech.gain20) + '%，短期涨幅过大' });
        else if (tech.gain20 >= 40.0) list.push({ level: 'mid', text: '近 20 日涨幅 ' + R2(tech.gain20) + '%，短线已有一定涨幅' });
      }
      if (tech.high250Dist !== null && tech.high250Dist <= -30.0) {
        list.push({ level: 'mid', text: '距 250 日高点仍有 ' + R2(tech.high250Dist) + '%，上方套牢盘较多' });
      }
    }

    var fc = item.floatCap || 0;
    if (fc > 0 && fc < 2000000000.0) list.push({ level: 'mid', text: '流通市值约 ' + R2(fc / 100000000.0) + ' 亿元，小盘股波动大' });
    else if (fc > 500000000000.0) list.push({ level: 'mid', text: '流通市值约 ' + R2(fc / 100000000.0) + ' 亿元，大市值连板难度较高' });

    var indN = item.industryCount || 0;
    if (indN <= 1) list.push({ level: 'mid', text: '所属行业当日仅此 1 家涨停，缺少板块合力' });

    if (sent) {
      if (sent.sealRate !== null && sent.sealRate !== undefined && sent.sealRate < 50.0) {
        list.push({ level: 'mid', text: '全市场封板率仅 ' + R1(sent.sealRate) + '%，短线情绪偏弱' });
      }
      if (sent.yztAvg !== null && sent.yztAvg !== undefined && sent.yztAvg < 0) {
        list.push({ level: 'mid', text: '昨日涨停股今日平均 ' + R2(sent.yztAvg) + '%，接力赚钱效应差' });
      }
    }

    if (prob && prob.vol) {
      if (prob.vol.n < 5) list.push({ level: 'low', text: '该股历史放量涨停样本仅 ' + prob.vol.n + ' 次，统计参考性有限' });
      if (prob.vol.smoothedLimit !== null && prob.vol.smoothedLimit !== undefined && prob.vol.smoothedLimit < 20.0) {
        list.push({ level: 'low', text: '该股放量涨停后的历史次日涨停参考值仅 ' + R1(prob.vol.smoothedLimit) + '%' });
      }
    }

    var high = 0, mid = 0, low = 0;
    list.forEach(function (x) { if (x.level === 'high') high++; else if (x.level === 'mid') mid++; else low++; });
    return { items: list, highCount: high, midCount: mid, lowCount: low };
  }

  /* ---------------- 理由（对照 5209–5262） ---------------- */
  function reasonsOf(item, tech, prob, sent) {
    var list = [];
    if (!item) return list;
    var sr = item.sealRatio;
    if (sr !== null && sr >= 2.0) list.push('封单额占流通市值 ' + R2(sr) + '%，封单较强');
    var fm = item.firstSealMin;
    if (fm !== null) {
      if (fm <= 1.0) list.push('开盘即封板（' + item.firstSeal + '），资金抢筹明显');
      else if (fm <= 30.0) list.push('开盘 30 分钟内封板（' + item.firstSeal + '）');
    }
    if (item.oneWord) list.push('一字板，筹码锁定较好');
    else if (item.tWord) list.push('T 字板，盘中打开后回封');
    if (item.volRatio !== null) list.push('量比 ' + R2(item.volRatio) + '，换手 ' + R2(item.turnover) + '%，属于放量涨停');
    var st = item.streak || 0;
    if (st <= 1) list.push('首板，相对高位连板股位置更低');
    else if (st === 2) list.push('2 连板，进入市场关注度较高的梯队');
    else list.push(st + ' 连板，属于当日强势梯队');
    var indN = item.industryCount || 0;
    if (indN >= 3) list.push('所属行业「' + item.industry + '」有 ' + indN + ' 家涨停，板块效应明显');
    if (tech && tech.ok) {
      if (tech.maBull) list.push('股价站上 5/10/20/60 日均线，均线多头排列');
      if (tech.breakout60) list.push('突破近 60 日平台高点 ' + R2(tech.priorHigh60) + '，上方空间打开');
      if (tech.newHigh250) list.push('创近 250 日新高，趋势强度较高');
    }
    if (prob && prob.vol && prob.vol.n >= 5) {
      var bl = 0.0;
      if (prob.baseline.limitRate !== null && prob.baseline.limitRate !== undefined) bl = prob.baseline.limitRate;
      if (prob.vol.smoothedLimit !== null && prob.vol.smoothedLimit !== undefined && prob.vol.smoothedLimit >= bl) {
        list.push('该股历史放量涨停 ' + prob.vol.n + ' 次，次日涨停参考值 ' + R1(prob.vol.smoothedLimit) + '%（样本有限）');
      }
    }
    if (sent) {
      if (sent.sealRate !== null && sent.sealRate !== undefined && sent.sealRate >= 60.0) {
        list.push('全市场封板率 ' + R1(sent.sealRate) + '%，短线情绪偏强');
      }
      if (sent.yztAvg !== null && sent.yztAvg !== undefined && sent.yztAvg >= 3.0) {
        list.push('昨日涨停股今日平均 ' + R2(sent.yztAvg) + '%，接力赚钱效应较好');
      }
    }
    return list.length > 7 ? list.slice(0, 7) : list;
  }

  /* ---------------- 价位（对照 5264–5301） ---------------- */
  function levelsOf(item, tech) {
    if (!item) return null;
    var price = item.price, lp = item.limitPct;
    var up = banker(price * (1.0 + lp / 100.0), 2);
    var down = banker(price * (1.0 - lp / 100.0), 2);
    var notes = [];
    notes.push('次日涨停价 ' + R2(up) + '，跌停价 ' + R2(down) + '；今日涨停价 ' + R2(price) + ' 是短线第一支撑。');
    var pressure = null;
    if (tech && tech.ok) {
      if (tech.ma5 !== null && tech.ma5 < price) {
        notes.push('5 日均线 ' + R2(tech.ma5) + '，若次日回踩不破可观察承接；跌破则强势结构受损。');
      }
      if (tech.high250 !== null && tech.high250 > price) {
        pressure = tech.high250;
        notes.push('上方压力参考 250 日高点 ' + R2(tech.high250) + '（距今 ' + R2(tech.high250Dist) + '%）。');
      } else if (tech.high250 !== null) {
        notes.push('已接近或创近 250 日新高，上方无近一年套牢盘，但需防高位分歧。');
      }
      if (tech.priorHigh60 !== null && tech.priorHigh60 > price && (pressure === null || tech.priorHigh60 < pressure)) {
        pressure = tech.priorHigh60;
        notes.push('近 60 日平台高点 ' + R2(tech.priorHigh60) + ' 是上方最近压力。');
      }
      if (!tech.maBull) notes.push('均线尚未形成多头排列，趋势确认度一般。');
    }
    notes.push('次日重点观察：集合竞价高开幅度、开盘 30 分钟能否守住均价线、封单是否持续，以及同板块龙头是否继续走强。');
    return {
      nextLimitPrice: R2(up), nextLimitDownPrice: R2(down),
      support: R2(price), pressure: pressure === null ? null : R2(pressure),
      ma5: (tech && tech.ma5 !== null) ? R2(tech.ma5) : null,
      notes: notes
    };
  }

  /* ---------------- 总分（对照 5303–5362） ---------------- */
  function fullScore(item, prob, tech, risks) {
    var base = 0.0;
    if (item && item.score !== null && item.score !== undefined) base = item.score;
    var techAdj = 0.0;
    if (tech && tech.ok) {
      if (tech.maBull) techAdj += 3.0;
      if (tech.ma20Dist !== null) { if (tech.ma20Dist >= 0) techAdj += 2.0; else techAdj -= 3.0; }
      if (tech.breakout60) techAdj += 4.0;
      if (tech.newHigh250) techAdj += 2.0;
      if (tech.gain20 !== null) {
        if (tech.gain20 >= 50.0) techAdj -= 5.0;
        else if (tech.gain20 >= 30.0) techAdj -= 2.0;
      }
      if (tech.high250Dist !== null && tech.high250Dist <= -25.0) techAdj -= 3.0;
      if (tech.maBull && tech.breakout60) techAdj += 1.0;
    }
    if (techAdj > 12.0) techAdj = 12.0;
    if (techAdj < -12.0) techAdj = -12.0;

    var probAdj = 0.0;
    if (prob && prob.vol) {
      var v = prob.vol;
      if (v.smoothedLimit !== null && v.smoothedLimit !== undefined) {
        var ref = 25.0;
        if (prob.baseline.limitRate !== null && prob.baseline.limitRate !== undefined) ref = prob.baseline.limitRate;
        probAdj += (v.smoothedLimit - ref) / 10.0;
      }
      if (v.n < 5) probAdj -= 1.0;
    }
    if (probAdj > 6.0) probAdj = 6.0;
    if (probAdj < -6.0) probAdj = -6.0;

    var riskAdj = 0.0;
    if (risks) {
      if (risks.highCount >= 2) riskAdj -= 6.0;
      else if (risks.highCount === 1) riskAdj -= 3.0;
      if (risks.midCount >= 3) riskAdj -= 3.0;
      else if (risks.midCount >= 1) riskAdj -= 1.0;
    }

    var total = base + techAdj + probAdj + riskAdj;
    if (total < 0) total = 0;
    if (total > 100) total = 100;
    var grade = '弱';
    if (total >= 80) grade = '强';
    else if (total >= 65) grade = '偏强';
    else if (total >= 50) grade = '中性';
    else if (total >= 35) grade = '偏弱';
    return {
      total: banker(total, 1), base: banker(base, 1), tech: banker(techAdj, 1),
      prob: banker(probAdj, 1), risk: banker(riskAdj, 1), grade: grade
    };
  }

  /* ---------------- 个股详情（对照 5364–5450） ---------------- */
  async function detail(searchParams) {
    var code = String(searchParams.get('code') || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code)) return { ok: false, error: '代码格式不正确' };
    var minVol = Number(searchParams.get('minVolRatio'));
    if (!isFinite(minVol) || minVol <= 0) minVol = 2.0;
    var force = searchParams.get('refresh') === '1';
    var key = code + '|' + minVol.toFixed(1);
    var hit = detailCache[key];
    if (!force && hit && (Date.now() - hit.t) < 60000) return hit.data;

    var r = await raw(force);
    if (!r.ok) return r;
    var item = null;
    r.items.some(function (x) { if (x.code === code) { item = x; return true; } return false; });
    if (!item) {
      return {
        ok: false, code: code, date: r.date, dateLabel: r.dateLabel, asOf: r.asOf,
        error: '该股不在 ' + r.dateLabel + ' 的涨停池中（可能已炸板、未涨停或代码有误）。'
      };
    }

    var bars = await getBars(code, 800);
    var hist = historyOf(code, item.name, minVol, bars);
    var tech = techOf(code, bars, item.price);
    var prob = probabilityOf(hist, r.sentiment, minVol);
    var risks = risksOf(item, tech, prob, r.sentiment);
    var score = fullScore(item, prob, tech, risks);
    var reasons = reasonsOf(item, tech, prob, r.sentiment);
    var levels = levelsOf(item, tech);

    var peers = [];
    r.items.forEach(function (x) {
      if (x.code === code) return;
      if (String(x.industry) !== String(item.industry)) return;
      peers.push({
        code: x.code, name: x.name, streak: x.streak, price: x.price, changePct: x.changePct,
        volRatio: x.volRatio, turnover: x.turnover, sealRatio: x.sealRatio, score: x.score
      });
    });
    peers.sort(function (a, b) { return b.score - a.score; });
    var peerTop = peers.slice(0, 8);

    var out = {
      ok: true, asOf: r.asOf, date: r.date, dateLabel: r.dateLabel, isToday: r.isToday,
      item: item, sentiment: r.sentiment, industryTop: r.industryTop,
      history: hist, tech: tech, probability: prob, risks: risks,
      reasons: reasons, score: score, levels: levels, peers: peerTop,
      method: '历史样本：该股近 3 年日 K（前复权），按板块涨跌幅识别涨停，按日成交量 / 前 5 日均量识别放量，已剔除次日为今日的未完成 K 线。概率为历史频率并用当前市场基准做小样本平滑，只代表过去，不构成收益预测。'
    };

    var keys = Object.keys(detailCache);
    if (keys.length > 60) { delete detailCache[keys[0]]; }
    detailCache[key] = { t: Date.now(), data: out };
    return out;
  }

  root.LimitUpLayer = { list: list, detail: detail };
})(typeof window !== 'undefined' ? window : globalThis);
