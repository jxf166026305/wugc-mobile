/* =====================================================================
 * 资金面 / 技术面 深度分析（移植自 网页评分.ps1 的 Get-DeepData）
 * 数据：东财 push2his K线 + fflow 资金流 + datacenter 报表 + 腾讯快照
 * ===================================================================== */
(function (root) {
  'use strict';

  var DC = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  var P2H = 'https://push2his.eastmoney.com';

  /* ---------------- 数值工具（对齐 PowerShell 口径） ---------------- */

  // PowerShell [math]::Round 是银行家舍入（四舍六入五成双）
  function banker(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    var f = Math.pow(10, d);
    var x = v * f;
    var r = Math.round(x);
    if (Math.abs(Math.abs(x - Math.trunc(x)) - 0.5) < 1e-9) {
      var t = Math.trunc(x);
      r = (t % 2 === 0) ? t : t + (x > 0 ? 1 : -1);
    }
    return r / f;
  }
  function Rnd(v, d) {
    if (v === null || v === undefined) return null;
    var n = Number(v);
    if (!isFinite(n)) return null;
    return banker(n, d === undefined ? 2 : d);
  }
  function num(v) {
    if (v === null || v === undefined || v === '' || v === '-') return NaN;
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }
  function nz(v, d) { return isFinite(v) ? v : d; }

  /* ---------------- 指标 ---------------- */
  function MA(a, n) {
    var out = new Array(a.length).fill(NaN);
    for (var i = n - 1; i < a.length; i++) {
      var s = 0;
      for (var j = i - n + 1; j <= i; j++) s += a[j];
      out[i] = s / n;
    }
    return out;
  }
  function EMA(a, n) {
    var out = new Array(a.length).fill(NaN);
    if (!a.length) return out;
    var k = 2 / (n + 1);
    out[0] = a[0];
    for (var i = 1; i < a.length; i++) out[i] = a[i] * k + out[i - 1] * (1 - k);
    return out;
  }
  function MACD(C) {
    var e12 = EMA(C, 12), e26 = EMA(C, 26);
    var dif = C.map(function (_, i) { return e12[i] - e26[i]; });
    var dea = EMA(dif, 9);
    var hist = dif.map(function (v, i) { return 2 * (v - dea[i]); });
    return { dif: dif, dea: dea, hist: hist };
  }
  function RSI(C, N) {
    var out = new Array(C.length).fill(NaN);
    if (C.length <= N) return out;
    var gain = 0, loss = 0;
    for (var i = 1; i <= N; i++) {
      var ch = C[i] - C[i - 1];
      if (ch > 0) gain += ch; else loss -= ch;
    }
    var ag = gain / N, al = loss / N;
    out[N] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (var i2 = N + 1; i2 < C.length; i2++) {
      var c = C[i2] - C[i2 - 1];
      var g = c > 0 ? c : 0, l = c < 0 ? -c : 0;
      ag = (ag * (N - 1) + g) / N;
      al = (al * (N - 1) + l) / N;
      out[i2] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }
  function KDJ(H, L, C, N) {
    var k = new Array(C.length).fill(50), d = new Array(C.length).fill(50), j = new Array(C.length).fill(50);
    var pk = 50, pd = 50;
    for (var i = 0; i < C.length; i++) {
      if (i < N - 1) continue;
      var hh = -Infinity, ll = Infinity;
      for (var x = i - N + 1; x <= i; x++) { if (H[x] > hh) hh = H[x]; if (L[x] < ll) ll = L[x]; }
      var rsv = (hh - ll === 0) ? 50 : (C[i] - ll) / (hh - ll) * 100;
      pk = (pk * 2 + rsv) / 3;
      pd = (pd * 2 + pk) / 3;
      k[i] = pk; d[i] = pd; j[i] = 3 * pk - 2 * pd;
    }
    return { k: k, d: d, j: j };
  }
  function BOLL(C, N) {
    var mid = MA(C, N);
    var up = new Array(C.length).fill(NaN), dn = new Array(C.length).fill(NaN), wd = new Array(C.length).fill(NaN);
    for (var i = N - 1; i < C.length; i++) {
      var s = 0;
      for (var x = i - N + 1; x <= i; x++) s += (C[x] - mid[i]) * (C[x] - mid[i]);
      var sd = Math.sqrt(s / N);
      up[i] = mid[i] + 2 * sd; dn[i] = mid[i] - 2 * sd;
      if (mid[i] > 0) wd[i] = (up[i] - dn[i]) / mid[i] * 100;
    }
    return { mid: mid, up: up, low: dn, width: wd };
  }
  function DMI(H, L, C, N) {
    var n = C.length;
    var pdi = new Array(n).fill(NaN), mdi = new Array(n).fill(NaN), adx = new Array(n).fill(NaN);
    if (n <= N + 1) return { pdi: pdi, mdi: mdi, adx: adx };
    var tr = new Array(n).fill(0), pdm = new Array(n).fill(0), mdm = new Array(n).fill(0);
    for (var i = 1; i < n; i++) {
      var h1 = H[i] - H[i - 1], l1 = L[i - 1] - L[i];
      tr[i] = Math.max(H[i] - L[i], Math.max(Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])));
      pdm[i] = (h1 > l1 && h1 > 0) ? h1 : 0;
      mdm[i] = (l1 > h1 && l1 > 0) ? l1 : 0;
    }
    var str = 0, spd = 0, smd = 0;
    for (var i2 = 1; i2 <= N; i2++) { str += tr[i2]; spd += pdm[i2]; smd += mdm[i2]; }
    var dxs = [];
    for (var i3 = N; i3 < n; i3++) {
      if (i3 > N) {
        str = str - str / N + tr[i3];
        spd = spd - spd / N + pdm[i3];
        smd = smd - smd / N + mdm[i3];
      }
      var pp = str === 0 ? 0 : spd / str * 100;
      var mm = str === 0 ? 0 : smd / str * 100;
      pdi[i3] = pp; mdi[i3] = mm;
      dxs.push((pp + mm === 0) ? 0 : Math.abs(pp - mm) / (pp + mm) * 100);
    }
    var av = NaN, si = 0;
    for (var i4 = N; i4 < n; i4++) {
      if (i4 < N + N) continue;
      if (isNaN(av)) {
        var sum = 0;
        for (var x2 = 0; x2 < N; x2++) sum += dxs[x2];
        av = sum / N; si = N;
      } else {
        av = (av * (N - 1) + dxs[si]) / N; si++;
      }
      adx[i4] = av;
    }
    return { pdi: pdi, mdi: mdi, adx: adx };
  }
  function CCI(H, L, C, N) {
    var tp = C.map(function (c, i) { return (H[i] + L[i] + c) / 3; });
    var out = new Array(C.length).fill(NaN);
    var ma = MA(tp, N);
    for (var i = N - 1; i < C.length; i++) {
      var md = 0;
      for (var x = i - N + 1; x <= i; x++) md += Math.abs(tp[x] - ma[i]);
      md = md / N;
      if (md > 0) out[i] = (tp[i] - ma[i]) / (0.015 * md);
    }
    return out;
  }
  function WR(H, L, C, N) {
    var out = new Array(C.length).fill(NaN);
    for (var i = N - 1; i < C.length; i++) {
      var hh = -Infinity, ll = Infinity;
      for (var x = i - N + 1; x <= i; x++) { if (H[x] > hh) hh = H[x]; if (L[x] < ll) ll = L[x]; }
      if (hh - ll > 0) out[i] = (hh - C[i]) / (hh - ll) * 100;
    }
    return out;
  }
  function ATR(H, L, C, N) {
    var n = C.length, tr = new Array(n).fill(0);
    for (var i = 1; i < n; i++) tr[i] = Math.max(H[i] - L[i], Math.max(Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])));
    var out = new Array(n).fill(NaN);
    if (n <= N) return out;
    var s = 0;
    for (var i2 = 1; i2 <= N; i2++) s += tr[i2];
    out[N] = s / N;
    for (var i3 = N + 1; i3 < n; i3++) out[i3] = (out[i3 - 1] * (N - 1) + tr[i3]) / N;
    return out;
  }
  function swings(H, L, win) {
    var highs = [], lows = [];
    for (var i = win; i < H.length - win; i++) {
      var isH = true, isL = true;
      for (var x = i - win; x <= i + win; x++) {
        if (x === i) continue;
        if (H[x] >= H[i]) isH = false;
        if (L[x] <= L[i]) isL = false;
      }
      if (isH) highs.push({ i: i, v: H[i] });
      if (isL) lows.push({ i: i, v: L[i] });
    }
    return { highs: highs, lows: lows };
  }

  /* ---------------- 数据抓取 ---------------- */
  async function emResult(report, filter, sort, pageSize, cols) {
    var url = DC + '?reportName=' + report + '&columns=' + (cols || 'ALL') +
      '&filter=' + filter.split('"').join('%22').split('(').join('%28').split(')').join('%29') +
      '&sortColumns=' + (sort || 'REPORT_DATE') + '&sortTypes=-1' +
      '&pageSize=' + (pageSize || 50) + '&pageNumber=1&source=WEB&client=WEB';
    try {
      var r = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } });
      if (!r.ok) return null;
      var j = await r.json();
      return (j && j.result) ? j.result : null;
    } catch (e) { return null; }
  }

  async function rawKline(secid, klt, lmt) {
    var u = P2H + '/api/qt/stock/kline/get?secid=' + secid + '&klt=' + klt + '&fqt=1&lmt=' + lmt +
      '&end=20500101&iscca=1&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61';
    var r = await fetch(u, { headers: { Accept: '*/*' } });
    if (!r.ok) return null;
    var j = await r.json();
    if (!j || !j.data || !j.data.klines) return null;
    var bars = j.data.klines.map(function (s) {
      var a = String(s).split(',');
      return {
        d: a[0], o: num(a[1]), c: num(a[2]), h: num(a[3]), l: num(a[4]),
        v: num(a[5]), amt: num(a[6]), pct: num(a[8]), turn: num(a[10])
      };
    });
    return { name: (j.data.name || ''), bars: bars };
  }

  async function flowBars(secid, lmt) {
    var u = P2H + '/api/qt/stock/fflow/daykline/get?lmt=' + lmt + '&klt=101&secid=' + secid +
      '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63';
    try {
      var r = await fetch(u, { headers: { Accept: '*/*' } });
      if (!r.ok) return null;
      var j = await r.json();
      if (!j || !j.data || !j.data.klines) return null;
      return j.data.klines.map(function (s) {
        var p = String(s).split(',');
        return { d: p[0], main: num(p[1]), small: num(p[2]), mid: num(p[3]), big: num(p[4]), super: num(p[5]) };
      }).filter(function (x) { return isFinite(x.main); });
    } catch (e) { return null; }
  }

  async function idxQuote() {
    var u = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001&fields=f2,f3,f6,f14';
    try {
      var r = await fetch(u, { headers: { Accept: '*/*' } });
      if (!r.ok) return null;
      var j = await r.json();
      var diff = j && j.data && j.data.diff ? j.data.diff : null;
      if (!diff) return null;
      var m = {};
      diff.forEach(function (x) { m[String(x.f14)] = x; });
      return { sh: diff[0], sz: diff[1] };
    } catch (e) { return null; }
  }

  function secidOf(code) { return (/^(6|9)/.test(code) ? '1.' : '0.') + code; }

  function RetOf(A, K) {
    if (A.length <= K) return NaN;
    var p0 = A[A.length - 1 - K], p1 = A[A.length - 1];
    if (!(p0 > 0)) return NaN;
    return (p1 - p0) / p0 * 100;
  }
  function Lin2(X, X0, X1, Y0, Y1) {
    if (!isFinite(X)) return (Y0 + Y1) / 2;
    if (X <= X0) return Y0;
    if (X >= X1) return Y1;
    return Y0 + (Y1 - Y0) * (X - X0) / (X1 - X0);
  }
  function maxOf(a, from, to) { var m = -Infinity; for (var i = from; i <= to; i++) if (a[i] > m) m = a[i]; return m; }
  function minOf(a, from, to) { var m = Infinity; for (var i = from; i <= to; i++) if (a[i] < m) m = a[i]; return m; }
  function avgOf(a, from, to) { var s = 0, c = 0; for (var i = from; i <= to; i++) { s += a[i]; c++; } return c ? s / c : NaN; }

  /* ---------------- 主函数 ---------------- */
  var cache = {};

  async function deep(code, force) {
    if (!force && cache[code] && (Date.now() - cache[code].t) < 15 * 60 * 1000) return cache[code].data;

    var sec = secidOf(code);
    var dayK = await rawKline(sec, '101', 340);
    if (!dayK || dayK.bars.length < 30) throw new Error('K线数据获取失败（代码可能不存在或已停牌）');
    var weekK = await rawKline(sec, '102', 280);
    var monthK = await rawKline(sec, '103', 160);

    var q = null;
    try { q = await root.DataLayer.quote(code); } catch (e) { q = null; }

    var bars = dayK.bars, n = bars.length;
    var C = bars.map(function (b) { return b.c; }), O = bars.map(function (b) { return b.o; });
    var H = bars.map(function (b) { return b.h; }), L = bars.map(function (b) { return b.l; });
    var V = bars.map(function (b) { return b.v; }), AMT = bars.map(function (b) { return b.amt; });
    var PCT = bars.map(function (b) { return b.pct; }), TURN = bars.map(function (b) { return b.turn; });
    var last = n - 1, price = C[last];

    if (!isFinite(TURN[last]) && q && num(q.turnover) > 0) TURN[last] = num(q.turnover);
    if (q && num(q.amount) > 0 && AMT[last] > 0) {
      var qAmt = num(q.amount) * 10000;
      if (Math.abs(qAmt - AMT[last]) / qAmt > 0.25) AMT[last] = qAmt;
    }

    // 均线
    var maDefs = [5, 10, 20, 60, 120, 250];
    var mas = {};
    maDefs.forEach(function (k) { mas[k] = MA(C, k); });
    var maRows = maDefs.map(function (k) {
      var mv = mas[k][last], prev5 = last >= 5 ? mas[k][last - 5] : NaN;
      var slope = (isFinite(mv) && isFinite(prev5) && prev5 !== 0) ? (mv - prev5) / prev5 * 100 : NaN;
      var pos = (isFinite(mv) && mv > 0) ? (price - mv) / mv * 100 : NaN;
      return { n: k, v: Rnd(mv, 2), slope: Rnd(slope, 2), pos: Rnd(pos, 2) };
    });
    var m5 = mas[5][last], m10 = mas[10][last], m20 = mas[20][last], m60 = mas[60][last];
    var order = '数据不足', orderTone = 'info';
    if ([m5, m10, m20, m60].every(isFinite)) {
      if (m5 > m10 && m10 > m20 && m20 > m60) { order = '多头排列'; orderTone = 'good'; }
      else if (m5 < m10 && m10 < m20 && m20 < m60) { order = '空头排列'; orderTone = 'bad'; }
      else { order = '纠缠'; orderTone = 'warn'; }
    }
    var stick = NaN;
    if (isFinite(m5) && isFinite(m20) && price > 0) {
      var vals = [m5, m10, m20].slice().sort(function (a, b) { return a - b; });
      stick = (vals[2] - vals[0]) / price * 100;
    }
    var cross = '', crossTone = 'info';
    for (var i = Math.max(1, last - 9); i <= last; i++) {
      var a0 = mas[5][i - 1], a1 = mas[5][i], b0 = mas[20][i - 1], b1 = mas[20][i];
      if (!isFinite(a0) || !isFinite(b0)) continue;
      if (a0 <= b0 && a1 > b1) { cross = 'MA5 上穿 MA20 金叉'; crossTone = 'good'; }
      if (a0 >= b0 && a1 < b1) { cross = 'MA5 下穿 MA20 死叉'; crossTone = 'bad'; }
    }

    // 周月线状态
    function periodState(K) {
      if (!K || K.bars.length < 30) return { ma20dir: 0, macd: 0, hist: NaN };
      var cc = K.bars.map(function (b) { return b.c; });
      var ma20 = MA(cc, 20), nn = cc.length, dir = 0;
      if (nn >= 6 && isFinite(ma20[nn - 1]) && isFinite(ma20[nn - 6]) && ma20[nn - 6] !== 0) {
        var sl = (ma20[nn - 1] - ma20[nn - 6]) / ma20[nn - 6] * 100;
        dir = sl > 0.5 ? 1 : (sl < -0.5 ? -1 : 0);
      }
      var mac = MACD(cc);
      var hm = mac.hist[nn - 1];
      return { ma20dir: dir, macd: hm > 0 ? 1 : (hm < 0 ? -1 : 0), hist: hm };
    }
    var wState = periodState(weekK), mState = periodState(monthK);
    var dMacd = MACD(C);
    var dState = { ma20dir: 0, macd: dMacd.hist[last] > 0 ? 1 : (dMacd.hist[last] < 0 ? -1 : 0) };
    if (isFinite(m20) && last >= 5) {
      var sl20 = (m20 - mas[20][last - 5]) / mas[20][last - 5] * 100;
      dState.ma20dir = sl20 > 0.5 ? 1 : (sl20 < -0.5 ? -1 : 0);
    }

    // 技术指标
    var difL = dMacd.dif[last], deaL = dMacd.dea[last], histL = dMacd.hist[last];
    var difPrev = last >= 1 ? dMacd.dif[last - 1] : difL, deaPrev = last >= 1 ? dMacd.dea[last - 1] : deaL;
    var macdCross = (difPrev <= deaPrev && difL > deaL) ? '金叉' : ((difPrev >= deaPrev && difL < deaL) ? '死叉' : '无新交叉');
    var boll = BOLL(C, 20), rsi6 = RSI(C, 6), rsi14 = RSI(C, 14);
    var kdj = KDJ(H, L, C, 9), cci = CCI(H, L, C, 14), wr = WR(H, L, C, 14);
    var atr = ATR(H, L, C, 14), dmi = DMI(H, L, C, 14);

    var obv = new Array(n).fill(0);
    for (var i2 = 1; i2 < n; i2++) {
      obv[i2] = obv[i2 - 1];
      if (C[i2] > C[i2 - 1]) obv[i2] += V[i2];
      else if (C[i2] < C[i2 - 1]) obv[i2] -= V[i2];
    }
    var obvSlope = (last >= 10 && obv[last - 10] !== 0) ? (obv[last] - obv[last - 10]) / Math.abs(obv[last - 10]) * 100 : 0;

    var vr = NaN;
    if (last >= 26) {
      var up = 0, dn = 0, fl = 0;
      for (var i3 = last - 25; i3 <= last; i3++) {
        if (i3 < 1) continue;
        if (C[i3] > C[i3 - 1]) up += V[i3];
        else if (C[i3] < C[i3 - 1]) dn += V[i3];
        else fl += V[i3];
      }
      if (dn + fl / 2 > 0) vr = (up + fl / 2) / (dn + fl / 2) * 100;
    }

    // 背离
    var sw = swings(H, L, 5);
    var diverg = '', divTone = 'info';
    var recentHighs = sw.highs.filter(function (x) { return x.i >= last - 60; });
    var recentLows = sw.lows.filter(function (x) { return x.i >= last - 60; });
    if (recentHighs.length >= 2) {
      var h1 = recentHighs[recentHighs.length - 1], h0 = recentHighs[recentHighs.length - 2];
      if (h1.v > h0.v && dMacd.dif[h1.i] < dMacd.dif[h0.i]) { diverg = 'MACD 顶背离（价格新高、DIF 未新高）'; divTone = 'warn'; }
    }
    if (recentLows.length >= 2) {
      var l1 = recentLows[recentLows.length - 1], l0 = recentLows[recentLows.length - 2];
      if (l1.v < l0.v && dMacd.dif[l1.i] > dMacd.dif[l0.i]) {
        diverg = diverg ? (diverg + '；底背离（价格新低、DIF 抬升）') : 'MACD 底背离（价格新低、DIF 抬升）';
        divTone = divTone === 'warn' ? 'warn' : 'good';
      }
    }

    // 价格结构
    var hi60 = maxOf(H, last - 59, last), lo60 = minOf(L, last - 59, last);
    var hi120 = maxOf(H, Math.max(0, last - 119), last), lo120 = minOf(L, Math.max(0, last - 119), last);
    var pos60 = hi60 > lo60 ? (price - lo60) / (hi60 - lo60) * 100 : 50;
    var struct = '数据不足', structTone = 'info';
    if (recentHighs.length >= 2 && recentLows.length >= 2) {
      var hA = recentHighs[recentHighs.length - 2], hB = recentHighs[recentHighs.length - 1];
      var lA = recentLows[recentLows.length - 2], lB = recentLows[recentLows.length - 1];
      var hh = hB.v > hA.v, hl = lB.v > lA.v;
      if (hh && hl) { struct = 'HH/HL 上升结构（高点抬高、低点抬高）'; structTone = 'good'; }
      else if (!hh && !hl) { struct = 'LH/LL 下降结构（高点降低、低点降低）'; structTone = 'bad'; }
      else { struct = '高低点背离（震荡/转折）'; structTone = 'warn'; }
    }
    var box = '', boxTone = 'info';
    if (lo60 > 0 && (hi60 - lo60) / lo60 * 100 < 18) {
      box = '近 60 日在 ' + Rnd(lo60, 2) + '~' + Rnd(hi60, 2) + ' 区间震荡（振幅 ' + Rnd((hi60 - lo60) / lo60 * 100, 1) + '%）';
    }
    var gaps = [];
    for (var i4 = Math.max(1, last - 19); i4 <= last; i4++) {
      if (L[i4] > H[i4 - 1]) gaps.push(bars[i4].d + ' 向上跳空 ' + Rnd(H[i4 - 1], 2) + '~' + Rnd(L[i4], 2));
      if (H[i4] < L[i4 - 1]) gaps.push(bars[i4].d + ' 向下跳空 ' + Rnd(H[i4], 2) + '~' + Rnd(L[i4 - 1], 2));
    }
    var sup = [{ v: Rnd(lo60, 2), t: '60 日低点' }];
    if (recentLows.length) sup.push({ v: Rnd(recentLows[recentLows.length - 1].v, 2), t: '最近摆动低点' });
    sup.push({ v: Rnd(m20, 2), t: 'MA20' });
    sup.push({ v: Rnd(m60, 2), t: 'MA60' });
    var res = [{ v: Rnd(hi60, 2), t: '60 日高点' }];
    if (recentHighs.length) res.push({ v: Rnd(recentHighs[recentHighs.length - 1].v, 2), t: '最近摆动高点' });
    res.push({ v: Rnd(hi120, 2), t: '120 日高点' });

    var hi20prev = last >= 21 ? maxOf(H, last - 20, last - 1) : 0;
    var volMa20 = last >= 20 ? avgOf(V, last - 19, last) : 0;
    var breakout = '', breakTone = 'info';
    if (hi20prev > 0 && C[last] > hi20prev) {
      var vr20 = volMa20 > 0 ? V[last] / volMa20 : 1;
      breakout = (vr20 >= 1.2 ? '放量突破 20 日高点（量比 ' : '缩量突破 20 日高点（量比 ') + Rnd(vr20, 2) + (vr20 >= 1.2 ? '）' : '，有效性存疑）');
      breakTone = vr20 >= 1.2 ? 'good' : 'warn';
    } else if (hi20prev > 0 && C[last] < hi20prev * 0.97) {
      breakout = '距 20 日高点还有 ' + Rnd((hi20prev - C[last]) / C[last] * 100, 1) + '%';
    }

    // 相对强弱（对上证指数）
    var ret5 = RetOf(C, 5), ret20 = RetOf(C, 20), ret60 = RetOf(C, 60);
    var idxK = await rawKline('1.000001', '101', 260);
    var idxRet20 = NaN, idxRet5 = NaN, idxClose = NaN, idxPct = NaN;
    if (idxK && idxK.bars.length > 25) {
      var ib = idxK.bars, ic = ib.map(function (x) { return x.c; });
      idxRet20 = RetOf(ic, 20); idxRet5 = RetOf(ic, 5);
      idxClose = ic[ic.length - 1]; idxPct = ib[ib.length - 1].pct;
    }
    var rs20 = (isFinite(ret20) && isFinite(idxRet20)) ? ret20 - idxRet20 : NaN;

    // 量价
    var volRatio = NaN;
    if (last >= 6) {
      var avg5 = avgOf(V, last - 5, last - 1);
      volRatio = avg5 > 0 ? V[last] / avg5 : NaN;
    }
    var vpToday = '', vpTone = 'info';
    if (isFinite(volRatio)) {
      if (PCT[last] > 0) { vpToday = volRatio >= 1.1 ? '价涨量增（健康）' : '价涨量缩（追高谨慎）'; vpTone = volRatio >= 1.1 ? 'good' : 'warn'; }
      else if (PCT[last] < 0) { vpToday = volRatio >= 1.1 ? '价跌量增（恐慌/出货）' : '价跌量缩（缩量回调，偏良性）'; vpTone = volRatio >= 1.1 ? 'bad' : 'info'; }
      else vpToday = '平盘';
    }
    var vr5 = last >= 9 ? avgOf(V, last - 4, last) / Math.max(1, avgOf(V, last - 9, last - 5)) : NaN;
    var climax = '';
    if (volRatio >= 2.5 && PCT[last] > 5) climax = '天量天价（短期见顶风险）';
    else if (isFinite(volRatio) && volRatio <= 0.55) climax = '地量（成交显著萎缩）';

    // 资金流
    var flow = await flowBars(sec, 120);
    var fund = null, fMain = NaN, f3 = NaN, f5 = NaN, f10 = NaN, f20 = NaN, fSuper = NaN, fBig = NaN, fMid = NaN, fSmall = NaN;
    var streak = 0, inDays = 0, flowSeries = [];
    if (flow && flow.length > 0) {
      var fc = flow.length, fz = flow[fc - 1];
      fMain = fz.main; fSuper = fz.super; fBig = fz.big; fMid = fz.mid; fSmall = fz.small;
      var s3 = 0, s5 = 0, s10 = 0, s20 = 0;
      for (var i5 = 0; i5 < Math.min(20, fc); i5++) {
        var m = flow[fc - 1 - i5].main;
        if (i5 < 3) s3 += m;
        if (i5 < 5) s5 += m;
        if (i5 < 10) s10 += m;
        s20 += m;
        if (m > 0) inDays++;
      }
      f3 = s3; f5 = s5; f10 = s10; f20 = s20;
      for (var i6 = fc - 1; i6 >= 0; i6--) { if (flow[i6].main > 0) streak++; else break; }
      for (var i7 = Math.max(0, fc - 20); i7 < fc; i7++) {
        flowSeries.push({ d: flow[i7].d, v: Rnd(flow[i7].main / 1e8, 2) });
      }
      fund = {
        ok: true,
        today: Rnd(fMain / 1e8, 2), super: Rnd(fSuper / 1e8, 2), big: Rnd(fBig / 1e8, 2),
        mid: Rnd(fMid / 1e8, 2), small: Rnd(fSmall / 1e8, 2),
        d3: Rnd(f3 / 1e8, 2), d5: Rnd(f5 / 1e8, 2), d10: Rnd(f10 / 1e8, 2), d20: Rnd(f20 / 1e8, 2),
        streak: streak, inDays: inDays, series: flowSeries
      };
    }

    // 筹码估算
    var avgCost = NaN, profit = NaN;
    var span = Math.min(120, n);
    if (span >= 20) {
      var sumAmt = 0, sumVol = 0;
      for (var i8 = n - span; i8 < n; i8++) { sumAmt += AMT[i8]; sumVol += V[i8]; }
      if (sumVol > 0) avgCost = sumAmt / (sumVol * 100);
      var bins = 40, loAll = minOf(L, n - span, last), hiAll = maxOf(H, n - span, last);
      if (hiAll > loAll) {
        var w = (hiAll - loAll) / bins, hist = new Array(bins).fill(0);
        for (var i9 = n - span; i9 < n; i9++) {
          var midp = (H[i9] + L[i9]) / 2;
          var bi = Math.floor((midp - loAll) / w);
          if (bi < 0) bi = 0; if (bi >= bins) bi = bins - 1;
          hist[bi] += V[i9];
        }
        var tot = 0, below = 0;
        for (var i10 = 0; i10 < bins; i10++) {
          tot += hist[i10];
          if (loAll + w * (i10 + 0.5) <= price) below += hist[i10];
        }
        if (tot > 0) profit = below / tot * 100;
      }
    }

    // 报表：板块 / 龙虎榜 / 北向 / 两融 / 股东 / 增减持 / 解禁 / 大宗 / 行业资金
    var today = new Date();
    function ymdAgo(days) {
      var d = new Date(today.getTime() - days * 86400000);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    var vRes = await emResult('RPT_VALUEANALYSIS_DET', '(SECURITY_CODE="' + code + '")', 'TRADE_DATE', 1, 'SECURITY_CODE,BOARD_NAME,PE_TTM,PB_MRQ,TOTAL_MARKET_CAP');
    var boardName = '', vCapYi = 0;
    if (vRes && vRes.data && vRes.data.length) {
      boardName = String(vRes.data[0].BOARD_NAME || '');
      vCapYi = num(vRes.data[0].TOTAL_MARKET_CAP) / 1e8;
    }
    var since6 = ymdAgo(180);
    var lhbRes = await emResult('RPT_DAILYBILLBOARD_DETAILSNEW', '(SECURITY_CODE="' + code + '")(TRADE_DATE>=\'' + since6 + '\')', 'TRADE_DATE', 30, 'TRADE_DATE,EXPLANATION,BILLBOARD_NET_AMT,CHANGE_RATE,BUY_SEAT');
    var lhbList = [], lhbCount = 0, lhbJg = 0;
    if (lhbRes && lhbRes.data) {
      lhbCount = lhbRes.data.length;
      lhbRes.data.forEach(function (x) {
        if (String(x.BUY_SEAT || '').indexOf('机构专用') >= 0) lhbJg++;
        lhbList.push({ d: String(x.TRADE_DATE).slice(0, 10), pct: Rnd(x.CHANGE_RATE, 2), net: Rnd(num(x.BILLBOARD_NET_AMT) / 1e8, 2), reason: String(x.EXPLANATION || '') });
      });
    }
    var northRes = await emResult('RPT_MUTUAL_HOLDSTOCKNORTH_STA', '(SECURITY_CODE="' + code + '")', 'TRADE_DATE', 25, 'TRADE_DATE,HOLD_SHARES,HOLD_MARKET_CAP,HOLD_SHARES_RATIO,FREE_SHARES_RATIO');
    var north = null;
    if (northRes && northRes.data && northRes.data.length) {
      var nr = northRes.data, n0 = nr[0];
      var sh0 = num(n0.HOLD_SHARES), sh5 = nr.length > 5 ? num(nr[5].HOLD_SHARES) : NaN, sh20 = nr.length > 20 ? num(nr[20].HOLD_SHARES) : NaN;
      north = {
        date: String(n0.TRADE_DATE).slice(0, 10), shares: Rnd(sh0 / 1e4, 2), mv: Rnd(num(n0.HOLD_MARKET_CAP) / 1e8, 2),
        ratio: Rnd(num(n0.HOLD_SHARES_RATIO), 2), freeRatio: Rnd(num(n0.FREE_SHARES_RATIO), 2),
        chg5: Rnd((sh0 - sh5) / 1e4, 2), chg20: Rnd((sh0 - sh20) / 1e4, 2), has: true
      };
    }
    var mrgRes = await emResult('RPTA_WEB_RZRQ_GGMX', '(SCODE="' + code + '")', 'DATE', 30, 'DATE,RZYE,RZMRE,RQYE,RZRQYE');
    var margin = null;
    if (mrgRes && mrgRes.data && mrgRes.data.length) {
      var mr = mrgRes.data, m0 = mr[0];
      var mcap = (q && num(q.marketCap) > 0) ? num(q.marketCap) * 1e8 : 0;
      var rzye = num(m0.RZYE), rzmre = num(m0.RZMRE), rqye = num(m0.RQYE);
      var amtToday = AMT[last];
      var prev5 = mr.length > 5 ? num(mr[5].RZYE) : NaN, prev20 = mr.length > 20 ? num(mr[20].RZYE) : NaN;
      margin = {
        date: String(m0.DATE).slice(0, 10), rzye: Rnd(rzye / 1e8, 2), rzmre: Rnd(rzmre / 1e8, 2),
        rzmreRatio: Rnd(amtToday > 0 ? rzmre / amtToday * 100 : NaN, 2), rqye: Rnd(rqye / 1e8, 2),
        net: Rnd((rzye - rqye) / 1e8, 2), ratio: Rnd(vCapYi > 0 ? (rzye / 1e8) / vCapYi * 100 : NaN, 2),
        chg5: Rnd((rzye - prev5) / 1e8, 2), chg20: Rnd((rzye - prev20) / 1e8, 2)
      };
    }
    var holdRes = await emResult('RPT_HOLDERNUMLATEST', '(SECURITY_CODE="' + code + '")', 'END_DATE', 6, 'END_DATE,HOLDER_NUM,PRE_HOLDER_NUM,HOLDER_NUM_CHANGE,HOLDER_NUM_RATIO,AVG_MARKET_CAP');
    var holders = null;
    if (holdRes && holdRes.data && holdRes.data.length) {
      var hr = holdRes.data, h0 = hr[0];
      holders = {
        date: String(h0.END_DATE).slice(0, 10), num: Rnd(num(h0.HOLDER_NUM), 0), chg: Rnd(num(h0.HOLDER_NUM_CHANGE), 0),
        ratio: Rnd(num(h0.HOLDER_NUM_RATIO), 2), avgCap: Rnd(num(h0.AVG_MARKET_CAP) / 1e4, 2),
        series: hr.map(function (x) { return { d: String(x.END_DATE).slice(0, 10), n: Rnd(num(x.HOLDER_NUM), 0) }; })
      };
    }
    var chgRes = await emResult('RPT_SHARE_HOLDER_INCREASE', '(SECURITY_CODE="' + code + '")(NOTICE_DATE>=\'' + ymdAgo(365) + '\')', 'NOTICE_DATE', 20, 'NOTICE_DATE,HOLDER_NAME,DIRECTION,CHANGE_NUM,CHANGE_RATE');
    var changes = [], chgNet = 0;
    if (chgRes && chgRes.data) {
      chgRes.data.forEach(function (x) {
        var dir = String(x.DIRECTION || ''), n2 = num(x.CHANGE_NUM);
        chgNet += (/减/.test(dir) ? -1 : 1) * n2;
        changes.push({ d: String(x.NOTICE_DATE).slice(0, 10), holder: String(x.HOLDER_NAME || ''), dir: dir, shares: Rnd(n2 / 1e4, 2), pct: Rnd(num(x.CHANGE_RATE), 3) });
      });
    }
    var liftRes = await emResult('RPT_LIFT_STAGE', '(SECURITY_CODE="' + code + '")', 'FREE_DATE', 20, 'FREE_DATE,LIFT_MARKET_CAP,FREE_RATIO,FREE_SHARES_TYPE');
    var lifts = [], liftSoon = 0;
    if (liftRes && liftRes.data) {
      liftRes.data.forEach(function (x) {
        var fd = String(x.FREE_DATE || '');
        if (fd.length < 10) return;
        var dt = new Date(fd.slice(0, 10) + 'T00:00:00');
        var days = Math.round((dt - today) / 86400000);
        if (days < -30 || days > 400) return;
        var cap = num(x.LIFT_MARKET_CAP);
        if (days >= 0 && days <= 90) liftSoon += cap;
        lifts.push({ d: fd.slice(0, 10), days: days, cap: Rnd(cap / 1e8, 2), ratio: Rnd(num(x.FREE_RATIO), 2), type: String(x.FREE_SHARES_TYPE || '') });
      });
    }
    var blkRes = await emResult('RPT_DATA_BLOCKTRADE', '(SECURITY_CODE="' + code + '")(TRADE_DATE>=\'' + ymdAgo(120) + '\')', 'TRADE_DATE', 20, 'TRADE_DATE,DEAL_PRICE,PREMIUM_RATIO,DEAL_AMT,BUYER_NAME');
    var blocks = [], blkAmt = 0, blkPrem = 0, blkCnt = 0;
    if (blkRes && blkRes.data) {
      blkRes.data.forEach(function (x) {
        blkCnt++; blkAmt += num(x.DEAL_AMT); blkPrem += num(x.PREMIUM_RATIO);
        blocks.push({ d: String(x.TRADE_DATE).slice(0, 10), price: Rnd(num(x.DEAL_PRICE), 2), prem: Rnd(num(x.PREMIUM_RATIO), 2), amt: Rnd(num(x.DEAL_AMT) / 1e8, 2), buyer: String(x.BUYER_NAME || '') });
      });
    }
    var indFlow = null;
    if (boardName) {
      var ifRes = await emResult('RPT_INDUSTRY_FUNDFLOW', '(BOARD_NAME="' + boardName + '")', 'TRADE_DATE', 6, 'BOARD_NAME,TRADE_DATE,CHANGE_RATE,NET_INFLOW,NET_INFLOW_RATIO,SUPERDEAL_NET');
      if (ifRes && ifRes.data && ifRes.data.length) {
        var i0 = ifRes.data[0];
        indFlow = {
          board: String(i0.BOARD_NAME || ''), date: String(i0.TRADE_DATE).slice(0, 10), pct: Rnd(num(i0.CHANGE_RATE), 2),
          net: Rnd(num(i0.NET_INFLOW) / 1e8, 2), ratio: Rnd(num(i0.NET_INFLOW_RATIO), 2), superNet: Rnd(num(i0.SUPERDEAL_NET) / 1e8, 2)
        };
      }
    }
    var iq = await idxQuote();

    // 打分
    var trendScore = 0;
    trendScore += (order === '多头排列') ? 14 : (order === '纠缠' ? 6 : 0);
    trendScore += (isFinite(m20) && price > m20) ? 8 : 0;
    trendScore += (isFinite(m60) && price > m60) ? 4 : 0;
    trendScore += (crossTone === 'good') ? 4 : 0;
    var structScore = Lin2(pos60, 0, 100, 0, 20);
    var indScore = 0;
    indScore += dMacd.hist[last] > 0 ? 6 : 0;
    indScore += (difL > 0 && deaL > 0) ? 4 : 0;
    indScore += (isFinite(rsi14[last]) && rsi14[last] > 50) ? 4 : 0;
    indScore += (kdj.k[last] > kdj.d[last]) ? 3 : 0;
    indScore += (isFinite(dmi.adx[last]) && dmi.adx[last] > 20 && dmi.pdi[last] > dmi.mdi[last]) ? 3 : 0;
    var vpScore = Lin2(vr5, 0.6, 1.6, 0, 15);
    var rsScore = Lin2(rs20, -10, 10, 0, 15);
    var techScore = banker(trendScore + structScore + indScore + vpScore + rsScore, 1);
    techScore = Math.max(0, Math.min(100, techScore));

    var fLiq = Lin2(vr5, 0.6, 2.0, 0, 8) + Lin2(isFinite(TURN[last]) ? TURN[last] : 0, 0.5, 8, 0, 7);
    var fMainS = 0;
    if (isFinite(fMain)) {
      fMainS += Lin2(fMain / 1e8, -2, 2, 0, 10);
      fMainS += Lin2(f5 / 1e8, -5, 5, 0, 10);
      fMainS += Lin2(f20 / 1e8, -10, 10, 0, 10);
      fMainS += streak >= 3 ? 5 : (streak >= 1 ? 2 : 0);
    }
    var northS = 0;
    if (north) { northS += Lin2(num(north.chg5), -300, 300, 0, 8); northS += Lin2(num(north.chg20), -800, 800, 0, 7); }
    var levS = 0;
    if (margin) { levS += Lin2(num(margin.chg5), -2, 2, 0, 8); levS += Lin2(num(margin.chg20), -4, 4, 0, 7); }
    var behS = 0;
    behS += (lhbCount > 0 && chgNet > 0) ? 6 : (chgNet > 0 ? 4 : 2);
    behS += chgNet > 0 ? 5 : 0;
    behS += liftSoon <= 0 ? 4 : 0;
    var envS = 0;
    if (indFlow) envS += Lin2(num(indFlow.net), -8, 8, 0, 10);
    var fundScore = banker(fLiq + fMainS + northS + levS + behS + envS, 1);
    fundScore = Math.max(0, Math.min(100, fundScore));

    var name = dayK.name || (q && q.name) || code;

    var out = {
      ok: true, code: code, name: name, board: boardName,
      price: Rnd(price, 2), pct: Rnd(PCT[last], 2), asOf: bars[last].d,
      scores: {
        tech: techScore, fund: fundScore, total: banker(0.5 * techScore + 0.5 * fundScore, 1),
        trend: Math.round(trendScore), structure: Math.round(structScore), indicator: Math.round(indScore),
        volprice: Math.round(vpScore), rs: Math.round(rsScore), liquidity: Math.round(fLiq),
        mainflow: Math.round(fMainS), north: Math.round(northS), leverage: Math.round(levS),
        behavior: Math.round(behS), env: Math.round(envS)
      },
      tech: {
        ma: { rows: maRows, order: order, orderTone: orderTone, cross: cross, crossTone: crossTone, stick: Rnd(stick, 2) },
        multi: {
          month: { ma20dir: mState.ma20dir, macd: mState.macd, hist: Rnd(mState.hist, 3) },
          week: { ma20dir: wState.ma20dir, macd: wState.macd, hist: Rnd(wState.hist, 3) },
          day: { ma20dir: dState.ma20dir, macd: dState.macd, hist: Rnd(histL, 3) },
          h60: null
        },
        structure: {
          hi60: Rnd(hi60, 2), lo60: Rnd(lo60, 2), hi120: Rnd(hi120, 2), lo120: Rnd(lo120, 2), pos60: Rnd(pos60, 1),
          pattern: struct, patternTone: structTone, box: box, boxTone: boxTone, gaps: gaps, sup: sup, res: res,
          breakout: breakout, breakTone: breakTone
        },
        indicators: {
          macd: { dif: Rnd(difL, 3), dea: Rnd(deaL, 3), hist: Rnd(histL, 3), cross: macdCross, zero: difL > 0 ? '零轴上方' : '零轴下方', div: diverg, divTone: divTone },
          boll: {
            mid: Rnd(boll.mid[last], 2), up: Rnd(boll.up[last], 2), low: Rnd(boll.low[last], 2), width: Rnd(boll.width[last], 2),
            pctB: Rnd((boll.up[last] - boll.low[last] > 0) ? (price - boll.low[last]) / (boll.up[last] - boll.low[last]) * 100 : NaN, 1)
          },
          rsi: { r6: Rnd(rsi6[last], 1), r14: Rnd(rsi14[last], 1) },
          kdj: { k: Rnd(kdj.k[last], 1), d: Rnd(kdj.d[last], 1), j: Rnd(kdj.j[last], 1) },
          cci: Rnd(cci[last], 1), wr: Rnd(wr[last], 1),
          atr: { v: Rnd(atr[last], 2), pct: Rnd(price > 0 ? atr[last] / price * 100 : NaN, 2) },
          dmi: { pdi: Rnd(dmi.pdi[last], 1), mdi: Rnd(dmi.mdi[last], 1), adx: Rnd(dmi.adx[last], 1) },
          obv: { slope: Rnd(obvSlope, 1) },
          vr: Rnd(vr, 1)
        },
        volprice: {
          volRatio: Rnd(volRatio, 2), today: vpToday, tone: vpTone, vr5: Rnd(vr5, 2), climax: climax,
          volMa20: Rnd(volMa20 / 1e4, 1), volToday: Rnd(V[last] / 1e4, 1)
        },
        rs: { r5: Rnd(ret5, 2), r20: Rnd(ret20, 2), r60: Rnd(ret60, 2), i5: Rnd(idxRet5, 2), i20: Rnd(idxRet20, 2), rs20: Rnd(rs20, 2) }
      },
      fund: {
        liquidity: {
          amount: Rnd(AMT[last] / 1e8, 2), volume: Rnd(V[last] / 1e4, 1), turnover: Rnd(TURN[last], 2),
          volRatio: Rnd(volRatio, 2),
          amtPct: Rnd((function () {
            if (last < 60) return NaN;
            var cnt = 0;
            for (var i = last - 59; i <= last; i++) if (AMT[i] < AMT[last]) cnt++;
            return cnt / 60 * 100;
          })(), 1)
        },
        mainflow: fund, north: north, margin: margin,
        behavior: { lhbCount: lhbCount, lhbJg: lhbJg, lhb: lhbList, holders: holders, changes: changes, chgNet: Rnd(chgNet / 1e4, 2), lifts: lifts, liftSoon: Rnd(liftSoon / 1e8, 2) },
        cost: { avgCost: Rnd(avgCost, 2), profit: Rnd(profit, 1), price: Rnd(price, 2), blocks: blocks, blkCnt: blkCnt, blkAmt: Rnd(blkAmt / 1e8, 2), blkPrem: Rnd(blkCnt > 0 ? blkPrem / blkCnt : NaN, 2) },
        env: {
          industry: indFlow,
          index: {
            close: Rnd(iq && iq.sh ? num(iq.sh.f2) : idxClose, 2),
            pct: Rnd(iq && iq.sh ? num(iq.sh.f3) : idxPct, 2),
            amount: Rnd(iq && iq.sh ? num(iq.sh.f6) / 1e8 : NaN, 0),
            amount2: Rnd(iq && iq.sz ? num(iq.sz.f6) / 1e8 : NaN, 0),
            amount20: null
          }
        }
      },
      series: {
        k: (function () {
          var arr = [];
          for (var i = Math.max(0, last - 119); i <= last; i++) arr.push({ d: bars[i].d, c: Rnd(C[i], 2), v: Rnd(V[i] / 1e4, 1) });
          return arr;
        })()
      }
    };

    cache[code] = { t: Date.now(), data: out };
    return out;
  }

  root.DeepLayer = { deep: deep };
})(typeof window !== 'undefined' ? window : globalThis);
