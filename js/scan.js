/* =====================================================================
 * 全 A 股扫描（移植自 网页评分.ps1 2879–3264）
 * 数据：东方财富 datacenter-web 估值快照 RPT_VALUEANALYSIS_DET + 年报 RPT_LICO_FN_CPD
 * 口径与桌面版一致：仅沪深主板（600/601/603/605/000/001/002/003），剔除 ST / 退
 * ===================================================================== */
(function (root) {
  'use strict';

  var BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  var st = {
    running: false, done: false, error: '', phase: '', current: 0, total: 0,
    startedAt: null, finishedAt: null, rows: null, date: ''
  };

  function banker(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return null;
    var f = Math.pow(10, d || 0), s = x * f;
    var fl = Math.floor(s), diff = s - fl, r;
    if (Math.abs(diff - 0.5) < 1e-9) r = (fl % 2 === 0) ? fl : fl + 1;
    else r = Math.round(s);
    return r / f;
  }
  function N(v) {
    if (v === null || v === undefined || v === '' || v === '-') return NaN;
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }
  function MM(a) {
    var s = 0, n = 0;
    a.forEach(function (x) { if (!isNaN(x)) { s += x; n++; } });
    return n === 0 ? NaN : s / n;
  }
  function MN(a) {
    var m = NaN;
    a.forEach(function (x) { if (!isNaN(x)) { if (isNaN(m) || x < m) m = x; } });
    return m;
  }
  function SD(a) {
    var vals = a.filter(function (x) { return !isNaN(x); });
    if (vals.length < 2) return NaN;
    var mean = 0;
    vals.forEach(function (v) { mean += v; });
    mean /= vals.length;
    var ss = 0;
    vals.forEach(function (v) { ss += (v - mean) * (v - mean); });
    return Math.sqrt(ss / (vals.length - 1));
  }
  function CG(a) {
    var first = -1, last = -1;
    for (var i = 0; i < a.length; i++) {
      if (!isNaN(a[i])) { if (first < 0) first = i; last = i; }
    }
    if (first < 0 || last <= first) return NaN;
    var v0 = a[first], v1 = a[last];
    if (!(v0 > 0) || !(v1 > 0)) return NaN;
    return Math.pow(v1 / v0, 1.0 / (last - first)) - 1.0;
  }
  function Lin(x, x0, x1, y0, y1) {
    if (isNaN(x)) return y0;
    if (x <= x0) return y0;
    if (x >= x1) return y1;
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }

  function emUrl(report, cols, filter, page, size, sort, types) {
    return BASE + '?reportName=' + report + '&columns=' + cols +
      '&filter=' + encodeURIComponent(filter) +
      '&pageSize=' + size + '&pageNumber=' + page +
      '&sortColumns=' + sort + '&sortTypes=' + types;
  }

  function getJson(url) {
    return fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
  }

  // 带重试与并发上限的批量取数
  function fetchPages(urls, concurrency) {
    concurrency = concurrency || 6;
    var out = new Array(urls.length);
    var next = 0;
    function worker() {
      if (next >= urls.length) return Promise.resolve();
      var i = next++;
      return getJson(urls[i]).then(function (j) { out[i] = j; return worker(); });
    }
    var jobs = [];
    for (var k = 0; k < Math.min(concurrency, urls.length); k++) jobs.push(worker());
    return Promise.all(jobs).then(function () { return out; });
  }

  function todayStr() {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  async function runAll(limit) {
    var val = {};
    try {
      st.phase = '连接数据源';
      var probe = await getJson(emUrl('RPT_VALUEANALYSIS_DET', 'SECURITY_CODE,TRADE_DATE',
        '(SECURITY_CODE="600519")', 1, 1, 'TRADE_DATE', '-1'));
      var tradeDate = '';
      if (probe && probe.result && probe.result.data && probe.result.data.length) {
        tradeDate = String(probe.result.data[0].TRADE_DATE).slice(0, 10);
      }
      if (!tradeDate) {
        var d0 = new Date(); d0.setDate(d0.getDate() - 1);
        tradeDate = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
      }
      st.date = tradeDate;

      st.phase = '拉取估值快照';
      var vcols = 'SECURITY_CODE,SECURITY_NAME_ABBR,BOARD_NAME,TOTAL_MARKET_CAP,PE_TTM,PB_MRQ,PEG_CAR';
      var vfilter = "(TRADE_DATE='" + tradeDate + "')";
      var v1 = await getJson(emUrl('RPT_VALUEANALYSIS_DET', vcols, vfilter, 1, 500, 'SECURITY_CODE', '1'));
      if (!v1 || !v1.result) throw new Error('估值快照获取失败（东财接口无响应）');
      var vpages = Number(v1.result.pages) || 1;
      (v1.result.data || []).forEach(function (r) {
        val[String(r.SECURITY_CODE)] = {
          name: String(r.SECURITY_NAME_ABBR || ''), board: String(r.BOARD_NAME || ''),
          cap: N(r.TOTAL_MARKET_CAP), pe: N(r.PE_TTM), pb: N(r.PB_MRQ), peg: N(r.PEG_CAR)
        };
      });
      if (vpages > 1) {
        var vurls = [];
        for (var i2 = 2; i2 <= vpages; i2++) vurls.push(emUrl('RPT_VALUEANALYSIS_DET', vcols, vfilter, i2, 500, 'SECURITY_CODE', '1'));
        var vjs = await fetchPages(vurls);
        vjs.forEach(function (j) {
          if (!j || !j.result) return;
          (j.result.data || []).forEach(function (r) {
            val[String(r.SECURITY_CODE)] = {
              name: String(r.SECURITY_NAME_ABBR || ''), board: String(r.BOARD_NAME || ''),
              cap: N(r.TOTAL_MARKET_CAP), pe: N(r.PE_TTM), pb: N(r.PB_MRQ), peg: N(r.PEG_CAR)
            };
          });
        });
      }

      st.phase = '拉取近 5 年年报';
      var now = new Date();
      var lastAnnual = now.getFullYear() - 1;
      if (now.getMonth() + 1 < 5) lastAnnual = lastAnnual - 1;
      var years = [];
      for (var y = 4; y >= 0; y--) years.push((lastAnnual - y) + '-12-31');
      var ny = years.length;

      var fcols = 'SECURITY_CODE,SECURITY_NAME_ABBR,BOARD_NAME,TOTAL_OPERATE_INCOME,PARENT_NETPROFIT,WEIGHTAVG_ROE,YSTZ,BASIC_EPS,MGJYXJJE,XSMLL';
      var markets = ['上交所主板', '深交所主板'];
      st.total = years.length * markets.length;
      st.current = 0;

      var fin = {};
      var yi = -1;
      for (var yy = 0; yy < years.length; yy++) {
        yi++;
        for (var mi = 0; mi < markets.length; mi++) {
          var m = markets[mi];
          var f = "(REPORTDATE='" + years[yy] + "')(TRADE_MARKET=\"" + m + "\")";
          var j = await getJson(emUrl('RPT_LICO_FN_CPD', fcols, f, 1, 500, 'SECURITY_CODE', '1'));
          var rows = [];
          if (j && j.result) {
            rows = j.result.data || [];
            var pages = Number(j.result.pages) || 1;
            if (pages > 1) {
              var urls = [];
              for (var k = 2; k <= pages; k++) urls.push(emUrl('RPT_LICO_FN_CPD', fcols, f, k, 500, 'SECURITY_CODE', '1'));
              var j2s = await fetchPages(urls);
              j2s.forEach(function (j2) { if (j2 && j2.result) rows = rows.concat(j2.result.data || []); });
            }
          }
          rows.forEach(function (r) {
            var c = String(r.SECURITY_CODE || '');
            if (!c) return;
            if (!fin[c]) {
              fin[c] = {
                name: String(r.SECURITY_NAME_ABBR || ''), board: String(r.BOARD_NAME || ''),
                roe: [], rev: [], np: [], ystz: [], eps: [], cf: [], gm: []
              };
              for (var z = 0; z < ny; z++) {
                fin[c].roe[z] = NaN; fin[c].rev[z] = NaN; fin[c].np[z] = NaN;
                fin[c].ystz[z] = NaN; fin[c].eps[z] = NaN; fin[c].cf[z] = NaN; fin[c].gm[z] = NaN;
              }
            }
            var rec = fin[c];
            rec.roe[yi] = N(r.WEIGHTAVG_ROE); rec.rev[yi] = N(r.TOTAL_OPERATE_INCOME);
            rec.np[yi] = N(r.PARENT_NETPROFIT); rec.ystz[yi] = N(r.YSTZ);
            rec.eps[yi] = N(r.BASIC_EPS); rec.cf[yi] = N(r.MGJYXJJE); rec.gm[yi] = N(r.XSMLL);
          });
          st.current = st.current + 1;
        }
      }

      st.phase = '计算评分';
      var cand = [];
      Object.keys(fin).forEach(function (c) {
        if (!/^(600|601|603|605|000|001|002|003)[0-9]{3}$/.test(c)) return;
        if (!val[c]) return;
        var rec = fin[c], v = val[c];
        var name = String(v.name || '');
        if (/ST|退/.test(name)) return;

        var roeAvg = MM(rec.roe);
        if (isNaN(roeAvg)) return;
        var roeMin = MN(rec.roe), roeSd = SD(rec.roe);
        var gmAvg = MM(rec.gm), gmFirst = NaN, gmLast = NaN;
        for (var z = 0; z < ny; z++) {
          if (!isNaN(rec.gm[z])) {
            if (isNaN(gmFirst)) gmFirst = rec.gm[z];
            gmLast = rec.gm[z];
          }
        }
        var gmDelta = (!isNaN(gmFirst) && !isNaN(gmLast)) ? gmLast - gmFirst : NaN;
        var revC = CG(rec.rev), npC = CG(rec.np), gsd = SD(rec.ystz);
        var sumCf = 0, sumEps = 0, hasCf = false;
        for (var z2 = 0; z2 < ny; z2++) {
          if (!isNaN(rec.cf[z2]) && !isNaN(rec.eps[z2])) { sumCf += rec.cf[z2]; sumEps += rec.eps[z2]; hasCf = true; }
        }
        var cash = (hasCf && sumEps > 0) ? sumCf / sumEps : NaN;
        var npLast = NaN;
        for (var z3 = ny - 1; z3 >= 0; z3--) { if (!isNaN(rec.np[z3])) { npLast = rec.np[z3]; break; } }

        cand.push({
          code: c, name: name, board: String(v.board || ''),
          pe: v.pe, pb: v.pb, cap: v.cap, peg: v.peg,
          roe: roeAvg, roemin: roeMin, roesd: roeSd,
          gm: gmAvg, gmd: gmDelta, revc: revC, npc: npC, gsd: gsd,
          cash: cash, npLast: npLast
        });
      });

      var byBoard = {};
      cand.forEach(function (r) {
        var b = String(r.board || '');
        if (!byBoard[b]) byBoard[b] = [];
        byBoard[b].push(r);
      });
      var pePct = {}, pbPct = {};
      Object.keys(byBoard).forEach(function (b) {
        var list = byBoard[b];
        var sp = list.filter(function (x) { return x.pe > 0; }).sort(function (a, b2) { return a.pe - b2.pe; });
        if (sp.length > 0) {
          sp.forEach(function (x, i) { pePct[x.code] = sp.length <= 1 ? 50.0 : 100.0 * i / (sp.length - 1); });
        }
        var sb = list.filter(function (x) { return x.pb > 0; }).sort(function (a, b2) { return a.pb - b2.pb; });
        if (sb.length > 0) {
          sb.forEach(function (x, i) { pbPct[x.code] = sb.length <= 1 ? 50.0 : 100.0 * i / (sb.length - 1); });
        }
      });

      var out = [];
      cand.forEach(function (r) {
        var q = 0.0;
        q += Lin(r.roe, 0, 25, 0, 45);
        q += Lin(r.roemin, 0, 12, 0, 20);
        q += Lin(r.roesd, 0, 8, 15, 0);
        q += Lin(r.gm, 10, 45, 0, 10);
        q += Lin(r.gmd, -5, 10, 0, 5);
        q += Lin(r.cash, 0, 1.2, 0, 5);
        if (q > 100) q = 100;
        if (q < 0) q = 0;

        var g = 0.0;
        g += Lin(r.revc * 100, -10, 25, 0, 40);
        g += Lin(r.npc * 100, -10, 30, 0, 40);
        g += Lin(r.gsd, 3, 20, 20, 0);
        if (g > 100) g = 100;
        if (g < 0) g = 0;

        var pep = (r.code in pePct) ? pePct[r.code] : 100.0;
        var pbp = (r.code in pbPct) ? pbPct[r.code] : 100.0;
        var vScore = 0.0;
        if (r.pe > 0) vScore += (45.0 - 0.45 * pep);
        vScore += (25.0 - 0.25 * pbp);
        if (r.pe > 0 && !isNaN(r.peg)) vScore += Lin(r.peg, 0.5, 3.0, 25, 0);
        if (r.pe > 0 && r.pe <= 40) vScore += 5;
        if (vScore < 0) vScore = 0;
        if (vScore > 100) vScore = 100;

        var total = 0.40 * q + 0.25 * g + 0.35 * vScore;
        var rating = 'D';
        if (total >= 75) rating = 'A';
        else if (total >= 65) rating = 'B';
        else if (total >= 55) rating = 'C';

        var flags = [];
        if (!isNaN(r.npLast) && r.npLast < 0) flags.push('亏损');
        if (!isNaN(r.roemin) && r.roemin < 0) flags.push('ROE曾为负');
        if (!isNaN(r.cash) && r.cash < 0.3) flags.push('现金流弱');
        if (r.pe <= 0) flags.push('估值不可用');
        else if (r.pe > 60) flags.push('PE偏高');
        if (!isNaN(r.revc) && r.revc < 0) flags.push('营收下滑');

        out.push({
          code: String(r.code), name: String(r.name), board: String(r.board),
          score: banker(total, 1), q: banker(q, 0), g: banker(g, 0), v: banker(vScore, 0),
          rating: rating,
          pe: isNaN(r.pe) ? null : banker(r.pe, 1),
          pb: isNaN(r.pb) ? null : banker(r.pb, 2),
          cap: isNaN(r.cap) ? null : banker(r.cap / 100000000, 0),
          roe: isNaN(r.roe) ? null : banker(r.roe, 1),
          roemin: isNaN(r.roemin) ? null : banker(r.roemin, 1),
          revc: isNaN(r.revc) ? null : banker(r.revc * 100, 1),
          npc: isNaN(r.npc) ? null : banker(r.npc * 100, 1),
          gm: isNaN(r.gm) ? null : banker(r.gm, 1),
          peg: isNaN(r.peg) ? null : banker(r.peg, 2),
          flags: flags.join('、')
        });
      });

      out.sort(function (a, b) { return b.score - a.score; });
      if (limit > 0 && out.length > limit) out = out.slice(0, limit);

      st.rows = out;
      st.phase = '完成';
    } catch (e) {
      st.error = (e && e.message) ? e.message : String(e);
    } finally {
      st.running = false;
      st.done = true;
      st.finishedAt = new Date();
    }
  }

  function start(limit) {
    if (st.running) return Promise.resolve({ ok: true, started: false, running: true });
    st.running = true;
    st.done = false;
    st.error = '';
    st.rows = null;
    st.phase = '准备中';
    st.current = 0;
    st.total = 0;
    st.date = '';
    st.startedAt = new Date();
    st.finishedAt = null;
    runAll(limit);  // 后台跑，立即返回给前端轮询
    return Promise.resolve({ ok: true, started: true, running: true });
  }

  function elapsedSec() {
    if (!st.startedAt) return 0;
    var ref = st.finishedAt || new Date();
    return Math.floor((ref - st.startedAt) / 1000);
  }

  function status() {
    return Promise.resolve({
      ok: true, running: !!st.running, done: !!st.done, error: String(st.error || ''),
      phase: String(st.phase || ''), current: st.current || 0, total: st.total || 0,
      count: st.rows ? st.rows.length : 0, date: String(st.date || ''), elapsed: elapsedSec()
    });
  }

  function result() {
    if (!st.rows) return Promise.resolve({ ok: false, error: '还没有扫描结果' });
    return Promise.resolve({ ok: true, date: String(st.date || ''), rows: st.rows });
  }

  root.ScanLayer = { start: start, status: status, result: result };
})(typeof window !== 'undefined' ? window : globalThis);
