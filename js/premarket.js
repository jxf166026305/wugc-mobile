/* =====================================================================
 * 美股盘前（移植自 网页评分.ps1 的 Get-UsPremarketData）
 * 桌面版读新浪 gb_/hf_ 记录拿到"盘前 / 盘后延时段"成交。新浪接口在浏览器
 * 里无 Referer 会 403，所以手机版改用腾讯 qt.gtimg.cn：
 *   · 三大期指 hf_ES / hf_NQ / hf_YM —— 24 小时连续，可当"盘前温度计"
 *   · 个股 usXXXX —— 常规时段最新价、涨跌幅、昨收、行情时间
 * 因此个股的"盘前/盘后延时段"列本版无数据（如实留空，不臆造）。
 * ===================================================================== */
(function (root) {
  'use strict';

  var GROUPS = [
    { name: '科技巨头', codes: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA'] },
    { name: 'AI / 半导体', codes: ['AVGO', 'AMD', 'TSM', 'MU', 'PLTR', 'ORCL', 'ARM'] },
    { name: '中概股', codes: ['BABA', 'PDD', 'JD', 'BIDU', 'NIO', 'XPEV', 'LI'] },
    { name: '热门 / 其他', codes: ['NFLX', 'COIN', 'MSTR', 'JPM', 'XOM'] },
    { name: 'ETF', codes: ['SPY', 'QQQ', 'DIA', 'IWM'] }
  ];

  var NDX100_ASOF = '2026-10-22';
  var NDX100 = ['ADBE', 'AMD', 'ABNB', 'ALNY', 'GOOGL', 'GOOG', 'AMZN', 'AEP', 'AMGN', 'ADI',
    'AAPL', 'AMAT', 'APP', 'ARM', 'ASML', 'ALAB', 'ADSK', 'ADP', 'AXON', 'BKR',
    'BKNG', 'AVGO', 'CDNS', 'CTAS', 'CSCO', 'CCEP', 'CMCSA', 'CEG', 'CPRT', 'CRWV',
    'COST', 'CRWD', 'CSX', 'DDOG', 'DXCM', 'FANG', 'DASH', 'EXC', 'FAST', 'FER',
    'FTNT', 'GEHC', 'GILD', 'HONA', 'HON', 'IDXX', 'INTC', 'INTU', 'ISRG', 'KDP',
    'KLAC', 'LRCX', 'LIN', 'LITE', 'MAR', 'MRVL', 'MELI', 'META', 'MCHP', 'MU',
    'MSFT', 'MSTR', 'MRNA', 'MDLZ', 'MPWR', 'MNST', 'NBIS', 'NFLX', 'NVDA', 'NXPI',
    'ORLY', 'ODFL', 'PCAR', 'PLTR', 'PANW', 'PAYX', 'PYPL', 'PDD', 'PEP', 'QCOM',
    'REGN', 'RKLB', 'ROP', 'ROST', 'SNDK', 'STX', 'SHOP', 'SPCX', 'SBUX', 'SNPS',
    'TMUS', 'TTWO', 'TER', 'TSLA', 'TXN', 'TRI', 'VRTX', 'WMT', 'WDC', 'WDAY', 'XEL'];

  var FUTDEFS = [
    { id: 'hf_ES', code: 'ES', name: '标普500主连' },
    { id: 'hf_NQ', code: 'NQ', name: '纳指100主连' },
    { id: 'hf_YM', code: 'YM', name: '道指主连' }
  ];

  var cache = {};

  function num(v) {
    if (v === null || v === undefined || v === '' || v === '-') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function etNow() {
    // 用 Intl 取美东时间，避免依赖本机时区
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
    });
    var parts = {};
    fmt.formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    var hh = Number(parts.hour === '24' ? '0' : parts.hour);
    return {
      hh: hh, mm: Number(parts.minute), ss: Number(parts.second),
      day: parts.day, month: parts.month, weekday: parts.weekday,
      text: parts.month + '-' + parts.day + ' ' + pad2(hh) + ':' + parts.minute,
      hhmm: pad2(hh) + ':' + parts.minute
    };
  }

  function sessionOf(et) {
    var wk = et.weekday;
    if (wk === 'Sat' || wk === 'Sun') return { status: 'closed', statusText: '休市（周末）' };
    var m = et.hh * 60 + et.mm;
    if (m >= 4 * 60 && m < 9 * 60 + 30) return { status: 'preopen', statusText: '盘前时段' };
    if (m >= 9 * 60 + 30 && m < 16 * 60) return { status: 'live', statusText: '常规交易中' };
    if (m >= 16 * 60 && m < 20 * 60) return { status: 'after', statusText: '盘后时段' };
    return { status: 'closed', statusText: '已收盘' };
  }

  async function getTencent(codes) {
    if (!codes.length) return {};
    var u = 'https://qt.gtimg.cn/q=' + codes.join(',') + '&_=' + Date.now();
    var map = {};
    try {
      var r = await fetch(u);
      var buf = await r.arrayBuffer();
      var text = '';
      try { text = new TextDecoder('gb18030').decode(buf); }
      catch (e) { text = new TextDecoder('utf-8').decode(buf); }
      var re = /v_([A-Za-z0-9_\.]+)="([^"]*)"/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        map[m[1]] = m[2];  // 原样保存：个股用 ~ 分隔，期指用 , 分隔
      }
    } catch (e) { return {}; }
    return map;
  }

  async function spotQuotes() {
    var out = {};
    try {
      var r = await fetch('https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=100.NDX,100.DJIA&fields=f2,f3,f4,f12,f13,f14,f18,f124&_=' + Date.now());
      var j = await r.json();
      var rows = j.data && j.data.diff ? j.data.diff : [];
      if (!Array.isArray(rows)) rows = Object.keys(rows).map(function (k) { return rows[k]; });
      rows.forEach(function (x) {
        if (x.f13 === 100 && x.f12 === 'NDX') out['100.NDX'] = packSpot(x);
        if (x.f13 === 100 && x.f12 === 'DJIA') out['100.DJIA'] = packSpot(x);
      });
    } catch (e) {}
    return out;
  }

  function packSpot(x) {
    var ts = num(x.f124);
    var lab = '';
    if (ts) {
      var d = new Date(ts * 1000);
      lab = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    return { price: num(x.f2), pct: num(x.f3), change: num(x.f4), prev: num(x.f18), time: lab };
  }

  function bjText() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  async function list(preset, codes, force) {
    var presetKey = String(preset || '').toLowerCase();
    var groups, cacheKey;
    if (presetKey === 'ndx100') {
      groups = [{ name: '纳斯达克100 成分股', codes: NDX100.slice() }];
      cacheKey = '__ndx100__';
    } else if (codes && codes.length) {
      groups = [{ name: '自定义', codes: codes.slice(0, 40) }];
      cacheKey = codes.slice(0, 40).join(',');
    } else {
      groups = GROUPS;
      cacheKey = '__default__';
    }
    if (!force && cache[cacheKey] && (Date.now() - cache[cacheKey].t) < 10000) return cache[cacheKey].data;

    var et = etNow();
    var sess = sessionOf(et);

    var allCodes = [];
    groups.forEach(function (g) { g.codes.forEach(function (c) { if (allCodes.indexOf('us' + c) < 0) allCodes.push('us' + c); }); });
    var futIds = FUTDEFS.map(function (f) { return f.id; });
    var map = await getTencent(allCodes);
    // 腾讯同一批请求里混入 us* 与 hf_* 会被截断，且 hf_* 一次只回一条，逐条取
    var futMap = {};
    for (var fi = 0; fi < futIds.length; fi++) {
      var one = await getTencent([futIds[fi]]);
      Object.keys(one).forEach(function (k) { futMap[k] = one[k]; });
    }

    var items = [];
    groups.forEach(function (g) {
      g.codes.forEach(function (codeRaw) {
        var code = String(codeRaw).toUpperCase();
        var raw = map['us' + code];
        var f = String(raw || '').split('~');
        if (!raw || f.length < 40) {
          items.push({
            code: code, name: code, group: g.name, ok: false, hasExt: false,
            latestPrice: null, latestPct: null, latestChange: null,
            latestKind: 'off', latestKindText: '未取到', latestTime: '',
            extPrice: null, extPct: null, extChange: null, extVolume: null, extAmount: null, extTime: '',
            regularPrice: null, regularPct: null, regularTime: '', prevClose: null, refPrice: null
          });
          return;
        }
        var name = String(f[1] || code);
        var price = num(f[3]), prev = num(f[4]), chg = num(f[31]), pct = num(f[32]);
        var tRaw = String(f[30] || '');
        var tShort = tRaw.length >= 16 ? tRaw.slice(5, 16) : tRaw;
        var ok = price !== null && price > 0;
        items.push({
          code: code, name: name, group: g.name, ok: ok, hasExt: false,
          latestPrice: price, latestPct: pct, latestChange: chg,
          latestKind: ok ? 'regular' : 'off',
          latestKindText: ok ? '常规时段' : '未取到',
          latestTime: tShort,
          extPrice: null, extPct: null, extChange: null, extVolume: null, extAmount: null, extTime: '',
          regularPrice: price, regularPct: pct, regularTime: tShort,
          prevClose: prev, refPrice: prev
        });
      });
    });

    // 腾讯只有标普期指(hf_ES)可用；纳指/道指用东财现货指数补位，名称里标明口径
    var spot = await spotQuotes();
    var futures = FUTDEFS.map(function (fd) {
      if (fd.code === 'ES') {
        var rawF = futMap[fd.id];
        var f = String(rawF || '').split(',');
        if (!rawF || f.length < 9) {
          return { ok: false, code: fd.code, name: fd.name, price: null, change: null, pct: null, prevClose: null, time: '' };
        }
        var price = num(f[0]), pct = num(f[1]), prev = num(f[7]);
        var chg = (price !== null && prev !== null) ? price - prev : null;
        var d = String(f[12] || ''), hh = String(f[6] || '');
        return {
          ok: price !== null, code: fd.code, name: fd.name + '（期指）',
          price: price, change: chg, pct: pct, prevClose: prev,
          time: (d ? d.slice(5) + ' ' : '') + hh
        };
      }
      var sid = fd.code === 'NQ' ? '100.NDX' : '100.DJIA';
      var s = spot[sid];
      if (!s) return { ok: false, code: fd.code, name: fd.name + '（现货）', price: null, change: null, pct: null, prevClose: null, time: '' };
      return {
        ok: s.price !== null, code: fd.code, name: fd.name + '（现货）',
        price: s.price, change: s.change, pct: s.pct, prevClose: s.prev,
        time: s.time
      };
    });

    var groupsOut = groups.map(function (g) {
      var gi = items.filter(function (x) { return x.group === g.name; });
      gi.sort(function (a, b) {
        var pa = a.latestPct === null ? -9999 : a.latestPct;
        var pb = b.latestPct === null ? -9999 : b.latestPct;
        return pb - pa;
      });
      return { name: g.name, items: gi };
    });

    var valid = items.filter(function (x) { return x.ok && x.latestPct !== null; });
    var up = valid.filter(function (x) { return x.latestPct > 0.001; }).length;
    var down = valid.filter(function (x) { return x.latestPct < -0.001; }).length;
    var best = null, worst = null;
    valid.forEach(function (x) {
      if (!best || x.latestPct > best.pct) best = { name: x.name, code: x.code, pct: x.latestPct };
      if (!worst || x.latestPct < worst.pct) worst = { name: x.name, code: x.code, pct: x.latestPct };
    });

    var data = {
      ok: true,
      time: bjText(), bjTime: bjText(), etTime: et.hhmm,
      status: sess.status, statusText: sess.statusText,
      count: items.length, okCount: valid.length, up: up, down: down, flat: valid.length - up - down,
      best: best, worst: worst,
      preset: presetKey === 'ndx100' ? 'ndx100' : '', presetCount: presetKey === 'ndx100' ? NDX100.length : 0,
      presetAsOf: presetKey === 'ndx100' ? NDX100_ASOF : '',
      futures: futures, groups: groupsOut,
      note: '个股仅常规时段数据：盘前/盘后延时成交需新浪接口，浏览器跨域受限未接入；三大期指为 24 小时连续行情。'
    };
    cache[cacheKey] = { t: Date.now(), data: data };
    return data;
  }

  root.PremarketLayer = { list: list, groups: GROUPS, ndx100: NDX100 };
})(typeof window !== 'undefined' ? window : globalThis);
