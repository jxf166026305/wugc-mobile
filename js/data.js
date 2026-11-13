/* =====================================================================
 * 数据层：行情 / K线 / 自选股（全部在浏览器本地完成，无需后端）
 * 对齐《网页评分.ps1》同名接口的输出结构
 * ===================================================================== */
(function (root) {
  'use strict';
  var D = {};

  /* ---------- 基础 ---------- */
  function num(v) {
    if (v === null || v === undefined) return 0;
    var d = Number(v);
    return isFinite(d) ? d : 0;
  }
  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var d = Number(v);
    return isFinite(d) ? d : null;
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function hhmmss(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function spf(v) {
    if (v === null || v === undefined || !isFinite(Number(v))) return '0.00';
    var n = Number(v);
    var s = Math.abs(n).toFixed(2);
    if (n > 0) return '+' + s;
    if (n < 0) return '-' + s;
    return '0.00';
  }
  function nf2(v) { return (num(v)).toFixed(2); }
  function shortNum(v) {
    var n = Number(v);
    if (!isFinite(n)) return '0';
    return String(Math.round(n * 100) / 100);
  }

  /* ---------- 行情（腾讯 qt.gtimg.cn，GBK 解码） ---------- */
  function tencentSymbol(code) {
    if (String(code).charAt(0) === '6') return 'sh' + code;
    if (/^(4|8|92)/.test(String(code))) return 'bj' + code;
    return 'sz' + code;
  }

  function decodeGbk(buf) {
    try { return new TextDecoder('gbk').decode(new Uint8Array(buf)); }
    catch (e) { return new TextDecoder('utf-8').decode(new Uint8Array(buf)); }
  }

  function parseQuoteBlock(text, code) {
    var m = text.match(/="([^"]*)"/);
    if (!m) return null;
    var f = m[1].split('~');
    if (f.length < 40) return null;
    return {
      ok: true,
      code: String(code),
      name: f[1],
      price: num(f[3]),
      prevClose: num(f[4]),
      open: num(f[5]),
      time: f[30],
      change: num(f[31]),
      changePct: num(f[32]),
      high: num(f[33]),
      low: num(f[34]),
      amount: num(f[37]),
      turnover: num(f[38]),
      peTtm: num(f[39]),
      amplitude: f.length > 43 ? num(f[43]) : 0,
      pb: f.length > 46 ? num(f[46]) : 0,
      marketCap: f.length > 45 ? num(f[45]) : 0,
      limitUp: f.length > 47 ? num(f[47]) : 0,
      limitDown: f.length > 48 ? num(f[48]) : 0,
      volRatio: f.length > 49 ? num(f[49]) : 0
    };
  }

  D.quote = async function (code) {
    if (!/^\d{6}$/.test(String(code))) return { ok: false, error: '代码格式不正确' };
    try {
      var r = await fetch('https://qt.gtimg.cn/q=' + tencentSymbol(code), { cache: 'no-store' });
      var buf = await r.arrayBuffer();
      var q = parseQuoteBlock(decodeGbk(buf), code);
      return q || { ok: false, error: '实时行情获取失败' };
    } catch (e) {
      return { ok: false, error: '实时行情获取失败' };
    }
  };

  D.quotes = async function (codes) {
    var syms = [];
    var map = {};
    (codes || []).forEach(function (c) {
      if (/^\d{6}$/.test(String(c))) { var s = tencentSymbol(c); syms.push(s); map[s] = String(c); }
    });
    if (syms.length === 0) return [];
    try {
      var r = await fetch('https://qt.gtimg.cn/q=' + syms.join(','), { cache: 'no-store' });
      var buf = await r.arrayBuffer();
      var text = decodeGbk(buf);
      var out = [];
      var re = /v_([a-z]{2}\d{6})="([^"]*)"/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        var q = parseQuoteBlock('="' + m[2] + '"', map[m[1]] || m[1]);
        if (q) out.push(q);
      }
      return out;
    } catch (e) { return []; }
  };

  /* ---------- K 线（东财 push2his） ---------- */
  function secid(code) {
    return (/^6/.test(String(code)) ? '1.' : '0.') + code;
  }
  function calcMA(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (i < n - 1) { out.push(null); continue; }
      var s = 0;
      for (var j = i - n + 1; j <= i; j++) s += arr[j];
      out.push(s / n);
    }
    return out;
  }
  function rnd(v, d) {
    var x = Number(v);
    if (!isFinite(x)) return 0;
    var f = Math.pow(10, d || 0);
    var v2 = x * f, fl = Math.floor(v2), diff = v2 - fl;
    if (Math.abs(diff - 0.5) < 1e-9) return ((fl % 2 === 0) ? fl : fl + 1) / f;
    return Math.round(v2) / f;
  }

  /* 腾讯日 K 兜底（东财不可用时使用，与电脑版 Get-KlineTencent 同源） */
  async function klineTencent(code, klt, limit) {
    var sym = tencentSymbol(code);
    var kname = klt === '102' ? 'week' : klt === '103' ? 'month' : 'day';
    var now = new Date();
    var start = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 365 * 4);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var ymd = function (dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); };
    var urls = [
      'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + sym + ',' + kname + ',' + ymd(start) + ',' + ymd(now) + ',' + limit + ',qfq',
      'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get?param=' + sym + ',' + kname + ',,,' + limit + ',qfq'
    ];
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetch(urls[i], { cache: 'no-store' });
        var j = await r.json();
        var node = j && j.data && j.data[sym];
        if (!node) continue;
        var arr = node[kname] || node['qfq' + kname];
        if (!arr || !arr.length) continue;
        var bars = [];
        for (var k = 0; k < arr.length; k++) {
          var p = arr[k];
          if (!p || p.length < 6) continue;
          bars.push({ d: String(p[0]).slice(0, 10), o: rnd(p[1], 2), c: rnd(p[2], 2), h: rnd(p[3], 2), l: rnd(p[4], 2), v: rnd(p[5], 2), amt: 0, pct: 0, turn: 0 });
        }
        if (!bars.length) continue;
        for (var m = 1; m < bars.length; m++) {
          var pc = bars[m - 1].c;
          if (pc > 0) bars[m].pct = rnd((bars[m].c - pc) / pc * 100.0, 2);
        }
        return { ok: true, code: code, name: '', period: kname, klt: klt, source: 'tencent', count: bars.length, asOf: bars[bars.length - 1].d, bars: bars };
      } catch (e) { /* 换下一个地址 */ }
    }
    return null;
  }

  D.kline = async function (code, period, limit) {
    period = String(period || 'day').toLowerCase();
    var klt = '101', pname = 'day';
    if (period === 'week' || period === '102') { klt = '102'; pname = 'week'; }
    else if (period === 'month' || period === '103') { klt = '103'; pname = 'month'; }
    limit = Math.min(800, Math.max(30, Number(limit) || 120));
    var url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid(code) +
      '&klt=' + klt + '&fqt=1&lmt=' + limit + '&end=20500101' +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';
    try {
      var r = await fetch(url, { cache: 'no-store' });
      var j = await r.json();
      var data = j && j.data;
      if (!data || !data.klines || data.klines.length < 5) {
        var fb = await klineTencent(code, klt, limit);
        if (fb) return fb;
        return { ok: false, code: code, period: pname, error: 'K 线数据获取失败（代码可能不存在、停牌或行情接口暂时不可用）' };
      }
      var bars = data.klines.map(function (s) {
        var a = s.split(',');
        return { d: a[0], o: rnd(a[1], 2), c: rnd(a[2], 2), h: rnd(a[3], 2), l: rnd(a[4], 2), v: rnd(a[5], 2), amt: rnd(a[6], 2), pct: rnd(a[8], 2), turn: rnd(a[10], 2) };
      });
      var closes = bars.map(function (b) { return b.c; });
      var vols = bars.map(function (b) { return b.v; });
      var ma5 = calcMA(closes, 5), ma10 = calcMA(closes, 10), ma20 = calcMA(closes, 20), ma60 = calcMA(closes, 60);
      var vma5 = calcMA(vols, 5);
      return {
        ok: true, code: code, name: data.name || '', period: pname, klt: klt,
        source: 'eastmoney', count: bars.length, asOf: bars[bars.length - 1].d,
        bars: bars,
        ma: {
          ma5: ma5.map(function (x) { return x === null ? null : rnd(x, 2); }),
          ma10: ma10.map(function (x) { return x === null ? null : rnd(x, 2); }),
          ma20: ma20.map(function (x) { return x === null ? null : rnd(x, 2); }),
          ma60: ma60.map(function (x) { return x === null ? null : rnd(x, 2); })
        },
        volMa5: vma5.map(function (x) { return x === null ? null : rnd(x, 2); })
      };
    } catch (e) {
      var fb2 = await klineTencent(code, klt, limit);
      if (fb2) return fb2;
      return { ok: false, code: code, period: pname, error: 'K 线数据获取失败：' + e.message };
    }
  };

  /* ---------- 自选股（本地存储，结构对齐 watchlist.json） ---------- */
  var STORE_KEY = 'wb_watchlist_v1';
  var DEFAULTS = { changePct: 5.0, turnover: 10.0, volRatio: 2.0, amplitude: 8.0, highPct: 1.0, lowPct: 1.0, tipsOn: true };

  function readData() {
    var data = { version: 1, settings: Object.assign({}, DEFAULTS), items: [] };
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var j = JSON.parse(raw);
        if (j && j.settings) {
          ['changePct', 'turnover', 'volRatio', 'amplitude', 'highPct', 'lowPct'].forEach(function (k) {
            var v = numOrNull(j.settings[k]);
            if (v !== null && v > 0) data.settings[k] = v;
          });
          if (typeof j.settings.tipsOn === 'boolean') data.settings.tipsOn = j.settings.tipsOn;
        }
        if (j && Array.isArray(j.items)) {
          j.items.forEach(function (x) {
            if (!x) return;
            var c = String(x.code || '');
            if (!/^\d{6}$/.test(c)) return;
            data.items.push({ code: c, name: String(x.name || ''), addedAt: String(x.addedAt || ''), note: String(x.note || '') });
          });
        }
      }
    } catch (e) { }
    return data;
  }
  function writeData(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { }
  }

  function newAlert(code, name, type, level, text, price, pct, time, keySuffix) {
    return {
      key: code + '|' + type + '|' + ymd(new Date()) + (keySuffix || ''),
      code: code, name: name, type: type, level: level, text: text,
      price: price, pct: pct, time: time
    };
  }

  function watchAlerts(item, q, settings) {
    var out = [];
    if (!q) return out;
    var name = q.name || item.name || '';
    var pct = num(q.changePct), price = num(q.price), turnover = num(q.turnover);
    var volRatio = num(q.volRatio), amp = num(q.amplitude);
    var tm = String(q.time || '');
    if (tm.length >= 14) tm = tm.substring(8, 10) + ':' + tm.substring(10, 12);
    else tm = pad2(new Date().getHours()) + ':' + pad2(new Date().getMinutes());

    var thChange = DEFAULTS.changePct, thTurn = DEFAULTS.turnover, thVol = DEFAULTS.volRatio, thAmp = DEFAULTS.amplitude;
    var thHigh = DEFAULTS.highPct, thLow = DEFAULTS.lowPct;
    var v;
    v = numOrNull(settings.changePct); if (v && v > 0) thChange = v;
    v = numOrNull(settings.turnover); if (v && v > 0) thTurn = v;
    v = numOrNull(settings.volRatio); if (v && v > 0) thVol = v;
    v = numOrNull(settings.amplitude); if (v && v > 0) thAmp = v;
    v = numOrNull(settings.highPct); if (v && v > 0) thHigh = v;
    v = numOrNull(settings.lowPct); if (v && v > 0) thLow = v;
    var tipsOn = true;
    if (settings.tipsOn !== null && settings.tipsOn !== undefined) {
      tipsOn = (typeof settings.tipsOn === 'boolean') ? settings.tipsOn : !(String(settings.tipsOn) === 'false' || String(settings.tipsOn) === '0');
    }

    var limitPct = 9.8;
    if (/^(30|68)/.test(item.code)) limitPct = 19.5;
    else if (/^(4|8|92)/.test(item.code)) limitPct = 29.5;
    if (name.indexOf('ST') >= 0) limitPct = 4.8;

    if (pct >= limitPct) {
      out.push(newAlert(item.code, name, '涨停', 'high', name + ' ' + item.code + ' 涨停，现价 ' + nf2(price) + '，涨幅 ' + spf(pct) + '%', price, pct, tm));
    } else if (pct <= -1.0 * limitPct) {
      out.push(newAlert(item.code, name, '跌停', 'high', name + ' ' + item.code + ' 跌停，现价 ' + nf2(price) + '，跌幅 ' + spf(pct) + '%', price, pct, tm));
    } else if (Math.abs(pct) >= thChange) {
      var word = pct > 0 ? '大涨' : '大跌';
      var lvl = (Math.abs(pct) >= thChange * 1.5) ? 'high' : 'warn';
      out.push(newAlert(item.code, name, word, lvl, name + ' ' + item.code + ' ' + word + ' ' + spf(pct) + '%，现价 ' + nf2(price) + '（阈值 ' + shortNum(thChange) + '%）', price, pct, tm));
    }
    if (turnover >= thTurn) {
      out.push(newAlert(item.code, name, '高换手', 'warn', name + ' ' + item.code + ' 换手率 ' + nf2(turnover) + '%，超过 ' + shortNum(thTurn) + '%（成交 ' + nf2(num(q.amount) / 10000.0) + ' 亿）', price, pct, tm));
    }
    if (volRatio >= thVol) {
      out.push(newAlert(item.code, name, '放量', 'warn', name + ' ' + item.code + ' 量比 ' + nf2(volRatio) + '，超过 ' + shortNum(thVol) + '，成交明显放大', price, pct, tm));
    }
    if (amp >= thAmp) {
      out.push(newAlert(item.code, name, '大幅波动', 'warn', name + ' ' + item.code + ' 振幅 ' + nf2(amp) + '%，最高 ' + nf2(num(q.high)) + ' / 最低 ' + nf2(num(q.low)), price, pct, tm));
    }

    var high = num(q.high), low = num(q.low), prevClose = num(q.prevClose);
    var rangePct = prevClose > 0 ? (high - low) / prevClose * 100.0 : amp;
    if (tipsOn && high > low && high > 0 && low > 0 && rangePct >= 1.0 && Math.abs(pct) < limitPct) {
      var fromHigh = (high - price) / high * 100.0;
      var fromLow = (price - low) / low * 100.0;
      var hb = '|' + ymd(new Date()).replace(/-/g, '') + pad2(new Date().getHours());
      if (fromHigh >= -0.05 && fromHigh <= thHigh) {
        out.push(newAlert(item.code, name, '高抛参考', fromHigh <= thHigh * 0.4 ? 'high' : 'warn',
          name + ' ' + item.code + ' 现价 ' + nf2(price) + '，距日内高点 ' + nf2(fromHigh) + '%（日高 ' + nf2(high) + ' / 日低 ' + nf2(low) + '），进入高抛参考区（阈值 ≤' + shortNum(thHigh) + '%）', price, pct, tm, hb));
      } else if (fromLow >= -0.05 && fromLow <= thLow) {
        out.push(newAlert(item.code, name, '低吸参考', fromLow <= thLow * 0.4 ? 'high' : 'warn',
          name + ' ' + item.code + ' 现价 ' + nf2(price) + '，距日内低点 ' + nf2(fromLow) + '%（日高 ' + nf2(high) + ' / 日低 ' + nf2(low) + '），进入低吸参考区（阈值 ≤' + shortNum(thLow) + '%）', price, pct, tm, hb));
      }
    }
    return out;
  }

  D.watchSnapshot = async function () {
    var d = readData();
    var itemsIn = d.items;
    var qmap = {};
    if (itemsIn.length > 0) {
      (await D.quotes(itemsIn.map(function (x) { return x.code; }))).forEach(function (q) {
        if (q && q.code) qmap[q.code] = q;
      });
    }
    var thHigh = DEFAULTS.highPct, thLow = DEFAULTS.lowPct;
    var v;
    v = numOrNull(d.settings.highPct); if (v && v > 0) thHigh = v;
    v = numOrNull(d.settings.lowPct); if (v && v > 0) thLow = v;

    var items = [], alerts = [];
    itemsIn.forEach(function (it) {
      var q = qmap[it.code];
      var al = q ? watchAlerts(it, q, d.settings) : [];
      var lvl = '';
      al.forEach(function (a) {
        if (a.level === 'high') { lvl = 'high'; }
        else if (a.level === 'warn' && !lvl) { lvl = 'warn'; }
      });
      var fromHigh = null, fromLow = null, dayPos = null, zone = '';
      if (q) {
        var qh = num(q.high), ql = num(q.low), qp = num(q.price);
        if (qh > ql && qh > 0 && ql > 0 && qp > 0) {
          fromHigh = rnd((qh - qp) / qh * 100.0, 2);
          fromLow = rnd((qp - ql) / ql * 100.0, 2);
          dayPos = rnd((qp - ql) / (qh - ql) * 100.0, 1);
          var zoneLimit = 9.8;
          if (/^(30|68)/.test(it.code)) zoneLimit = 19.5;
          else if (/^(4|8|92)/.test(it.code)) zoneLimit = 29.5;
          if (String(q.name).indexOf('ST') >= 0) zoneLimit = 4.8;
          if (Math.abs(num(q.changePct)) < zoneLimit && num(q.amplitude) >= 1.0) {
            if (fromHigh <= thHigh) zone = 'high';
            else if (fromLow <= thLow) zone = 'low';
          }
        }
      }
      al.forEach(function (a) { alerts.push(a); });
      var name = it.name;
      if (q && q.name) name = q.name;
      items.push({
        code: it.code, name: name, addedAt: it.addedAt, note: it.note, ok: !!q,
        price: q ? num(q.price) : null,
        change: q ? num(q.change) : null,
        changePct: q ? num(q.changePct) : null,
        high: q ? num(q.high) : null,
        low: q ? num(q.low) : null,
        prevClose: q ? num(q.prevClose) : null,
        open: q ? num(q.open) : null,
        amount: q ? num(q.amount) : null,
        turnover: q ? num(q.turnover) : null,
        volRatio: q ? num(q.volRatio) : null,
        amplitude: q ? num(q.amplitude) : null,
        peTtm: q ? num(q.peTtm) : null,
        pb: q ? num(q.pb) : null,
        marketCap: q ? num(q.marketCap) : null,
        fromHigh: fromHigh, fromLow: fromLow, dayPos: dayPos, zone: zone,
        alertLevel: lvl, alerts: al
      });
    });
    var now = new Date();
    return {
      ok: true, time: hhmmss(now), date: ymd(now), count: items.length,
      settings: d.settings, items: items, alerts: alerts
    };
  };

  D.watchAdd = async function (code) {
    if (!/^\d{6}$/.test(String(code))) return { ok: false, error: '请输入 6 位 A 股代码' };
    var q = await D.quote(code);
    var d = readData();
    if (!d.items.some(function (x) { return x.code === String(code); })) {
      d.items.push({ code: String(code), name: q && q.ok ? q.name : '', addedAt: ymd(new Date()), note: '' });
      writeData(d);
    }
    return { ok: true, count: d.items.length, items: d.items, quote: q };
  };

  D.watchRemove = async function (code) {
    if (!/^\d{6}$/.test(String(code))) return { ok: false, error: '请输入 6 位 A 股代码' };
    var d = readData();
    d.items = d.items.filter(function (x) { return x.code !== String(code); });
    writeData(d);
    return { ok: true, count: d.items.length, items: d.items };
  };

  D.watchSettings = async function (q) {
    var d = readData();
    function take(name, key) {
      var raw = String(q.get(name) || '').trim();
      if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw);
      return null;
    }
    var changePct = take('changePct'), turnover = take('turnover'), volRatio = take('volRatio');
    var amplitude = take('amplitude'), highPct = take('highPct'), lowPct = take('lowPct');
    if (changePct !== null) d.settings.changePct = changePct;
    if (turnover !== null) d.settings.turnover = turnover;
    if (volRatio !== null) d.settings.volRatio = volRatio;
    if (amplitude !== null) d.settings.amplitude = amplitude;
    if (highPct !== null) d.settings.highPct = highPct;
    if (lowPct !== null) d.settings.lowPct = lowPct;
    var tips = String(q.get('tipsOn') || '').trim().toLowerCase();
    if (tips === '1' || tips === 'true') d.settings.tipsOn = true;
    else if (tips === '0' || tips === 'false') d.settings.tipsOn = false;
    writeData(d);
    return { ok: true, settings: d.settings };
  };

  D.__seedIfEmpty = async function () {
    var d = readData();
    if (d.items.length > 0) return;
    try {
      var r = await fetch('watchlist.json', { cache: 'no-store' });
      if (!r.ok) return;
      var j = await r.json();
      if (j && Array.isArray(j.items)) {
        d.items = j.items.filter(function (x) { return x && /^\d{6}$/.test(String(x.code)); })
          .map(function (x) { return { code: String(x.code), name: String(x.name || ''), addedAt: String(x.addedAt || ''), note: String(x.note || '') }; });
        writeData(d);
      }
    } catch (e) { }
  };

  root.DataLayer = D;
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
})(typeof window !== 'undefined' ? window : globalThis);
