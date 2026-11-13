/* ============================================================
   五层基本面分析 · 网页版前端
   数据来自 /api/analyze（东方财富数据中心，实时联网）
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function nf(v, d) { d = d === undefined ? 2 : d; return isNum(v) ? v.toFixed(d) : '—'; }
  function pf(v, d) { d = d === undefined ? 2 : d; return isNum(v) ? v.toFixed(d) + '%' : '—'; }
  function spf(v, d) {
    d = d === undefined ? 2 : d;
    if (!isNum(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(d) + '%';
  }
  function money(v) { return isNum(v) ? v.toFixed(2) + ' 亿' : '—'; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function lamp(tone, text) {
    return '<span class="lamp ' + (tone || 'muted') + '"><i></i>' + esc(text) + '</span>';
  }
  function lampWord(tone) {
    return { good: '绿灯', warn: '黄灯', bad: '红灯', info: '中性', muted: '—' }[tone] || '—';
  }
  function toneOfRating(r) {
    if (!r) return 'muted';
    if (r.indexOf('A') === 0) return 'good';
    if (r.indexOf('B') === 0) return 'info';
    if (r.indexOf('C') === 0) return 'warn';
    if (r.indexOf('D') === 0) return 'bad';
    return 'muted';
  }
  function toneOfScore(s) {
    if (!isNum(s)) return 'muted';
    if (s >= 75) return 'good';
    if (s >= 55) return 'info';
    if (s >= 40) return 'warn';
    return 'bad';
  }
  function verdictTone(v) {
    if (v === '通过') return 'good';
    if (v === '警告') return 'warn';
    if (v === '淘汰') return 'bad';
    return 'info';
  }
  function richify(text) {
    var s = esc(text);
    s = s.replace(/→/g, '<span class="arrow">→</span>');
    s = s.replace(/([-+]?\d+(?:\.\d+)?%)/g, '<b>$1</b>');
    s = s.replace(/([-+]?\d+(?:\.\d+)?\s?亿)/g, '<b>$1</b>');
    return s;
  }

  /* ---------------- 网络 ---------------- */
  function fetchJSON(url) {
    return fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      return r.text().then(function (t) {
        var j;
        try { j = JSON.parse(t); } catch (e) { throw new Error('返回内容无法解析（' + r.status + '）'); }
        if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  var FILE_MODE = location.protocol === 'file:';
  // 手机独立版：数据全部由 js/shim.js 在本地接管，file:// 打开也无需后端服务
  var STANDALONE = !!(window.STANDALONE_MODE && window.ScoreEngine);
  var API = '';   // file:// 打开时指向本机服务，例如 http://localhost:5218

  var state = {
    code: null, data: null, quote: null, req: 0,
    theme: 'light', history: [], quoteTimer: null, watchCodes: {}, kline: null
  };
  var kline = { code: '', period: 'day', data: null, daily: null, req: 0, loading: false };
  try { state.theme = localStorage.getItem('wf5_theme') || 'light'; } catch (e) {}

  /* ---------------- 图表引擎 ---------------- */
  var CH = { jobs: [], palette: null };

  function pal() {
    var cs = getComputedStyle(document.documentElement);
    var g = function (n) { return cs.getPropertyValue(n).trim() || '#888'; };
    return {
      ink: g('--ink'), ink2: g('--ink-2'), ink3: g('--ink-3'), ink4: g('--ink-4'),
      line: g('--line'), line2: g('--line-2'), panel: g('--panel'),
      good: g('--good'), warn: g('--warn'), bad: g('--bad'), brand: g('--brand'),
      muted: g('--muted'), up: g('--up'), down: g('--down')
    };
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) e.setAttribute(k, attrs[k]);
    return e;
  }

  function niceScale(min, max, count) {
    if (!isNum(min) || !isNum(max)) { min = 0; max = 1; }
    if (min === max) { min = min - 1; max = max + 1; }
    var raw = (max - min) / count;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step;
    if (norm <= 1) step = 1; else if (norm <= 2) step = 2;
    else if (norm <= 2.5) step = 2.5; else if (norm <= 5) step = 5; else step = 10;
    step *= mag;
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { lo: lo, hi: hi, ticks: ticks };
  }

  function segPath(pts) {
    var d = '', open = false;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p) { open = false; continue; }
      d += (open ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ' ';
      open = true;
    }
    return d.trim();
  }

  function drawChart(host, spec) {
    if (!host || !spec) return;
    var C = CH.palette || pal();
    $$('svg, .legend', host).forEach(function (n) { n.remove(); });

    var pad = { l: 44, r: 14, t: 14, b: 26 };
    var w = Math.max(240, host.clientWidth - 24);
    var h = spec.h || 210;
    var labels = spec.labels || [];
    var series = (spec.series || []).filter(function (s) { return s && s.values; });
    var n = labels.length;
    var svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, width: '100%', height: h, role: 'img' });

    /* ---- 横向条形（行业对比） ---- */
    if (spec.type === 'hbar') {
      var items = spec.items || [];
      var maxV = 1;
      items.forEach(function (it) { if (isNum(it.value) && it.value > maxV) maxV = it.value; });
      var labelW = spec.labelW || 96;
      var x0 = labelW + 10, x1 = w - 48;
      var rowH = Math.min(26, (h - 8) / Math.max(1, items.length));
      items.forEach(function (it, i) {
        var y = 4 + i * rowH;
        var bw = Math.max(2, (Math.max(0, it.value) / maxV) * (x1 - x0));
        var col = it.highlight ? C.brand : C.ink4;
        var tx = svgEl('text', { x: labelW, y: y + rowH * 0.7, 'text-anchor': 'end', 'font-size': 10.5, fill: it.highlight ? C.ink : C.ink2 });
        tx.textContent = it.label;
        var rect = svgEl('rect', { x: x0, y: y + rowH * 0.18, width: bw, height: Math.max(3, rowH * 0.56), rx: 3, fill: col, opacity: it.highlight ? 0.9 : 0.45 });
        var tt = svgEl('title'); tt.textContent = it.label + '：' + (it.text || nf(it.value, 2)); rect.appendChild(tt);
        var vt = svgEl('text', { x: x0 + bw + 6, y: y + rowH * 0.7, 'font-size': 10.5, fill: it.highlight ? C.ink : C.ink3 });
        vt.textContent = it.display != null ? it.display : nf(it.value, 1);
        svg.appendChild(tx); svg.appendChild(rect); svg.appendChild(vt);
      });
      host.appendChild(svg);
      return;
    }

    /* ---- 通用坐标系 ---- */
    var plotW = w - pad.l - pad.r;
    var plotH = h - pad.t - pad.b;
    var band = {
      width: plotW / Math.max(1, n),
      center: function (i) { return pad.l + this.width * (i + 0.5); }
    };

    var vals = [];
    series.forEach(function (s) {
      s.values.forEach(function (v) { if (isNum(v)) vals.push(v); });
    });
    if (spec.baselineZero) vals.push(0);
    (spec.refs || []).forEach(function (r) { if (isNum(r.v)) vals.push(r.v); });
    if (!vals.length) vals = [0, 1];
    var vmin = Math.min.apply(null, vals), vmax = Math.max.apply(null, vals);
    if (spec.yMin != null) vmin = Math.min(vmin, spec.yMin);
    if (spec.yMax != null) vmax = Math.max(vmax, spec.yMax);
    var sc = niceScale(vmin, vmax, spec.yTicks || 4);
    var yScale = function (v) { return pad.t + plotH - ((v - sc.lo) / (sc.hi - sc.lo)) * plotH; };

    // 网格与 y 轴
    sc.ticks.forEach(function (t) {
      var y = yScale(t);
      svg.appendChild(svgEl('line', {
        x1: pad.l, x2: w - pad.r, y1: y, y2: y,
        stroke: t === 0 ? C.ink4 : C.line2, 'stroke-width': 1,
        'stroke-dasharray': t === 0 ? '' : '3 4', opacity: t === 0 ? 0.5 : 1
      }));
      var tx = svgEl('text', { x: pad.l - 7, y: y + 3.5, 'text-anchor': 'end', 'font-size': 10, fill: C.ink4 });
      tx.textContent = spec.yFmt ? spec.yFmt(t) : nf(t, Math.abs(t) < 10 ? 1 : 0);
      svg.appendChild(tx);
    });

    // x 轴标签
    var step = n > 10 ? Math.ceil(n / 8) : 1;
    labels.forEach(function (lb, i) {
      if (i % step !== 0 && i !== n - 1) return;
      var tx = svgEl('text', { x: band.center(i), y: h - 8, 'text-anchor': 'middle', 'font-size': 10, fill: C.ink4 });
      tx.textContent = lb;
      svg.appendChild(tx);
    });

    // 分位参考线
    (spec.refs || []).forEach(function (r) {
      if (!isNum(r.v)) return;
      var y = yScale(r.v);
      svg.appendChild(svgEl('line', {
        x1: pad.l, x2: w - pad.r, y1: y, y2: y,
        stroke: r.color || C.warn, 'stroke-width': 1.1, 'stroke-dasharray': '5 4', opacity: 0.75
      }));
    });
    // 参考线标签：按纵坐标排序后强制最小间距，避免相互压住
    var labs = (spec.refs || []).filter(function (r) { return isNum(r.v) && r.label; })
      .map(function (r) { return { r: r, y: yScale(r.v) - 4 }; })
      .sort(function (a, b) { return a.y - b.y; });
    var lastY = -99;
    labs.forEach(function (o) {
      var yy = Math.max(o.y, lastY + 11);
      yy = Math.min(yy, h - pad.b - 2);
      lastY = yy;
      var tl = svgEl('text', { x: w - pad.r - 2, y: yy, 'text-anchor': 'end', 'font-size': 9.5, fill: o.r.color || C.warn, stroke: C.panel, 'stroke-width': 3, 'paint-order': 'stroke' });
      tl.textContent = o.r.label;
      svg.appendChild(tl);
    });

    // 柱
    var bars = series.filter(function (s) { return s.type === 'bar'; });
    var bn = bars.length || 1;
    bars.forEach(function (s, si) {
      var bandW = band.width * (spec.barWidth || 0.62);
      var bw = bn > 1 ? bandW / bn : bandW;
      s.values.forEach(function (v, i) {
        if (!isNum(v)) return;
        var y0 = yScale(0), y1 = yScale(v);
        var x = band.center(i) - (bn > 1 ? bandW / 2 : bw / 2) + si * bw + (bn > 1 ? 0.8 : 0);
        var rect = svgEl('rect', {
          x: x, y: Math.min(y0, y1), width: Math.max(1.5, bw - 1.6), height: Math.max(1, Math.abs(y1 - y0)),
          rx: Math.min(3, bw / 3), fill: s.color || C.brand, opacity: s.opacity || 0.85
        });
        var tt = svgEl('title');
        tt.textContent = labels[i] + ' ' + (s.name || '') + '：' + (spec.tipFmt ? spec.tipFmt(v) : nf(v, 2));
        rect.appendChild(tt);
        svg.appendChild(rect);
        if (spec.showValues) {
          var vt = svgEl('text', {
            x: x + (bw - 1.6) / 2, y: (v >= 0 ? y1 : y0) - 4,
            'text-anchor': 'middle', 'font-size': 9.5, fill: C.ink3
          });
          vt.textContent = spec.valFmt ? spec.valFmt(v) : nf(v, 1);
          svg.appendChild(vt);
        }
      });
    });

    // 线 / 面积
    series.filter(function (s) { return s.type !== 'bar'; }).forEach(function (s) {
      var pts = [];
      for (var i = 0; i < n; i++) {
        var v = s.values[i];
        pts.push(isNum(v) ? { x: band.center(i), y: yScale(v), v: v, i: i } : null);
      }
      if (s.area) {
        var segs = [], cur = [];
        pts.forEach(function (p) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
        if (cur.length) segs.push(cur);
        segs.forEach(function (seg) {
          if (seg.length < 2) return;
          var d = 'M' + seg[0].x.toFixed(1) + ' ' + yScale(Math.max(sc.lo, 0));
          seg.forEach(function (p) { d += 'L' + p.x.toFixed(1) + ' ' + p.y.toFixed(1); });
          d += 'L' + seg[seg.length - 1].x.toFixed(1) + ' ' + yScale(Math.max(sc.lo, 0)) + 'Z';
          svg.appendChild(svgEl('path', { d: d, fill: s.color || C.brand, opacity: 0.12 }));
        });
      }
      svg.appendChild(svgEl('path', {
        d: segPath(pts), fill: 'none', stroke: s.color || C.brand,
        'stroke-width': s.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'stroke-dasharray': s.dash || ''
      }));
      if (s.dots !== false && n <= 24) {
        pts.forEach(function (p) {
          if (!p) return;
          var c = svgEl('circle', { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 2.6, fill: C.panel, stroke: s.color || C.brand, 'stroke-width': 1.6 });
          var tt = svgEl('title');
          tt.textContent = labels[p.i] + ' ' + (s.name || '') + '：' + (spec.tipFmt ? spec.tipFmt(p.v) : nf(p.v, 2));
          c.appendChild(tt);
          svg.appendChild(c);
        });
      }
    });

    svg.appendChild(svgEl('line', { x1: pad.l, x2: w - pad.r, y1: pad.t + plotH, y2: pad.t + plotH, stroke: C.line, 'stroke-width': 1 }));
    host.appendChild(svg);

    var named = series.filter(function (s) { return s.name; });
    if (named.length > 1) {
      var lg = document.createElement('div');
      lg.className = 'legend';
      lg.innerHTML = named.map(function (s) {
        return '<span><i style="background:' + (s.color || '#888') + '"></i>' + esc(s.name) + '</span>';
      }).join('');
      host.appendChild(lg);
    }
  }

  function chart(host, spec) {
    if (!host) return;
    CH.jobs.push({ host: host, spec: spec });
    drawChart(host, spec);
  }

  /* ---------------- K 线 + 高抛低吸 ---------------- */
  function priceLimitPct(code, name) {
    var p = 9.8;
    var c = String(code || '');
    if (/^(30|68)/.test(c)) p = 19.5;
    else if (/^(4|8|92)/.test(c)) p = 29.5;
    if (/ST/i.test(String(name || ''))) p = 4.8;
    return p;
  }

  function periodLabel(p) {
    return p === 'week' ? '周K' : p === 'month' ? '月K' : '日K';
  }

  function klineHTML() {
    var p = kline.period || 'day';
    function tab(k, label) {
      return '<button type="button" class="kline-tab' + (p === k ? ' on' : '') + '" data-kperiod="' + k + '">' + label + '</button>';
    }
    return '<section class="card kline-card" id="sec-kline">' +
      '<div class="kline-head"><div>' +
        '<h3>K 线走势 <span class="tag" id="klineTag">' + periodLabel(p) + '</span></h3>' +
        '<span class="sub" id="klineMeta">前复权 · 正在加载…</span>' +
      '</div><div class="kline-tabs">' +
        tab('day', '日K') + tab('week', '周K') + tab('month', '月K') +
        '<button type="button" class="ghost kline-refresh" id="klineRefresh">刷新</button>' +
      '</div></div>' +
      '<div class="kline-legend" id="klineLegend"></div>' +
      '<div class="kline-wrap" id="klineChart"><div class="nload">加载 K 线…</div></div>' +
      '<p class="kline-note muted">前复权。MA5 / MA10 / MA20 / MA60 为算术均线；鼠标或手指按住图表可查看单根 K 线的开高低收与成交量。</p>' +
      '</section>';
  }

  function tipsHTML() {
    return '<section class="card tips-card" id="sec-tips">' +
      '<div class="tips-head"><div><h3>实时高抛低吸参考</h3>' +
      '<span class="sub" id="tipsMeta">按日内高低位机械计算，不构成投资建议</span></div>' +
      '<div class="tips-th" id="tipsTh"></div></div>' +
      '<div id="tipsBody"><div class="nload">等待实时行情…</div></div>' +
      '</section>';
  }

  function fmtQuoteTime(t) {
    t = String(t || '');
    if (t.length >= 14) return t.slice(8, 10) + ':' + t.slice(10, 12) + ':' + t.slice(12, 14);
    if (t.length >= 12) return t.slice(8, 10) + ':' + t.slice(10, 12);
    return '';
  }

  function lastNum(arr) {
    if (!arr || !arr.length) return null;
    for (var i = arr.length - 1; i >= 0; i--) if (isNum(arr[i])) return arr[i];
    return null;
  }

  function tradeTipsCalc(q, k) {
    var s = watch.settings || {};
    var thHigh = isNum(s.highPct) ? s.highPct : 1;
    var thLow = isNum(s.lowPct) ? s.lowPct : 1;
    var tipsOn = s.tipsOn !== false;
    var price = q && q.ok && isNum(q.price) ? q.price : (state.data && isNum(state.data.price) ? state.data.price : null);
    var high = q && q.ok && isNum(q.high) ? q.high : null;
    var low = q && q.ok && isNum(q.low) ? q.low : null;
    var prev = q && q.ok && isNum(q.prevClose) ? q.prevClose : null;
    var pct = q && q.ok && isNum(q.changePct) ? q.changePct : (state.data && isNum(state.data.pct) ? state.data.pct : null);
    var amp = q && q.ok && isNum(q.amplitude) ? q.amplitude : (high > 0 && low > 0 && prev > 0 ? (high - low) / prev * 100 : null);
    var fromHigh = high > 0 && isNum(price) ? (high - price) / high * 100 : null;
    var fromLow = low > 0 && isNum(price) ? (price - low) / low * 100 : null;
    var dayPos = high > low && isNum(price) ? (price - low) / (high - low) * 100 : null;
    var lim = priceLimitPct(state.code, state.data && state.data.name);
    var zone = '';
    if (tipsOn && isNum(dayPos) && isNum(amp) && amp >= 1 && isNum(pct) && Math.abs(pct) < lim) {
      if (isNum(fromHigh) && fromHigh <= thHigh && fromHigh >= -0.05) zone = 'high';
      else if (isNum(fromLow) && fromLow <= thLow && fromLow >= -0.05) zone = 'low';
    }
    var bars = k && k.ok && k.bars ? k.bars : [];
    var take = bars.slice(-20);
    var hi20 = null, lo20 = null;
    if (take.length) {
      hi20 = take[0].h; lo20 = take[0].l;
      take.forEach(function (b) { if (isNum(b.h) && b.h > hi20) hi20 = b.h; if (isNum(b.l) && b.l < lo20) lo20 = b.l; });
    }
    var ma20 = k && k.ok && k.ma ? lastNum(k.ma.ma20) : null;
    return {
      price: price, pct: pct, high: high, low: low, prev: prev,
      fromHigh: fromHigh, fromLow: fromLow, dayPos: dayPos, amp: amp,
      highZone: high > 0 ? high * (1 - thHigh / 100) : null,
      lowZone: low > 0 ? low * (1 + thLow / 100) : null,
      thHigh: thHigh, thLow: thLow, tipsOn: tipsOn, zone: zone,
      hi20: hi20, lo20: lo20, ma20: ma20
    };
  }

  function tipsRender() {
    var body = $('#tipsBody');
    if (!body) return;
    var t = tradeTipsCalc(state.quote, kline.daily || (kline.data && kline.data.period === 'day' ? kline.data : null));
    var th = $('#tipsTh');
    if (th) th.textContent = '高抛 ≤ 距日高 ' + t.thHigh + '% · 低吸 ≤ 距日低 ' + t.thLow + '%';
    var meta = $('#tipsMeta');
    if (meta) {
      meta.textContent = (state.quote && state.quote.time ? '更新于 ' + fmtQuoteTime(state.quote.time) + ' · ' : '') +
        '按日内高低位机械计算，阈值可在特别关注里调整，不构成投资建议';
    }
    if (!isNum(t.price) || !isNum(t.high) || !isNum(t.low) || t.high <= t.low) {
      body.innerHTML = '<div class="nload">' + (state.quote && state.quote.ok === false ? '实时行情获取失败，稍后自动重试' : '等待实时行情…') + '</div>';
      return;
    }
    var zoneCls = !t.tipsOn ? 'off' : t.zone === 'high' ? 'high' : t.zone === 'low' ? 'low' : 'mid';
    var zoneTxt = !t.tipsOn ? '提醒已关闭' : t.zone === 'high' ? '高抛参考区' : t.zone === 'low' ? '低吸参考区' : '日内中枢';
    var zoneSub = !t.tipsOn ? '可在特别关注里重新开启' :
      t.zone === 'high' ? '距日内高点 ' + nf(t.fromHigh, 2) + '%' :
      t.zone === 'low' ? '距日内低点 ' + nf(t.fromLow, 2) + '%' :
      '距高 ' + nf(t.fromHigh, 2) + '% / 距低 ' + nf(t.fromLow, 2) + '%';
    var pos = clamp(t.dayPos, 0, 100);
    var lowW = clamp((t.lowZone - t.low) / (t.high - t.low) * 100, 0, 100);
    var highW = clamp((t.high - t.highZone) / (t.high - t.low) * 100, 0, 100);
    var cls = t.pct > 0 ? 'up' : t.pct < 0 ? 'dn' : '';
    body.innerHTML =
      '<div class="tips-top">' +
        '<div class="tips-price"><b>' + nf(t.price, 2) + '</b><span class="' + cls + '">' + spf(t.pct, 2) + '</span>' +
          '<small>' + (state.quote && state.quote.time ? fmtQuoteTime(state.quote.time) + ' 实时' : '') + '</small></div>' +
        '<div class="tips-state ' + zoneCls + '"><b>' + zoneTxt + '</b><span>' + zoneSub + '</span></div>' +
      '</div>' +
      '<div class="tips-range">' +
        '<span class="tr-lo">日低 ' + nf(t.low, 2) + '</span>' +
        '<div class="tips-track"><i class="tz-low" style="width:' + lowW.toFixed(1) + '%"></i><i class="tz-high" style="width:' + highW.toFixed(1) + '%"></i><b style="left:' + pos.toFixed(1) + '%"></b></div>' +
        '<span class="tr-hi">日高 ' + nf(t.high, 2) + '</span>' +
      '</div>' +
      '<div class="tips-grid">' +
        '<div class="tips-cell high"><span>高抛参考区</span><b>≥ ' + nf(t.highZone, 2) + '</b><small>距日高 ≤ ' + t.thHigh + '%' + (isNum(t.hi20) ? ' · 20日压力 ' + nf(t.hi20, 2) : '') + '</small></div>' +
        '<div class="tips-cell low"><span>低吸参考区</span><b>≤ ' + nf(t.lowZone, 2) + '</b><small>距日低 ≤ ' + t.thLow + '%' + (isNum(t.lo20) ? ' · 20日支撑 ' + nf(t.lo20, 2) : '') + (isNum(t.ma20) ? ' · MA20 ' + nf(t.ma20, 2) : '') + '</small></div>' +
        '<div class="tips-cell"><span>日内位置</span><b>' + nf(t.dayPos, 0) + '%</b><small>0% = 日低，100% = 日高</small></div>' +
      '</div>' +
      '<p class="tips-note">高抛 / 低吸只是“现价在日内区间中的位置”这一机械提示：靠近日高不等于一定回落，靠近日低也不等于一定反弹。请结合趋势、量能和自身持仓判断，<b>不构成投资建议</b>。</p>';
  }

  function klineLoad(code, period, force) {
    code = code || state.code;
    if (!code) return;
    period = period || 'day';
    kline.code = code;
    kline.period = period;
    var my = ++kline.req;
    var host = $('#klineChart');
    if (!host) return;
    kline.loading = true;
    $$('[data-kperiod]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-kperiod') === period); });
    var tag = $('#klineTag'); if (tag) tag.textContent = periodLabel(period);
    host.innerHTML = '<div class="nload">正在加载' + periodLabel(period) + '…</div>';
    var limit = period === 'month' ? 72 : period === 'week' ? 104 : 120;
    var url = API + '/api/kline?code=' + encodeURIComponent(code) + '&period=' + period + '&limit=' + limit + (force ? '&refresh=1' : '');
    fetchJSON(url).then(function (d) {
      if (my !== kline.req || state.code !== code) return;
      if (!d || !d.ok) throw new Error((d && d.error) || 'K 线加载失败');
      kline.data = d;
      if (d.period === 'day') kline.daily = d;
      kline.loading = false;
      klineRenderMeta();
      drawKlineChart();
      tipsRender();
    }).catch(function (e) {
      if (my !== kline.req || state.code !== code) return;
      kline.loading = false;
      var h = $('#klineChart');
      if (h) h.innerHTML = '<div class="nload">K 线加载失败：' + esc(e.message) + '</div>';
    });
  }

  function klineRenderMeta() {
    var d = kline.data;
    if (!d || !d.ok) return;
    var tag = $('#klineTag'); if (tag) tag.textContent = periodLabel(d.period);
    var meta = $('#klineMeta');
    if (meta) meta.textContent = '前复权 · ' + d.count + ' 根 · 截至 ' + (d.asOf || '—') + ' · 数据源 ' + (d.source === 'tencent' ? '腾讯' : d.source === 'eastmoney' ? '东方财富' : (d.source || '—'));
    var lg = $('#klineLegend');
    if (!lg) return;
    var i = (d.bars || []).length - 1;
    if (i < 0) { lg.innerHTML = ''; return; }
    var defs = [['MA5', 'ma5', '#f59e0b'], ['MA10', 'ma10', '#3b82f6'], ['MA20', 'ma20', '#a855f7'], ['MA60', 'ma60', '#94a3b8']];
    lg.innerHTML = defs.map(function (x) {
      var v = d.ma && d.ma[x[1]] ? d.ma[x[1]][i] : null;
      return '<span><i style="background:' + x[2] + '"></i>' + x[0] + ' ' + nf(v, 2) + '</span>';
    }).join('') + '<span class="kline-last">最新 ' + esc((d.bars[i].d || '')) + ' · 收 ' + nf(d.bars[i].c, 2) + '</span>';
  }

  function drawKlineChart() {
    var host = $('#klineChart');
    var d = kline.data;
    if (!host || !d || !d.ok || !d.bars || !d.bars.length) return;
    var bars = d.bars, n = bars.length, C = pal();
    var w = Math.max(240, host.clientWidth || 760);
    var narrow = w < 520;
    var h = narrow ? 300 : 390;
    var pad = narrow ? { l: 30, r: 42, t: 12, b: 24 } : { l: 46, r: 58, t: 16, b: 28 };
    var plotW = w - pad.l - pad.r;
    var totalH = h - pad.t - pad.b;
    var volH = Math.max(48, totalH * 0.22);
    var gap = 12;
    var priceH = totalH - volH - gap;
    var priceTop = pad.t, priceBottom = priceTop + priceH;
    var volTop = priceBottom + gap, volBottom = volTop + volH;
    var bandW = plotW / Math.max(1, n);
    var cw = Math.max(1.1, Math.min(9, bandW * 0.64));

    var lows = [], highs = [], mvals = [];
    bars.forEach(function (b) { if (isNum(b.l)) lows.push(b.l); if (isNum(b.h)) highs.push(b.h); });
    ['ma5', 'ma10', 'ma20', 'ma60'].forEach(function (k) {
      var a = d.ma && d.ma[k] ? d.ma[k] : [];
      a.forEach(function (v) { if (isNum(v)) mvals.push(v); });
    });
    var pmin = Math.min.apply(null, lows.concat(mvals));
    var pmax = Math.max.apply(null, highs.concat(mvals));
    if (!isFinite(pmin) || !isFinite(pmax) || pmin === pmax) { pmin = (pmin || 0) * 0.98; pmax = (pmax || 1) * 1.02; }
    var span = pmax - pmin;
    var sc = niceScale(pmin - span * 0.04, pmax + span * 0.04, 4);
    function yP(v) { return priceTop + priceH - ((v - sc.lo) / (sc.hi - sc.lo)) * priceH; }
    function xAt(i) { return pad.l + bandW * (i + 0.5); }
    var vmax = 0;
    bars.forEach(function (b) { if (isNum(b.v) && b.v > vmax) vmax = b.v; });
    function vY(v) { return volTop + volH - (vmax > 0 ? (v / vmax) * volH : 0); }

    host.innerHTML = '';
    host.style.position = 'relative';
    var svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, width: '100%', height: h, role: 'img' });

    // 价格网格
    sc.ticks.forEach(function (t) {
      var y = yP(t);
      if (y < priceTop - 1 || y > priceBottom + 1) return;
      svg.appendChild(svgEl('line', { x1: pad.l, x2: w - pad.r, y1: y, y2: y, stroke: C.line2, 'stroke-width': 1, 'stroke-dasharray': '3 4' }));
      var tx = svgEl('text', { x: w - pad.r + 8, y: y + 3.5, 'font-size': 10, fill: C.ink4 });
      tx.textContent = nf(t, 2);
      svg.appendChild(tx);
    });
    // 成交量区
    svg.appendChild(svgEl('line', { x1: pad.l, x2: w - pad.r, y1: volTop, y2: volTop, stroke: C.line2, 'stroke-width': 1 }));
    var vlab = svgEl('text', { x: pad.l, y: volTop + 11, 'font-size': 9.5, fill: C.ink4 });
    vlab.textContent = '成交量';
    svg.appendChild(vlab);
    bars.forEach(function (b, i) {
      if (!isNum(b.v) || vmax <= 0) return;
      var up = isNum(b.c) && isNum(b.o) ? b.c >= b.o : true;
      var y = vY(b.v);
      var x = xAt(i) - cw / 2;
      svg.appendChild(svgEl('rect', { x: x, y: y, width: Math.max(1, cw), height: Math.max(1, volBottom - y), fill: up ? C.up : C.down, opacity: 0.38 }));
    });
    var vma = d.volMa5 || [];
    var vpts = [];
    for (var i = 0; i < n; i++) vpts.push(isNum(vma[i]) ? { x: xAt(i), y: vY(vma[i]) } : null);
    svg.appendChild(svgEl('path', { d: segPath(vpts), fill: 'none', stroke: C.ink3, 'stroke-width': 1, opacity: 0.7 }));

    // K 线
    bars.forEach(function (b, i) {
      if (!isNum(b.o) || !isNum(b.c) || !isNum(b.h) || !isNum(b.l)) return;
      var up = b.c >= b.o;
      var col = up ? C.up : C.down;
      var x = xAt(i);
      svg.appendChild(svgEl('line', { x1: x, x2: x, y1: yP(b.h), y2: yP(b.l), stroke: col, 'stroke-width': 1 }));
      var y1 = yP(Math.max(b.o, b.c)), y2 = yP(Math.min(b.o, b.c));
      svg.appendChild(svgEl('rect', {
        x: x - cw / 2, y: Math.min(y1, y2), width: Math.max(1, cw), height: Math.max(1, Math.abs(y2 - y1)),
        fill: col, opacity: 0.9
      }));
    });

    // 均线
    var maDefs = [['ma5', '#f59e0b'], ['ma10', '#3b82f6'], ['ma20', '#a855f7'], ['ma60', '#94a3b8']];
    maDefs.forEach(function (m) {
      var arr = d.ma && d.ma[m[0]] ? d.ma[m[0]] : [];
      var pts = [];
      for (var j = 0; j < n; j++) pts.push(isNum(arr[j]) ? { x: xAt(j), y: yP(arr[j]) } : null);
      svg.appendChild(svgEl('path', { d: segPath(pts), fill: 'none', stroke: m[1], 'stroke-width': 1.4, 'stroke-linejoin': 'round', opacity: 0.9 }));
    });

    // 现价线
    var live = state.quote && state.quote.ok && isNum(state.quote.price) ? state.quote.price : lastNum(bars.map(function (b) { return b.c; }));
    if (isNum(live) && live >= sc.lo && live <= sc.hi) {
      var ly = yP(live);
      svg.appendChild(svgEl('line', { x1: pad.l, x2: w - pad.r, y1: ly, y2: ly, stroke: C.brand, 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.8 }));
      var lt = svgEl('text', { x: w - pad.r + 8, y: ly + 3.5, 'font-size': 10, fill: C.brand, stroke: C.panel, 'stroke-width': 3, 'paint-order': 'stroke' });
      lt.textContent = '现 ' + nf(live, 2);
      svg.appendChild(lt);
    }

    // X 轴日期
    var step = Math.max(1, Math.ceil(n / 6));
    for (var j = 0; j < n; j += step) addDate(j);
    addDate(n - 1);
    function addDate(idx) {
      if (idx < 0 || idx >= n) return;
      var ds = String(bars[idx].d || '');
      var lb = d.period === 'month' ? ds.slice(0, 7) : ds.slice(5);
      var tx = svgEl('text', { x: xAt(idx), y: h - 8, 'text-anchor': 'middle', 'font-size': 9.5, fill: C.ink4 });
      tx.textContent = lb;
      svg.appendChild(tx);
    }

    // 十字光标与提示
    var vline = svgEl('line', { x1: 0, x2: 0, y1: priceTop, y2: volBottom, stroke: C.ink4, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.75, 'pointer-events': 'none' });
    var hline = svgEl('line', { x1: pad.l, x2: w - pad.r, y1: 0, y2: 0, stroke: C.ink4, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.55, 'pointer-events': 'none' });
    vline.style.display = 'none'; hline.style.display = 'none';
    svg.appendChild(vline); svg.appendChild(hline);
    var overlay = svgEl('rect', { x: pad.l, y: priceTop, width: plotW, height: totalH, fill: 'transparent' });
    svg.appendChild(overlay);
    host.appendChild(svg);

    var tip = document.createElement('div');
    tip.className = 'kline-tip';
    tip.hidden = true;
    host.appendChild(tip);

    function hideTip() {
      tip.hidden = true; vline.style.display = 'none'; hline.style.display = 'none';
    }
    overlay.addEventListener('pointermove', function (ev) {
      var rect = svg.getBoundingClientRect();
      var scale = rect.width / w;
      var x = (ev.clientX - rect.left) / scale;
      var yy = (ev.clientY - rect.top) / scale;
      var idx = Math.floor((x - pad.l) / bandW);
      if (idx < 0 || idx >= n) { hideTip(); return; }
      var b = bars[idx];
      var px = xAt(idx), py = yP(isNum(b.c) ? b.c : 0);
      vline.setAttribute('x1', px); vline.setAttribute('x2', px); vline.style.display = '';
      hline.setAttribute('y1', yy); hline.setAttribute('y2', yy); hline.style.display = '';
      tip.hidden = false;
      var pct = isNum(b.pct) ? b.pct : (isNum(b.c) && isNum(b.o) && b.o ? (b.c - b.o) / b.o * 100 : null);
      tip.innerHTML = '<b>' + esc(b.d || '') + '</b>' +
        '<div class="kt-grid"><span>开</span><b>' + nf(b.o, 2) + '</b><span>高</span><b>' + nf(b.h, 2) + '</b>' +
        '<span>低</span><b>' + nf(b.l, 2) + '</b><span>收</span><b>' + nf(b.c, 2) + '</b></div>' +
        '<div class="kt-meta">涨跌 ' + spf(pct, 2) + ' · 量 ' + (isNum(b.v) ? nf(b.v / 10000, 2) + ' 万手' : '—') + '</div>' +
        '<div class="kt-ma">MA5 ' + nf(d.ma && d.ma.ma5 ? d.ma.ma5[idx] : null, 2) + ' · MA20 ' + nf(d.ma && d.ma.ma20 ? d.ma.ma20[idx] : null, 2) + '</div>';
      var leftPx = (px + 12) * scale;
      if (leftPx + 180 > rect.width) leftPx = (px - 12) * scale - 180;
      leftPx = Math.max(2, Math.min(rect.width - 182, leftPx));
      tip.style.left = leftPx + 'px';
      tip.style.top = '8px';
    });
    overlay.addEventListener('pointerleave', hideTip);
    overlay.addEventListener('pointerdown', function (ev) { ev.preventDefault(); });
  }

  /* ---------------- 片段：层头 ---------------- */
  function layerHead(no, title, tone, lampText, right) {
    return '<div class="layer-head">' +
      '<span class="layer-no">' + esc(no) + '</span>' +
      '<h3 class="layer-title">' + esc(title) + '</h3>' +
      lamp(tone, lampText) +
      '<div class="score"><span class="muted" style="font-size:12px">' + esc(right) + '</span></div>' +
      '</div>';
  }
  function scorePill(name, score, weight) {
    var tone = toneOfScore(score);
    var v = isNum(score) ? score : 0;
    return '<div class="score-pill">' +
      '<div class="sp-top"><span class="sp-name">' + esc(name) + ' <span class="sp-w">权重 ' + weight + '%</span></span>' +
      '<span class="sp-val ' + tone + '">' + (isNum(score) ? score.toFixed(1) : '—') + '</span></div>' +
      '<div class="bar ' + tone + '"><i style="width:' + clamp(v, 0, 100) + '%"></i></div>' +
      '</div>';
  }

  /* ---------------- 概览 ---------------- */
  function heroHTML(d, q) {
    var tone = toneOfRating(d.rating);
    var C = pal();
    var s = clamp(isNum(d.total) ? d.total : 0, 0, 100);
    var R = 50, CIR = 2 * Math.PI * R;
    var ring = tone === 'good' ? C.good : tone === 'warn' ? C.warn : tone === 'bad' ? C.bad : C.brand;

    var price = d.price, chg = null, chgPct = null, qtime = '';
    if (q && q.ok && isNum(q.price) && q.price > 0) {
      price = q.price; chg = q.change; chgPct = q.changePct;
      if (q.time && q.time.length >= 12) qtime = q.time.slice(8, 10) + ':' + q.time.slice(10, 12);
    }
    var chgCls = isNum(chgPct) ? (chgPct > 0 ? 'up' : chgPct < 0 ? 'down' : '') : '';

    return '<div class="hero-top">' +
      '<div class="hero-left">' +
        '<div class="hero-name">' +
          '<h2>' + esc(d.name) + '</h2>' +
          '<span class="hero-code">' + esc(d.code) + '</span>' +
          '<div class="hero-tags">' +
            (d.industry ? '<span class="tag">' + esc(d.industry) + '</span>' : '') +
            '<span class="tag grey">L1 ' + esc(d.l1.verdict || '—') + '</span>' +
            '<button type="button" class="hero-watch' + (state.watchCodes[d.code] ? ' on' : '') + '" id="heroWatch" data-watch-code="' + esc(d.code) + '">' +
              (state.watchCodes[d.code] ? '★ 已关注' : '☆ 特别关注') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="hero-price">' +
          '<span class="p">' + nf(price, 2) + '</span>' +
          (isNum(chgPct) ? '<span class="chg ' + chgCls + '">' + spf(chgPct, 2) + '　' + (chg > 0 ? '+' : '') + nf(chg, 2) + '</span>' : '') +
          '<span class="when">' + (qtime ? esc(qtime) + ' 实时' : '收盘 ' + esc(d.meta.dataAsOf || '')) + '</span>' +
        '</div>' +
        '<div class="hero-facts">' +
          '<div><span>总市值</span><b>' + money(d.marketCap) + '</b></div>' +
          '<div><span>PE(TTM)</span><b>' + nf(d.peTtm, 2) + '</b></div>' +
          '<div><span>PB</span><b>' + nf(d.pb, 2) + '</b></div>' +
          '<div><span>股息率</span><b>' + pf(d.dividendYield, 2) + '</b></div>' +
          '<div><span>行业</span><b class="txt">' + esc(d.industry || '—') + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="hero-right">' +
        '<div class="score-ring">' +
          '<svg viewBox="0 0 116 116" width="100%" height="100%">' +
            '<circle cx="58" cy="58" r="' + R + '" fill="none" stroke="' + C.line2 + '" stroke-width="9"/>' +
            '<circle cx="58" cy="58" r="' + R + '" fill="none" stroke="' + ring + '" stroke-width="9" stroke-linecap="round" ' +
              'stroke-dasharray="' + CIR.toFixed(1) + '" stroke-dashoffset="' + (CIR * (1 - s / 100)).toFixed(1) + '"/>' +
          '</svg>' +
          '<div class="val"><b>' + (isNum(d.total) ? d.total.toFixed(1) : '—') + '</b><span>综合分</span></div>' +
        '</div>' +
        '<div class="rating-box">' +
          '<div class="rating-chip ' + tone + '">' + esc(d.rating) + '</div>' +
          '<div class="rating-sub">L2×40% + L3×25% + L4×35%</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="hero-scores">' +
      scorePill('L2 盈利质量', d.l2.score, 40) +
      scorePill('L3 增长稳定性', d.l3.score, 25) +
      scorePill('L4 估值', d.l4.score, 35) +
    '</div>' +
    '<div class="hero-concl"><span class="k">一句话结论</span><span class="v">' + esc(d.conclusion || '—') + '</span></div>';
  }

  function kpisHTML(d) {
    var ks = d.keyStats || [];
    return '<section class="card"><div class="sec-head"><h3>关键指标</h3>' +
      '<span class="sub">' + esc((d.l3.partial && d.l3.partial.label) || '') + ' · 实时抓取</span></div>' +
      '<div class="kpis">' + ks.map(function (k) {
        return '<div class="kpi ' + (k.tone || '') + '">' +
          '<div class="k-label">' + esc(k.label) + '</div>' +
          '<div class="k-val">' + esc(k.value) + '</div>' +
          '<div class="k-sub">' + esc(k.sub || '') + '</div>' +
          '</div>';
      }).join('') + '</div></section>';
  }

  function summaryHTML(d) {
    var items = d.summary || [];
    return '<section class="card"><div class="sec-head"><h3>分析要点</h3>' +
      '<span class="sub">逐条给数、给增速、给判断</span></div>' +
      '<div class="insights">' + items.map(function (it) {
        return '<div class="insight ' + (it.tone || '') + '">' +
          '<div class="tagbox">' + esc(it.tag || '') + '</div>' +
          '<div class="txt">' + richify(it.text || '') + '</div>' +
          '</div>';
      }).join('') + '</div></section>';
  }

  /* ---------------- L1 排雷 ---------------- */
  function renderL1(d) {
    var L = d.l1 || {};
    var kill = L.kill || 0, warn = L.warn || 0;
    var tone = kill > 0 ? 'bad' : (warn > 0 ? 'warn' : 'good');
    var head = layerHead('L1', '排雷（否决制）', tone, lampWord(tone),
      '淘汰 ' + kill + ' · 警告 ' + warn + ' · 提示 ' + (L.tip || 0));

    var rule = kill > 0
      ? '存在淘汰项 → 直接 D-排除，其余四层不再参与评级。'
      : (warn > 0
        ? '本层无淘汰项，但有 ' + warn + ' 项警告 → 评级最高只能到 B-观察。'
        : '所有排雷项通过，可以继续看盈利质量与估值。');

    var rows = (L.items || []).map(function (it) {
      var t = verdictTone(it.verdict);
      return '<div class="item">' +
        '<span class="bulb ' + t + '"></span>' +
        '<span class="i-name">' + esc(it.item) + '</span>' +
        '<span class="i-val">' + esc(it.value) + '</span>' +
        '<span class="i-std">标准 ' + esc(it.standard) + '</span>' +
        '<span class="i-verdict"><span class="' + t + '">' + esc(it.verdict) + '</span></span>' +
        '<span class="i-note">' + esc(it.note || '') + '</span>' +
        '</div>';
    }).join('');

    return '<section class="card layer" id="sec-l1">' + head +
      '<div class="layer-body">' +
        '<p class="layer-note ' + (tone === 'good' ? 'good' : tone) + '">' + esc(rule) + '</p>' +
        '<div class="items">' + rows + '</div>' +
      '</div></section>';
  }

  /* ---------------- L2 盈利质量 ---------------- */
  function renderL2(d) {
    var L = d.l2 || {};
    var tone = toneOfScore(L.score);
    var head = layerHead('L2', '盈利质量', tone, lampWord(tone),
      '权重 40% · 得分 ' + (isNum(L.score) ? L.score.toFixed(1) : '—'));

    var ser = L.series || [];
    var first = ser[0] || {}, last = ser[ser.length - 1] || {};
    var gmDelta = isNum(L.gmDelta) ? L.gmDelta : ((isNum(first.gm) && isNum(last.gm)) ? last.gm - first.gm : null);

    var pts = [];
    pts.push('5 年 ROE 均值 <b>' + pf(L.roeAvg) + '</b>（门槛 15%），最低 <b>' + pf(L.roeMin) + '</b>，标准差 <b>' +
      nf(L.roeSd, 2) + '</b>' + (isNum(L.roeSd) ? (L.roeSd <= 2 ? '，波动小、稳定' : '，波动偏大') : ''));
    if (isNum(first.gm) && isNum(last.gm) && (first.gm > 0 || last.gm > 0)) {
      pts.push('毛利率 <b>' + pf(first.gm) + '</b>（' + esc(first.year || '') + '）→ <b>' + pf(last.gm) + '</b>（' + esc(last.year || '') +
        '），变化 <b>' + (gmDelta > 0 ? '+' : '') + nf(gmDelta, 2) + 'pct</b>' +
        (Math.abs(gmDelta) <= 2 ? '，基本持平' : (gmDelta > 0 ? '，在抬升' : '，在下滑')));
    } else {
      pts.push('毛利率未披露或口径不适用（金融类公司无此指标）。');
    }
    if (isNum(L.lev) && L.lev > 0) {
      pts.push('权益乘数 <b>' + nf(L.lev, 2) + '</b>' + (L.lev > 2.5
        ? '（&gt;2.5，ROE 含杠杆成分，总分已打 85 折）' : '（杠杆不高，ROE 主要靠经营）'));
    }
    if (isNum(L.roic) && L.roic > 0) {
      pts.push('ROIC <b>' + pf(L.roic) + '</b>（≥12% 加分，&lt;8% 扣分）' +
        (L.roic >= 12 ? '，投入资本回报健康' : '，投入资本回报一般'));
    }
    var drs = ser.filter(function (x) { return isNum(x.deductRatio); }).slice(-3);
    if (drs.length) {
      var avg = drs.reduce(function (a, b) { return a + b.deductRatio; }, 0) / drs.length;
      pts.push('扣非 / 归母（近 ' + drs.length + ' 年均值）<b>' + pf(avg, 0) + '</b>，利润主要来自主营。');
    }

    return {
      html: '<section class="card layer" id="sec-l2">' + head + '<div class="layer-body">' +
        '<ul class="pts">' + pts.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>' +
        '<div class="charts">' +
          '<div class="chart" id="ch-roe"><h4>ROE 走势<small>证监会加权口径</small></h4></div>' +
          '<div class="chart" id="ch-gm"><h4>毛利率 / 净利率<small>%</small></h4></div>' +
        '</div>' +
        '</div></section>',
      after: function (C) {
        var years = ser.map(function (x) { return x.year; });
        chart($('#ch-roe'), {
          h: 190, labels: years, baselineZero: true,
          yFmt: function (v) { return v.toFixed(0) + '%'; },
          series: [{ name: 'ROE', color: C.brand, values: ser.map(function (x) { return x.roe; }) }],
          tipFmt: function (v) { return v.toFixed(2) + '%'; }
        });
        chart($('#ch-gm'), {
          h: 190, labels: years, baselineZero: true,
          yFmt: function (v) { return v.toFixed(0) + '%'; },
          series: [
            { name: '毛利率', color: C.warn, values: ser.map(function (x) { return x.gm; }) },
            { name: '净利率', color: C.good, values: ser.map(function (x) { return x.netMargin; }) }
          ],
          tipFmt: function (v) { return v.toFixed(2) + '%'; }
        });
      }
    };
  }

  /* ---------------- L3 增长稳定性 ---------------- */
  function verdictWord(v, seq) {
    if (!isNum(v)) return '';
    var valid = (seq || []).filter(isNum);
    if (!valid.length) return '';
    var d = v - valid[valid.length - 1];
    if (d > 3) return '（<span class="em">继续上台阶</span>）';
    if (d > -3) return '（大致走平）';
    if (d > -10) return '（<span class="muted">略有放缓</span>）';
    return '（<span class="muted">明显降档</span>）';
  }
  function trendWord(arr) {
    var a = arr.filter(isNum);
    if (a.length < 2) return '';
    var d = a[a.length - 1] - a[0];
    if (d > 5) return '（<span class="em">在加速</span>）';
    if (d > -5) return '（走平）';
    if (d > -15) return '（<span class="muted">在放缓</span>）';
    return '（<span class="muted">明显失速</span>）';
  }

  function forecastBox(cs) {
    var items = (cs.forecasts || []).map(function (f) {
      var est = f.mark === 'E';
      return '<div class="fc-item' + (est ? ' est' : '') + '">' +
        '<div class="y">' + f.year + (est ? 'E 预测' : 'A 实际') + '</div>' +
        '<div class="e">' + nf(f.eps, 3) + '</div>' +
        '<div class="g ' + (isNum(f.growth) ? (f.growth > 0 ? 'pos' : f.growth < 0 ? 'neg' : '') : '') + '">' +
        (isNum(f.growth) ? spf(f.growth, 1) : '—') + '</div>' +
        '</div>';
    }).join('');
    var meta = [];
    if (isNum(cs.targetMin) || isNum(cs.targetMax)) meta.push('目标价 ' + nf(cs.targetMin, 2) + '–' + nf(cs.targetMax, 2));
    if (isNum(cs.upside)) meta.push('空间 ' + spf(cs.upside, 1));
    if (isNum(cs.org)) meta.push('覆盖 ' + cs.org + ' 家');
    if (cs.ratingText) meta.push(cs.ratingText);
    return '<div class="fc">' + items + '</div>' +
      (meta.length ? '<p class="muted" style="margin:10px 0 0;font-size:12.5px">' + esc(meta.join(' · ')) + '</p>' : '');
  }

  function renderL3(d) {
    var L = d.l3 || {};
    var M = L.momentum || {};
    var tone = toneOfScore(L.score);
    var lt = M.tone === 'warn' ? 'warn' : (M.tone === 'bad' ? 'bad' : (M.tone === 'good' ? 'good' : tone));
    var head = layerHead('L3', '增长稳定性', lt, lampWord(lt),
      '权重 25% · 得分 ' + (isNum(L.score) ? L.score.toFixed(1) : '—') + (M.label ? ' · ' + M.label : ''));

    var ann = L.annual || [];
    var part = L.partial || {};
    var qs = L.quarters || [];
    var pts = [];

    var revSeq = ann.map(function (a) { return a.revGrowth; });
    var revChain = ann.slice(-3).map(function (a) { return a.year + ' <b>' + pf(a.revGrowth) + '</b>'; });
    if (isNum(part.revGrowth)) revChain.push(esc(part.label || '最新') + ' <b>' + pf(part.revGrowth) + '</b>');
    if (revChain.length) pts.push('营收增速：' + revChain.join(' → ') + verdictWord(part.revGrowth, revSeq));

    var npSeq = ann.map(function (a) { return a.npGrowth; });
    var npChain = ann.slice(-3).map(function (a) { return a.year + ' <b>' + pf(a.npGrowth) + '</b>'; });
    if (isNum(part.npGrowth)) npChain.push(esc(part.label || '最新') + ' 累计 <b>' + pf(part.npGrowth) + '</b>');
    if (npChain.length) pts.push('归母净利增速：' + npChain.join(' → ') + verdictWord(part.npGrowth, npSeq));

    if (qs.length >= 2) {
      var q4 = qs.slice(-4);
      pts.push('单季营收增速：' + q4.map(function (q) { return q.label + ' <b>' + pf(q.revGrowth) + '</b>'; }).join(' → ') +
        trendWord(q4.map(function (q) { return q.revGrowth; })));
      pts.push('单季归母增速：' + q4.map(function (q) { return q.label + ' <b>' + pf(q.npGrowth) + '</b>'; }).join(' → ') +
        trendWord(q4.map(function (q) { return q.npGrowth; })));
    }

    if (isNum(part.dedGrowth)) {
      var gap = isNum(part.npGrowth) ? Math.abs(part.npGrowth - part.dedGrowth) : null;
      pts.push('扣非净利：' + esc(part.label || '最新') + ' 累计 <b>' + pf(part.dedGrowth) + '</b>' +
        (gap != null ? '（与归母相差 <b>' + nf(gap, 2) + 'pct</b>' + (gap <= 5 ? '，含金量可以' : '，非经常性损益贡献不小') + '）' : ''));
    }

    pts.push('3 年 CAGR：营收 <b>' + pf(L.revCagr) + '</b> · 扣非 <b>' + pf(L.dedCagr) + '</b>；年度增速标准差 <b>' +
      nf(L.growthSd, 1) + '</b>' + (isNum(L.growthSd) ? (L.growthSd > 25 ? '（波动很大，周期属性明显）' : '（增速相对平滑）') : ''));
    pts.push('PEG <b>' + nf(L.peg, 2) + '</b>（PE_TTM ÷ 扣非 CAGR）' +
      (isNum(L.peg) ? (L.peg > 0 && L.peg <= 1 ? '，估值跟得上增速' : (L.peg > 2 ? '，估值跑在增速前面' : '，大致匹配')) : ''));
    if (isNum(L.capexDep)) pts.push('资本开支 / 折旧 <b>' + nf(L.capexDep, 2) + '</b>' + (L.capexDep > 1.5 ? '，处于扩张期' : '，以维持性投入为主'));

    var rd = L.rd || {};
    if (isNum(rd.latest) && rd.latest > 0) {
      pts.push('研发 <b>' + money(rd.latest) + '</b>（占营收 <b>' + pf(rd.ratio) + '</b>' +
        (isNum(rd.yoy) ? '，同比 <b>' + spf(rd.yoy, 1) + '</b>' : '') + '）' +
        (isNum(rd.ratio) && rd.ratio >= 5 ? '，投入强度不低' : ''));
    } else {
      pts.push('研发投入未披露（金融类或未单独列示）。');
    }

    var cs = L.consensus;
    if (cs && cs.forecasts && cs.forecasts.length) {
      var est = (cs.forecasts || []).filter(function (f) { return f.mark === 'E'; });
      var chain = (est.length ? est : cs.forecasts).map(function (f) {
        return '<b>' + f.year + 'E</b> ' + (isNum(f.growth) ? spf(f.growth, 1) : '—');
      }).join(' / ');
      var tgt = '';
      if (isNum(cs.targetMin) || isNum(cs.targetMax)) {
        tgt = '；目标价 <b>' + nf(cs.targetMin, 2) + '–' + nf(cs.targetMax, 2) + '</b>' +
          (isNum(cs.targetMid) ? '（中值 ' + nf(cs.targetMid, 2) + (isNum(cs.upside) ? '，较现价 ' + spf(cs.upside, 1) : '') + '）' : '');
      }
      var orgTxt = isNum(cs.org)
        ? ('覆盖 <b>' + cs.org + '</b> 家' + (cs.ratingText ? '（' + esc(cs.ratingText) + '）' : ''))
        : '覆盖机构数缺失';
      pts.push('一致预期 ' + chain + tgt + '；' + orgTxt +
        (isNum(cs.org) && cs.org < 5 ? ' —— 样本太少，别当锚' : ''));
    }

    var hasCs = cs && cs.forecasts && cs.forecasts.length;
    return {
      html: '<section class="card layer" id="sec-l3">' + head + '<div class="layer-body">' +
        (M.detail ? '<p class="layer-note ' + (lt === 'good' ? 'good' : lt === 'bad' ? 'bad' : 'warn') + '">' + esc(M.detail) + '</p>' : '') +
        '<ul class="pts">' + pts.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>' +
        '<div class="charts">' +
          '<div class="chart" id="ch-rev"><h4>营业收入<small>亿元</small></h4></div>' +
          '<div class="chart" id="ch-ded"><h4>扣非净利<small>亿元</small></h4></div>' +
          '<div class="chart wide" id="ch-gr"><h4>年度增速<small>同比 %</small></h4></div>' +
          '<div class="chart wide" id="ch-q"><h4>单季增速<small>单季同比 %</small></h4></div>' +
          '<div class="chart" id="ch-rd"><h4>研发投入<small>亿元</small></h4></div>' +
          (hasCs ? '<div class="chart" id="ch-fc"><h4>一致预期 EPS<small>元 / 股</small></h4></div>'
                 : '<div class="chart" id="ch-rd2"><h4>研发占营收<small>%</small></h4></div>') +
        '</div>' +
        (hasCs ? forecastBox(cs) : '') +
        '</div></section>',
      after: function (C) {
        chart($('#ch-rev'), {
          h: 200, labels: ann.map(function (a) { return a.year; }), baselineZero: true, barWidth: 0.5,
          yFmt: function (v) { return v.toFixed(0); },
          series: [{ name: '营业收入', type: 'bar', color: C.brand, values: ann.map(function (a) { return a.revenue; }), opacity: 0.8 }],
          tipFmt: function (v) { return nf(v, 2) + ' 亿'; }
        });
        chart($('#ch-ded'), {
          h: 200, labels: ann.map(function (a) { return a.year; }), baselineZero: true, barWidth: 0.5,
          yFmt: function (v) { return v.toFixed(0); },
          series: [{ name: '扣非净利', type: 'bar', color: C.good, values: ann.map(function (a) { return a.deduct; }), opacity: 0.8 }],
          tipFmt: function (v) { return nf(v, 2) + ' 亿'; }
        });
        chart($('#ch-gr'), {
          h: 210, labels: ann.map(function (a) { return a.year; }), baselineZero: true,
          yFmt: function (v) { return v.toFixed(0) + '%'; },
          series: [
            { name: '营收增速', color: C.brand, values: ann.map(function (a) { return a.revGrowth; }) },
            { name: '归母增速', color: C.warn, values: ann.map(function (a) { return a.npGrowth; }) },
            { name: '扣非增速', color: C.muted, values: ann.map(function (a) { return a.dedGrowth; }), dash: '4 3', dots: false }
          ],
          tipFmt: function (v) { return v.toFixed(2) + '%'; }
        });
        chart($('#ch-q'), {
          h: 220, labels: qs.map(function (q) { return q.label; }), baselineZero: true,
          yFmt: function (v) { return v.toFixed(0) + '%'; },
          series: [
            { name: '单季营收', color: C.brand, values: qs.map(function (q) { return q.revGrowth; }) },
            { name: '单季归母', color: C.warn, values: qs.map(function (q) { return q.npGrowth; }) },
            { name: '单季扣非', color: C.muted, values: qs.map(function (q) { return q.dedGrowth; }), dash: '4 3', dots: false }
          ],
          tipFmt: function (v) { return v.toFixed(2) + '%'; }
        });
        var rh = rd.history || [];
        chart($('#ch-rd'), {
          h: 190, labels: rh.map(function (x) { return x.year; }), baselineZero: true, barWidth: 0.5,
          series: [{ name: '研发投入', type: 'bar', color: C.brand, values: rh.map(function (x) { return x.rd; }), opacity: 0.75 }],
          yFmt: function (v) { return v.toFixed(0); },
          tipFmt: function (v) { return nf(v, 2) + ' 亿'; }
        });
        if (hasCs) {
          var fc = cs.forecasts;
          chart($('#ch-fc'), {
            h: 190, labels: fc.map(function (f) { return f.year + (f.mark === 'E' ? 'E' : ''); }),
            baselineZero: true, showValues: true, barWidth: 0.48,
            series: [{ name: 'EPS', type: 'bar', color: C.brand, values: fc.map(function (f) { return f.eps; }), opacity: 0.8 }],
            valFmt: function (v) { return nf(v, 2); },
            tipFmt: function (v) { return nf(v, 3) + ' 元'; }
          });
        } else {
          chart($('#ch-rd2'), {
            h: 190, labels: rh.map(function (x) { return x.year; }), baselineZero: true,
            yFmt: function (v) { return v.toFixed(0) + '%'; },
            series: [{ name: '研发占营收', color: C.warn, values: rh.map(function (x) { return x.ratio; }) }],
            tipFmt: function (v) { return v.toFixed(2) + '%'; }
          });
        }
      }
    };
  }

  /* ---------------- L4 估值 ---------------- */
  function pctWord(p) {
    if (!isNum(p)) return '—';
    if (p <= 10) return '最低端';
    if (p <= 30) return '偏低区间';
    if (p <= 50) return '中位偏下';
    if (p <= 70) return '中位偏上';
    if (p <= 90) return '偏高区间';
    return '最高端';
  }

  function peersTable(ind) {
    if (!ind || !ind.peers || !ind.peers.length) return '';
    var rows = ind.peers.map(function (p, i) {
      return '<tr class="' + (p.self ? 'me' : '') + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(p.name) + (p.self ? ' <span class="tag" style="font-size:10px;padding:1px 6px">本股</span>' : '') + '</td>' +
        '<td class="num">' + esc(p.code) + '</td>' +
        '<td class="num">' + nf(p.pe, 2) + '</td>' +
        '<td class="num">' + nf(p.pb, 2) + '</td>' +
        '<td class="num">' + money(p.cap) + '</td>' +
        '</tr>';
    }).join('');
    return '<div class="tbl-wrap"><table class="tbl">' +
      '<thead><tr><th>#</th><th>公司</th><th>代码</th><th>PE(TTM)</th><th>PB</th><th>市值</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function renderL4(d) {
    var L = d.l4 || {};
    var tone = toneOfScore(L.score);
    var head = layerHead('L4', '估值', tone, lampWord(tone),
      '权重 35% · 得分 ' + (isNum(L.score) ? L.score.toFixed(1) : '—') + ' · ' + (L.verdict || ''));

    var pts = [];
    var triad = [];
    if (isNum(L.peStatic)) triad.push('静态 <b>' + nf(L.peStatic, 2) + '</b>');
    if (isNum(L.peTtm)) triad.push('TTM <b>' + nf(L.peTtm, 2) + '</b>');
    if (isNum(L.peDynamic)) triad.push('动态 <b>' + nf(L.peDynamic, 2) + '</b>');
    if (triad.length) {
      pts.push('三档 PE：' + triad.join(' / ') +
        (isNum(L.spread) ? '，最大差 <b>' + nf(L.spread, 1) + '%</b>' +
          (L.spread < 10 ? '（&lt;10%，盈利可外推 ✓）' : '（&gt;10%，报告期年化含一次性因素）') : ''));
    }
    if (isNum(L.implied)) {
      pts.push('动态 PE 隐含增速 <b>' + pf(L.implied, 1) + '</b>，对比扣非 3 年 CAGR <b>' + pf(d.l3.dedCagr, 1) + '</b>' +
        (isNum(d.l3.dedCagr) ? (L.implied <= d.l3.dedCagr ? '，估值没有跑在增速前面' : '，估值略跑在增速前面') : '（扣非 CAGR 不可算，无法对比增速）'));
    }

    var ye = L.yearEnd || [];
    if (ye.length > 1) {
      var chain = ye.map(function (y) {
        return y.current
          ? '<b>' + esc(y.year) + ' ' + nf(y.pe, 1) + '</b>'
          : esc(y.year) + ' ' + nf(y.pe, 1);
      }).join(' / ');
      pts.push('自算年末 PE：' + chain +
        (isNum(L.pePct6) ? ' —— 当前处于近 6 年 <b>' + pctWord(L.pePct6) + '</b>（分位 ' + pf(L.pePct6, 1) + '）' : ''));
    }

    var ps = L.peStats || {};
    if (isNum(L.pePct6) || isNum(L.pePct5)) {
      pts.push('PE 分位：6 年 <b>' + pf(L.pePct6, 1) + '</b> · 5 年 <b>' + pf(L.pePct5, 1) + '</b>' +
        (isNum(ps.min) ? '；区间 min <b>' + nf(ps.min, 2) + '</b> / p20 <b>' + nf(ps.p20, 2) +
          '</b> / 中位 <b>' + nf(ps.p50, 2) + '</b> / p80 <b>' + nf(ps.p80, 2) + '</b> / max <b>' + nf(ps.max, 2) + '</b>' : ''));
    }
    var bs = L.pbStats || {};
    pts.push('PB <b>' + nf(L.pb, 2) + '</b>' + (isNum(L.pbPct6) ? '，6 年分位 <b>' + pf(L.pbPct6, 1) + '</b>' : '') +
      (isNum(bs.p50) ? '（历史中位 ' + nf(bs.p50, 2) + '）' : ''));

    var ind = L.industry || {};
    if (ind.name) {
      pts.push('行业参照：' + esc(ind.name) + ' <b>' + (ind.count || 0) + '</b> 家，整体 PE <b>' + nf(ind.peAgg, 2) +
        '</b> / PB <b>' + nf(ind.pbAgg, 2) + '</b>，中位 PE <b>' + nf(ind.peMedian, 2) + '</b>' +
        (isNum(ind.peRank) ? '；本股 PE 处于板块 <b>' + pf(ind.peRank, 1) + '</b> 分位、PB <b>' + pf(ind.pbRank, 1) + '</b> 分位' : '') +
        (isNum(ind.pbRank) && ind.pbRank > 70 ? '，板块 PB 分位本身偏高 → 整个赛道不算便宜' : ''));
    }
    pts.push('股息率 <b>' + pf(d.dividendYield, 2) + '</b>（近 12 个月已实施现金分红 ÷ 现价）' +
      (d.dividendYield >= 3 ? '，分红回报不错' : (isNum(d.dividendYield) && d.dividendYield < 1.5 ? '，分红贡献有限' : '')));

    return {
      html: '<section class="card layer" id="sec-l4">' + head + '<div class="layer-body">' +
        '<ul class="pts">' + pts.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>' +
        '<div class="charts">' +
          '<div class="chart wide" id="ch-pe"><h4>PE(TTM) 近 6 年走势<small>虚线为历史分位参考</small></h4></div>' +
          '<div class="chart" id="ch-ye"><h4>自算年末 PE<small>年末收盘价 ÷ 当年 EPS</small></h4></div>' +
          '<div class="chart" id="ch-ind"><h4>同业 PE 对比<small>按市值前 10</small></h4></div>' +
        '</div>' +
        peersTable(ind) +
        '</div></section>',
      after: function (C) {
        var ser = L.peSeries || [];
        var refs = [];
        if (isNum(ps.p20)) refs.push({ v: ps.p20, label: 'p20 ' + nf(ps.p20, 1), color: C.good });
        if (isNum(ps.p50)) refs.push({ v: ps.p50, label: '中位 ' + nf(ps.p50, 1), color: C.muted });
        if (isNum(ps.p80)) refs.push({ v: ps.p80, label: 'p80 ' + nf(ps.p80, 1), color: C.warn });
        chart($('#ch-pe'), {
          h: 250, labels: ser.map(function (p) { return (p.d || '').slice(0, 7); }),
          yFmt: function (v) { return v.toFixed(0); },
          series: [{ name: 'PE(TTM)', color: C.brand, values: ser.map(function (p) { return p.pe; }), dots: false, width: 1.8 }],
          refs: refs,
          tipFmt: function (v) { return nf(v, 2) + ' 倍'; }
        });
        chart($('#ch-ye'), {
          h: 210, labels: ye.map(function (y) { return y.year; }), baselineZero: true, showValues: true, barWidth: 0.58,
          series: [{ name: '年末 PE', type: 'bar', values: ye.map(function (y) { return y.pe; }), color: C.brand, opacity: 0.8 }],
          valFmt: function (v) { return nf(v, 1); },
          tipFmt: function (v) { return nf(v, 2) + ' 倍'; }
        });
        var peers = (ind.peers || []).slice(0, 10);
        chart($('#ch-ind'), {
          type: 'hbar', h: Math.max(150, peers.length * 24 + 10),
          items: peers.map(function (p) {
            return { label: p.name, value: isNum(p.pe) ? p.pe : 0, highlight: !!p.self, display: nf(p.pe, 1) };
          })
        });
      }
    };
  }

  /* ---------------- L5 资金筹码 ---------------- */
  function renderL5(d) {
    var L = d.l5 || {};
    var mr = L.marginRatio;
    var tone = !isNum(mr) ? 'muted' : (mr > 5 ? 'warn' : 'good');
    var head = layerHead('L5', '资金筹码', tone, lampWord(tone), '仅辅助 · 不计分');

    var pts = [];
    if (isNum(mr)) {
      pts.push('两融余额 / 流通市值 <b>' + pf(mr, 2) + '</b>' + (mr > 5 ? '（&gt;5%，交易拥挤，注意踩踏）' : '（不拥挤）'));
    } else {
      pts.push('该股不是两融标的，或暂无两融数据。');
    }
    if (isNum(L.rzTrend)) {
      pts.push('融资余额近 20 个交易日变化 <b>' + spf(L.rzTrend, 1) + '</b>' + (L.rzTrend > 0 ? '（资金在加）' : '（资金在撤）'));
    }
    pts.push('股息率 <b>' + pf(L.divYield, 2) + '</b>。本层不参与淘汰、不进综合分，只回答“这个位置挤不挤”。');

    return {
      html: '<section class="card layer" id="sec-l5">' + head + '<div class="layer-body">' +
        '<ul class="pts">' + pts.map(function (p) { return '<li>' + p + '</li>'; }).join('') + '</ul>' +
        '<div class="charts"><div class="chart wide" id="ch-mg"><h4>融资余额走势<small>近 25 个交易日，亿元</small></h4></div></div>' +
        '</div></section>',
      after: function (C) {
        var m = L.marginTrend || [];
        chart($('#ch-mg'), {
          h: 190, labels: m.map(function (x) { return (x.d || '').slice(5); }),
          series: [{ name: '融资余额', color: C.brand, values: m.map(function (x) { return x.value; }), area: true, dots: false, width: 2 }],
          yFmt: function (v) { return v.toFixed(0); },
          tipFmt: function (v) { return nf(v, 2) + ' 亿'; }
        });
      }
    };
  }

  /* ---------------- 口径 ---------------- */
  function note(title, body) {
    return '<div class="note-block"><h4>' + esc(title) + '</h4>' + body + '</div>';
  }
  function renderNotes(d) {
    return '<section class="card" id="sec-notes">' +
      '<div class="sec-head"><h3>口径与说明</h3><span class="sub">为什么这么算</span></div>' +
      '<div class="notes-grid">' +
        note('L1 排雷', '<ul><li>现金流含金量 = 5 年累计经营现金流 ÷ 5 年累计归母净利，&lt;0.8 淘汰</li><li>收现比 = 销售收现 ÷ 营业收入（金融股不适用）</li><li>资产负债率 &gt;80%、有息负债率 &gt;50%、商誉/净资产 &gt;30%、质押 &gt;30% 直接淘汰</li><li>扣非/归母近 3 年均值 &lt;60% 淘汰</li></ul>') +
        note('L2 盈利质量', '<ul><li>ROE 用证监会加权口径，5 年均值 ≥15% 满分</li><li>ROE 标准差 ≤2 加分，考察稳定性</li><li>权益乘数 &gt;2.5 时整体打 85 折，防止靠杠杆堆 ROE</li><li>ROIC ≥12% 加分、&lt;8% 扣分</li></ul>') +
        note('L3 增长稳定性', '<ul><li>用最近 3 个完整年度的营收 / 扣非 CAGR</li><li>年度增速标准差衡量波动</li><li>PEG = PE_TTM ÷ 扣非 CAGR</li><li>单季数据按季度相减还原，避免累计口径失真</li></ul>') +
        note('L4 估值', '<ul><li>PE/PB 分位取近 6 年日频数据；三档 PE = 静态 / TTM / 动态（最新报告期年化）</li><li>不强制三档 PE 差 ≤10%，改为比较“动态 PE 隐含增速”与“扣非实际 CAGR”</li><li>自算年末 PE = 年末收盘价 ÷ 当年 EPS，非官方分位</li><li>行业参照取同板块当日全部个股</li></ul>') +
        note('L5 资金筹码', '<ul><li>两融余额 / 流通市值 &gt;5% 视为交易拥挤</li><li>融资余额 20 日变化看资金方向</li><li>不参与淘汰、不计入综合分</li></ul>') +
        note('综合分与评级', '<ul><li>综合分 = L2×40% + L3×25% + L4×35%</li><li>A-可跟踪：L1 全通过 + 综合 ≥75 + L4 ≥50 + 5 年 ROE 均值 ≥15% + ROE 最低 ≥10%</li><li>B-观察 ≥65；C-谨慎 ≥50；D-不建议 &lt;50；L1 有淘汰 → D-排除</li><li>L1 有警告时最高只能到 B</li></ul>') +
      '</div>' +
      '<div class="disclaimer">局限：识别不了财务造假与表外负债；财报是后视镜，高分不代表会涨；周期股 PE 分位低可能是周期顶部；ROE 门槛天然排除次新股与亏损成长股。本工具只是机械筛子，<b>不构成投资建议</b>。</div>' +
      '<p class="muted" style="margin:12px 0 0;font-size:12px">数据源：东方财富数据中心 + 腾讯行情快照。生成时间 ' + esc(d.meta.generatedAt) +
      '，抓取用时 ' + (d.meta.elapsedMs ? (d.meta.elapsedMs / 1000).toFixed(1) + 's' : '—') + '。</p>' +
      '</section>';
  }

  /* ---------------- 组装 ---------------- */
  function renderAll(d, q) {
    CH.jobs = [];
    var parts = [];
    var afters = [];


    parts.push('<section class="card" id="sec-hero">' + heroHTML(d, q) + '</section>');
    parts.push(kpisHTML(d));
    parts.push(summaryHTML(d));
    parts.push(klineHTML());
    parts.push(tipsHTML());

    [renderL1, renderL2, renderL3, renderL4, renderL5].forEach(function (fn) {
      var out = fn(d);
      if (typeof out === 'string') { parts.push(out); return; }
      parts.push(out.html);
      if (out.after) afters.push(out.after);
    });
    parts.push(renderNotes(d));

    var report = $('#report');
    report.innerHTML = parts.join('');
    report.hidden = false;
    $('#welcome').hidden = true;
    $('#errorBox').hidden = true;
    $('#loading').hidden = true;
    $('#layerNav').hidden = false;

    var C = pal();
    afters.forEach(function (fn) { try { fn(C); } catch (e) { console.warn('chart error', e); } });
    updateNavTones(d);
    if (!kline.data || kline.code !== d.code) { kline.data = null; kline.daily = null; }
    klineLoad(d.code, kline.period || 'day', false);
    tipsRender();
    $('#footMeta').textContent = 'v' + (d.meta.version || '1.0') + ' · 数据截至 ' + (d.meta.dataAsOf || '—') +
      ' · 生成 ' + (d.meta.generatedAt || '') + (d.meta.cached ? ' · 命中缓存' : '') + ' · ' + (d.meta.source || '');

    window.scrollTo({ top: 0, behavior: 'smooth' });
    startQuoteTimer();
  }

  function updateNavTones(d) {
    var map = {
      'sec-l1': (d.l1.kill > 0 ? 'bad' : (d.l1.warn > 0 ? 'warn' : 'good')),
      'sec-l2': toneOfScore(d.l2.score),
      'sec-l3': (d.l3.momentum && d.l3.momentum.tone) || toneOfScore(d.l3.score),
      'sec-l4': toneOfScore(d.l4.score),
      'sec-l5': (isNum(d.l5.marginRatio) && d.l5.marginRatio > 5) ? 'warn' : 'muted'
    };
    Object.keys(map).forEach(function (id) {
      var a = $('.layer-nav a[data-spy="' + id + '"]');
      if (!a) return;
      var dot = a.querySelector('.dot');
      if (dot) dot.className = 'dot t-' + map[id];
    });
  }

  /* ---------------- 查询流程 ---------------- */
  function showLoading(code) {
    $('#report').hidden = true;
    $('#welcome').hidden = true;
    $('#errorBox').hidden = true;
    $('#loading').hidden = false;
    $('#layerNav').hidden = true;
    $('#loadingTxt').textContent = '正在联网抓取 ' + (code || '') + ' 的财报与估值数据…';
  }
  // file:// 打开时，尝试在 5218~5228 里找到正在运行的本机服务
  function detectServer() {
    var ports = [];
    for (var p = 5218; p <= 5228; p++) ports.push(p);
    return ports.reduce(function (chain, p) {
      return chain.then(function (found) {
        if (found) return found;
        var base = 'http://localhost:' + p;
        return fetch(base + '/api/health')
          .then(function (r) { return r.ok ? r.text() : null; })
          .then(function (txt) {
            try { var j = JSON.parse(txt); return (j && j.ok) ? base : null; } catch (e) { return null; }
          })
          .catch(function () { return null; });
      });
    }, Promise.resolve(null));
  }

  function showFileNotice() {
    $('#loading').hidden = true;
    $('#report').hidden = true;
    $('#welcome').hidden = true;
    $('#layerNav').hidden = true;
    $('#errorBox').hidden = false;
    $('#errorTitle').textContent = '请用启动器打开';
    $('#errorTitle').className = 'warn';
    $('#errorMsg').textContent = '你现在是直接双击 index.html 打开的（地址栏以 file:// 开头），而且没检测到本机服务在运行（5218~5228 都没响应）。这种页面自己不能联网取数，所以查询会失败，刷新也没用。';
    $('#errorHint').innerHTML = '关掉本页 → 回到文件夹「五层基本面评分网页版」→ 双击 <b>启动网页版.bat</b> → 浏览器会自动打开 <b>http://localhost:5218/</b>，在那里再查询。<br>那个黑窗口就是服务本身，查询期间不要关；端口被占用时它可能会换成 5219、5220…，以窗口里打印的地址为准。';
    $('#retryBtn').hidden = true;
  }

  function showError(msg) {
    if (FILE_MODE && !API && !STANDALONE) { showFileNotice(); return; }
    $('#errorTitle').textContent = '分析失败';
    $('#errorTitle').className = '';
    $('#errorHint').innerHTML = '可检查：是否为 6 位 A 股代码；服务窗口是否还开着；网络能否访问东方财富。';
    $('#retryBtn').hidden = false;
    $('#loading').hidden = true;
    $('#report').hidden = true;
    $('#welcome').hidden = true;
    $('#layerNav').hidden = true;
    $('#errorBox').hidden = false;
    $('#errorMsg').textContent = msg || '未知错误';
  }

  function analyze(code, opts) {
    if (FILE_MODE && !API && !STANDALONE) { showFileNotice(); return; }
    scanClose();
    newsClose();
    watchClose();
    indicesClose();
    premarketClose();
    limitupClose();
    opts = opts || {};
    code = String(code || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code)) { showError('请输入 6 位 A 股代码，例如 002475'); return; }
    state.code = code;
    var my = ++state.req;
    showLoading(code);
    try { history.replaceState(null, '', '#/' + code); } catch (e) { location.hash = '#/' + code; }

    var t0 = Date.now();
    var quoteP = fetchJSON(API + '/api/quote?code=' + code).catch(function () { return null; });

    fetchJSON(API + '/api/analyze?code=' + code + (opts.refresh ? '&refresh=1' : ''))
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || '接口返回异常');
        return quoteP.then(function (q) {
          if (my !== state.req) return;
          state.data = d; state.quote = q;
          renderAll(d, q);
          pushHistory(d);
          if (opts.refresh) toast('已重新联网抓取 · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
        });
      })
      .catch(function (e) {
        if (my !== state.req) return;
        showError(e && e.message ? e.message : String(e));
      });
  }

  function refreshQuote() {
    if (!state.code || !state.data) return;
    fetchJSON(API + '/api/quote?code=' + state.code).then(function (q) {
      if (!q || !q.ok) return;
      state.quote = q;
      var p = $('.hero-price .p'), chg = $('.hero-price .chg');
      if (p) p.textContent = nf(q.price, 2);
      if (chg) {
        chg.textContent = spf(q.changePct, 2) + '　' + (q.change > 0 ? '+' : '') + nf(q.change, 2);
        chg.className = 'chg ' + (q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : '');
      }
      tipsRender();
      if (kline.data && kline.data.ok && !$('#report').hidden) drawKlineChart();
    }).catch(function () {});
  }
  function startQuoteTimer() {
    if (state.quoteTimer) clearInterval(state.quoteTimer);
    state.quoteTimer = setInterval(refreshQuote, 30000);
  }

  /* ---------------- 历史记录 ---------------- */
  function loadHistory() {
    try { state.history = JSON.parse(localStorage.getItem('wf5_history') || '[]') || []; }
    catch (e) { state.history = []; }
  }
  function pushHistory(d) {
    var list = state.history.filter(function (x) { return x.code !== d.code; });
    list.unshift({ code: d.code, name: d.name });
    state.history = list.slice(0, 8);
    try { localStorage.setItem('wf5_history', JSON.stringify(state.history)); } catch (e) {}
    renderHistory();
  }
  function renderHistory() {
    var box = $('#historyBox'), list = $('#historyList');
    if (!box || !list) return;
    if (!state.history.length) { box.hidden = true; return; }
    box.hidden = false;
    list.innerHTML = state.history.map(function (x) {
      return '<button data-code="' + esc(x.code) + '">' + esc(x.name) + ' ' + esc(x.code) + '</button>';
    }).join('');
  }

  /* ---------------- 主题 / 提示 ---------------- */
  function applyTheme(t) {
    state.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('wf5_theme', t); } catch (e) {}
    CH.palette = pal();
    CH.jobs.forEach(function (j) { drawChart(j.host, j.spec); });
    if (kline.data && kline.data.ok && !$('#report').hidden) drawKlineChart();
    if (state.data) {
      var hero = $('#sec-hero');
      if (hero) hero.innerHTML = heroHTML(state.data, state.quote);
    }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------------- 全 A 股扫描（初筛） ---------------- */
  var scan = {
    rows: [], date: '', loaded: false, timer: null,
    sortKey: 'score', sortDir: -1, page: 0, pageSize: 50, q: '', rating: ''
  };

  function scanClose() {
    $('#scanView').hidden = true;
    if (scan.timer) { clearInterval(scan.timer); scan.timer = null; }
  }

  function scanOpen() {
    if (FILE_MODE && !API && !STANDALONE) { showFileNotice(); return; }
    deepClose();
    newsClose();
    watchClose();
    indicesClose();
    premarketClose();
    limitupClose();
    $('#welcome').hidden = true;
    $('#report').hidden = true;
    $('#loading').hidden = true;
    $('#errorBox').hidden = true;
    $('#layerNav').hidden = true;
    $('#scanView').hidden = false;
    try { history.replaceState(null, '', '#/scan'); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (scan.loaded) { scanRender(); return; }
    scanCheck();
  }

  function scanSetProgress(phase, cur, total, note) {
    $('#scanProgress').hidden = false;
    $('#scanPhase').textContent = phase || '准备中';
    var pct = 4;
    if (phase === '拉取估值快照') pct = 10;
    else if (phase === '拉取近 5 年年报') pct = 12 + (total > 0 ? cur / total * 72 : 0);
    else if (phase === '计算评分') pct = 92;
    else if (phase === '完成') pct = 100;
    $('#scanBar').style.width = Math.max(0, Math.min(100, pct)) + '%';
    $('#scanCount').textContent = note || (total > 0 ? cur + ' / ' + total : '');
  }

  function scanIdle() {
    $('#scanProgress').hidden = true;
    $('#scanStart').disabled = false;
    $('#scanStart').textContent = '开始扫描';
  }

  function scanCheck() {
    $('#scanStart').disabled = true;
    $('#scanStart').textContent = '检查中…';
    fetchJSON(API + '/api/scan/status').then(function (s) {
      if (!s || !s.ok) { scanIdle(); return; }
      if (s.running) { scanPoll(); return; }
      if (s.done && s.count > 0) { scanLoadResult(); return; }
      if (s.done && s.error) {
        $('#scanProgress').hidden = false;
        $('#scanPhase').textContent = '上次扫描失败';
        $('#scanCount').textContent = s.error;
        $('#scanStart').disabled = false;
        $('#scanStart').textContent = '重新扫描';
        return;
      }
      scanIdle();
    }).catch(function () { scanIdle(); });
  }

  function scanPoll() {
    $('#scanStart').disabled = true;
    $('#scanStart').textContent = '扫描中…';
    if (scan.timer) return;
    scan.timer = setInterval(function () {
      fetchJSON(API + '/api/scan/status').then(function (s) {
        if (!s || !s.ok) return;
        var note = s.total > 0 ? (s.current + ' / ' + s.total) : '';
        if (s.running) { scanSetProgress(s.phase, s.current, s.total, note); return; }
        clearInterval(scan.timer); scan.timer = null;
        $('#scanStart').disabled = false;
        if (s.error) {
          scanSetProgress('扫描失败', 0, 0, s.error);
          $('#scanStart').textContent = '重新扫描';
          return;
        }
        scanSetProgress('完成', 1, 1, s.count + ' 只');
        setTimeout(scanLoadResult, 300);
      }).catch(function () {});
    }, 1000);
  }

  function scanStart() {
    $('#scanStart').disabled = true;
    $('#scanStart').textContent = '扫描中…';
    $('#scanToolbar').hidden = true;
    $('#scanCsv').hidden = true;
    $('#scanTableWrap').innerHTML = '';
    scanSetProgress('连接数据源', 0, 0, '约 20~40 秒');
    fetchJSON(API + '/api/scan/start').then(function (r) {
      if (r && r.started === false && r.running) { scanPoll(); return; }
      if (r && r.ok) { scanPoll(); return; }
      scanSetProgress('启动失败', 0, 0, (r && r.error) || '接口异常');
      $('#scanStart').disabled = false;
      $('#scanStart').textContent = '重新扫描';
    }).catch(function (e) {
      scanSetProgress('启动失败', 0, 0, e && e.message ? e.message : String(e));
      $('#scanStart').disabled = false;
      $('#scanStart').textContent = '重新扫描';
    });
  }

  function scanLoadResult() {
    fetchJSON(API + '/api/scan/result').then(function (r) {
      if (!r || !r.ok) { scanIdle(); return; }
      scan.rows = r.rows || [];
      scan.date = r.date || '';
      scan.loaded = true;
      scan.page = 0;
      $('#scanProgress').hidden = true;
      $('#scanStart').disabled = false;
      $('#scanStart').textContent = '重新扫描';
      $('#scanCsv').hidden = false;
      $('#scanDeep').hidden = false;
      $('#scanToolbar').hidden = false;
      scanRender();
      toast('扫描完成 · ' + scan.rows.length + ' 只');
    }).catch(function (e) {
      scanSetProgress('读取结果失败', 0, 0, e && e.message ? e.message : String(e));
    });
  }

  var SCAN_COLS = [
    { k: 'idx', t: '#', w: 46 },
    { k: 'code', t: '代码', w: 66 },
    { k: 'name', t: '名称', w: 96 },
    { k: 'board', t: '行业', w: 92, m: 2 },
    { k: 'score', t: '评分', w: 62 },
    { k: 'q', t: '质量', w: 52, m: 1 },
    { k: 'g', t: '成长', w: 52, m: 1 },
    { k: 'v', t: '估值', w: 52, m: 1 },
    { k: 'rating', t: '评级', w: 52 },
    { k: 'pe', t: 'PE', w: 60, m: 1 },
    { k: 'pb', t: 'PB', w: 60, m: 1 },
    { k: 'roe', t: 'ROE', w: 62, m: 1 },
    { k: 'revc', t: '营收CAGR', w: 86, m: 1 },
    { k: 'npc', t: '净利CAGR', w: 86, m: 1 },
    { k: 'cap', t: '市值', w: 74, m: 1 },
    { k: 'flags', t: '标记', w: 0 }
  ];

  function scanFiltered() {
    var q = scan.q.trim().toLowerCase();
    var arr = scan.rows;
    if (q) {
      arr = arr.filter(function (r) {
        return (r.code && r.code.indexOf(q) >= 0) ||
          (r.name && String(r.name).toLowerCase().indexOf(q) >= 0) ||
          (r.board && String(r.board).toLowerCase().indexOf(q) >= 0);
      });
    }
    if (scan.rating) arr = arr.filter(function (r) { return r.rating === scan.rating; });
    var k = scan.sortKey, d = scan.sortDir;
    arr = arr.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (k === 'name' || k === 'board' || k === 'rating' || k === 'code' || k === 'flags') {
        return String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'zh') * (d < 0 ? -1 : 1);
      }
      if (x == null) x = -1e9;
      if (y == null) y = -1e9;
      return (x - y) * d;
    });
    return arr;
  }

  function scanCell(r, k, rank) {
    if (k === 'idx') return '<span class="muted">' + rank + '</span>';
    if (k === 'code') return '<span class="sc-code">' + esc(r.code) + '</span>';
    if (k === 'name') return '<b>' + esc(r.name) + '</b>';
    if (k === 'board') return '<span class="muted">' + esc(r.board) + '</span>';
    if (k === 'score') return '<b class="sc-score t-' + toneOfScore(r.score) + '">' + nf(r.score, 1) + '</b>';
    if (k === 'q') return nf(r.q, 0);
    if (k === 'g') return nf(r.g, 0);
    if (k === 'v') return nf(r.v, 0);
    if (k === 'rating') return '<span class="rt r-' + r.rating + '">' + esc(r.rating) + '</span>';
    if (k === 'pe') return nf(r.pe, 1);
    if (k === 'pb') return nf(r.pb, 2);
    if (k === 'roe') return pf(r.roe, 1);
    if (k === 'revc') return '<span class="' + (r.revc > 0 ? 'up' : r.revc < 0 ? 'down' : '') + '">' + spf(r.revc, 1) + '</span>';
    if (k === 'npc') return '<span class="' + (r.npc > 0 ? 'up' : r.npc < 0 ? 'down' : '') + '">' + spf(r.npc, 1) + '</span>';
    if (k === 'cap') return nf(r.cap, 0) + ' 亿';
    if (k === 'flags') return '<span class="sc-flag">' + esc(r.flags || '') + '</span>';
    return '';
  }

  function scanRender() {
    var arr = scanFiltered();
    var total = arr.length;
    var pages = Math.max(1, Math.ceil(total / scan.pageSize));
    if (scan.page >= pages) scan.page = pages - 1;
    var start = scan.page * scan.pageSize;
    var slice = arr.slice(start, start + scan.pageSize);

    var meta = '共 ' + scan.rows.length + ' 只 · 估值日 ' + (scan.date || '—');
    if (total !== scan.rows.length) meta += ' · 筛选后 ' + total + ' 只';
    $('#scanMeta').textContent = meta;

    var head = '<tr>' + SCAN_COLS.map(function (c) {
      var on = scan.sortKey === c.k ? ' on' : '';
      var arrow = scan.sortKey === c.k ? (scan.sortDir < 0 ? ' ↓' : ' ↑') : '';
      return '<th class="' + (c.m ? 'hide-s' : '') + on + '" data-sk="' + c.k + '">' + c.t + arrow + '</th>';
    }).join('') + '</tr>';

    var body = slice.map(function (r, i) {
      return '<tr class="scan-row" data-code="' + esc(r.code) + '">' +
        SCAN_COLS.map(function (c) {
          return '<td class="' + (c.m ? 'hide-s' : '') + '">' + scanCell(r, c.k, start + i + 1) + '</td>';
        }).join('') + '</tr>';
    }).join('');

    var pager = '<div class="scan-pager">' +
      '<button class="ghost" data-pg="-1"' + (scan.page <= 0 ? ' disabled' : '') + '>上一页</button>' +
      '<span class="muted">第 ' + (scan.page + 1) + ' / ' + pages + ' 页</span>' +
      '<button class="ghost" data-pg="1"' + (scan.page >= pages - 1 ? ' disabled' : '') + '>下一页</button>' +
      '</div>';

    $('#scanTableWrap').innerHTML =
      '<div class="card scan-table-card">' +
      '<div class="scan-scroll"><table class="scan-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      (total === 0 ? '<p class="muted scan-empty">没有符合条件的股票</p>' : '') +
      pager +
      '</div>';
  }

  function scanCsv() {
    var arr = scanFiltered();
    var lines = ['排名,代码,名称,行业,评分,质量,成长,估值,评级,PE,PB,ROE%,营收CAGR%,净利CAGR%,毛利率%,市值亿,标记'];
    arr.forEach(function (r, i) {
      lines.push([i + 1, r.code, r.name, r.board, r.score, r.q, r.g, r.v, r.rating,
        r.pe == null ? '' : r.pe, r.pb == null ? '' : r.pb,
        r.roe == null ? '' : r.roe, r.revc == null ? '' : r.revc, r.npc == null ? '' : r.npc,
        r.gm == null ? '' : r.gm, r.cap == null ? '' : r.cap,
        (r.flags || '').replace(/,/g, ' ')].join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '全A股初筛_' + (scan.date || 'today') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('已导出 ' + arr.length + ' 行');
  }

  /* ---------------- 资金面 / 技术面 深度分析 ---------------- */
  var deep = { results: [], busy: false, queue: [], idx: 0 };

  function deepClose() {
    var v = $('#deepView');
    if (v) v.hidden = true;
  }

  function deepOpen(codes) {
    if (FILE_MODE && !API && !STANDALONE) { showFileNotice(); return; }
    $('#welcome').hidden = true;
    $('#report').hidden = true;
    $('#loading').hidden = true;
    $('#errorBox').hidden = true;
    $('#layerNav').hidden = true;
    scanClose();
    newsClose();
    watchClose();
    indicesClose();
    premarketClose();
    limitupClose();
    $('#deepView').hidden = false;
    try { history.replaceState(null, '', '#/deep'); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (codes) {
      $('#deepInput').value = codes;
      deepRun();
    } else {
      setTimeout(function () { try { $('#deepInput').focus(); } catch (e) {} }, 120);
    }
  }

  function deepParse(txt) {
    var raw = String(txt || '').toUpperCase().replace(/[^0-9A-Z,，;；\s]/g, ' ');
    var out = [], seen = {};
    raw.split(/[\s,，;；]+/).forEach(function (w) {
      if (/^\d{6}$/.test(w) && !seen[w]) { seen[w] = 1; out.push(w); }
    });
    return out;
  }

  function dtag(tone, word) { return '<em class="dtag ' + tone + '">' + esc(word) + '</em>'; }
  function drow(label, value, tone, note) {
    return '<div class="drow"><span class="dlbl">' + esc(label) + '</span>' +
      '<span class="dval">' + value + (tone ? dtag(tone, { good: '优', warn: '中性', bad: '弱', info: '—' }[tone] || '') : '') + '</span>' +
      (note ? '<span class="dnote">' + note + '</span>' : '') + '</div>';
  }

  function toneBy(v, good, bad) {
    if (!isNum(v)) return '';
    if (v >= good) return 'good';
    if (v <= bad) return 'bad';
    return 'warn';
  }

  function svgSpark(pts, opt) {
    opt = opt || {};
    var w = 320, h = opt.h || 64, pad = 3;
    if (!pts.length) return '';
    var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts);
    if (mx === mn) { mx = mn + 1; }
    var stepX = (w - pad * 2) / Math.max(1, pts.length - 1);
    var xy = pts.map(function (v, i) {
      return [pad + i * stepX, h - pad - (v - mn) / (mx - mn) * (h - pad * 2)];
    });
    var d = xy.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = d + ' L' + xy[xy.length - 1][0].toFixed(1) + ' ' + (h - pad) + ' L' + xy[0][0].toFixed(1) + ' ' + (h - pad) + ' Z';
    var col = opt.color || 'var(--brand)';
    return '<svg class="dspark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<path d="' + area + '" fill="' + col + '" opacity="0.10"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round"/>' +
      '</svg>';
  }

  function svgBars(pts, w, h) {
    if (!pts.length) return '';
    var mx = Math.max.apply(null, pts.map(function (p) { return Math.abs(p.v); })) || 1;
    var bw = (w - 8) / pts.length;
    var zero = 4 + (h - 8) / 2;
    var out = ['<svg class="dspark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'];
    out.push('<line x1="0" y1="' + zero.toFixed(1) + '" x2="' + w + '" y2="' + zero.toFixed(1) + '" stroke="var(--line)" stroke-width="1"/>');
    pts.forEach(function (p, i) {
      var hh = Math.abs(p.v) / mx * ((h - 8) / 2);
      var x = 4 + i * bw + bw * 0.18;
      var y = p.v >= 0 ? zero - hh : zero;
      out.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw * 0.64).toFixed(1) + '" height="' + Math.max(0.8, hh).toFixed(1) + '" fill="' + (p.v >= 0 ? 'var(--up)' : 'var(--down)') + '" opacity="0.85"/>');
    });
    out.push('</svg>');
    return out.join('');
  }

  function deepCardHead(r) {
    var s = r.scores || {};
    var pct = r.pct;
    var cls = isNum(pct) ? (pct > 0 ? 'up' : pct < 0 ? 'dn' : '') : '';
    return '<header class="dcard-head">' +
      '<div class="dcard-id"><b>' + esc(r.name) + '</b><span class="dcard-code">' + esc(r.code) + '</span>' +
      (r.board ? '<span class="dcard-board">' + esc(r.board) + '</span>' : '') + '</div>' +
      '<div class="dcard-price"><b class="' + cls + '">' + nf(r.price, 2) + '</b><span class="' + cls + '">' + spf(pct, 2) + '</span>' +
      '<span class="muted dcard-date">' + esc(r.asOf) + '</span></div>' +
      '<div class="dcard-scores">' +
      '<div class="dsco ' + toneOfScore(s.tech) + '"><b>' + nf(s.tech, 1) + '</b><span>技术</span></div>' +
      '<div class="dsco ' + toneOfScore(s.fund) + '"><b>' + nf(s.fund, 1) + '</b><span>资金</span></div>' +
      '<div class="dsco ' + toneOfScore(s.total) + '"><b>' + nf(s.total, 1) + '</b><span>综合</span></div>' +
      '</div></header>';
  }

  function deepPriceChart(r) {
    var k = (r.series && r.series.k) || [];
    if (!k.length) return '';
    var closes = k.map(function (x) { return x.c; });
    var vols = k.map(function (x) { return x.v; });
    var last = closes[closes.length - 1], first = closes[0];
    var chg = first ? (last - first) / first * 100 : 0;
    return '<div class="dchart"><div class="dchart-t"><span>近 ' + k.length + ' 个交易日走势</span>' +
      '<span class="muted">区间 ' + spf(chg, 1) + ' · 最高 ' + nf(Math.max.apply(null, closes), 2) + ' · 最低 ' + nf(Math.min.apply(null, closes), 2) + '</span></div>' +
      svgSpark(closes, { h: 90, color: chg >= 0 ? 'var(--up)' : 'var(--down)' }) +
      '<div class="dchart-v">' + svgBars(vols.map(function (v) { return { v: v }; }), 320, 34) + '</div>' +
      '<div class="dchart-x"><span>' + esc(k[0].d) + '</span><span>' + esc(k[k.length - 1].d) + '</span></div></div>';
  }

  function deepTech(r) {
    var t = r.tech || {}, s = r.scores || {};
    var ind = t.indicators || {}, ma = t.ma || {}, st = t.structure || {}, vp = t.volprice || {}, rs = t.rs || {};
    var h = '';

    /* ① 趋势与均线 */
    var maRows = (ma.rows || []).map(function (x) {
      var tone = isNum(x.pos) ? (x.pos > 0 ? 'up' : 'dn') : '';
      return '<tr><td>MA' + x.n + '</td><td>' + nf(x.v, 2) + '</td><td class="' + (isNum(x.slope) ? (x.slope > 0 ? 'up' : 'dn') : '') + '">' + spf(x.slope, 2) + '</td><td class="' + tone + '">' + spf(x.pos, 2) + '</td></tr>';
    }).join('');
    h += '<section class="dgrp"><h4>① 趋势与均线' + (ma.order ? dtag(ma.orderTone, ma.order) : '') + '</h4><div class="dgrp-body">' +
      '<table class="dtable"><thead><tr><th>均线</th><th>数值</th><th>5 日斜率</th><th>价格偏离</th></tr></thead><tbody>' + maRows + '</tbody></table>' +
      drow('均线排列', esc(ma.order || '—'), ma.orderTone, '多头排列＝短期均线全部在长期均线之上') +
      drow('最近交叉', esc(ma.cross || '近 10 日无 MA5/MA20 交叉'), ma.crossTone) +
      drow('均线粘合度', (isNum(ma.stick) ? nf(ma.stick, 2) + '%' : '—'), isNum(ma.stick) ? (ma.stick < 2 ? 'good' : 'warn') : '', 'MA5/10/20 极差占股价比例，越小越粘合，越易变盘') +
      '</div></section>';

    /* ② 多周期共振 */
    function mpCell(dir, macd) {
      var d = dir > 0 ? '<span class="up">MA20 向上</span>' : dir < 0 ? '<span class="dn">MA20 向下</span>' : '<span class="muted">MA20 走平</span>';
      var m = macd > 0 ? '<span class="up">MACD 红柱</span>' : macd < 0 ? '<span class="dn">MACD 绿柱</span>' : '<span class="muted">MACD 零轴</span>';
      return '<span class="mp-l">' + d + '</span><span class="mp-l">' + m + '</span>';
    }
    var mm = t.multi || {};
    var cnt = 0;
    [mm.month, mm.week, mm.day].forEach(function (x) { if (x && x.ma20dir > 0 && x.macd > 0) cnt++; });
    h += '<section class="dgrp"><h4>② 多周期共振' + dtag(cnt >= 3 ? 'good' : cnt === 0 ? 'bad' : 'warn', cnt >= 3 ? '三周期同向' : cnt === 0 ? '三周期走弱' : '周期分歧') + '</h4><div class="dgrp-body">' +
      '<div class="dgrid3"><div><span class="muted">月线（定方向）</span><b>' + mpCell(mm.month && mm.month.ma20dir, mm.month && mm.month.macd) + '</b></div>' +
      '<div><span class="muted">周线（定结构）</span><b>' + mpCell(mm.week && mm.week.ma20dir, mm.week && mm.week.macd) + '</b></div>' +
      '<div><span class="muted">日线（定位置）</span><b>' + mpCell(mm.day && mm.day.ma20dir, mm.day && mm.day.macd) + '</b></div></div>' +
      (mm.h60 ? drow('60 分钟（定入场）', nf(mm.h60.close, 2) + ' · MA20 ' + nf(mm.h60.ma20, 2) + ' · MACD ' + nf(mm.h60.hist, 3), mm.h60.hist > 0 ? 'good' : 'bad', 'KDJ ' + nf(mm.h60.k, 1) + '/' + nf(mm.h60.d, 1)) : '') +
      drow('共振度', cnt + ' / 3 个周期向上', cnt >= 3 ? 'good' : cnt === 0 ? 'bad' : 'warn', '月线定方向、周线定结构、日线定位置') +
      '</div></section>';

    /* ③ 价格结构 */
    var supTxt = (st.sup || []).map(function (x) { return esc(x.t) + ' <b>' + nf(x.v, 2) + '</b>'; }).join('　');
    var resTxt = (st.res || []).map(function (x) { return esc(x.t) + ' <b>' + nf(x.v, 2) + '</b>'; }).join('　');
    h += '<section class="dgrp"><h4>③ 价格结构' + (st.pattern ? dtag(st.patternTone, /HH/.test(st.pattern) ? '上升结构' : /LH/.test(st.pattern) ? '下降结构' : '结构分歧') : '') + '</h4><div class="dgrp-body">' +
      drow('60 日区间', nf(st.lo60, 2) + ' ~ ' + nf(st.hi60, 2), '', '当前位于区间 <b>' + nf(st.pos60, 1) + '%</b> 分位') +
      drow('120 日区间', nf(st.lo120, 2) + ' ~ ' + nf(st.hi120, 2)) +
      drow('K 线结构', esc(st.pattern || '—'), st.patternTone) +
      (st.box ? drow('箱体', esc(st.box), st.boxTone) : '') +
      drow('缺口', (st.gaps && st.gaps.length) ? esc(st.gaps.join('；')) : '近 20 日无跳空缺口', (st.gaps && st.gaps.length) ? 'warn' : '') +
      drow('突破状态', esc(st.breakout || '—'), st.breakTone) +
      '<div class="dlevels"><div><span class="muted">支撑</span>' + (supTxt || '—') + '</div><div><span class="muted">压力</span>' + (resTxt || '—') + '</div></div>' +
      '</div></section>';

    /* ④ 指标族 */
    var mc = ind.macd || {}, bl = ind.boll || {}, rsi = ind.rsi || {}, kdj = ind.kdj || {}, dmi = ind.dmi || {}, atr = ind.atr || {};
    var rsiV = rsi.r14, kdV = kdj.k, jdV = kdj.j, pctB = bl.pctB;
    h += '<section class="dgrp"><h4>④ 指标族</h4><div class="dgrp-body">' +
      drow('MACD', 'DIF ' + nf(mc.dif, 3) + ' / DEA ' + nf(mc.dea, 3) + ' / 柱 ' + nf(mc.hist, 3),
        isNum(mc.hist) ? (mc.hist > 0 ? 'good' : 'bad') : '',
        esc(mc.zero || '') + '，' + esc(mc.cross || '') + (mc.div ? '，' + esc(mc.div) : '')) +
      drow('布林带 BOLL', '中 ' + nf(bl.mid, 2) + ' / 上 ' + nf(bl.up, 2) + ' / 下 ' + nf(bl.low, 2), isNum(pctB) ? (pctB > 80 ? 'warn' : pctB < 20 ? 'warn' : 'good') : '',
        '带宽 ' + nf(bl.width, 2) + '%，价格位于带内 <b>' + nf(pctB, 0) + '%</b> 位置' + (isNum(bl.width) && bl.width < 10 ? '，带宽收窄（变盘前夜）' : '')) +
      drow('RSI', 'RSI6 ' + nf(rsi.r6, 1) + ' / RSI14 ' + nf(rsi.r14, 1), isNum(rsiV) ? (rsiV > 70 ? 'warn' : rsiV < 30 ? 'good' : 'good') : '', isNum(rsiV) ? (rsiV > 70 ? '超买区' : rsiV < 30 ? '超卖区' : '中性偏强') : '') +
      drow('KDJ', 'K ' + nf(kdj.k, 1) + ' / D ' + nf(kdj.d, 1) + ' / J ' + nf(kdj.j, 1), isNum(kdV) && isNum(kdj.d) ? (kdV > kdj.d ? 'good' : 'bad') : '', isNum(jdV) ? (jdV > 100 ? 'J 值过高（超买）' : jdV < 0 ? 'J 值过低（超卖）' : '') : '') +
      drow('CCI(14)', nf(ind.cci, 1), isNum(ind.cci) ? (ind.cci > 100 ? 'good' : ind.cci < -100 ? 'bad' : 'warn') : '') +
      drow('威廉 %R(14)', nf(ind.wr, 1), isNum(ind.wr) ? (ind.wr < 20 ? 'warn' : ind.wr > 80 ? 'good' : '') : '', '0 为最强、100 为最弱') +
      drow('DMI / ADX', '+DI ' + nf(dmi.pdi, 1) + ' / -DI ' + nf(dmi.mdi, 1) + ' / ADX ' + nf(dmi.adx, 1),
        isNum(dmi.adx) ? (dmi.adx > 25 && dmi.pdi > dmi.mdi ? 'good' : dmi.adx > 25 && dmi.pdi < dmi.mdi ? 'bad' : 'warn') : '',
        isNum(dmi.adx) ? (dmi.adx > 25 ? '趋势明确' : '趋势偏弱（震荡）') : '') +
      drow('ATR(14)', nf(atr.v, 2) + '（' + pf(atr.pct, 2) + '）', isNum(atr.pct) ? (atr.pct > 5 ? 'warn' : 'good') : '', '日均波幅，越大越难拿') +
      drow('OBV 斜率', spf(ind.obv && ind.obv.slope, 1) + '（10 日）', ind.obv && ind.obv.slope > 0 ? 'good' : 'bad', '量能累积方向') +
      drow('VR(26)', nf(ind.vr, 1), isNum(ind.vr) ? (ind.vr > 160 ? 'warn' : ind.vr < 70 ? 'good' : 'warn') : '', isNum(ind.vr) ? (ind.vr > 160 ? '成交过热' : ind.vr < 70 ? '成交低迷' : '正常') : '') +
      '</div></section>';

    /* ⑤ 量价配合 */
    h += '<section class="dgrp"><h4>⑤ 量价配合' + (vp.today ? dtag(vp.tone, vp.today.slice(0, 4)) : '') + '</h4><div class="dgrp-body">' +
      drow('今日组合', esc(vp.today || '—'), vp.tone, '量比 ' + nf(vp.volRatio, 2)) +
      drow('今日成交量', nf(vp.volToday, 1) + ' 万手', '', '20 日均量 ' + nf(vp.volMa20, 1) + ' 万手') +
      drow('5 日量能变化', '×' + nf(vp.vr5, 2), isNum(vp.vr5) ? (vp.vr5 > 1.2 ? 'good' : vp.vr5 < 0.8 ? 'warn' : 'warn') : '') +
      (vp.climax ? drow('量价异动', esc(vp.climax), 'warn') : '') +
      '</div></section>';

    /* ⑥ 相对强弱 */
    h += '<section class="dgrp"><h4>⑥ 相对强弱</h4><div class="dgrp-body">' +
      drow('个股 5 / 20 / 60 日', spf(rs.r5, 2) + ' / ' + spf(rs.r20, 2) + ' / ' + spf(rs.r60, 2)) +
      drow('上证同期 5 / 20 日', spf(rs.i5, 2) + ' / ' + spf(rs.i20, 2)) +
      drow('RS（20 日超额）', spf(rs.rs20, 2), isNum(rs.rs20) ? (rs.rs20 > 3 ? 'good' : rs.rs20 < -3 ? 'bad' : 'warn') : '', isNum(rs.rs20) ? (rs.rs20 > 0 ? '跑赢大盘' : '跑输大盘') : '') +
      '</div></section>';

    return h;
  }

  function deepFund(r) {
    var f = r.fund || {}, mf = f.mainflow || {}, n = f.north || {}, mg = f.margin || {}, bh = f.behavior || {}, cs = f.cost || {}, ev = f.env || {}, lq = f.liquidity || {};
    var h = '';

    /* ① 量能底座 */
    h += '<section class="dgrp"><h4>① 量能底座' + dtag(lq.turnover > 0.5 ? 'good' : 'warn', lq.turnover > 0.5 ? '活跃' : '清淡') + '</h4><div class="dgrp-body">' +
      drow('成交额', nf(lq.amount, 2) + ' 亿', '', '处于自身近 60 日 <b>' + nf(lq.amtPct, 0) + '%</b> 分位') +
      drow('成交量', nf(lq.volume, 1) + ' 万手') +
      drow('换手率', pf(lq.turnover, 2), isNum(lq.turnover) ? (lq.turnover > 3 ? 'good' : lq.turnover < 0.5 ? 'warn' : 'info') : '') +
      drow('量比', nf(lq.volRatio, 2), isNum(lq.volRatio) ? (lq.volRatio > 1.2 ? 'good' : lq.volRatio < 0.6 ? 'bad' : 'warn') : '', '相对前 5 日均量') +
      '</div></section>';

    /* ② 主力与大单 */
    if (mf && mf.ok !== false) {
      var flowPts = (mf.series || []).map(function (p) { return { v: p.v }; });
      h += '<section class="dgrp"><h4>② 主力与大单流向' + dtag(mf.today > 1 ? 'good' : mf.today < -1 ? 'bad' : 'warn', mf.today > 0 ? '净流入' : '净流出') + '</h4><div class="dgrp-body">' +
        '<div class="dflow-chart">' + svgBars(flowPts, 320, 52) + '<span class="muted">近 ' + flowPts.length + ' 日主力净流入（亿元）</span></div>' +
        drow('今日主力净额', nf(mf.today, 2) + ' 亿', mf.today > 0 ? 'good' : 'bad') +
        drow('结构（今日）', '超大 ' + nf(mf.super, 2) + ' / 大 ' + nf(mf.big, 2) + ' / 中 ' + nf(mf.mid, 2) + ' / 小 ' + nf(mf.small, 2) + ' 亿') +
        drow('3 / 5 日累计', nf(mf.d3, 2) + ' / ' + nf(mf.d5, 2) + ' 亿', mf.d5 > 0 ? 'good' : 'bad') +
        drow('10 / 20 日累计', nf(mf.d10, 2) + ' / ' + nf(mf.d20, 2) + ' 亿', mf.d20 > 0 ? 'good' : 'bad') +
        drow('连续性', '连续净流入 ' + (mf.streak || 0) + ' 天', mf.streak >= 3 ? 'good' : mf.streak === 0 ? 'bad' : 'warn', '近 20 日净流入 ' + (mf.inDays || 0) + ' 天') +
        '</div></section>';
    }

    /* ③ 北向 */
    if (n && n.date) {
      h += '<section class="dgrp"><h4>③ 北向 / 外资</h4><div class="dgrp-body">' +
        drow('沪深股通持股', nf(n.shares, 0) + ' 万股（' + nf(n.mv, 2) + ' 亿元）') +
        drow('占流通股', pf(n.freeRatio != null ? n.freeRatio : n.ratio, 2), isNum(n.ratio) && n.ratio > 3 ? 'good' : 'warn') +
        drow('5 / 20 日变化', (isNum(n.chg5) || isNum(n.chg20)) ? ((isNum(n.chg5) ? spf(n.chg5, 0) : '—') + ' / ' + (isNum(n.chg20) ? spf(n.chg20, 0) : '—') + ' 万股') : '暂无区间变化数据', isNum(n.chg20) ? (n.chg20 > 0 ? 'good' : 'bad') : '') +
        drow('披露日期', esc(n.date), '', '北向持股披露频率已下调，日期可能滞后') +
        '</div></section>';
    } else {
      h += '<section class="dgrp"><h4>③ 北向 / 外资</h4><div class="dgrp-body">' + drow('沪深股通持股', '该标的无披露数据', 'warn') + '</div></section>';
    }

    /* ④ 杠杆资金 */
    if (mg && mg.date) {
      h += '<section class="dgrp"><h4>④ 杠杆资金' + dtag(mg.chg5 > 0 ? 'good' : 'bad', mg.chg5 > 0 ? '加杠杆' : '撤杠杆') + '</h4><div class="dgrp-body">' +
        drow('融资余额', nf(mg.rzye, 2) + ' 亿', '', '占流通市值 ' + pf(mg.ratio, 2)) +
        drow('融资买入额', nf(mg.rzmre, 2) + ' 亿', '', '占当日成交额 <b>' + pf(mg.rzmreRatio, 2) + '</b>') +
        drow('融券余额', nf(mg.rqye, 2) + ' 亿') +
        drow('两融差额', nf(mg.net, 2) + ' 亿') +
        drow('5 / 20 日融资变化', nf(mg.chg5, 2) + ' / ' + nf(mg.chg20, 2) + ' 亿', isNum(mg.chg20) ? (mg.chg20 > 0 ? 'good' : 'bad') : '') +
        drow('数据日期', esc(mg.date), '', '两融数据 T+1') +
        '</div></section>';
    }

    /* ⑤ 席位与股东 */
    var lhbRows = (bh.lhb || []).map(function (x) {
      return '<tr><td>' + esc(x.d) + '</td><td class="' + (x.pct > 0 ? 'up' : 'dn') + '">' + spf(x.pct, 2) + '</td><td class="' + (x.net > 0 ? 'up' : 'dn') + '">' + nf(x.net, 2) + ' 亿</td><td class="dl-reason">' + esc(x.reason || '') + '</td></tr>';
    }).join('');
    var chgRows = (bh.changes || []).map(function (x) {
      return '<tr><td>' + esc(x.d) + '</td><td class="dl-reason">' + esc(x.holder) + '</td><td>' + esc(x.dir) + '</td><td>' + nf(x.shares, 1) + ' 万股</td></tr>';
    }).join('');
    var liftRows = (bh.lifts || []).map(function (x) {
      return '<tr><td>' + esc(x.d) + '</td><td>' + (x.days >= 0 ? x.days + ' 天后' : Math.abs(x.days) + ' 天前') + '</td><td>' + nf(x.cap, 2) + ' 亿</td><td>' + pf(x.ratio, 2) + '</td></tr>';
    }).join('');
    h += '<section class="dgrp"><h4>⑤ 席位与股东行为' + dtag((bh.chgNet || 0) > 0 ? 'good' : 'warn', (bh.chgNet || 0) > 0 ? '净增持' : '无增持') + '</h4><div class="dgrp-body">' +
      drow('近 180 天龙虎榜', (bh.lhbCount || 0) + ' 次', bh.lhbCount > 0 ? 'warn' : '', '其中机构席位 ' + (bh.lhbJg || 0) + ' 次') +
      (lhbRows ? '<table class="dtable dtable-sm"><thead><tr><th>日期</th><th>涨跌</th><th>净买入</th><th>上榜原因</th></tr></thead><tbody>' + lhbRows + '</tbody></table>' : '') +
      (bh.holders ? drow('股东户数', esc(bh.holders.num != null ? nf(bh.holders.num, 0) : '—') + ' 户（' + esc(bh.holders.date) + '）', isNum(bh.holders.ratio) ? (bh.holders.ratio < 0 ? 'good' : 'bad') : '', '环比 ' + spf(bh.holders.ratio, 2) + '，户数减少＝筹码集中') : '') +
      drow('近一年重要股东', (bh.chgNet || 0) + ' 万股（净额）', (bh.chgNet || 0) > 0 ? 'good' : (bh.chgNet || 0) < 0 ? 'bad' : '') +
      (chgRows ? '<table class="dtable dtable-sm"><thead><tr><th>公告日</th><th>股东</th><th>方向</th><th>股数</th></tr></thead><tbody>' + chgRows + '</tbody></table>' : '') +
      drow('未来 90 天解禁', nf(bh.liftSoon, 2) + ' 亿', (bh.liftSoon || 0) > 0 ? 'warn' : 'good') +
      (liftRows ? '<table class="dtable dtable-sm"><thead><tr><th>解禁日</th><th>时间</th><th>市值</th><th>占比</th></tr></thead><tbody>' + liftRows + '</tbody></table>' : '') +
      '</div></section>';

    /* ⑥ 筹码与成本 */
    var blkRows = (cs.blocks || []).map(function (x) {
      return '<tr><td>' + esc(x.d) + '</td><td>' + nf(x.price, 2) + '</td><td class="' + (x.prem > 0 ? 'up' : 'dn') + '">' + spf(x.prem, 2) + '</td><td>' + nf(x.amt, 2) + ' 亿</td><td class="dl-reason">' + esc(x.buyer || '') + '</td></tr>';
    }).join('');
    h += '<section class="dgrp"><h4>⑥ 筹码与成本</h4><div class="dgrp-body">' +
      drow('120 日平均成本', nf(cs.avgCost, 2) + ' 元', '', '现价 ' + nf(cs.price, 2) + ' 元，' + (isNum(cs.avgCost) && cs.price < cs.avgCost ? '低于平均成本（多数持仓浮亏）' : '高于平均成本')) +
      drow('获利盘比例（估算）', pf(cs.profit, 1), isNum(cs.profit) ? (cs.profit > 70 ? 'good' : cs.profit < 30 ? 'bad' : 'warn') : '', '按 120 日成交量分布估算') +
      drow('近 120 日大宗交易', (cs.blkCnt || 0) + ' 笔 / ' + nf(cs.blkAmt, 2) + ' 亿', (cs.blkCnt || 0) > 0 ? 'warn' : '', '平均溢价 ' + spf(cs.blkPrem, 2)) +
      (blkRows ? '<table class="dtable dtable-sm"><thead><tr><th>日期</th><th>价格</th><th>溢价</th><th>金额</th><th>买方</th></tr></thead><tbody>' + blkRows + '</tbody></table>' : '') +
      '</div></section>';

    /* ⑦ 资金环境 */
    var ind = ev.industry, ix = ev.index || {};
    h += '<section class="dgrp"><h4>⑦ 资金环境' + dtag(ind && ind.net > 0 ? 'good' : 'bad', ind && ind.net > 0 ? '板块流入' : '板块流出') + '</h4><div class="dgrp-body">' +
      (ind ? drow('所属板块资金', esc(ind.board) + '：' + nf(ind.net, 2) + ' 亿（' + pf(ind.ratio, 2) + '）', ind.net > 0 ? 'good' : 'bad', '板块涨跌 ' + spf(ind.pct, 2) + '，超大单 ' + nf(ind.superNet, 2) + ' 亿') : drow('所属板块资金', '未取到板块资金流', 'warn')) +
      drow('上证指数', nf(ix.close, 2) + '（' + spf(ix.pct, 2) + '）', isNum(ix.pct) ? (ix.pct > 0 ? 'good' : 'bad') : '') +
      drow('两市成交额', nf(ix.amount, 0) + ' / ' + nf(ix.amount2, 0) + ' 亿', '', '上证 / 深证，缩量下跌＝杀跌动能不足') +
      '</div></section>';

    return h;
  }

  function deepCard(r) {
    return '<article class="dcard" id="dc-' + esc(r.code) + '">' +
      deepCardHead(r) + deepPriceChart(r) +
      '<div class="dcols"><div class="dcol"><h3 class="dcol-t">技术面</h3>' + deepTech(r) + '</div>' +
      '<div class="dcol"><h3 class="dcol-t">资金面</h3>' + deepFund(r) + '</div></div>' +
      '</article>';
  }

  function deepSummaryTable() {
    if (deep.results.length < 2) return '';
    var rows = deep.results.map(function (r) {
      var s = r.scores || {};
      return '<tr data-code="' + esc(r.code) + '">' +
        '<td>' + esc(r.code) + '</td>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td class="' + (r.pct > 0 ? 'up' : r.pct < 0 ? 'dn' : '') + '">' + nf(r.price, 2) + '</td>' +
        '<td class="' + (r.pct > 0 ? 'up' : r.pct < 0 ? 'dn' : '') + '">' + spf(r.pct, 2) + '</td>' +
        '<td><b class="' + toneOfScore(s.tech) + '">' + nf(s.tech, 1) + '</b></td>' +
        '<td><b class="' + toneOfScore(s.fund) + '">' + nf(s.fund, 1) + '</b></td>' +
        '<td><b class="' + toneOfScore(s.total) + '">' + nf(s.total, 1) + '</b></td>' +
        '<td>' + esc((r.tech && r.tech.ma && r.tech.ma.order) || '') + '</td>' +
        '</tr>';
    }).join('');
    var sorted = deep.results.slice().sort(function (a, b) { return (b.scores ? b.scores.total : 0) - (a.scores ? a.scores.total : 0); });
    var best = sorted[0], worst = sorted[sorted.length - 1];
    return '<div class="dsum"><div class="dsum-head"><h3>批量结果 · ' + deep.results.length + ' 只</h3>' +
      '<span class="muted">综合分最高 ' + esc(best.name) + ' ' + nf(best.scores.total, 1) + '，最低 ' + esc(worst.name) + ' ' + nf(worst.scores.total, 1) + '</span></div>' +
      '<table class="dtable dsum-table"><thead><tr><th>代码</th><th>名称</th><th>价格</th><th>涨跌</th><th>技术</th><th>资金</th><th>综合</th><th>均线</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function deepRender() {
    var box = $('#deepResults');
    box.innerHTML = deep.results.map(deepCard).join('');
    $('#deepSummary').innerHTML = deepSummaryTable();
  }

  function deepStatus(txt, pct) {
    $('#deepProgress').hidden = false;
    $('#deepStatus').textContent = txt;
    if (pct != null) $('#deepBar').style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function deepRun() {
    if (deep.busy) { toast('正在分析中，请稍候'); return; }
    var codes = deepParse($('#deepInput').value);
    if (!codes.length) { toast('请输入至少一个 6 位股票代码'); return; }
    if (codes.length > 20) { codes = codes.slice(0, 20); toast('单次最多 20 只，已截取前 20 只'); }
    deep.busy = true;
    deep.results = [];
    deep.queue = codes;
    deep.idx = 0;
    $('#deepResults').innerHTML = '';
    $('#deepSummary').innerHTML = '';
    $('#deepRun').disabled = true;
    $('#deepRun').textContent = '分析中…';
    deepStatus('准备中 0 / ' + codes.length, 2);
    deepNext();
  }

  function deepNext() {
    if (deep.idx >= deep.queue.length) {
      deep.busy = false;
      $('#deepRun').disabled = false;
      $('#deepRun').textContent = '开始分析';
      deepStatus('完成 · ' + deep.results.length + ' 只', 100);
      setTimeout(function () { $('#deepProgress').hidden = true; }, 900);
      deepRender();
      toast('分析完成 · ' + deep.results.length + ' 只');
      return;
    }
    var code = deep.queue[deep.idx];
    deepStatus('正在分析 ' + code + '（' + (deep.idx + 1) + ' / ' + deep.queue.length + '）', (deep.idx / deep.queue.length) * 100);
    fetchJSON(API + '/api/deep?code=' + encodeURIComponent(code)).then(function (r) {
      if (r && r.ok) {
        deep.results.push(r);
        $('#deepResults').insertAdjacentHTML('beforeend', deepCard(r));
        $('#deepSummary').innerHTML = deepSummaryTable();
      } else {
        deep.results.push({ code: code, ok: false, name: code, error: (r && r.error) || '分析失败', scores: {}, tech: {}, fund: {} });
        $('#deepResults').insertAdjacentHTML('beforeend',
          '<article class="dcard dcard-err"><header class="dcard-head"><div class="dcard-id"><b>' + esc(code) + '</b></div></header>' +
          '<p class="muted" style="padding:8px 16px 16px">' + esc((r && r.error) || '分析失败，请检查代码或稍后重试') + '</p></article>');
      }
      deep.idx++;
      deepNext();
    }).catch(function (e) {
      deep.results.push({ code: code, ok: false, name: code, error: String(e), scores: {}, tech: {}, fund: {} });
      deep.idx++;
      deepNext();
    });
  }


  /* ---------------- 资讯雷达（新闻 / 公告 / 事件） ---------------- */
  var news = {
    items: [], total: 0, time: '', filter: 'all', sector: '', auto: true,
    timer: null, loading: false, stock: null, stockCode: ''
  };

  function newsClose() {
    var v = $('#newsView');
    if (v) v.hidden = true;
    if (news.timer) { clearInterval(news.timer); news.timer = null; }
  }

  function newsOpen(code) {
    if (FILE_MODE && !API && !STANDALONE) { showFileNotice(); return; }
    $('#welcome').hidden = true;
    $('#report').hidden = true;
    $('#loading').hidden = true;
    $('#errorBox').hidden = true;
    $('#layerNav').hidden = true;
    scanClose();
    deepClose();
    watchClose();
    indicesClose();
    premarketClose();
    limitupClose();
    $('#newsView').hidden = false;
    try { history.replaceState(null, '', code ? '#/news/' + code : '#/news'); } catch (e) {}
    window.scrollTo({ top: 0 });
    if (code) { $('#newsSearch').value = code; newsStock(code); } else { $('#newsStock').hidden = true; }
    newsLoad();
    if (news.timer) clearInterval(news.timer);
    news.timer = setInterval(function () {
      if (news.auto && !$('#newsView').hidden) newsLoad(true);
    }, 120000);
  }

  function newsLoad(silent) {
    var seq = (news.seq || 0) + 1;
    news.seq = seq;
    news.loading = true;
    if (!silent) { $('#newsList').innerHTML = '<div class="nload">正在抓取最新资讯…</div>'; }
    var q = '/api/news?limit=150';
    if (news.filter === 'high') q += '&level=high';
    if (news.filter === 'policy') q += '&level=policy';
    if (news.sector) q += '&sector=' + encodeURIComponent(news.sector);
    fetch(API + q).then(function (r) { return r.json(); }).then(function (d) {
      if (seq !== news.seq) return;
      news.loading = false;
      if (!d.ok) { $('#newsList').innerHTML = '<div class="nload">加载失败：' + esc(d.error || '未知错误') + '</div>'; return; }
      news.items = d.items || [];
      news.total = d.total || 0;
      news.time = d.time || '';
      $('#newsTime').textContent = '更新于 ' + news.time + ' · 当前 ' + news.total + ' 条';
      newsRender();
    }).catch(function (e) {
      if (seq !== news.seq) return;
      news.loading = false;
      $('#newsList').innerHTML = '<div class="nload">网络错误：' + esc(e.message) + '</div>';
    });
  }

  function newsChips() {
    var cnt = {};
    news.items.forEach(function (it) {
      (it.sectors || []).forEach(function (s) {
        if (s === '全市场') return;
        cnt[s] = (cnt[s] || 0) + 1;
      });
    });
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 7);
    var html = '';
    function chip(key, label, cls) {
      var on = (key === '__all' && news.filter === 'all' && !news.sector) ||
        (key === '__high' && news.filter === 'high') ||
        (key === '__policy' && news.filter === 'policy') ||
        (key === '__sector' && news.sector === label);
      return '<button class="nchip' + (on ? ' on' : '') + (cls ? ' ' + cls : '') + '" data-k="' + key + '" data-v="' + esc(label) + '">' + esc(label) + '</button>';
    }
    html += chip('__all', '全部');
    html += chip('__high', '⚡ 重大');
    html += chip('__policy', '📋 政策');
    top.forEach(function (s) { html += chip('__sector', s); });
    $('#newsChips').innerHTML = html;
  }

  function newsRender() {
    newsChips();
    if (!news.items.length) {
      $('#newsList').innerHTML = '<div class="nload">暂无符合条件的资讯，换个筛选条件试试。</div>';
      return;
    }
    var html = '';
    news.items.forEach(function (it, i) {
      html += newsCard(it, i);
    });
    $('#newsList').innerHTML = html;
  }

  function newsCard(it, i) {
    var lv = it.level === '高' ? '<em class="ntag ntag-hot">重大</em>' : '';
    var dirCls = it.dir === '利好' ? 'ntag-up' : it.dir === '利空' ? 'ntag-dn' : 'ntag-flat';
    var dir = it.dir && it.dir !== '中性' ? '<em class="ntag ' + dirCls + '">' + it.dir + '</em>' : '';
    var pol = it.policy ? '<em class="ntag ntag-pol">政策</em>' : '';
    var secs = (it.sectors || []).map(function (s) {
      return '<button class="npill npill-sec" data-sec="' + esc(s) + '">' + esc(s) + '</button>';
    }).join('');
    var stks = (it.stocks || []).map(function (s) {
      var peer = s.p ? ' peer' : '';
      return '<button class="npill npill-stk' + peer + '" data-code="' + esc(s.c) + '" title="' + (s.p ? '同板块关联标的' : '新闻点名') + '">' + esc(s.n) + '</button>';
    }).join('');
    var t = String(it.time || '');
    var hm = t.length >= 16 ? t.slice(11, 16) : t;
    var dd = t.length >= 10 ? t.slice(5, 10) : '';
    var sum = String(it.summary || '').replace(/^【[^】]*】/, '').trim();
    var ttl = String(it.title || '');
    if (sum && ttl && (sum === ttl || sum.indexOf(ttl) === 0)) {
      sum = sum.slice(ttl.length).replace(/^[：:，,。\s]+/, '');
    }
    var hasLong = sum.length > 90;
    var url = it.url ? '<a class="nlink" href="' + esc(it.url) + '" target="_blank" rel="noopener">原文</a>' : '';
    return '<article class="nitem' + (it.level === '高' ? ' hot' : '') + '">' +
      '<div class="nitem-t"><b>' + esc(hm) + '</b><span>' + esc(dd) + '</span></div>' +
      '<div class="nitem-b">' +
      '<div class="nitem-h"><h4>' + esc(it.title) + '</h4><div class="ntags">' + lv + dir + pol + '</div></div>' +
      (sum ? '<p class="nsum' + (hasLong ? ' clamp' : '') + '">' + esc(sum) + '</p>' : '') +
      (secs ? '<div class="nrow"><span class="nlbl">影响板块</span>' + secs + '</div>' : '') +
      (stks ? '<div class="nrow"><span class="nlbl">关联个股</span>' + stks + '</div>' : '') +
      '<div class="nmeta"><span>' + esc(it.src || '') + '</span>' + url + '</div>' +
      '</div></article>';
  }

  function newsStock(code) {
    news.stockCode = code;
    var box = $('#newsStock');
    box.hidden = false;
    box.innerHTML = '<div class="nload">正在检索 ' + esc(code) + ' 的公告与新闻…</div>';
    fetch(API + '/api/news/stock?code=' + encodeURIComponent(code))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { box.innerHTML = '<div class="nload">' + esc(d.error || '查询失败') + '</div>'; return; }
        news.stock = d;
        box.innerHTML = newsStockHtml(d);
      })
      .catch(function (e) { box.innerHTML = '<div class="nload">网络错误：' + esc(e.message) + '</div>'; });
  }

  function newsStockHtml(d) {
    var ann = (d.ann || []).map(function (a) {
      return '<tr><td class="na-d">' + esc(a.d) + '</td><td class="na-c">' + esc(a.col || '公告') + '</td>' +
        '<td><a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.title) + '</a></td></tr>';
    }).join('');
    var nw = (d.news || []).map(function (x) {
      var dt = String(x.d || '');
      return '<li><span class="nn-d">' + esc(dt.slice(5, 16)) + '</span>' +
        '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a>' +
        '<span class="nn-m">' + esc(x.media || '') + '</span></li>';
    }).join('');
    var peers = (d.peers || []).map(function (p) {
      return '<button class="npill npill-stk peer" data-code="' + esc(p.c) + '">' + esc(p.n) + '</button>';
    }).join('');
    return '<div class="nstk-head">' +
      '<div><b>' + esc(d.name) + '</b><span class="nstk-code">' + esc(d.code) + '</span>' +
      (d.industry ? '<span class="nstk-ind">' + esc(d.industry) + '</span>' : '') + '</div>' +
      '<div class="nstk-act"><button class="ghost" id="nstkReport">看五层报告</button>' +
      '<button class="ghost" id="nstkDeep">看资金技术</button>' +
      '<button class="ghost" id="nstkClose">关闭</button></div>' +
      '</div>' +
      '<div class="nstk-body">' +
      '<div class="nstk-col"><h5>公司公告 <span class="muted">' + (d.ann || []).length + ' 条</span></h5>' +
      (ann ? '<table class="ntable"><thead><tr><th>日期</th><th>类型</th><th>标题</th></tr></thead><tbody>' + ann + '</tbody></table>' : '<p class="muted">暂无公告</p>') +
      '</div>' +
      '<div class="nstk-col"><h5>相关新闻 <span class="muted">' + (d.news || []).length + ' 条</span></h5>' +
      (nw ? '<ul class="nnews">' + nw + '</ul>' : '<p class="muted">暂无新闻</p>') +
      (peers ? '<h5 class="mt">同行业可比</h5><div class="nrow">' + peers + '</div>' : '') +
      '</div></div>';
  }

  function newsBind() {
    $('#newsBtn').addEventListener('click', function () { newsOpen(); });
    $('#newsRefresh').addEventListener('click', function () { newsLoad(); });
    $('#newsAuto').addEventListener('change', function () { news.auto = this.checked; });
    $('#newsGo').addEventListener('click', function () {
      var v = $('#newsSearch').value.trim();
      if (!v) { toast('请输入代码或名称'); return; }
      var m = v.match(/\d{6}/);
      if (m) { newsStock(m[0]); }
      else { newsSearchKeyword(v); }
    });
    $('#newsSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') { $('#newsGo').click(); } });
    $('#newsChips').addEventListener('click', function (e) {
      var b = e.target.closest('.nchip');
      if (!b) return;
      var k = b.getAttribute('data-k');
      var v = b.getAttribute('data-v');
      if (k === '__all') { news.filter = 'all'; news.sector = ''; }
      else if (k === '__high') { news.filter = 'high'; news.sector = ''; }
      else if (k === '__policy') { news.filter = 'policy'; news.sector = ''; }
      else if (k === '__sector') { news.filter = 'all'; news.sector = (news.sector === v ? '' : v); }
      newsLoad();
    });
    $('#newsList').addEventListener('click', function (e) {
      var sec = e.target.closest('.npill-sec');
      if (sec) { news.sector = sec.getAttribute('data-sec'); news.filter = 'all'; newsLoad(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      var stk = e.target.closest('.npill-stk');
      if (stk) { analyze(stk.getAttribute('data-code')); return; }
      var sum = e.target.closest('.nsum.clamp');
      if (sum) { sum.classList.remove('clamp'); return; }
    });
    $('#newsStock').addEventListener('click', function (e) {
      var stk = e.target.closest('.npill-stk');
      if (stk) { analyze(stk.getAttribute('data-code')); return; }
      if (e.target.closest('#nstkReport')) { analyze(news.stockCode); return; }
      if (e.target.closest('#nstkDeep')) { deepOpen(news.stockCode); return; }
      if (e.target.closest('#nstkClose')) { $('#newsStock').hidden = true; return; }
    });
  }

  function newsSearchKeyword(kw) {
    var box = $('#newsStock');
    box.hidden = false;
    box.innerHTML = '<div class="nload">正在搜索「' + esc(kw) + '」…</div>';
    fetch(API + '/api/news/stock?q=' + encodeURIComponent(kw))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { box.innerHTML = '<div class="nload">' + esc(d.error || '查询失败') + '</div>'; return; }
        var list = (d.news || []).map(function (x) {
          var dt = String(x.d || '');
          return '<li><span class="nn-d">' + esc(dt.slice(5, 16)) + '</span>' +
            '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.title) + '</a>' +
            '<span class="nn-m">' + esc(x.media || '') + '</span></li>';
        }).join('');
        box.innerHTML = '<div class="nstk-head"><div><b>' + esc(kw) + '</b><span class="nstk-ind">关键词搜索</span></div>' +
          '<div class="nstk-act"><button class="ghost" id="nstkClose">关闭</button></div></div>' +
          '<div class="nstk-body single"><div class="nstk-col"><h5>搜索结果 <span class="muted">' + (d.news || []).length + ' 条</span></h5>' +
          (list ? '<ul class="nnews">' + list + '</ul>' : '<p class="muted">没有找到相关新闻</p>') + '</div></div>';
      })
      .catch(function (e) { box.innerHTML = '<div class="nload">网络错误：' + esc(e.message) + '</div>'; });
  }

  /* ---------------- 特别关注（自选股）+ 异动提醒 ---------------- */
  var watch = {
    data: null, items: [], alerts: [], settings: {},
    loaded: false, loading: false, busy: false, timer: null,
    seen: {}, settingsInit: false
  };

  function watchSeenLoad() {
    try { watch.seen = JSON.parse(localStorage.getItem('wf5_alert_seen') || '{}') || {}; }
    catch (e) { watch.seen = {}; }
  }
  function watchSeenSave() {
    try { localStorage.setItem('wf5_alert_seen', JSON.stringify(watch.seen)); } catch (e) {}
  }

  function watchClose() {
    var v = $('#watchView');
    if (v) v.hidden = true;
  }

  function watchOpen() {
    if (FILE_MODE && !API && !STANDALONE) { showFileNotice(); return; }
    $('#welcome').hidden = true;
    $('#report').hidden = true;
    $('#loading').hidden = true;
    $('#errorBox').hidden = true;
    $('#layerNav').hidden = true;
    scanClose();
    deepClose();
    newsClose();
    indicesClose();
    premarketClose();
    limitupClose();
    $('#watchView').hidden = false;
    try { history.replaceState(null, '', '#/watchlist'); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (watch.data) watchRender();
    watchFetch({ silent: false });
  }

  function watchFetch(opts) {
    opts = opts || {};
    if (FILE_MODE && !API && !STANDALONE) return Promise.resolve(null);
    var seq = (watch.seq || 0) + 1;
    watch.seq = seq;
    watch.loading = true;
    return fetchJSON(API + '/api/watchlist').then(function (d) {
      if (seq !== watch.seq) return null;
      if (!d || !d.ok) throw new Error((d && d.error) || '接口返回异常');
      watch.data = d;
      watch.items = d.items || [];
      watch.alerts = d.alerts || [];
      watch.settings = d.settings || {};
      watch.loaded = true;
      state.watchCodes = {};
      watch.items.forEach(function (x) { state.watchCodes[x.code] = 1; });
      watchUpdateBadge();
      updateHeroWatch();
      if (!watch.settingsInit && watch.settings) {
        watchFillSettings(watch.settings);
        watch.settingsInit = true;
      }
      if (!$('#watchView').hidden) watchRender();
      if (!$('#report').hidden) tipsRender();
      try { handleNewAlerts(watch.alerts); } catch (e) { console.warn('alert error', e); }
      return d;
    }).catch(function (e) {
      if (seq !== watch.seq) return null;
      if (!opts.silent) toast('特别关注加载失败：' + e.message);
      return null;
    }).then(function (r) {
      if (seq === watch.seq) watch.loading = false;
      return r;
    });
  }

  function watchFillSettings(s) {
    if (!s) return;
    var map = {
      changePct: '#wsChange', turnover: '#wsTurnover', volRatio: '#wsVol', amplitude: '#wsAmp',
      highPct: '#wsHigh', lowPct: '#wsLow'
    };
    Object.keys(map).forEach(function (k) {
      var el = $(map[k]);
      if (el && isNum(s[k])) el.value = s[k];
    });
    var tips = $('#wsTips');
    if (tips) tips.checked = s.tipsOn !== false;
  }

  function watchUpdateBadge() {
    var badge = $('#watchBadge');
    if (!badge) return;
    var n = watch.alerts.length, m = watch.items.length;
    if (!n && !m) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.textContent = String(n || m);
    badge.className = 'nav-badge' + (n ? ' alert' : '');
    badge.title = n ? (n + ' 条异动提醒') : (m + ' 只特别关注');
  }

  function updateHeroWatch() {
    var b = $('#heroWatch');
    if (!b || !state.code) return;
    var on = !!state.watchCodes[state.code];
    b.className = 'hero-watch' + (on ? ' on' : '');
    b.innerHTML = on ? '★ 已关注' : '☆ 特别关注';
  }

  function fmtWAmount(v) {
    if (!isNum(v)) return '—';
    if (v >= 10000) return (v / 10000).toFixed(2) + ' 亿';
    return v.toFixed(0) + ' 万';
  }

  function watchStatsHTML(items, alerts) {
    var up = 0, down = 0, flat = 0, sum = 0, n = 0;
    items.forEach(function (x) {
      if (!isNum(x.changePct)) return;
      if (x.changePct > 0.001) up++;
      else if (x.changePct < -0.001) down++;
      else flat++;
      sum += x.changePct; n++;
    });
    var avg = n ? sum / n : 0;
    return '<div class="wstat"><span>关注股票</span><b>' + items.length + '</b><small>只</small></div>' +
      '<div class="wstat' + (alerts.length ? ' warn' : '') + '"><span>当前异动</span><b>' + alerts.length + '</b><small>条</small></div>' +
      '<div class="wstat"><span>上涨 / 下跌 / 平</span><b class="up">' + up + '</b><small class="dn"> / ' + down + ' / ' + flat + '</small></div>' +
      '<div class="wstat"><span>平均涨跌幅</span><b class="' + (avg > 0 ? 'up' : avg < 0 ? 'dn' : '') + '">' + spf(avg, 2) + '</b></div>';
  }

  function watchTipItemHTML(x, kind) {
    var near = kind === 'high' ? x.fromHigh : x.fromLow;
    return '<button type="button" class="wt-item ' + kind + '" data-code="' + esc(x.code) + '">' +
      '<b>' + esc(x.name) + '</b>' +
      '<span>' + nf(x.price, 2) + '</span>' +
      '<em>' + (kind === 'high' ? '距日高 ' : '距日低 ') + nf(near, 2) + '%</em>' +
      '</button>';
  }

  function watchTipsHTML(items) {
    var s = watch.settings || {};
    var thHigh = isNum(s.highPct) ? s.highPct : 1;
    var thLow = isNum(s.lowPct) ? s.lowPct : 1;
    var on = s.tipsOn !== false;
    var high = [], low = [];
    items.forEach(function (x) {
      if (x.zone === 'high') high.push(x);
      else if (x.zone === 'low') low.push(x);
    });
    var active = high.length + low.length;
    var head = '<div class="watch-tip-head"><div>' +
      '<h3>高抛低吸参考 <span class="tag">实时</span></h3>' +
      '<span class="muted">每 30 秒刷新 · 高抛 ≤ 距日高 ' + thHigh + '% · 低吸 ≤ 距日低 ' + thLow + '%</span>' +
      '</div><span class="wt-state' + (!on ? ' off' : active ? ' on' : '') + '">' +
      (!on ? '提醒已关闭' : active ? '有 ' + active + ' 只进入参考区' : '暂无股票进入参考区') + '</span></div>';

    if (!on) {
      return '<div class="card watch-tip-card">' + head +
        '<div class="wt-empty">高抛低吸提醒已关闭。可在上方设置里勾选「高抛低吸提醒」重新开启。</div></div>';
    }
    if (!items.length) {
      return '<div class="card watch-tip-card">' + head +
        '<div class="wt-empty">还没有特别关注的股票，加入后这里会显示每只股票的日内位置与高抛 / 低吸参考区。</div></div>';
    }

    var hiNear = null, loNear = null;
    items.forEach(function (x) {
      if (isNum(x.fromHigh) && (!hiNear || x.fromHigh < hiNear.fromHigh)) hiNear = x;
      if (isNum(x.fromLow) && (!loNear || x.fromLow < loNear.fromLow)) loNear = x;
    });
    var hiBody = high.length ? high.map(function (x) { return watchTipItemHTML(x, 'high'); }).join('') :
      '<div class="wt-none">暂无 · ' + (hiNear ? '最接近 <b>' + esc(hiNear.name) + '</b> 距日高 ' + nf(hiNear.fromHigh, 2) + '%' : '暂无行情数据') + '</div>';
    var loBody = low.length ? low.map(function (x) { return watchTipItemHTML(x, 'low'); }).join('') :
      '<div class="wt-none">暂无 · ' + (loNear ? '最接近 <b>' + esc(loNear.name) + '</b> 距日低 ' + nf(loNear.fromLow, 2) + '%' : '暂无行情数据') + '</div>';
    return '<div class="card watch-tip-card">' + head +
      '<div class="wt-cols">' +
        '<div class="wt-col high"><div class="wt-col-head"><b>高抛参考区</b><span>现价靠近日内高点</span></div>' + hiBody + '</div>' +
        '<div class="wt-col low"><div class="wt-col-head"><b>低吸参考区</b><span>现价靠近日内低点</span></div>' + loBody + '</div>' +
      '</div>' +
      '<p class="wt-note">仅按现价在日内区间中的位置机械提示，不预测涨跌，不构成投资建议。</p></div>';
  }

  function watchAlertsHTML(alerts) {
    if (!alerts.length) {
      return '<div class="card watch-none"><b>暂无触发异动</b><span class="muted">行情每 30 秒刷新一次；阈值可在上方调整。没有消息就是最好的消息。</span></div>';
    }
    var list = alerts.slice().sort(function (a, b) {
      var la = a.level === 'high' ? 2 : a.level === 'warn' ? 1 : 0;
      var lb = b.level === 'high' ? 2 : b.level === 'warn' ? 1 : 0;
      return lb - la;
    });
    var rows = list.map(function (a) {
      return '<div class="walert ' + esc(a.level || 'warn') + '">' +
        '<span class="wdot"></span>' +
        '<div class="wmain"><b>' + esc(a.type) + '</b><span>' + esc(a.text) + '</span></div>' +
        '<button class="wl-act" data-code="' + esc(a.code) + '">分析</button>' +
        '</div>';
    }).join('');
    return '<div class="card watch-alert-card"><div class="sec-head"><h3>当前异动 <span class="tag">' + alerts.length + '</span></h3>' +
      '<span class="sub">按当前阈值实时判断 · 每次刷新重新计算</span></div><div class="walert-list">' + rows + '</div></div>';
  }

  function watchZoneHTML(x) {
    if (!isNum(x.dayPos)) return '<span class="muted">—</span>';
    var zone = x.zone === 'high' ? 'high' : x.zone === 'low' ? 'low' : '';
    var label = zone === 'high' ? '高抛区' : zone === 'low' ? '低吸区' : '中枢';
    var pos = clamp(x.dayPos, 0, 100);
    return '<div class="wl-zone ' + zone + '">' +
      '<div class="wz-track"><i style="left:' + pos.toFixed(1) + '%"></i></div>' +
      '<span class="wz-meta"><b>' + label + '</b> ' + nf(x.dayPos, 0) + '% · 距高 ' + nf(x.fromHigh, 2) + '% / 距低 ' + nf(x.fromLow, 2) + '%</span>' +
      '</div>';
  }

  function watchTableHTML(items) {
    if (!items.length) {
      return '<div class="card watch-empty"><b>还没有特别关注的股票</b>' +
        '<span class="muted">在上方输入 6 位代码，或在任意个股报告页点「☆ 特别关注」。</span></div>';
    }
    var list = items.slice().sort(function (a, b) {
      var la = a.alertLevel === 'high' ? 2 : a.alertLevel === 'warn' ? 1 : 0;
      var lb = b.alertLevel === 'high' ? 2 : b.alertLevel === 'warn' ? 1 : 0;
      if (la !== lb) return lb - la;
      return (isNum(b.changePct) ? b.changePct : -999) - (isNum(a.changePct) ? a.changePct : -999);
    });
    var rows = list.map(function (x) {
      var pctCls = isNum(x.changePct) ? (x.changePct > 0 ? 'up' : x.changePct < 0 ? 'dn' : '') : '';
      var tags = (x.alerts || []).map(function (a) {
        return '<em class="wtag ' + esc(a.level || '') + '">' + esc(a.type) + '</em>';
      }).join('');
      if (!tags && !x.ok) tags = '<em class="wtag">行情失败</em>';
      var priceCls = pctCls ? ' ' + pctCls : '';
      return '<tr class="wl-row' + (x.alertLevel ? ' alert-' + esc(x.alertLevel) : '') + '" data-code="' + esc(x.code) + '">' +
        '<td class="wl-name"><b>' + esc(x.name) + '</b><span>' + esc(x.code) + (x.addedAt ? ' · 加入 ' + esc(String(x.addedAt).slice(5)) : '') + '</span></td>' +
        '<td class="wl-price' + priceCls + '">' + nf(x.price, 2) + '</td>' +
        '<td class="wl-pct' + priceCls + '">' + spf(x.changePct, 2) + '</td>' +
        '<td>' + fmtWAmount(x.amount) + '</td>' +
        '<td>' + pf(x.turnover, 2) + '</td>' +
        '<td>' + nf(x.volRatio, 2) + '</td>' +
        '<td>' + pf(x.amplitude, 2) + '</td>' +
        '<td class="wl-zone-td">' + watchZoneHTML(x) + '</td>' +
        '<td class="wl-ve">' + nf(x.peTtm, 1) + ' / ' + nf(x.pb, 2) + '</td>' +
        '<td class="wl-tags">' + (tags || '<span class="muted">—</span>') + '</td>' +
        '<td class="wl-ops"><button class="wl-act" data-code="' + esc(x.code) + '">分析</button>' +
        '<button class="wl-act danger" data-remove="' + esc(x.code) + '" data-name="' + esc(x.name) + '">移除</button></td>' +
        '</tr>';
    }).join('');
    return '<div class="card wl-card"><div class="wl-scroll"><table class="wl-table"><thead><tr>' +
      '<th>股票</th><th>最新价</th><th>涨跌幅</th><th>成交额</th><th>换手率</th><th>量比</th><th>振幅</th><th>日内位置</th><th>PE / PB</th><th>异动</th><th>操作</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function watchRender() {
    var d = watch.data;
    if (!d) return;
    var items = d.items || [], alerts = d.alerts || [];
    $('#watchStats').innerHTML = watchStatsHTML(items, alerts);
    var wt = $('#watchTips');
    if (wt) wt.innerHTML = watchTipsHTML(items);
    $('#watchAlerts').innerHTML = watchAlertsHTML(alerts);
    $('#watchList').innerHTML = watchTableHTML(items);
  }

  function watchAddCode(code) {
    code = String(code || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code)) { toast('请输入 6 位 A 股代码'); return; }
    if (watch.busy) return;
    watch.busy = true;
    fetchJSON(API + '/api/watchlist/add?code=' + code).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || '加入失败');
      toast(d.added === false ? ('已在特别关注中 · ' + (d.name || code)) : ('已加入特别关注 · ' + (d.name || code)));
      var inp = $('#watchInput');
      if (inp) inp.value = '';
      return watchFetch({ silent: false });
    }).catch(function (e) {
      toast('加入失败：' + e.message);
    }).then(function () { watch.busy = false; });
  }

  function watchAdd() {
    watchAddCode($('#watchInput') ? $('#watchInput').value : '');
  }

  function watchRemove(code, name) {
    if (!confirm('确定把 ' + (name || code) + ' 从特别关注中移除？')) return;
    if (watch.busy) return;
    watch.busy = true;
    fetchJSON(API + '/api/watchlist/remove?code=' + code).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || '移除失败');
      toast('已移除 ' + (name || code));
      return watchFetch({ silent: false });
    }).catch(function (e) {
      toast('移除失败：' + e.message);
    }).then(function () { watch.busy = false; });
  }

  function watchToggle(code) {
    if (!code) return;
    if (state.watchCodes[code]) watchRemove(code, code);
    else watchAddCode(code);
  }

  function watchNotifyState() {
    var el = $('#watchNotifyState');
    if (!el) return;
    if (!('Notification' in window)) { el.textContent = '当前浏览器不支持桌面通知'; return; }
    el.textContent = Notification.permission === 'granted' ? '桌面通知已开启' :
      Notification.permission === 'denied' ? '桌面通知已被浏览器拒绝' : '桌面通知未开启';
  }

  function watchEnableNotify() {
    if (!('Notification' in window)) { toast('当前浏览器不支持桌面通知'); return; }
    if (Notification.permission === 'granted') { toast('桌面通知已开启'); watchNotifyState(); return; }
    try {
      var r = Notification.requestPermission(function () { watchNotifyState(); });
      if (r && r.then) {
        r.then(function (p) {
          watchNotifyState();
          toast(p === 'granted' ? '桌面通知已开启' : '未开启桌面通知');
        });
      }
    } catch (e) {
      toast('开启桌面通知失败：' + e.message);
    }
  }

  function notifyAlerts(fresh) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    var body = fresh.slice(0, 3).map(function (a) { return a.text; }).join('\n');
    try {
      new Notification('特别关注异动 · ' + fresh.length + ' 条', { body: body, tag: 'wf5-watch-alert' });
    } catch (e) {}
  }

  function showAlertStrip(fresh) {
    var first = fresh[0];
    if (!first) return;
    $('#alertTitle').textContent = '特别关注异动 · ' + fresh.length + ' 条';
    $('#alertText').textContent = first.text + (fresh.length > 1 ? ' 等 ' + fresh.length + ' 条' : '');
    $('#alertStrip').hidden = false;
  }

  function handleNewAlerts(alerts) {
    if (!alerts || !alerts.length) {
      var strip = $('#alertStrip');
      if (strip) strip.hidden = true;
      return;
    }
    var now = Date.now(), fresh = [];
    alerts.forEach(function (a) {
      var k = a.key || (a.code + '|' + a.type + '|' + (a.time || ''));
      if (!watch.seen[k]) fresh.push(a);
      watch.seen[k] = now;
    });
    var cutoff = now - 7 * 86400000;
    Object.keys(watch.seen).forEach(function (k) {
      if (Number(watch.seen[k]) < cutoff) delete watch.seen[k];
    });
    watchSeenSave();
    if (!fresh.length) return;
    showAlertStrip(fresh);
    notifyAlerts(fresh);
  }

  function watchInit() {
    watchSeenLoad();
    watchNotifyState();
    watchFetch({ silent: true });
    if (watch.timer) clearInterval(watch.timer);
    watch.timer = setInterval(function () {
      if (!document.hidden) watchFetch({ silent: true });
    }, 30000);
  }

  /* ---------------- 放量涨停研究 ---------------- */
  var LU_DEFAULT = { minVolRatio: 2, minTurnover: 5, minAmount: 1, board: 'all', sealed: false, sort: 'score' };
  var limitup = {
    data: null, loaded: false, loading: false, timer: null,
    detail: null, detailCode: '', detailLoading: false,
    filters: { minVolRatio: 2, minTurnover: 5, minAmount: 1, board: 'all', sealed: false, sort: 'score' },
    auto: true
  };
  try {
    var luf = JSON.parse(localStorage.getItem('wf5_limitup_filters') || 'null');
    if (luf && typeof luf === 'object') {
      if (isNum(luf.minVolRatio)) limitup.filters.minVolRatio = luf.minVolRatio;
      if (isNum(luf.minTurnover)) limitup.filters.minTurnover = luf.minTurnover;
      if (isNum(luf.minAmount)) limitup.filters.minAmount = luf.minAmount;
      if (luf.board === 'all' || luf.board === 'first' || luf.board === 'multi') limitup.filters.board = luf.board;
      limitup.filters.sealed = !!luf.sealed;
      if (luf.sort) limitup.filters.sort = luf.sort;
    }
    var lua = localStorage.getItem('wf5_limitup_auto');
    if (lua === '0') limitup.auto = false;
  } catch (e) {}

  function limitupSaveFilters() {
    try { localStorage.setItem('wf5_limitup_filters', JSON.stringify(limitup.filters)); } catch (e) {}
  }

  function limitupClose() {
    var v = $('#limitupView');
    if (v) v.hidden = true;
    var d = $('#limitupDetail');
    if (d) { d.hidden = true; }
    var w = $('#limitupListWrap');
    if (w) w.hidden = false;
    if (limitup.timer) { clearInterval(limitup.timer); limitup.timer = null; }
    limitup.detailCode = '';
  }

  function limitupSyncInputs() {
    var f = limitup.filters;
    if ($('#luVolRatio')) $('#luVolRatio').value = f.minVolRatio;
    if ($('#luTurnover')) $('#luTurnover').value = f.minTurnover;
    if ($('#luAmount')) $('#luAmount').value = f.minAmount;
    if ($('#luBoard')) $('#luBoard').value = f.board;
    if ($('#luSealed')) $('#luSealed').checked = !!f.sealed;
    if ($('#luSort')) $('#luSort').value = f.sort;
    if ($('#limitupAuto')) $('#limitupAuto').checked = !!limitup.auto;
  }

  function limitupOpen(code) {
    if (FILE_MODE && !API && !STANDALONE) { showFileNotice(); return; }
    limitupClose();
    $('#welcome').hidden = true;
    $('#report').hidden = true;
    $('#loading').hidden = true;
    $('#errorBox').hidden = true;
    $('#layerNav').hidden = true;
    scanClose();
    deepClose();
    newsClose();
    watchClose();
    indicesClose();
    premarketClose();
    $('#limitupView').hidden = false;
    limitupSyncInputs();
    if (code) {
      try { history.replaceState(null, '', '#/limitup/' + code); } catch (e) {}
      limitupDetailOpen(code, true);
    } else {
      try { history.replaceState(null, '', '#/limitup'); } catch (e) {}
      $('#limitupDetail').hidden = true;
      $('#limitupListWrap').hidden = false;
      if (limitup.data) limitupRender();
      limitupLoad(false);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (limitup.timer) clearInterval(limitup.timer);
    limitup.timer = setInterval(function () {
      if ($('#limitupView').hidden || document.hidden || !limitup.auto) return;
      if (!$('#limitupDetail').hidden && limitup.detailCode) limitupDetailLoad(limitup.detailCode, false);
      else limitupLoad(false);
    }, 60000);
  }

  function limitupLoad(force) {
    if (FILE_MODE && !API && !STANDALONE) return;
    var seq = (limitup.seq || 0) + 1;
    limitup.seq = seq;
    limitup.loading = true;
    if (!limitup.data) $('#limitupList').innerHTML = '<div class="nload">正在抓取涨停池与实时行情，首次约 3~8 秒…</div>';
    var f = limitup.filters;
    var q = '?minVolRatio=' + encodeURIComponent(f.minVolRatio) +
      '&minTurnover=' + encodeURIComponent(f.minTurnover) +
      '&minAmount=' + encodeURIComponent(f.minAmount) +
      '&board=' + encodeURIComponent(f.board) +
      '&sealed=' + (f.sealed ? '1' : '0') +
      '&sort=' + encodeURIComponent(f.sort) +
      (force ? '&refresh=1' : '');
    fetchJSON(API + '/api/limitup' + q).then(function (d) {
      if (seq !== limitup.seq) return;
      if (!d || !d.ok) throw new Error((d && d.error) || '接口返回异常');
      limitup.data = d;
      limitup.loaded = true;
      limitupRender();
    }).catch(function (e) {
      if (seq !== limitup.seq) return;
      if (!limitup.data) $('#limitupList').innerHTML = '<div class="nload">放量涨停加载失败：' + esc(e.message) + '</div>';
      else toast('放量涨停刷新失败：' + e.message);
    }).then(function () {
      if (seq === limitup.seq) limitup.loading = false;
    });
  }

  function limitupReadFilters() {
    var v = parseFloat($('#luVolRatio').value);
    var t = parseFloat($('#luTurnover').value);
    var a = parseFloat($('#luAmount').value);
    limitup.filters = {
      minVolRatio: isFinite(v) && v >= 0 ? Math.min(50, v) : 0,
      minTurnover: isFinite(t) && t >= 0 ? Math.min(100, t) : 0,
      minAmount: isFinite(a) && a >= 0 ? Math.min(1000, a) : 0,
      board: $('#luBoard').value || 'all',
      sealed: $('#luSealed').checked,
      sort: $('#luSort').value || 'score'
    };
    limitupSaveFilters();
  }

  function limitupApplyFilters() {
    limitupReadFilters();
    if (!$('#limitupDetail').hidden) {
      limitup.detailCode = '';
      $('#limitupDetail').hidden = true;
      $('#limitupListWrap').hidden = false;
      try { history.replaceState(null, '', '#/limitup'); } catch (e) {}
    }
    limitup.data = null;
    limitupLoad(false);
  }

  function limitupReset() {
    limitup.filters = { minVolRatio: 2, minTurnover: 5, minAmount: 1, board: 'all', sealed: false, sort: 'score' };
    limitupSaveFilters();
    limitupSyncInputs();
    if (!$('#limitupDetail').hidden) {
      limitup.detailCode = '';
      $('#limitupDetail').hidden = true;
      $('#limitupListWrap').hidden = false;
      try { history.replaceState(null, '', '#/limitup'); } catch (e) {}
    }
    limitup.data = null;
    limitupLoad(false);
  }

  function limitupSort(key) {
    limitup.filters.sort = key;
    if ($('#luSort')) $('#luSort').value = key;
    limitupSaveFilters();
    limitupLoad(false);
  }

  function limitupBack() {
    limitup.detailCode = '';
    $('#limitupDetail').hidden = true;
    $('#limitupListWrap').hidden = false;
    try { history.replaceState(null, '', '#/limitup'); } catch (e) {}
    if (limitup.data) limitupRender();
    else limitupLoad(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function limitupDetailOpen(code, fromRoute) {
    if (FILE_MODE && !API && !STANDALONE) { showFileNotice(); return; }
    code = String(code || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code)) { toast('代码格式不正确'); return; }
    limitup.detailCode = code;
    if (!fromRoute) {
      try { history.replaceState(null, '', '#/limitup/' + code); } catch (e) {}
    }
    $('#limitupListWrap').hidden = true;
    $('#limitupDetail').hidden = false;
    limitupDetailLoad(code, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function limitupDetailLoad(code, force) {
    if (FILE_MODE && !API && !STANDALONE) return;
    if (limitup.detailLoading) return;
    limitup.detailLoading = true;
    var f = limitup.filters;
    var q = '?code=' + encodeURIComponent(code) +
      '&minVolRatio=' + encodeURIComponent(f.minVolRatio) +
      (force ? '&refresh=1' : '');
    if (!limitup.detail || limitup.detailCode !== code) {
      $('#limitupDetail').innerHTML = '<div class="card lu-detail-load"><div class="nload">正在计算该股的封板质量、技术位置与近 3 年同类样本…</div></div>';
    }
    fetchJSON(API + '/api/limitup/detail' + q).then(function (d) {
      if (limitup.detailCode !== code) return;
      if (!d || !d.ok) throw new Error((d && d.error) || '接口返回异常');
      limitup.detail = d;
      limitupDetailRender(d);
    }).catch(function (e) {
      if (limitup.detailCode !== code) return;
      $('#limitupDetail').innerHTML = '<div class="card lu-detail-load">' +
        '<button class="ghost lu-back" id="luBack">← 返回列表</button>' +
        '<div class="nload">该股详情加载失败：' + esc(e.message) + '</div></div>';
    }).then(function () { limitup.detailLoading = false; });
  }

  function luPct(v) { return isNum(v) ? v.toFixed(1) + '%' : '—'; }
  function luAmount(v) { return isNum(v) ? (v / 100000000).toFixed(2) + ' 亿' : '—'; }
  function luSigned(v, d) { if (!isNum(v)) return '—'; d = d === undefined ? 1 : d; return (v > 0 ? '+' : '') + v.toFixed(d); }
  function luTone(score) {
    if (!isNum(score)) return 'muted';
    if (score >= 75) return 'good';
    if (score >= 55) return 'info';
    if (score >= 40) return 'warn';
    return 'bad';
  }
  function luTag(text, cls) {
    return '<span class="lu-tag ' + (cls || '') + '">' + esc(text) + '</span>';
  }
  function luStat(label, value, sub, tone) {
    return '<div class="lu-stat"><span>' + esc(label) + '</span><b class="' + (tone || '') + '">' + value + '</b><small>' + (sub || '') + '</small></div>';
  }
  function luKv(label, value, tone) {
    return '<div class="lu-kv"><span>' + esc(label) + '</span><b class="' + (tone || '') + '">' + value + '</b></div>';
  }
  function luProbCell(rate, lo, hi) {
    if (!isNum(rate)) return '—';
    var s = rate.toFixed(1) + '%';
    if (isNum(lo) && isNum(hi)) s += '<small>CI ' + lo.toFixed(1) + '~' + hi.toFixed(1) + '</small>';
    return s;
  }
  function luProbRow(label, b, cls) {
    if (!b) return '';
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
      '<td class="txt">' + esc(label) + '</td>' +
      '<td class="num">' + (b.n || 0) + '</td>' +
      '<td class="num">' + luProbCell(b.limitRate, b.limitCiLow, b.limitCiHigh) + '</td>' +
      '<td class="num">' + luProbCell(b.big5Rate, b.big5CiLow, b.big5CiHigh) + '</td>' +
      '<td class="num">' + luPct(b.upRate) + '</td>' +
      '<td class="num">' + spf(b.avgOpen) + '</td>' +
      '<td class="num">' + spf(b.avgHigh) + '</td>' +
      '<td class="num">' + spf(b.avgClose) + '</td>' +
      '</tr>';
  }
  function luBucketRow(label, b) {
    if (!b) return '';
    return '<tr><td class="txt">' + esc(label) + '</td>' +
      '<td class="num">' + (b.n || 0) + '</td>' +
      '<td class="num">' + luPct(b.limitRate) + '</td>' +
      '<td class="num">' + luPct(b.big5Rate) + '</td>' +
      '<td class="num">' + luPct(b.upRate) + '</td>' +
      '<td class="num">' + spf(b.avgClose) + '</td></tr>';
  }

  function limitupRender() {
    var d = limitup.data;
    if (!d) return;
    var s = d.sentiment || {};
    var time = String(d.asOf || '');
    $('#limitupMeta').textContent = '数据日 ' + (d.dateLabel || '—') + ' · ' + (d.isToday ? '盘中' : '已收盘') + ' · 更新 ' + (time.slice(11, 19) || '—');
    if ($('#luCount')) $('#luCount').textContent = '命中 ' + (d.total || 0) + ' / 涨停 ' + (d.rawCount || 0) + ' 只';

    var mood = '中性';
    var moodTone = 'info';
    if (isNum(s.sealRate) && isNum(s.yztAvg)) {
      if (s.sealRate >= 70 && s.yztAvg >= 2) { mood = '短线情绪偏强'; moodTone = 'good'; }
      else if (s.sealRate >= 60) { mood = '情绪中性偏强'; moodTone = 'info'; }
      else if (s.sealRate < 50 || s.yztAvg < 0) { mood = '情绪偏弱，注意接力风险'; moodTone = 'bad'; }
      else { mood = '情绪中性，分歧一般'; moodTone = 'warn'; }
    }
    var statsHtml = '<div class="lu-stats">' +
      luStat('涨停 / 炸板', (s.ztCount == null ? '—' : s.ztCount) + ' / ' + (s.zbCount == null ? '—' : s.zbCount), '跌停 ' + (s.dtCount == null ? '—' : s.dtCount) + ' 家') +
      luStat('封板率', luPct(s.sealRate), '炸板率 ' + luPct(s.brokenRate), isNum(s.sealRate) && s.sealRate >= 60 ? 'up' : '') +
      luStat('昨日涨停今日均', spf(s.yztAvg), '收涨占比 ' + luPct(s.yztUpRate) + ' · 样本 ' + (s.yztCount || 0), isNum(s.yztAvg) && s.yztAvg > 0 ? 'up' : (isNum(s.yztAvg) && s.yztAvg < 0 ? 'down' : '')) +
      luStat('昨日涨停再涨停', luPct(s.yztLimitRate), '≥5% ' + luPct(s.yztBig5Rate) + ' · 再涨停 ' + (s.yztLimitCount || 0) + ' 只', isNum(s.yztLimitRate) && s.yztLimitRate >= 25 ? 'up' : '') +
      luStat('涨跌家数', (s.upCount == null ? '—' : s.upCount) + ' / ' + (s.downCount == null ? '—' : s.downCount), '上涨占比 ' + luPct(s.breadthUpRate)) +
      luStat('最高连板', (s.maxStreak == null ? '—' : s.maxStreak + ' 板'), '首板 ' + (s.firstCount || 0) + ' · 2板 ' + (s.secondCount || 0) + ' · 3板+ ' + (s.thirdPlus || 0)) +
      '</div>' +
      '<div class="lu-mood lu-mood-' + moodTone + '"><b>' + esc(mood) + '</b><span>封板率 ' + luPct(s.sealRate) + ' · 昨日涨停今日平均 ' + spf(s.yztAvg) + ' · 上涨家数占比 ' + luPct(s.breadthUpRate) + '</span></div>';

    var inds = (d.industryTop || []).map(function (x) {
      return '<span class="lu-ind">' + esc(x.name) + '<b>' + x.count + '</b></span>';
    }).join('');
    if (inds) statsHtml += '<div class="lu-industries"><span class="muted">涨停行业集中度</span>' + inds + '</div>';
    $('#limitupSentiment').innerHTML = statsHtml;

    var items = d.items || [];
    if (!items.length) {
      $('#limitupList').innerHTML = '<div class="card lu-empty"><b>当前阈值下没有命中的放量涨停股</b><p class="muted">可以尝试降低量比 / 换手率 / 成交额门槛，或把连板范围切回「全部」。</p></div>';
      return;
    }
    var sort = limitup.filters.sort;
    function th(label, key, cls) {
      var on = key && sort === key ? ' class="on ' + (cls || '') + '"' : ' class="' + (cls || '') + '"';
      return '<th' + on + (key ? ' data-lu-sort="' + key + '"' : '') + '>' + label + '</th>';
    }
    var rows = items.map(function (x) {
      var tags = (x.tags || []).slice(0, 3).map(function (t) {
        var cls = '';
        if (/炸板|巨量/.test(t)) cls = 'warn';
        else if (/强|一字|秒板|板块/.test(t)) cls = 'good';
        return luTag(t, cls);
      }).join('');
      var chgTone = isNum(x.changePct) && x.changePct > 0 ? 'up' : (isNum(x.changePct) && x.changePct < 0 ? 'down' : '');
      var scoreTone = luTone(x.score);
      return '<tr class="lu-row" data-lu-code="' + esc(x.code) + '">' +
        '<td class="txt lu-name-cell"><b>' + esc(x.name) + '</b><span class="lu-code">' + esc(x.code) + '</span><div class="lu-tags">' + tags + '</div></td>' +
        '<td class="num hide-xxs">' + nf(x.price, 2) + '</td>' +
        '<td class="num ' + chgTone + ' hide-xs">' + spf(x.changePct, 2) + '</td>' +
        '<td class="num' + (isNum(x.volRatio) && x.volRatio >= 5 ? ' lu-hot' : '') + '">' + nf(x.volRatio, 2) + '</td>' +
        '<td class="num">' + pf(x.turnover, 2) + '</td>' +
        '<td class="num hide-s">' + luAmount(x.amount) + '</td>' +
        '<td class="num hide-s">' + esc(x.firstSeal || '—') + '</td>' +
        '<td class="num hide-s">' + (x.openCount > 0 ? x.openCount + ' 次' : '0') + '</td>' +
        '<td class="num hide-m">' + pf(x.sealRatio, 2) + '</td>' +
        '<td class="num">' + (x.streak > 1 ? x.streak + ' 板' : '首板') + '</td>' +
        '<td class="txt hide-s">' + esc(x.industry || '—') + (x.industryCount > 1 ? ' <span class="lu-ind-n">' + x.industryCount + '</span>' : '') + '</td>' +
        '<td class="num"><span class="lu-score t-' + scoreTone + '">' + nf(x.score, 0) + '</span></td>' +
        '</tr>';
    }).join('');

    $('#limitupList').innerHTML = '<div class="card limitup-table-card"><div class="lu-scroll"><table class="lu-table">' +
      '<thead><tr>' +
      th('股票 / 代码', '', 'txt') +
      th('现价', '', 'num hide-xxs') +
      th('涨幅', '', 'num hide-xs') +
      th('量比', 'volRatio', 'num') +
      th('换手', '', 'num') +
      th('成交额', 'amount', 'num hide-s') +
      th('首封', 'firstSeal', 'num hide-s') +
      th('炸板', '', 'num hide-s') +
      th('封单/流通', 'sealRatio', 'num hide-m') +
      th('连板', 'streak', 'num') +
      th('行业', '', 'txt hide-s') +
      th('评分', 'score', 'num') +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function limitupDetailRender(d) {
    var it = d.item || {};
    var pr = d.probability || {};
    var h = d.history || {};
    var t = d.tech || {};
    var sc = d.score || {};
    var lv = d.levels || {};
    var risks = d.risks || {};
    var sent = d.sentiment || {};
    var vol = pr.vol || {};
    var base = pr.baseline || {};
    var time = String(d.asOf || '');
    $('#limitupMeta').textContent = '数据日 ' + (d.dateLabel || '—') + ' · ' + (d.isToday ? '盘中' : '已收盘') + ' · 更新 ' + (time.slice(11, 19) || '—');

    var tags = (it.tags || []).map(function (x) { return luTag(x); }).join('');
    var scoreTone = luTone(sc.total);
    var chgTone = isNum(it.changePct) && it.changePct > 0 ? 'up' : (isNum(it.changePct) && it.changePct < 0 ? 'down' : '');
    var volN = vol.n || 0;
    var limitSm = vol.smoothedLimit;
    var big5Sm = vol.smoothedBig5;
    var conf = vol.confidence || '无样本';

    var html = '';
    html += '<div class="card lu-detail-head">' +
      '<div class="lu-detail-top">' +
      '<button class="ghost lu-back" id="luBack">← 返回列表</button>' +
      '<div class="lu-detail-name"><h2>' + esc(it.name) + ' <span class="lu-code">' + esc(it.code) + '</span></h2><div class="lu-tags">' + tags + '</div></div>' +
      '<div class="lu-detail-price"><div class="p">' + nf(it.price, 2) + '</div><div class="c ' + chgTone + '">' + spf(it.changePct, 2) + '</div></div>' +
      '<div class="lu-detail-score"><span class="lu-score-big t-' + scoreTone + '">' + nf(sc.total, 1) + '</span><span class="lu-grade">' + esc(sc.grade || '') + '</span><small>综合强度</small></div>' +
      '</div>' +
      '<div class="lu-facts">' +
      luKv('量比', nf(it.volRatio, 2), isNum(it.volRatio) && it.volRatio >= 2 ? 'up' : '') +
      luKv('换手率', pf(it.turnover, 2)) +
      luKv('成交额', luAmount(it.amount)) +
      luKv('封单 / 流通市值', pf(it.sealRatio, 2)) +
      luKv('封单额', luAmount(it.sealAmount)) +
      luKv('封单 / 成交额', pf(it.sealAmtRatio, 2)) +
      luKv('首次封板', esc(it.firstSeal || '—')) +
      luKv('最后封板', esc(it.lastSeal || '—')) +
      luKv('炸板次数', (it.openCount || 0) + ' 次', it.openCount > 0 ? 'warn' : '') +
      luKv('所属行业', esc(it.industry || '—') + (it.industryCount > 1 ? ' · ' + it.industryCount + ' 家涨停' : '')) +
      '</div></div>';

    html += '<div class="card lu-sec"><div class="lu-sec-head"><h3>综合强度拆解</h3><span class="muted">基础分 + 技术位置调整 + 历史概率调整 − 风险扣分</span></div>' +
      '<div class="lu-parts">' +
      '<div><span>基础分</span><b>' + nf(sc.base, 1) + '</b><small>封板 40 / 量能 30 / 连板板块 20 / 情绪 10</small></div>' +
      '<div><span>技术位置</span><b class="' + (sc.tech > 0 ? 'up' : sc.tech < 0 ? 'down' : '') + '">' + luSigned(sc.tech) + '</b><small>均线、平台突破、涨幅与压力位</small></div>' +
      '<div><span>历史概率</span><b class="' + (sc.prob > 0 ? 'up' : sc.prob < 0 ? 'down' : '') + '">' + luSigned(sc.prob) + '</b><small>相对当前市场基准的边际</small></div>' +
      '<div><span>风险扣分</span><b class="' + (sc.risk < 0 ? 'down' : '') + '">' + luSigned(sc.risk) + '</b><small>机械风险清单扣分</small></div>' +
      '<div class="lu-parts-total"><span>总分</span><b class="t-' + scoreTone + '">' + nf(sc.total, 1) + '</b><small>仅用于横向比较，不是上涨概率</small></div>' +
      '</div></div>';

    html += '<div class="card lu-sec"><div class="lu-sec-head"><h3>历史次日表现 <span class="tag">近 3 年同类样本</span></h3><span class="muted">放量口径：日成交量 / 前 5 日均量 ≥ ' + nf(h.minVolRatio, 1) + '</span></div>' +
      '<div class="lu-prob-hero">' +
      '<div class="lu-prob-big"><span>次日涨停参考</span><b class="up">' + luPct(limitSm) + '</b><small>历史 ' + (vol.limitCount || 0) + ' / ' + volN + ' = ' + luPct(vol.limitRate) + (volN ? ' · 95%CI ' + nf(vol.limitCiLow, 1) + '~' + nf(vol.limitCiHigh, 1) + '%' : '') + '</small><em>' + (volN ? '小样本平滑值' : '无历史样本 · 市场基准') + '</em></div>' +
      '<div class="lu-prob-big"><span>次日大涨 ≥5% 参考</span><b class="up">' + luPct(big5Sm) + '</b><small>历史 ' + (vol.big5Count || 0) + ' / ' + volN + ' = ' + luPct(vol.big5Rate) + (volN ? ' · 95%CI ' + nf(vol.big5CiLow, 1) + '~' + nf(vol.big5CiHigh, 1) + '%' : '') + '</small><em>' + (volN ? '小样本平滑值' : '无历史样本 · 市场基准') + '</em></div>' +
      '<div class="lu-prob-big"><span>样本量 / 置信度</span><b>' + volN + ' 次</b><small>次日收涨 ' + luPct(vol.upRate) + ' · 平均次日收盘 ' + spf(vol.avgClose) + '</small><em>' + esc(conf) + '</em></div>' +
      '</div>' +
      '<div class="lu-baseline">市场基准（昨日涨停股今日表现）：再涨停 <b>' + luPct(base.limitRate) + '</b> · 收盘 ≥5% <b>' + luPct(base.big5Rate) + '</b> · 收涨 <b>' + luPct(base.upRate) + '</b> · 样本 ' + (base.sample || 0) + ' 只</div>' +
      '<div class="lu-table-wrap"><table class="lu-table-mini"><thead><tr><th class="txt">口径</th><th class="num">样本</th><th class="num">次日涨停</th><th class="num">次日≥5%</th><th class="num">次日收涨</th><th class="num">均开</th><th class="num">均高</th><th class="num">均收</th></tr></thead><tbody>' +
      luProbRow('放量涨停', vol, 'on') +
      luProbRow('全部涨停', pr.all) +
      luProbRow('首板放量', pr.firstVol) +
      luProbRow('连板放量', pr.multiVol) +
      '</tbody></table></div>' +
      '<p class="lu-method">' + esc(pr.method || '') + '</p>' +
      '<div class="lu-grid2">' +
      '<div><h4 class="lu-h4">按当日量能分组</h4><div class="lu-table-wrap"><table class="lu-table-mini"><thead><tr><th class="txt">日K量比</th><th class="num">样本</th><th class="num">涨停</th><th class="num">≥5%</th><th class="num">收涨</th><th class="num">均收</th></tr></thead><tbody>' + (h.volBuckets || []).map(function (b) { return luBucketRow(b.label, b); }).join('') + '</tbody></table></div></div>' +
      '<div><h4 class="lu-h4">按连板高度分组</h4><div class="lu-table-wrap"><table class="lu-table-mini"><thead><tr><th class="txt">连板</th><th class="num">样本</th><th class="num">涨停</th><th class="num">≥5%</th><th class="num">收涨</th><th class="num">均收</th></tr></thead><tbody>' + (h.streakBuckets || []).map(function (b) { return luBucketRow(b.label, b); }).join('') + '</tbody></table></div></div>' +
      '</div>' +
      '<h4 class="lu-h4">次日开盘情景（按历史样本的次日开盘幅度分组）</h4><div class="lu-table-wrap"><table class="lu-table-mini"><thead><tr><th class="txt">次日开盘</th><th class="num">样本</th><th class="num">涨停</th><th class="num">≥5%</th><th class="num">收涨</th><th class="num">均收</th></tr></thead><tbody>' + (h.openBuckets || []).map(function (b) { return luBucketRow(b.label, b); }).join('') + '</tbody></table></div>' +
      '<h4 class="lu-h4">最近 6 次涨停样本</h4><div class="lu-table-wrap"><table class="lu-table-mini"><thead><tr><th class="txt">日期</th><th class="num">量比</th><th class="num">连板</th><th class="num">次日开盘</th><th class="num">次日最高</th><th class="num">次日收盘</th><th class="num">次日涨停</th></tr></thead><tbody>' +
      ((h.recent || []).map(function (e) {
        return '<tr><td class="txt">' + esc(e.date) + '</td><td class="num">' + nf(e.volRatio, 2) + '</td><td class="num">' + (e.streak > 1 ? e.streak + ' 板' : '首板') + '</td>' +
          '<td class="num ' + (e.nextOpenPct > 0 ? 'up' : e.nextOpenPct < 0 ? 'down' : '') + '">' + spf(e.nextOpenPct) + '</td>' +
          '<td class="num ' + (e.nextHighPct > 0 ? 'up' : e.nextHighPct < 0 ? 'down' : '') + '">' + spf(e.nextHighPct) + '</td>' +
          '<td class="num ' + (e.nextClosePct > 0 ? 'up' : e.nextClosePct < 0 ? 'down' : '') + '">' + spf(e.nextClosePct) + '</td>' +
          '<td class="num">' + (e.nextLimit ? '是' : '否') + '</td></tr>';
      }).join('') || '<tr><td colspan="7" class="txt muted">暂无已完成的历史样本</td></tr>') +
      '</tbody></table></div>' +
      '<p class="lu-method">样本已剔除「次日就是今天」的未完成 K 线；涨停按代码所属板块（10% / 20% / 30% / ST 5%）识别。历史样本 ' + (h.eventCount || 0) + ' 次，放量样本 ' + (h.volCount || 0) + ' 次，时间范围 ' + esc(h.firstDate || '—') + ' ~ ' + esc(h.lastDate || '—') + '。</p>' +
      '</div>';

    html += '<div class="card lu-sec"><div class="lu-sec-head"><h3>技术位置</h3><span class="muted">日 K：' + (t.bars || 0) + ' 根</span></div>' +
      '<div class="lu-kv-grid">' +
      luKv('现价', nf(t.price, 2)) +
      luKv('MA5', nf(t.ma5, 2) + (isNum(t.ma5Dist) ? '（' + spf(t.ma5Dist) + '）' : '')) +
      luKv('MA10', nf(t.ma10, 2) + (isNum(t.ma10Dist) ? '（' + spf(t.ma10Dist) + '）' : '')) +
      luKv('MA20', nf(t.ma20, 2) + (isNum(t.ma20Dist) ? '（' + spf(t.ma20Dist) + '）' : '')) +
      luKv('MA60', nf(t.ma60, 2) + (isNum(t.ma60Dist) ? '（' + spf(t.ma60Dist) + '）' : '')) +
      luKv('均线多头排列', t.maBull ? '是' : '否', t.maBull ? 'up' : 'warn') +
      luKv('近 20 日涨幅', spf(t.gain20), isNum(t.gain20) && t.gain20 > 0 ? 'up' : 'down') +
      luKv('近 60 日涨幅', spf(t.gain60), isNum(t.gain60) && t.gain60 > 0 ? 'up' : 'down') +
      luKv('250 日高点', nf(t.high250, 2)) +
      luKv('距 250 日高点', spf(t.high250Dist), isNum(t.high250Dist) && t.high250Dist >= 0 ? 'up' : '') +
      luKv('250 日区间位置', pf(t.rangePos, 1)) +
      luKv('60 日平台高点', nf(t.priorHigh60, 2)) +
      luKv('突破 60 日平台', t.breakout60 ? '是' : '否', t.breakout60 ? 'up' : '') +
      luKv('创 60 日新高', t.newHigh60 ? '是' : '否', t.newHigh60 ? 'up' : '') +
      luKv('日 K 量比', nf(t.dayVolRatio, 2)) +
      '</div></div>';

    var riskItems = (risks.items || []).map(function (r) {
      return '<li class="lu-risk-' + esc(r.level) + '"><i></i><span>' + esc(r.text) + '</span></li>';
    }).join('');
    var reasonItems = (d.reasons || []).map(function (x) {
      return '<li><i></i><span>' + esc(x) + '</span></li>';
    }).join('');
    html += '<div class="lu-grid2 lu-grid2-pad">' +
      '<div class="card lu-sec"><div class="lu-sec-head"><h3>风险清单</h3><span class="muted">高 ' + (risks.highCount || 0) + ' · 中 ' + (risks.midCount || 0) + ' · 低 ' + (risks.lowCount || 0) + '</span></div>' +
      (riskItems ? '<ul class="lu-risk-list">' + riskItems + '</ul>' : '<p class="muted">未触发明显机械风险，但仍需注意市场系统性风险和次日情绪变化。</p>') + '</div>' +
      '<div class="card lu-sec"><div class="lu-sec-head"><h3>正面因素</h3><span class="muted">来自封板、量能、板块与技术</span></div>' +
      (reasonItems ? '<ul class="lu-reason-list">' + reasonItems + '</ul>' : '<p class="muted">暂无明显正面标签。</p>') + '</div>' +
      '</div>';

    var notes = (lv.notes || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    html += '<div class="card lu-sec"><div class="lu-sec-head"><h3>次日观察点</h3><span class="muted">价格单位：元</span></div>' +
      '<div class="lu-levels">' +
      '<div class="lu-level"><span>次日涨停价</span><b class="up">' + nf(lv.nextLimitPrice, 2) + '</b></div>' +
      '<div class="lu-level"><span>次日跌停价</span><b class="down">' + nf(lv.nextLimitDownPrice, 2) + '</b></div>' +
      '<div class="lu-level"><span>短线支撑</span><b>' + nf(lv.support, 2) + '</b></div>' +
      '<div class="lu-level"><span>上方压力</span><b>' + (isNum(lv.pressure) ? nf(lv.pressure, 2) : '—') + '</b></div>' +
      '</div><ul class="lu-notes">' + notes + '</ul>' +
      '<div class="lu-actions"><button class="scan-btn" data-code="' + esc(it.code) + '">打开五层基本面报告</button><button class="ghost" id="luDetailRefresh">重新分析</button></div>' +
      '</div>';

    if ((d.peers || []).length) {
      html += '<div class="card lu-sec"><div class="lu-sec-head"><h3>同行业涨停股</h3><span class="muted">' + esc(it.industry || '') + ' · 共 ' + (it.industryCount || 0) + ' 家</span></div><div class="lu-peers">' +
        d.peers.map(function (p) {
          return '<button class="lu-peer" data-lu-code="' + esc(p.code) + '"><b>' + esc(p.name) + '</b><span>' + esc(p.code) + '</span><em>' + (p.streak > 1 ? p.streak + ' 板' : '首板') + ' · 量比 ' + nf(p.volRatio, 2) + ' · ' + nf(p.score, 0) + ' 分</em></button>';
        }).join('') + '</div></div>';
    }

    html += '<p class="scan-note muted">' + esc(d.method || '') + ' 市场情绪：封板率 ' + luPct(sent.sealRate) + '，昨日涨停股今日平均 ' + spf(sent.yztAvg) + '。工具只做机械统计，<b>不构成投资建议</b>。</p>';
    $('#limitupDetail').innerHTML = html;
  }


  var indices = { data: null, loaded: false, loading: false, timer: null };

  function indicesClose() {
    var v = $('#indicesView');
    if (v) v.hidden = true;
    if (indices.timer) { clearInterval(indices.timer); indices.timer = null; }
  }

  function indicesOpen() {
    if (FILE_MODE && !API && !STANDALONE) { showFileNotice(); return; }
    $('#welcome').hidden = true;
    $('#report').hidden = true;
    $('#loading').hidden = true;
    $('#errorBox').hidden = true;
    $('#layerNav').hidden = true;
    scanClose();
    deepClose();
    newsClose();
    watchClose();
    premarketClose();
    limitupClose();
    $('#indicesView').hidden = false;
    try { history.replaceState(null, '', '#/indices'); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (indices.data) indicesRender();
    indicesLoad(false);
    if (indices.timer) clearInterval(indices.timer);
    indices.timer = setInterval(function () {
      if (!$('#indicesView').hidden && !document.hidden) indicesLoad(false);
    }, 20000);
  }

  function indicesLoad(force) {
    if (FILE_MODE && !API && !STANDALONE) return;
    var seq = (indices.seq || 0) + 1;
    indices.seq = seq;
    indices.loading = true;
    if (!indices.data) $('#indicesGroups').innerHTML = '<div class="nload">正在获取全球指数行情…</div>';
    fetchJSON(API + '/api/indices' + (force ? '?refresh=1' : '')).then(function (d) {
      if (seq !== indices.seq) return;
      if (!d || !d.ok) throw new Error((d && d.error) || '接口返回异常');
      indices.data = d;
      indices.loaded = true;
      indicesRender();
    }).catch(function (e) {
      if (seq !== indices.seq) return;
      if (!indices.data) $('#indicesGroups').innerHTML = '<div class="nload">全球指数加载失败：' + esc(e.message) + '</div>';
      else toast('指数刷新失败：' + e.message);
    }).then(function () {
      if (seq === indices.seq) indices.loading = false;
    });
  }

  function indicesRender() {
    var d = indices.data;
    if (!d) return;
    var groups = d.groups || [], items = d.items || [];
    var up = 0, down = 0, flat = 0, best = null, worst = null;
    items.forEach(function (x) {
      if (!x.ok || !isNum(x.pct) || x.status === 'preopen') return;
      if (x.pct > 0.001) up++;
      else if (x.pct < -0.001) down++;
      else flat++;
      if (!best || x.pct > best.pct) best = x;
      if (!worst || x.pct < worst.pct) worst = x;
    });
    $('#indicesMeta').textContent = '更新于 ' + (d.time || '—') + ' · ' + (d.okCount || 0) + '/' + (d.total || 0) + ' 个指数 · 每 20 秒自动刷新';
    $('#indicesSummary').innerHTML =
      '<div class="idx-sum"><span>上涨 / 下跌 / 平</span><b><i class="up">' + up + '</i> / <i class="dn">' + down + '</i> / ' + flat + '</b></div>' +
      (best ? '<div class="idx-sum"><span>最强 · ' + esc(best.name) + '</span><b class="up">' + spf(best.pct, 2) + '</b></div>' : '') +
      (worst ? '<div class="idx-sum"><span>最弱 · ' + esc(worst.name) + '</span><b class="dn">' + spf(worst.pct, 2) + '</b></div>' : '') +
      '<div class="idx-sum"><span>数据源</span><b class="idx-src">' + esc(d.source || '—') + '</b></div>';

    var html = groups.map(function (g) {
      var gup = 0, gdown = 0;
      (g.items || []).forEach(function (x) {
        if (!x.ok || !isNum(x.pct) || x.status === 'preopen') return;
        if (x.pct > 0.001) gup++; else if (x.pct < -0.001) gdown++;
      });
      var cards = (g.items || []).map(function (x) {
        var pre = x.status === 'preopen';
        var cls = pre ? 'preopen' : (x.ok ? (isNum(x.pct) && x.pct > 0 ? 'up' : isNum(x.pct) && x.pct < 0 ? 'down' : '') : 'off');
        var pos = 50;
        if (x.ok && !pre && isNum(x.high) && isNum(x.low) && x.high > x.low) {
          pos = clamp((x.price - x.low) / (x.high - x.low) * 100, 0, 100);
        }
        var chg;
        if (pre) chg = '未开盘';
        else if (x.ok) chg = (x.change > 0 ? '+' : '') + nf(x.change, 2) + '　' + spf(x.pct, 2);
        else chg = '暂无数据';
        var st = x.status || 'unknown';
        var stText = x.statusText || (st === 'live' ? '实时' : st === 'delayed' ? '延迟' : st === 'closed' ? '非交易时段' : st === 'preopen' ? '未开盘' : '时间未知');
        var quote = pre ? '等待开盘' : (!x.quoteLabel ? '行情时间未知' : (st === 'closed' ? '收盘 ' + String(x.quoteTime || x.quoteLabel).slice(5, 16) : '行情 ' + x.quoteLabel));
        return '<article class="idx-card ' + cls + '">' +
          '<div class="idx-top"><b>' + esc(x.name) + '</b><span class="idx-tags"><span class="idx-st ' + esc(st) + '">' + esc(stText) + '</span><span class="idx-code">' + esc(x.code) + '</span></span></div>' +
          '<div class="idx-price">' + (x.ok ? nf(x.price, 2) : '—') + (pre ? '<small class="idx-prev-tag">昨收</small>' : '') + '</div>' +
          '<div class="idx-chg">' + chg + '</div>' +
          '<div class="idx-quote">' + esc(quote) + '</div>' +
          (x.ok && !pre ? '<div class="idx-track"><i style="left:' + pos.toFixed(1) + '%"></i></div>' : '<div class="idx-track idx-track-empty"></div>') +
          '<div class="idx-meta"><span>高 ' + nf(x.high, 2) + '</span><span>低 ' + nf(x.low, 2) + '</span></div>' +
          '<div class="idx-meta"><span>开 ' + nf(x.open, 2) + '</span><span>昨收 ' + nf(x.prevClose, 2) + '</span></div>' +
          '</article>';
      }).join('');
      return '<div class="card idx-group"><div class="idx-group-head"><h3>' + esc(g.name) + '</h3>' +
        '<span class="muted">上涨 ' + gup + ' · 下跌 ' + gdown + '</span></div>' +
        '<div class="idx-grid">' + cards + '</div></div>';
    }).join('');
    if (!html) html = '<div class="nload">' + esc(d.error || '暂无可展示的指数数据') + '</div>';
    $('#indicesGroups').innerHTML = html;
  }

  /* ---------------- 美股盘前 ---------------- */
  var premarket = { data: null, loading: false, timer: null, seq: 0, codes: [], mode: 'default', auto: true };
  try {
    var pmSaved = localStorage.getItem('wf5_premarket_codes') || '';
    if (pmSaved) premarket.codes = pmSaved.split(',').filter(function (x) { return x; });
    premarket.auto = localStorage.getItem('wf5_premarket_auto') !== '0';
    var pmMode = localStorage.getItem('wf5_premarket_mode') || '';
    if (pmMode === 'ndx100') premarket.mode = 'ndx100';
    else if (pmMode === 'custom' && premarket.codes.length) premarket.mode = 'custom';
    else if (pmMode === 'default') premarket.mode = 'default';
    else premarket.mode = premarket.codes.length ? 'custom' : 'default';
  } catch (e) {
    premarket.mode = premarket.codes.length ? 'custom' : 'default';
  }

  function pmUsd(v) {
    if (!isNum(v)) return '—';
    if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
    if (v >= 1e4) return (v / 1e4).toFixed(1) + ' 万';
    return v.toFixed(0);
  }

  function pmPct(v) {
    if (!isNum(v)) return '—';
    if (Math.abs(v) < 0.005) return '0.00%';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  function pmSigned(v) {
    if (!isNum(v)) return '—';
    if (Math.abs(v) < 0.005) return '0.00';
    return (v > 0 ? '+' : '') + v.toFixed(2);
  }

  function pmSaveMode() {
    try { localStorage.setItem('wf5_premarket_mode', premarket.mode); } catch (e) {}
  }

  function pmMetaLabel() {
    if (premarket.mode === 'ndx100') return '纳斯达克100 成分股';
    if (premarket.mode === 'custom' && premarket.codes.length) return '自选 ' + premarket.codes.length + ' 只';
    return '默认热门池';
  }

  function pmPoolsRender() {
    var html = '<span class="pm-tools-label">行情列表</span>' +
      '<button type="button" class="pm-pool' + (premarket.mode === 'default' ? ' on' : '') + '" data-pm-mode="default" aria-pressed="' + (premarket.mode === 'default' ? 'true' : 'false') + '">热门池</button>' +
      '<button type="button" class="pm-pool' + (premarket.mode === 'ndx100' ? ' on' : '') + '" data-pm-mode="ndx100" aria-pressed="' + (premarket.mode === 'ndx100' ? 'true' : 'false') + '">纳斯达克100</button>';
    if (premarket.codes.length) {
      html += '<button type="button" class="pm-pool' + (premarket.mode === 'custom' ? ' on' : '') + '" data-pm-mode="custom" aria-pressed="' + (premarket.mode === 'custom' ? 'true' : 'false') + '">自选 <span class="n">' + premarket.codes.length + '</span></button>';
    }
    var box = $('#premarketPools');
    if (box && box.innerHTML !== html) box.innerHTML = html;
  }

  function pmSetMode(mode) {
    if (mode === 'custom' && !premarket.codes.length) {
      toast('请先在输入框填写自选代码');
      $('#premarketInput').focus();
      return;
    }
    if (mode !== 'default' && mode !== 'ndx100' && mode !== 'custom') return;
    if (premarket.mode === mode) {
      if (!premarket.data && !premarket.loading) premarketLoad(true);
      return;
    }
    premarket.mode = mode;
    premarket.data = null;
    pmSaveMode();
    pmPoolsRender();
    $('#pmSummary').innerHTML = '';
    $('#premarketFutures').innerHTML = '';
    $('#premarketGroups').innerHTML = '<div class="nload">正在获取美股盘前行情…</div>';
    $('#pmMeta').textContent = pmMetaLabel();
    premarketLoad(true);
  }

  function pmSyncTimer() {
    if (premarket.timer) { clearInterval(premarket.timer); premarket.timer = null; }
    if (!premarket.auto) return;
    premarket.timer = setInterval(function () {
      if (!$('#premarketView').hidden && !document.hidden) premarketLoad(false);
    }, 15000);
  }

  function premarketClose() {
    var v = $('#premarketView');
    if (v) v.hidden = true;
    if (premarket.timer) { clearInterval(premarket.timer); premarket.timer = null; }
  }

  function premarketOpen() {
    if (FILE_MODE && !API && !STANDALONE) { showFileNotice(); return; }
    $('#welcome').hidden = true;
    $('#report').hidden = true;
    $('#loading').hidden = true;
    $('#errorBox').hidden = true;
    $('#layerNav').hidden = true;
    scanClose();
    deepClose();
    newsClose();
    watchClose();
    indicesClose();
    limitupClose();
    $('#premarketView').hidden = false;
    try { history.replaceState(null, '', '#/premarket'); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('#premarketInput').value = premarket.codes.join(',');
    $('#premarketAuto').checked = premarket.auto;
    pmPoolsRender();
    $('#pmMeta').textContent = pmMetaLabel();
    if (premarket.data) premarketRender();
    premarketLoad(false);
    pmSyncTimer();
  }

  function premarketLoad(force) {
    if (FILE_MODE && !API && !STANDALONE) return;
    var seq = (premarket.seq || 0) + 1;
    premarket.seq = seq;
    premarket.loading = true;
    if (!premarket.data) $('#premarketGroups').innerHTML = '<div class="nload">正在获取美股盘前行情…</div>';
    var q = [];
    if (premarket.mode === 'ndx100') q.push('preset=ndx100');
    else if (premarket.mode === 'custom' && premarket.codes.length) q.push('codes=' + encodeURIComponent(premarket.codes.join(',')));
    if (force) q.push('refresh=1');
    var url = API + '/api/uspremarket' + (q.length ? '?' + q.join('&') : '');
    fetchJSON(url).then(function (d) {
      if (seq !== premarket.seq) return;
      if (!d || !d.ok) throw new Error((d && d.error) || '接口返回异常');
      premarket.data = d;
      premarketRender();
    }).catch(function (e) {
      if (seq !== premarket.seq) return;
      if (!premarket.data) $('#premarketGroups').innerHTML = '<div class="nload">美股盘前行情加载失败：' + esc(e.message) + '</div>';
      else toast('美股盘前刷新失败：' + e.message);
    }).then(function () {
      if (seq === premarket.seq) premarket.loading = false;
    });
  }

  function premarketRender() {
    var d = premarket.data;
    if (!d) return;
    var st = d.status || 'closed';
    var tag = $('#pmSessionTag');
    tag.textContent = d.statusText || '—';
    tag.className = 'tag pm-st ' + st;
    $('#premarketStatus').textContent = '更新 ' + (d.bjTime || d.time || '—') + ' 北京 · 美东 ' + (d.etTime || '—') + ' · ' + (d.okCount || 0) + '/' + (d.count || 0) + ' 只';
    if (d.preset === 'ndx100') $('#pmMeta').textContent = '纳斯达克100 · ' + (d.presetCount || d.count || 0) + ' 只';
    else if (premarket.mode === 'custom' && premarket.codes.length) $('#pmMeta').textContent = '自选 ' + premarket.codes.length + ' 只';
    else $('#pmMeta').textContent = '默认热门池';
    pmPoolsRender();
    $('#premarketAuto').checked = premarket.auto;

    var futLine = (d.futures || []).filter(function (f) { return f.ok && isNum(f.pct); }).map(function (f) {
      return f.code + ' ' + spf(f.pct, 2);
    }).join(' · ');
    var summary = '<div class="idx-sum"><span>市场状态</span><b class="pm-st-text ' + esc(st) + '">' + esc(d.statusText || '—') + '</b></div>' +
      '<div class="idx-sum"><span>上涨 / 下跌 / 平</span><b><i class="up">' + (d.up || 0) + '</i> / <i class="dn">' + (d.down || 0) + '</i> / ' + (d.flat || 0) + '</b></div>';
    if (d.best) summary += '<div class="idx-sum"><span>最强 · ' + esc(d.best.name) + '</span><b class="up">' + spf(d.best.pct, 2) + '</b></div>';
    if (d.worst) summary += '<div class="idx-sum"><span>最弱 · ' + esc(d.worst.name) + '</span><b class="dn">' + spf(d.worst.pct, 2) + '</b></div>';
    if (futLine) summary += '<div class="idx-sum pm-sum-wide"><span>三大期指</span><b class="idx-src">' + esc(futLine) + '</b></div>';
    $('#pmSummary').innerHTML = summary;

    var futs = (d.futures || []).map(function (f) {
      var cls = !f.ok || !isNum(f.pct) ? 'off' : (f.pct > 0.001 ? 'up' : (f.pct < -0.001 ? 'down' : 'flat'));
      var chg = f.ok ? (pmSigned(f.change) + '　' + pmPct(f.pct)) : '暂无数据';
      return '<article class="pm-fut ' + cls + '">' +
        '<div class="pm-fut-top"><b>' + esc(f.name || f.code) + '</b><span class="pm-fut-code">' + esc(f.code) + '</span></div>' +
        '<div class="pm-fut-price">' + nf(f.price, 2) + '</div>' +
        '<div class="pm-fut-chg">' + chg + '</div>' +
        '<div class="pm-fut-meta"><span>昨结 ' + nf(f.prevClose, 2) + '</span><span>' + esc(f.time || '—') + '</span></div>' +
        '</article>';
    }).join('');
    $('#premarketFutures').innerHTML = '<div class="pm-fut-head"><h3>三大期指</h3><span class="muted">CME 迷你期货 · 美东时间</span></div>' +
      '<div class="pm-fut-grid">' + (futs || '<div class="nload">期指行情暂不可用</div>') + '</div>';

    var html = (d.groups || []).map(function (g) {
      var arr = g.items || [];
      var gup = 0, gdn = 0;
      arr.forEach(function (x) {
        if (!x.ok || !isNum(x.latestPct)) return;
        if (x.latestPct > 0.001) gup++; else if (x.latestPct < -0.001) gdn++;
      });
      var rows = arr.map(function (x) {
        var has = x.ok && isNum(x.latestPct);
        var cls = !x.ok ? 'off' : (has && x.latestPct > 0.005 ? 'up' : (has && x.latestPct < -0.005 ? 'down' : ''));
        var kind = 'k-' + (x.latestKind || 'off');
        var chg = pmSigned(x.latestChange);
        return '<tr class="' + cls + '">' +
          '<td class="pm-name"><b>' + esc(x.name) + '</b><span>' + esc(x.code) + '</span></td>' +
          '<td class="num pm-latest">' + nf(x.latestPrice, 2) + '</td>' +
          '<td class="num pm-pct">' + pmPct(x.latestPct) + '</td>' +
          '<td class="num hide-m">' + chg + '</td>' +
          '<td class="num pm-ext hide-m">' + nf(x.extPrice, 2) + '<small>' + pmPct(x.extPct) + '</small></td>' +
          '<td class="num hide-m">' + (isNum(x.extAmount) ? pmUsd(x.extAmount) : '—') + '</td>' +
          '<td class="num hide-s">' + esc(x.latestTime || '—') + '</td>' +
          '<td class="num hide-s">' + nf(x.regularPrice, 2) + '</td>' +
          '<td class="num hide-s">' + nf(x.refPrice, 2) + '</td>' +
          '<td class="pm-kind-cell"><span class="pm-kind ' + kind + '">' + esc(x.latestKindText || '—') + '</span></td>' +
          '</tr>';
      }).join('');
      var gnote = '上涨 ' + gup + ' · 下跌 ' + gdn + ' · 按延时段涨跌幅排序';
      if (d.preset === 'ndx100') gnote = '共 ' + arr.length + ' 只 · 截至 ' + (d.presetAsOf || '—') + ' · ' + gnote;
      return '<div class="card pm-group"><div class="pm-group-head"><h3>' + esc(g.name) + '</h3>' +
        '<span class="muted">' + esc(gnote) + '</span></div>' +
        '<div class="pm-scroll"><table class="pm-table"><thead><tr>' +
        '<th>股票</th><th>最新价</th><th>涨跌幅</th><th class="hide-m">涨跌额</th><th class="hide-m">盘前 / 盘后</th>' +
        '<th class="hide-m">时段成交额</th><th class="hide-s">行情时间 ET</th><th class="hide-s">正股价</th><th class="hide-s">涨跌基准</th><th>状态</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }).join('');
    if (!html) html = '<div class="nload">' + esc(d.error || '暂无可展示的美股行情') + '</div>';
    $('#premarketGroups').innerHTML = html;
  }

  function premarketApply() {
    var raw = $('#premarketInput').value || '';
    var seen = {}, codes = [], bad = [], over = false;
    raw.toUpperCase().split(/[\s,，;、]+/).forEach(function (p) {
      p = (p || '').trim().replace(/\$/g, '.');
      if (!p) return;
      if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(p)) { bad.push(p); return; }
      if (seen[p]) return;
      seen[p] = true;
      if (codes.length >= 40) { over = true; return; }
      codes.push(p);
    });
    if (bad.length) toast('已忽略无效代码：' + bad.slice(0, 3).join(', ') + (bad.length > 3 ? '…' : ''));
    if (!codes.length && raw.trim()) { toast('没有有效的美股代码'); return; }
    if (over) toast('最多 40 只，已保留前 40 只');
    premarket.codes = codes;
    premarket.mode = codes.length ? 'custom' : 'default';
    premarket.data = null;
    try {
      if (codes.length) localStorage.setItem('wf5_premarket_codes', codes.join(','));
      else localStorage.removeItem('wf5_premarket_codes');
    } catch (e) {}
    pmSaveMode();
    pmPoolsRender();
    $('#premarketInput').value = codes.join(',');
    $('#pmSummary').innerHTML = '';
    $('#premarketFutures').innerHTML = '';
    $('#premarketGroups').innerHTML = '<div class="nload">正在获取美股盘前行情…</div>';
    $('#pmMeta').textContent = pmMetaLabel();
    premarketLoad(true);
  }

  function premarketReset() {
    premarket.codes = [];
    premarket.mode = 'default';
    premarket.data = null;
    try { localStorage.removeItem('wf5_premarket_codes'); } catch (e) {}
    pmSaveMode();
    pmPoolsRender();
    $('#premarketInput').value = '';
    $('#pmSummary').innerHTML = '';
    $('#premarketFutures').innerHTML = '';
    $('#premarketGroups').innerHTML = '<div class="nload">正在获取美股盘前行情…</div>';
    $('#pmMeta').textContent = pmMetaLabel();
    premarketLoad(true);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('#searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      analyze($('#codeInput').value.trim());
    });
    $('#codeInput').addEventListener('input', function () {
      this.value = this.value.replace(/\D/g, '').slice(0, 6);
    });
    document.body.addEventListener('click', function (e) {
      var wb = e.target.closest ? e.target.closest('[data-watch-code]') : null;
      if (wb) {
        e.preventDefault();
        watchToggle(wb.getAttribute('data-watch-code'));
        return;
      }
      var b = e.target.closest ? e.target.closest('[data-code]') : null;
      if (!b) return;
      var code = b.getAttribute('data-code');
      $('#codeInput').value = code;
      analyze(code);
    });
    $('#brandLink').addEventListener('click', function (e) {
      e.preventDefault();
      state.code = null;
      scanClose();
      deepClose();
      newsClose();
      watchClose();
      indicesClose();
      premarketClose();
      limitupClose();
      $('#report').hidden = true;
      $('#loading').hidden = true;
      $('#errorBox').hidden = true;
      $('#layerNav').hidden = true;
      $('#welcome').hidden = false;
      try { history.replaceState(null, '', '#/'); } catch (err) {}
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('#retryBtn').addEventListener('click', function () {
      if (state.code) analyze(state.code, { refresh: true });
      else $('#codeInput').focus();
    });
    $('#refreshBtn').addEventListener('click', function () {
      if (state.code) analyze(state.code, { refresh: true });
      else toast('先输入一个 6 位代码');
    });
    $('#report').addEventListener('click', function (e) {
      var kb = e.target.closest ? e.target.closest('[data-kperiod]') : null;
      if (kb) {
        e.preventDefault();
        klineLoad(state.code, kb.getAttribute('data-kperiod'), false);
        return;
      }
      if (e.target.closest && e.target.closest('#klineRefresh')) {
        e.preventDefault();
        klineLoad(state.code, kline.period || 'day', true);
      }
    });
    $('#deepBtn').addEventListener('click', function () { deepOpen(); });
    $('#deepRun').addEventListener('click', function () { deepRun(); });
    $('#deepClear').addEventListener('click', function () { $('#deepInput').value = ''; $('#deepResults').innerHTML = ''; $('#deepSummary').innerHTML = ''; });
    $('#deepChips').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-sample]') : null;
      if (!b) return;
      var v = b.getAttribute('data-sample');
      var cur = $('#deepInput').value.trim();
      if (cur.indexOf(v) < 0) { $('#deepInput').value = cur ? cur + ' ' + v : v; }
    });
    $('#deepInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); deepRun(); }
    });
    $('#deepSummary').addEventListener('click', function (e) {
      var tr = e.target.closest ? e.target.closest('tr[data-code]') : null;
      if (!tr) return;
      var el = document.getElementById('dc-' + tr.getAttribute('data-code'));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#watchBtn').addEventListener('click', watchOpen);
    $('#watchCta').addEventListener('click', watchOpen);
    $('#indicesCta').addEventListener('click', indicesOpen);
    $('#watchAddBtn').addEventListener('click', watchAdd);
    $('#watchInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); watchAdd(); }
    });
    $('#watchRefresh').addEventListener('click', function () {
      watchFetch({ silent: false }).then(function (d) { if (d) toast('特别关注已刷新 · ' + d.time); });
    });
    $('#watchSaveSettings').addEventListener('click', function () {
      var q = '?changePct=' + encodeURIComponent($('#wsChange').value) +
        '&turnover=' + encodeURIComponent($('#wsTurnover').value) +
        '&volRatio=' + encodeURIComponent($('#wsVol').value) +
        '&amplitude=' + encodeURIComponent($('#wsAmp').value) +
        '&highPct=' + encodeURIComponent($('#wsHigh').value) +
        '&lowPct=' + encodeURIComponent($('#wsLow').value) +
        '&tipsOn=' + ($('#wsTips').checked ? '1' : '0');
      fetchJSON(API + '/api/watchlist/settings' + q).then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || '保存失败');
        watch.settings = d.settings || {};
        toast('提醒阈值已保存');
        return watchFetch({ silent: false });
      }).catch(function (e) { toast('保存失败：' + e.message); });
    });
    $('#watchNotify').addEventListener('click', watchEnableNotify);
    $('#watchView').addEventListener('click', function (e) {
      var rm = e.target.closest ? e.target.closest('[data-remove]') : null;
      if (!rm) return;
      e.preventDefault();
      e.stopPropagation();
      watchRemove(rm.getAttribute('data-remove'), rm.getAttribute('data-name'));
    });
    $('#alertGo').addEventListener('click', function () {
      $('#alertStrip').hidden = true;
      watchOpen();
    });
    $('#alertClose').addEventListener('click', function () { $('#alertStrip').hidden = true; });
    $('#indexBtn').addEventListener('click', indicesOpen);
    $('#indicesRefresh').addEventListener('click', function () { indicesLoad(true); });
    $('#premarketBtn').addEventListener('click', premarketOpen);
    $('#premarketCta').addEventListener('click', premarketOpen);
    $('#premarketRefresh').addEventListener('click', function () { premarketLoad(true); });
    $('#premarketPools').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-pm-mode]') : null;
      if (!b) return;
      e.preventDefault();
      pmSetMode(b.getAttribute('data-pm-mode'));
    });
    $('#premarketApply').addEventListener('click', premarketApply);
    $('#premarketReset').addEventListener('click', premarketReset);
    $('#premarketInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); premarketApply(); }
    });
    $('#premarketAuto').addEventListener('change', function () {
      premarket.auto = !!this.checked;
      try { localStorage.setItem('wf5_premarket_auto', premarket.auto ? '1' : '0'); } catch (e) {}
      pmSyncTimer();
    });
    $('#limitupBtn').addEventListener('click', function () { limitupOpen(); });
    $('#limitupCta').addEventListener('click', function () { limitupOpen(); });
    $('#limitupRefresh').addEventListener('click', function () {
      if (!$('#limitupDetail').hidden && limitup.detailCode) limitupDetailLoad(limitup.detailCode, true);
      else limitupLoad(true);
    });
    $('#luApply').addEventListener('click', limitupApplyFilters);
    $('#luReset').addEventListener('click', limitupReset);
    $('#luBoard').addEventListener('change', limitupApplyFilters);
    $('#luSort').addEventListener('change', limitupApplyFilters);
    $('#luSealed').addEventListener('change', limitupApplyFilters);
    ['luVolRatio', 'luTurnover', 'luAmount'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); limitupApplyFilters(); }
      });
    });
    $('#limitupAuto').addEventListener('change', function () {
      limitup.auto = !!this.checked;
      try { localStorage.setItem('wf5_limitup_auto', limitup.auto ? '1' : '0'); } catch (e) {}
    });
    $('#limitupView').addEventListener('click', function (e) {
      var back = e.target.closest ? e.target.closest('#luBack') : null;
      if (back) { e.preventDefault(); limitupBack(); return; }
      var rf = e.target.closest ? e.target.closest('#luDetailRefresh') : null;
      if (rf) { e.preventDefault(); if (limitup.detailCode) limitupDetailLoad(limitup.detailCode, true); return; }
      var th = e.target.closest ? e.target.closest('th[data-lu-sort]') : null;
      if (th) {
        e.preventDefault();
        limitupSort(th.getAttribute('data-lu-sort'));
        return;
      }
      var row = e.target.closest ? e.target.closest('[data-lu-code]') : null;
      if (row) {
        e.preventDefault();
        limitupDetailOpen(row.getAttribute('data-lu-code'));
      }
    });
    $('#scanBtn').addEventListener('click', function () { scanOpen(); });
    $('#scanCta').addEventListener('click', function () { scanOpen(); });
    $('#scanStart').addEventListener('click', function () { scanStart(); });
    $('#scanCsv').addEventListener('click', scanCsv);
    $('#scanDeep').addEventListener('click', function () {
      var rows = scanFiltered();
      if (!rows.length) { toast('没有可分析的股票'); return; }
      var codes = rows.slice(0, 20).map(function (x) { return x.code; }).join(' ');
      deepOpen(codes);
    });
    $('#scanSearch').addEventListener('input', function () { scan.q = this.value; scan.page = 0; scanRender(); });
    $('#scanRating').addEventListener('change', function () { scan.rating = this.value; scan.page = 0; scanRender(); });
    $('#scanView').addEventListener('click', function (e) {
      var th = e.target.closest ? e.target.closest('th[data-sk]') : null;
      if (th) {
        var k = th.getAttribute('data-sk');
        if (k === 'idx') return;
        if (scan.sortKey === k) { scan.sortDir = -scan.sortDir; }
        else {
          scan.sortKey = k;
          scan.sortDir = (k === 'name' || k === 'board' || k === 'rating' || k === 'code') ? 1 : -1;
        }
        scan.page = 0;
        scanRender();
        return;
      }
      var pg = e.target.closest ? e.target.closest('button[data-pg]') : null;
      if (pg) {
        scan.page = Math.max(0, scan.page + parseInt(pg.getAttribute('data-pg'), 10));
        scanRender();
      }
    });
    $('#printBtn').addEventListener('click', function () { window.print(); });
    $('#themeBtn').addEventListener('click', function () {
      applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    });
    window.addEventListener('hashchange', route);
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        CH.palette = pal();
        CH.jobs.forEach(function (j) { drawChart(j.host, j.spec); });
        if (kline.data && kline.data.ok && !$('#report').hidden) drawKlineChart();
      }, 180);
    });

    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var id = en.target.id;
          $$('.layer-nav a').forEach(function (a) {
            a.classList.toggle('on', a.getAttribute('data-spy') === id);
          });
        });
      }, { rootMargin: '-130px 0px -55% 0px', threshold: 0 });
      ['sec-hero', 'sec-kline', 'sec-tips', 'sec-l1', 'sec-l2', 'sec-l3', 'sec-l4', 'sec-l5', 'sec-notes'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) obs.observe(el);
      });
    }
  }

  /* ---------------- 启动 ---------------- */
  function route() {
    var h = location.hash || '';
    var lm = h.match(/^#\/limitup(?:\/(\d{6}))?$/);
    if (lm) { limitupOpen(lm[1] || null); return; }
    if (/^#\/watchlist\b/.test(h)) { watchOpen(); return; }
    if (/^#\/indices\b/.test(h)) { indicesOpen(); return; }
    if (/^#\/premarket\b/.test(h)) { premarketOpen(); return; }
    if (/^#\/scan\b/.test(h)) { scanOpen(); return; }
    var nm = h.match(/^#\/news(?:\/(\d{6}))?$/);
    if (nm) { newsOpen(nm[1] || null); return; }
    var dm = h.match(/^#\/deep(?:\/(\d{6}(?:[,，]\d{6})*))?$/);
    if (dm) { deepOpen(dm[1] ? dm[1].replace(/，/g, ',') : null); return; }
    var m = h.match(/^#\/(\d{6})$/);
    if (m) { $('#codeInput').value = m[1]; analyze(m[1]); return; }
    state.code = null;
    scanClose();
    deepClose();
    newsClose();
    watchClose();
    indicesClose();
    premarketClose();
    limitupClose();
    $('#report').hidden = true;
    $('#loading').hidden = true;
    $('#errorBox').hidden = true;
    $('#layerNav').hidden = true;
    $('#welcome').hidden = false;
  }

  newsBind();

  function init() {
    document.documentElement.setAttribute('data-theme', state.theme);
    loadHistory();
    renderHistory();
    if (FILE_MODE && !STANDALONE) {
      detectServer().then(function (base) {
        if (!base) { showFileNotice(); return; }
        API = base;
        bind();
        watchInit();
        route();
      });
      return;
    }
    bind();
    watchInit();
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
