/* =====================================================================
 * 五层基本面评分 · 手机独立版核心引擎
 * ---------------------------------------------------------------------
 * 从《网页评分.ps1》的 Invoke-Analyze / Get-StockBundle 逐条移植（v1.2）
 * 目标：同一份东财数据，算出的分数、文案、结构必须与电脑版一致。
 * 无任何后端依赖，全部在浏览器（或 Node）内完成。
 * ===================================================================== */
(function (root) {
  'use strict';

  var EM_BASE = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  var MIN_ROE = 15.0;   // $Script:MinRoe
  var MAX_PE_PCT = 80.0; // $Script:MaxPePct
  var VERSION = 'v1.2';

  /* ---------------- 数值与统计工具（对齐 PowerShell 口径） ---------------- */
  function toNum(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'string' && v === '') return 0;
    var d = Number(v);
    if (!isFinite(d)) return 0;
    return d;
  }
  function numOrNull(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string' && v === '') return null;
    var d = Number(v);
    if (!isFinite(d)) return null;
    return d;
  }
  function N(v) { return toNum(v); }
  // PowerShell [math]::Round 是"银行家舍入"（四舍六入五成双），不能用 Math.round
  function psRound(x, digits) {
    x = toNum(x);
    if (!isFinite(x)) return 0;
    var f = Math.pow(10, digits);
    var v = x * f;
    var fl = Math.floor(v);
    var diff = v - fl;
    if (Math.abs(diff - 0.5) < 1e-9) {
      var even = (fl % 2 === 0) ? fl : fl + 1;
      return even / f;
    }
    return Math.round(v) / f;
  }
  function R1(v) { return psRound(v, 1); }
  function R2(v) { return psRound(v, 2); }
  function R3(v) { return psRound(v, 3); }
  function avg(list) {
    if (!list || list.length === 0) return 0;
    var s = 0;
    for (var i = 0; i < list.length; i++) s += Number(list[i]);
    return s / list.length;
  }
  function stdev(list) {
    if (!list || list.length < 2) return 0;
    var a = avg(list), sum = 0;
    for (var i = 0; i < list.length; i++) { var d = Number(list[i]) - a; sum += d * d; }
    return Math.sqrt(sum / (list.length - 1));
  }
  function percentile(values, current) {
    var v = values.filter(function (x) { return x !== null && x !== undefined && Number(x) > 0; });
    if (v.length < 30 || current <= 0) return -1.0;
    var below = 0;
    for (var i = 0; i < v.length; i++) if (Number(v[i]) <= current) below++;
    return psRound(100.0 * below / v.length, 1);
  }
  function rankPct(values, current) {
    var v = values.filter(function (x) { return x !== null && x !== undefined && Number(x) > 0; });
    if (v.length === 0 || current <= 0) return -1.0;
    var below = 0;
    for (var i = 0; i < v.length; i++) if (Number(v[i]) <= current) below++;
    return psRound(100.0 * below / v.length, 1);
  }
  function quantile(values, q) {
    var v = values.filter(function (x) { return x !== null && x !== undefined && Number(x) > 0; })
      .map(function (x) { return Number(x); })
      .sort(function (a, b) { return a - b; });
    if (v.length === 0) return 0.0;
    var idx = Math.floor((v.length - 1) * q);
    if (idx < 0) idx = 0;
    if (idx >= v.length) idx = v.length - 1;
    return v[idx];
  }
  function date10(v) {
    var s = String(v === null || v === undefined ? '' : v);
    return s.length >= 10 ? s.substring(0, 10) : s;
  }
  function quarterNo(dateStr) {
    var d = date10(dateStr);
    if (d.length < 10) return 4;
    var m = parseInt(d.substring(5, 7), 10);
    if (m <= 3) return 1;
    if (m <= 6) return 2;
    if (m <= 9) return 3;
    return 4;
  }
  function periodLabel(dateStr) {
    var d = date10(dateStr);
    if (d.length < 10) return '';
    var y = d.substring(0, 4);
    var m = parseInt(d.substring(5, 7), 10);
    if (m === 3) return y + 'Q1';
    if (m === 6) return y + 'H1';
    if (m === 9) return y + '前三季';
    return y + '年报';
  }
  function shortQuarter(dateStr) {
    var d = date10(dateStr);
    if (d.length < 10) return '';
    var yy = d.substring(2, 4);
    return yy + 'Q' + quarterNo(d);
  }
  function fmt2(v) { return (R2(v)).toFixed(2); }
  function pctText(v) {
    if (v === null || v === undefined) return '—';
    return fmt2(v) + '%';
  }
  function insight(tag, text, tone) {
    return { tag: tag, text: text, tone: tone || 'info' };
  }
  function fmtDate(d) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1, dd = d.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }
  function addYears(d, n) { var x = new Date(d.getTime()); x.setFullYear(x.getFullYear() + n); return x; }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

  /* ---------------- 东财数据接口 ---------------- */
  function emUrl(report, cols, filter, sort, pageSize, page) {
    var url = EM_BASE + '?reportName=' + report +
      '&columns=' + (cols || 'ALL') +
      '&filter=' + encodeURIComponent(filter || '').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/'/g, '%27') +
      '&sortColumns=' + (sort || 'REPORT_DATE') + '&sortTypes=-1' +
      '&pageSize=' + (pageSize || 200) + '&pageNumber=' + (page || 1);
    return url;
  }

  function emGet(report, opts) {
    opts = opts || {};
    var url = emUrl(report, opts.cols, opts.filter, opts.sort, opts.pageSize, opts.page);
    var attempt = 0;
    function once() {
      attempt++;
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;
      return fetch(url, { headers: { 'Accept': 'application/json, text/plain, */*' }, signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) {
          if (timer) clearTimeout(timer);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (j) { return (j && j.result) ? j.result : null; })
        .catch(function (e) {
          if (timer) clearTimeout(timer);
          if (attempt < 3) return new Promise(function (res) { setTimeout(res, 300 * attempt); }).then(once);
          throw e;
        });
    }
    return once().then(function (res) {
      return res || { data: [], count: 0 };
    });
  }

  /* ---------------- 数据包（对应 Get-StockBundle） ---------------- */
  async function stockBundle(code) {
    var f = '(SECURITY_CODE="' + code + '")';
    var start = fmtDate(addYears(new Date(), -9));
    var vf = '(SECURITY_CODE="' + code + '")(TRADE_DATE>=\'' + start + '\')';

    var mfCols = 'REPORT_DATE,REPORT_TYPE,SECURITY_NAME_ABBR,PARENTNETPROFIT,KCFJCXSYJLR,TOTALOPERATEREVE,TOTALOPERATEREVETZ,PARENTNETPROFITTZ,KCFJCXSYJLRTZ,DJD_TOI_YOY,DJD_DPNP_YOY,DJD_DEDUCTDPNP_YOY,ROEJQ,ROEKCJQ,XSMLL,ZCFZL,INTEREST_DEBT_RATIO,ROIC,RDEXPEND,RDPERSONNEL,PRATIO,EPSJB';
    var balCols = 'REPORT_DATE,TOTAL_PARENT_EQUITY,GOODWILL,TOTAL_ASSETS,OPINION_TYPE,SECURITY_NAME_ABBR';
    var cfCols = 'REPORT_DATE,NEFCASH_OPERATE,NEFCASH_OPERATE_X';

    var t1 = emGet('RPT_F10_FINANCE_MAINFINADATA', { cols: mfCols, filter: f, pageSize: 60 });
    var t2 = emGet('RPT_F10_FINANCE_GBALANCE', { cols: balCols, filter: f, pageSize: 60 });
    var t3 = emGet('RPT_F10_FINANCE_GCASHFLOW', { cols: 'REPORT_DATE,NETCASH_OPERATE,SALES_SERVICES,CONSTRUCT_LONG_ASSET,FA_IR_DEPR,IA_AMORTIZE,LPE_AMORTIZE', filter: f, pageSize: 60 });
    var t4 = emGet('RPT_VALUEANALYSIS_DET', { cols: 'SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,PE_TTM,PE_LAR,PB_MRQ,TOTAL_MARKET_CAP,CLOSE_PRICE,BOARD_NAME,BOARD_CODE', filter: vf, sort: 'TRADE_DATE', pageSize: 1000, page: 1 });
    var t5 = emGet('RPT_VALUEANALYSIS_DET', { cols: 'SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,PE_TTM,PE_LAR,PB_MRQ,TOTAL_MARKET_CAP,CLOSE_PRICE,BOARD_NAME,BOARD_CODE', filter: vf, sort: 'TRADE_DATE', pageSize: 1000, page: 2 });
    var t6 = emGet('RPT_VALUEANALYSIS_DET', { cols: 'SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,PE_TTM,PE_LAR,PB_MRQ,TOTAL_MARKET_CAP,CLOSE_PRICE,BOARD_NAME,BOARD_CODE', filter: vf, sort: 'TRADE_DATE', pageSize: 1000, page: 3 });
    var t7 = emGet('RPT_WEB_RESPREDICT', { filter: f, sort: 'SECURITY_CODE', pageSize: 5, cols: 'ALL' });
    var t8 = emGet('RPT_SHAREBONUS_DET', { filter: f, sort: 'REPORT_DATE', pageSize: 12, cols: 'REPORT_DATE,ASSIGN_PROGRESS,EX_DIVIDEND_DATE,PRETAX_BONUS_RMB' });
    var t9 = emGet('RPT_CSDC_LIST_NEWEST', { filter: f, sort: 'PLEDGE_RATIO', pageSize: 1, cols: 'SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,PLEDGE_RATIO' });
    var t10 = emGet('RPTA_WEB_RZRQ_GGMX', { filter: '(SCODE="' + code + '")', sort: 'DATE', pageSize: 25, cols: 'DATE,RZYE,RZYEZB' });

    var rs = await Promise.all([t1, t2, t3, t4, t5, t6, t7, t8, t9, t10]);
    var val = [];
    [rs[3], rs[4], rs[5]].forEach(function (r) {
      if (r && r.data) r.data.forEach(function (x) { if (x) val.push(x); });
    });
    var mf = (rs[0].data || []);
    if (mf.length === 0) throw new Error('未获取到财务报表数据，请检查代码是否正确或稍后重试');
    if (val.length === 0) throw new Error('未获取到估值数据，该股票可能停牌、退市或代码不存在');

    val.sort(function (a, b) { return String(b.TRADE_DATE) < String(a.TRADE_DATE) ? -1 : (String(b.TRADE_DATE) > String(a.TRADE_DATE) ? 1 : 0); });
    // 上面写法保持"按日期字符串降序"
    val.sort(function (a, b) { return String(b.TRADE_DATE).localeCompare(String(a.TRADE_DATE)); });

    return {
      Code: code,
      Mf: mf,
      Bal: (rs[1].data || []),
      Cf: (rs[2].data || []),
      Val: val,
      Pred: (rs[6].data && rs[6].data.length > 0) ? rs[6].data[0] : null,
      Div: (rs[7].data || []),
      Pledge: (rs[8].data && rs[8].data.length > 0) ? rs[8].data[0] : null,
      Margin: (rs[9].data || [])
    };
  }

  /* ---------------- 单季序列（Get-QuarterlySeries） ---------------- */
  function quarterlySeries(Mf) {
    var rows = Mf.slice().sort(function (a, b) { return String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)); }).slice(0, 14);
    var cum = {};
    rows.forEach(function (r) {
      var d = date10(r.REPORT_DATE);
      if (d.length >= 10) cum[d] = r;
    });
    var out = [];
    rows.forEach(function (r) {
      var d = date10(r.REPORT_DATE);
      if (d.length < 10) return;
      var year = d.substring(0, 4);
      var q = quarterNo(d);
      var prevDate = '';
      if (q === 2) prevDate = year + '-03-31';
      else if (q === 3) prevDate = year + '-06-30';
      else if (q === 4) prevDate = year + '-09-30';

      var revCum = N(r.TOTALOPERATEREVE);
      var npCum = N(r.PARENTNETPROFIT);
      var dedCum = N(r.KCFJCXSYJLR);
      var rev, np, ded;
      if (prevDate && cum[prevDate]) {
        var p = cum[prevDate];
        rev = (revCum - N(p.TOTALOPERATEREVE)) / 1e8;
        np = (npCum - N(p.PARENTNETPROFIT)) / 1e8;
        ded = (dedCum - N(p.KCFJCXSYJLR)) / 1e8;
      } else {
        rev = revCum / 1e8; np = npCum / 1e8; ded = dedCum / 1e8;
      }
      if (rev <= 0 && np === 0) return;
      out.push({
        date: d,
        label: shortQuarter(d),
        period: periodLabel(d),
        revenue: R2(rev),
        np: R2(np),
        deduct: R2(ded),
        revGrowth: numOrNull(r.DJD_TOI_YOY) !== null ? R2(numOrNull(r.DJD_TOI_YOY)) : null,
        npGrowth: numOrNull(r.DJD_DPNP_YOY) !== null ? R2(numOrNull(r.DJD_DPNP_YOY)) : null,
        dedGrowth: numOrNull(r.DJD_DEDUCTDPNP_YOY) !== null ? R2(numOrNull(r.DJD_DEDUCTDPNP_YOY)) : null
      });
    });
    var sorted = out.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    if (sorted.length > 10) sorted = sorted.slice(-10);
    return sorted;
  }

  /* ---------------- 增长动能（Get-Momentum） ---------------- */
  function momentum(quarters, latestCumNp, latestCumRev) {
    var q = quarters || [];
    if (q.length < 2) {
      return { label: '数据不足', tone: 'muted', detail: '季度数据不足，无法判断增长动能。', npSeq: [], revSeq: [] };
    }
    var tail = q.slice(-3);
    var npSeq = tail.map(function (x) { return x.npGrowth; });
    var revSeq = tail.map(function (x) { return x.revGrowth; });
    var npValid = npSeq.filter(function (x) { return x !== null && x !== undefined; });
    var decline = 0;
    for (var i = 1; i < npValid.length; i++) {
      if (Number(npValid[i]) < Number(npValid[i - 1])) decline++;
    }
    var latest = npValid.length > 0 ? Number(npValid[npValid.length - 1]) : null;
    var first = npValid.length > 0 ? Number(npValid[0]) : null;

    var label = '平稳', tone = 'info';
    if (latest !== null && latest < 0) { label = '失速'; tone = 'bad'; }
    else if (decline >= 2 && latest !== null && first !== null && (latest - first) < -10) { label = '降档'; tone = 'warn'; }
    else if (decline === 0 && latest !== null && first !== null && (latest - first) > 5) { label = '加速'; tone = 'good'; }

    var npText = tail.map(function (x) { return x.label + ' ' + pctText(x.npGrowth); }).join(' → ');
    var revText = tail.map(function (x) { return x.label + ' ' + pctText(x.revGrowth); }).join(' → ');
    var detail = '单季归母增速 ' + npText + '；单季营收增速 ' + revText + '。';
    if (latestCumNp !== null && latestCumNp !== undefined) { detail += ' 累计归母增速 ' + pctText(latestCumNp) + '。'; }
    return { label: label, tone: tone, detail: detail, npSeq: npSeq, revSeq: revSeq };
  }

  /* ---------------- 机构一致预期（Get-ConsensusData） ---------------- */
  function consensusData(Pred, price) {
    if (!Pred) return null;
    var entries = [];
    for (var i = 1; i <= 4; i++) {
      var year = Pred['YEAR' + i];
      var eps = numOrNull(Pred['EPS' + i]);
      var mark = String(Pred['YEAR_MARK' + i] === null || Pred['YEAR_MARK' + i] === undefined ? '' : Pred['YEAR_MARK' + i]);
      if (year !== null && year !== undefined && eps !== null && eps > 0) {
        entries.push({ year: parseInt(year, 10), mark: mark, eps: Number(eps) });
      }
    }
    if (entries.length === 0) return null;
    var sorted = entries.sort(function (a, b) { return a.year - b.year; });
    var forecasts = [];
    for (var k = 0; k < sorted.length; k++) {
      var growthVal = null;
      if (k > 0 && sorted[k - 1].eps > 0) growthVal = R2(((sorted[k].eps / sorted[k - 1].eps) - 1.0) * 100.0);
      forecasts.push({ year: sorted[k].year, mark: sorted[k].mark, eps: R2(sorted[k].eps), growth: growthVal });
    }

    var tMin = numOrNull(Pred.DEC_AIMPRICEMIN);
    var tMax = numOrNull(Pred.DEC_AIMPRICEMAX);
    if (tMin !== null && tMin <= 0) tMin = null;
    if (tMax !== null && tMax <= 0) tMax = null;
    if (tMin !== null && tMax !== null && tMin > tMax) { var tmp = tMin; tMin = tMax; tMax = tmp; }
    var tMid = null;
    if (tMin !== null && tMax !== null) tMid = R2((tMin + tMax) / 2.0);
    else if (tMin !== null) tMid = R2(tMin);
    else if (tMax !== null) tMid = R2(tMax);

    var upside = null;
    if (tMid !== null && price > 0) upside = R1(((tMid / price) - 1.0) * 100.0);

    var orgRaw = numOrNull(Pred.RATING_ORG_NUM);
    var orgVal = null;
    if (orgRaw !== null && orgRaw > 0) orgVal = Math.trunc(orgRaw);
    var buyVal = Math.trunc(N(Pred.RATING_BUY_NUM));
    var addVal = Math.trunc(N(Pred.RATING_ADD_NUM));
    var neutralVal = Math.trunc(N(Pred.RATING_NEUTRAL_NUM));
    var reduceVal = Math.trunc(N(Pred.RATING_REDUCE_NUM));
    var saleVal = Math.trunc(N(Pred.RATING_SALE_NUM));

    var ratings = [];
    if (buyVal > 0) ratings.push('买入 ' + buyVal);
    if (addVal > 0) ratings.push('增持 ' + addVal);
    if (neutralVal > 0) ratings.push('中性 ' + neutralVal);
    if (reduceVal > 0) ratings.push('减持 ' + reduceVal);
    if (saleVal > 0) ratings.push('卖出 ' + saleVal);
    var ratingText = ratings.join(' / ');
    if (!ratingText) ratingText = '评级分布未披露';

    return {
      org: orgVal, buy: buyVal, add: addVal, neutral: neutralVal, reduce: reduceVal, sale: saleVal,
      ratingText: ratingText,
      forecasts: forecasts,
      targetMin: tMin !== null ? R2(tMin) : null,
      targetMax: tMax !== null ? R2(tMax) : null,
      targetMid: tMid !== null ? R2(tMid) : null,
      upside: upside !== null ? R1(upside) : null,
      industry: String(Pred.INDUSTRY_BOARD === null || Pred.INDUSTRY_BOARD === undefined ? '' : Pred.INDUSTRY_BOARD)
    };
  }

  /* ---------------- 主流程（Invoke-Analyze） ---------------- */
  async function analyze(code) {
    var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var bundle = await stockBundle(code);

    var mf = bundle.Mf.slice().sort(function (a, b) { return String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)); });
    var bal = bundle.Bal || [], cf = bundle.Cf || [], val = bundle.Val || [];
    if (mf.length === 0) throw new Error('未获取到财务报表数据');

    var latestMf = mf[0];
    var latestMfDate = date10(latestMf.REPORT_DATE);
    var latestPeriod = periodLabel(latestMfDate);

    var annMf = mf.filter(function (x) { return String(x.REPORT_TYPE) === '年报'; })
      .sort(function (a, b) { return String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)); })
      .slice(0, 6);
    if (annMf.length < 3) throw new Error('年报数据不足（至少需要 3 个完整年度），无法评分');

    var balByYear = {}, cfByYear = {};
    bal.filter(function (x) { return String(x.REPORT_DATE).indexOf('12-31') >= 0; })
      .sort(function (a, b) { return String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)); })
      .forEach(function (x) {
        var y = String(x.REPORT_DATE).substring(0, 4);
        if (!balByYear[y]) balByYear[y] = x;
      });
    cf.filter(function (x) { return String(x.REPORT_DATE).indexOf('12-31') >= 0; })
      .sort(function (a, b) { return String(b.REPORT_DATE).localeCompare(String(a.REPORT_DATE)); })
      .forEach(function (x) {
        var y = String(x.REPORT_DATE).substring(0, 4);
        if (!cfByYear[y]) cfByYear[y] = x;
      });

    var years = [];
    annMf.forEach(function (a) {
      var y = String(a.REPORT_DATE).substring(0, 4);
      var b = balByYear[y], c = cfByYear[y];

      var npRaw = N(a.PARENTNETPROFIT);
      var dedRaw = N(a.KCFJCXSYJLR);
      var revRaw = N(a.TOTALOPERATEREVE);
      var rdRaw = N(a.RDEXPEND);
      var cfoRaw = 0, capexRaw = 0, depRaw = 0, salesCash = 0;
      if (c) {
        cfoRaw = N(c.NETCASH_OPERATE);
        salesCash = N(c.SALES_SERVICES);
        capexRaw = N(c.CONSTRUCT_LONG_ASSET);
        depRaw = N(c.FA_IR_DEPR) + N(c.IA_AMORTIZE) + N(c.LPE_AMORTIZE);
      }
      var eqRaw = 0, gwRaw = 0, taRaw = 0;
      if (b) { eqRaw = N(b.TOTAL_PARENT_EQUITY); gwRaw = N(b.GOODWILL); taRaw = N(b.TOTAL_ASSETS); }

      var cashRatioYear = 0;
      if (revRaw > 0 && salesCash !== 0) cashRatioYear = salesCash / revRaw;
      var cfoNpYear = 0;
      if (npRaw > 0) cfoNpYear = cfoRaw / npRaw;
      var rdRatioYear = 0;
      if (revRaw > 0) rdRatioYear = rdRaw / revRaw * 100.0;

      var revGrowthVal = numOrNull(a.TOTALOPERATEREVETZ);
      var npGrowthVal = numOrNull(a.PARENTNETPROFITTZ);
      var dedGrowthVal = numOrNull(a.KCFJCXSYJLRTZ);
      var epsVal = numOrNull(a.EPSJB);

      years.push({
        year: y,
        reportDate: date10(a.REPORT_DATE),
        revenue: R2(revRaw / 1e8),
        np: R2(npRaw / 1e8),
        deduct: R2(dedRaw / 1e8),
        cfo: R2(cfoRaw / 1e8),
        capex: R2(capexRaw / 1e8),
        dep: R2(depRaw / 1e8),
        equity: R2(eqRaw / 1e8),
        goodwill: R2(gwRaw / 1e8),
        totalAssets: R2(taRaw / 1e8),
        roe: R2(N(a.ROEJQ)),
        roeKc: R2(N(a.ROEKCJQ)),
        gm: R2(N(a.XSMLL)),
        debtRatio: R2(N(a.ZCFZL)),
        intDebtRatio: R2(N(a.INTEREST_DEBT_RATIO)),
        roic: R2(N(a.ROIC)),
        cashRatio: R3(cashRatioYear),
        cfoNp: R3(cfoNpYear),
        eps: epsVal !== null ? R3(epsVal) : null,
        revGrowth: revGrowthVal !== null ? R2(revGrowthVal) : null,
        npGrowth: npGrowthVal !== null ? R2(npGrowthVal) : null,
        dedGrowth: dedGrowthVal !== null ? R2(dedGrowthVal) : null,
        rd: R2(rdRaw / 1e8),
        rdRatio: R2(rdRatioYear)
      });
    });

    for (var i = 0; i < years.length; i++) {
      var cur = years[i];
      if (i + 1 < years.length) {
        var prev = years[i + 1];
        if (cur.revGrowth === null && prev.revenue > 0) cur.revGrowth = R2(((cur.revenue / prev.revenue) - 1.0) * 100.0);
        if (cur.npGrowth === null && prev.np > 0) cur.npGrowth = R2(((cur.np / prev.np) - 1.0) * 100.0);
        if (cur.dedGrowth === null && prev.deduct > 0) cur.dedGrowth = R2(((cur.deduct / prev.deduct) - 1.0) * 100.0);
      }
    }
    var latest = years[0];

    /* ---- 估值快照 ---- */
    var vLatest = val[0];
    var latestDate = date10(vLatest.TRADE_DATE);
    var price = R2(N(vLatest.CLOSE_PRICE));
    var mcap = R2(N(vLatest.TOTAL_MARKET_CAP) / 1e8);
    var peTtm = R2(N(vLatest.PE_TTM));
    var peStaticApi = R2(N(vLatest.PE_LAR));
    var pb = R3(N(vLatest.PB_MRQ));
    var industry = String(vLatest.BOARD_NAME === null || vLatest.BOARD_NAME === undefined ? '' : vLatest.BOARD_NAME);
    var boardCode = String(vLatest.BOARD_CODE === null || vLatest.BOARD_CODE === undefined ? '' : vLatest.BOARD_CODE);
    var name = String(latestMf.SECURITY_NAME_ABBR === null || latestMf.SECURITY_NAME_ABBR === undefined ? '' : latestMf.SECURITY_NAME_ABBR);
    if (!name) name = String(vLatest.SECURITY_NAME_ABBR === null || vLatest.SECURITY_NAME_ABBR === undefined ? '' : vLatest.SECURITY_NAME_ABBR);

    var peStatic = 0;
    if (mcap > 0 && latest.np > 0) peStatic = R2(mcap / latest.np);
    else if (peStaticApi > 0) peStatic = peStaticApi;

    var qNo = quarterNo(latestMfDate);
    var npCum = N(latestMf.PARENTNETPROFIT) / 1e8;
    var peDyn = 0;
    if (mcap > 0 && npCum > 0 && qNo > 0) peDyn = R2(mcap / (npCum * 4.0 / qNo));

    var implied = 0;
    if (peDyn > 0 && peStatic > 0) implied = R1(((peStatic / peDyn) - 1.0) * 100.0);

    var spread = 0;
    var peTriplet = [peStatic, peTtm, peDyn].filter(function (x) { return x > 0; });
    if (peTriplet.length >= 2) {
      var peMax = Math.max.apply(null, peTriplet), peMin = Math.min.apply(null, peTriplet);
      if (peMin > 0) spread = R1(((peMax / peMin) - 1.0) * 100.0);
    }

    function cutoff(yearsBack) {
      var d = new Date(latestDate + 'T00:00:00');
      d.setFullYear(d.getFullYear() - yearsBack);
      return fmtDate(d);
    }
    var cut5 = cutoff(5), cut6 = cutoff(6);

    function valsSince(cut, field, maxLimit) {
      return val.filter(function (x) { return date10(x.TRADE_DATE) >= cut; })
        .map(function (x) { return numOrNull(x[field]); })
        .filter(function (v) { return v !== null && v > 0 && v < maxLimit; });
    }
    var peVals5 = valsSince(cut5, 'PE_TTM', 500);
    var pbVals5 = valsSince(cut5, 'PB_MRQ', 50);
    var peVals6 = valsSince(cut6, 'PE_TTM', 500);
    var pbVals6 = valsSince(cut6, 'PB_MRQ', 50);

    var pePct5 = percentile(peVals5, peTtm);
    var pbPct5 = percentile(pbVals5, pb);
    var pePct6 = percentile(peVals6, peTtm);
    var pbPct6 = percentile(pbVals6, pb);

    var peStats6 = {
      min: R2(quantile(peVals6, 0.0)), p20: R2(quantile(peVals6, 0.2)), p50: R2(quantile(peVals6, 0.5)),
      p80: R2(quantile(peVals6, 0.8)), max: R2(quantile(peVals6, 1.0)), current: peTtm, pct: pePct6, count: peVals6.length
    };
    var pbStats6 = {
      min: R3(quantile(pbVals6, 0.0)), p20: R3(quantile(pbVals6, 0.2)), p50: R3(quantile(pbVals6, 0.5)),
      p80: R3(quantile(pbVals6, 0.8)), max: R3(quantile(pbVals6, 1.0)), current: pb, pct: pbPct6, count: pbVals6.length
    };

    /* ---- PE/PB 周采样序列 ---- */
    var peSeries = [];
    var latestDt = new Date(latestDate + 'T00:00:00');
    var nextSample = new Date(latestDt.getTime()); nextSample.setFullYear(nextSample.getFullYear() - 6);
    val.slice().sort(function (a, b) { return String(a.TRADE_DATE).localeCompare(String(b.TRADE_DATE)); }).forEach(function (row) {
      if (peSeries.length >= 380) return;
      var ds = date10(row.TRADE_DATE);
      if (ds.length < 10) return;
      var dt = new Date(ds + 'T00:00:00');
      if (dt < nextSample) return;
      var peVal = numOrNull(row.PE_TTM), pbVal = numOrNull(row.PB_MRQ);
      var peOut = null, pbOut = null;
      if (peVal !== null && peVal > 0 && peVal < 500) peOut = R2(peVal);
      if (pbVal !== null && pbVal > 0 && pbVal < 50) pbOut = R3(pbVal);
      if (peOut === null && pbOut === null) return;
      peSeries.push({ d: ds, pe: peOut, pb: pbOut });
      nextSample = addDays(dt, 7);
    });
    if (peSeries.length > 0 && peSeries[peSeries.length - 1].d !== latestDate) {
      var lastPe = null, lastPb = null;
      if (peTtm > 0 && peTtm < 500) lastPe = peTtm;
      if (pb > 0 && pb < 50) lastPb = pb;
      peSeries.push({ d: latestDate, pe: lastPe, pb: lastPb });
    }
    if (peSeries.length === 0) peSeries.push({ d: latestDate, pe: peTtm, pb: pb });

    /* ---- 自算年末 PE ---- */
    var yearEnd = [];
    var currentYear = latestDt.getFullYear();
    var startYear = currentYear - 6;
    if (startYear < 2000) startYear = 2000;
    for (var yy = startYear; yy < currentYear; yy++) {
      var rowFind = null;
      for (var vi = 0; vi < val.length; vi++) {
        var dd = date10(val[vi].TRADE_DATE);
        if (dd.indexOf(String(yy) + '-') === 0) { rowFind = val[vi]; break; }
      }
      if (!rowFind) continue;
      var epsRows = years.filter(function (x) { return x.year === String(yy); });
      if (epsRows.length === 0) continue;
      var eps = epsRows[0].eps;
      var close = N(rowFind.CLOSE_PRICE);
      if (close > 0 && eps !== null && eps > 0) {
        yearEnd.push({ year: String(yy), close: R2(close), eps: R3(eps), pe: R2(close / eps), current: false });
      }
    }
    var curEps = peTtm > 0 ? R3(price / peTtm) : null;
    yearEnd.push({ year: '当前', close: price, eps: curEps, pe: peTtm, current: true });

    /* ---- 行业同行估值 ---- */
    var industryObj = {
      name: industry, code: boardCode, count: 0, peAgg: 0, pbAgg: 0, peMedian: 0, pbMedian: 0,
      peRank: -1, pbRank: -1, peers: []
    };
    if (boardCode) {
      var peerFilter = '(BOARD_CODE="' + boardCode + '")(TRADE_DATE=\'' + latestDate + '\')';
      var peerCols = 'SECURITY_CODE,SECURITY_NAME_ABBR,PE_TTM,PB_MRQ,TOTAL_MARKET_CAP,CLOSE_PRICE';
      var peerRes = await emGet('RPT_VALUEANALYSIS_DET', { filter: peerFilter, sort: 'TOTAL_MARKET_CAP', pageSize: 500, page: 1, cols: peerCols });
      var peerRows = (peerRes && peerRes.data) ? peerRes.data.slice() : [];
      if (peerRes && N(peerRes.count) > 500) {
        var peerRes2 = await emGet('RPT_VALUEANALYSIS_DET', { filter: peerFilter, sort: 'TOTAL_MARKET_CAP', pageSize: 500, page: 2, cols: peerCols });
        if (peerRes2 && peerRes2.data) peerRows = peerRows.concat(peerRes2.data);
      }
      if (peerRows.length > 0) {
        var peValidRows = peerRows.filter(function (r) { return N(r.PE_TTM) > 0 && N(r.PE_TTM) < 500; });
        var pbValidRows = peerRows.filter(function (r) { return N(r.PB_MRQ) > 0 && N(r.PB_MRQ) < 50; });
        var capSum = 0;
        peerRows.forEach(function (pr) { capSum += N(pr.TOTAL_MARKET_CAP); });
        var earnSum = 0;
        peValidRows.forEach(function (pr) { earnSum += N(pr.TOTAL_MARKET_CAP) / N(pr.PE_TTM); });
        var bookSum = 0;
        pbValidRows.forEach(function (pr) { bookSum += N(pr.TOTAL_MARKET_CAP) / N(pr.PB_MRQ); });
        var peAgg = 0, pbAgg = 0;
        if (earnSum > 0) peAgg = R2(capSum / earnSum);
        if (bookSum > 0) pbAgg = R3(capSum / bookSum);
        var peArr = peValidRows.map(function (r) { return N(r.PE_TTM); });
        var pbArr = pbValidRows.map(function (r) { return N(r.PB_MRQ); });
        var peersTop = peerRows.slice().sort(function (a, b) { return N(b.TOTAL_MARKET_CAP) - N(a.TOTAL_MARKET_CAP); })
          .slice(0, 10).map(function (x) {
            return {
              code: String(x.SECURITY_CODE),
              name: String(x.SECURITY_NAME_ABBR),
              pe: R2(N(x.PE_TTM)),
              pb: R3(N(x.PB_MRQ)),
              cap: R2(N(x.TOTAL_MARKET_CAP) / 1e8),
              self: String(x.SECURITY_CODE) === code
            };
          });
        industryObj = {
          name: industry, code: boardCode, count: peerRows.length,
          peAgg: peAgg, pbAgg: pbAgg,
          peMedian: R2(quantile(peArr, 0.5)), pbMedian: R3(quantile(pbArr, 0.5)),
          peRank: rankPct(peArr, peTtm), pbRank: rankPct(pbArr, pb),
          peers: peersTop
        };
      }
    }

    /* ---------------- L1 排雷 ---------------- */
    var l1 = [];
    var cfoSum = 0, npSum = 0;
    years.forEach(function (y) { cfoSum += y.cfo; npSum += y.np; });
    var cfRatio = 0;
    if (npSum > 0) cfRatio = cfoSum / npSum;

    if (npSum <= 0) {
      l1.push({ item: '现金流含金量', value: '5年累计净利≤0', standard: 'CFO/净利 ≥1', verdict: '淘汰', note: '5 年累计归母净利为负，无法用现金流验证利润' });
    } else if (cfRatio >= 1.0) {
      l1.push({ item: '现金流含金量', value: fmt2(cfRatio), standard: 'CFO/净利 ≥1', verdict: '通过', note: '5 年累计经营现金流覆盖归母净利' });
    } else if (cfRatio >= 0.8) {
      l1.push({ item: '现金流含金量', value: fmt2(cfRatio), standard: 'CFO/净利 ≥1', verdict: '警告', note: '利润含金量偏低，注意应收/存货占用' });
    } else {
      l1.push({ item: '现金流含金量', value: fmt2(cfRatio), standard: 'CFO/净利 ≥1', verdict: '淘汰', note: '现金流长期跟不上利润，警惕纸面利润' });
    }

    var cashRatioAvg = avg(years.map(function (y) { return y.cashRatio; }));
    var isFinInd = /银行|保险|证券|多元金融/.test(industry);
    if (isFinInd) {
      l1.push({ item: '收现比', value: '不适用', standard: '金融类单列', verdict: '通过', note: '金融类销售收现口径不可比，不参与判断' });
    } else if (cashRatioAvg >= 0.9) {
      l1.push({ item: '收现比', value: fmt2(cashRatioAvg), standard: '≥0.90', verdict: '通过', note: '收入基本收到现金' });
    } else if (cashRatioAvg >= 0.75) {
      l1.push({ item: '收现比', value: fmt2(cashRatioAvg), standard: '≥0.90', verdict: '警告', note: '收现偏低，需看应收/票据结算' });
    } else {
      l1.push({ item: '收现比', value: fmt2(cashRatioAvg), standard: '≥0.90', verdict: '警告', note: '收现明显偏低，检查是否赊销冲收入' });
    }

    var finLike = /银行|保险|证券|多元金融|房地产/.test(industry);
    if (latest.debtRatio <= 70) {
      l1.push({ item: '资产负债率', value: R1(latest.debtRatio).toFixed(1) + '%', standard: '≤70%', verdict: '通过', note: '杠杆可控' });
    } else if (latest.debtRatio <= 80) {
      l1.push({ item: '资产负债率', value: R1(latest.debtRatio).toFixed(1) + '%', standard: '≤70%', verdict: '警告', note: '杠杆偏高' });
    } else if (finLike) {
      l1.push({ item: '资产负债率', value: R1(latest.debtRatio).toFixed(1) + '%', standard: '金融/地产单列', verdict: '警告', note: '行业特性使然，不直接淘汰' });
    } else {
      l1.push({ item: '资产负债率', value: R1(latest.debtRatio).toFixed(1) + '%', standard: '≤70%', verdict: '淘汰', note: '杠杆过高，抗风险能力弱' });
    }

    if (latest.intDebtRatio <= 30) {
      l1.push({ item: '有息负债率', value: R1(latest.intDebtRatio).toFixed(1) + '%', standard: '≤30%', verdict: '通过', note: '有息负债占总资产比例低' });
    } else if (latest.intDebtRatio <= 50) {
      l1.push({ item: '有息负债率', value: R1(latest.intDebtRatio).toFixed(1) + '%', standard: '≤30%', verdict: '警告', note: '有息负债偏高' });
    } else {
      l1.push({ item: '有息负债率', value: R1(latest.intDebtRatio).toFixed(1) + '%', standard: '≤30%', verdict: '淘汰', note: '有息负债过重' });
    }

    var gwRatio = 0;
    if (latest.equity > 0) gwRatio = latest.goodwill / latest.equity * 100.0;
    if (gwRatio <= 20) {
      l1.push({ item: '商誉/净资产', value: R1(gwRatio).toFixed(1) + '%', standard: '≤20%', verdict: '通过', note: '商誉减值风险低' });
    } else if (gwRatio <= 30) {
      l1.push({ item: '商誉/净资产', value: R1(gwRatio).toFixed(1) + '%', standard: '≤20%', verdict: '警告', note: '商誉偏高，注意减值' });
    } else {
      l1.push({ item: '商誉/净资产', value: R1(gwRatio).toFixed(1) + '%', standard: '≤20%', verdict: '淘汰', note: '商誉过重，一次减值可吞掉多年利润' });
    }

    var pledgeRatio = -1.0, pledgeDate = '';
    if (bundle.Pledge) {
      pledgeRatio = N(bundle.Pledge.PLEDGE_RATIO);
      pledgeDate = date10(bundle.Pledge.TRADE_DATE);
    }
    if (pledgeRatio < 0) {
      l1.push({ item: '股权质押', value: '未取到', standard: '≤10%', verdict: '提示', note: '中登未返回记录，需人工核对最新质押公告' });
    } else if (pledgeRatio <= 10) {
      l1.push({ item: '股权质押', value: R2(pledgeRatio).toFixed(2) + '%', standard: '≤10%', verdict: '通过', note: '质押数据 ' + pledgeDate });
    } else if (pledgeRatio <= 30) {
      l1.push({ item: '股权质押', value: R2(pledgeRatio).toFixed(2) + '%', standard: '≤10%', verdict: '警告', note: '质押比例偏高，注意大股东平仓风险' });
    } else {
      l1.push({ item: '股权质押', value: R2(pledgeRatio).toFixed(2) + '%', standard: '≤10%', verdict: '淘汰', note: '质押比例过高，股价下跌易触发平仓' });
    }

    var audit = '';
    for (var yi = 0; yi < years.length; yi++) {
      var bRow = balByYear[years[yi].year];
      if (bRow) {
        var op = String(bRow.OPINION_TYPE === null || bRow.OPINION_TYPE === undefined ? '' : bRow.OPINION_TYPE);
        if (op) { audit = op; break; }
      }
    }
    if (audit === '标准无保留意见') {
      l1.push({ item: '审计意见', value: audit, standard: '标准无保留', verdict: '通过', note: '最近年报为标准无保留意见' });
    } else if (!audit) {
      l1.push({ item: '审计意见', value: '未取到', standard: '标准无保留', verdict: '警告', note: '接口未返回审计意见，需人工核对年报' });
    } else {
      l1.push({ item: '审计意见', value: audit, standard: '标准无保留', verdict: '淘汰', note: '非标意见，直接排除' });
    }

    var dedRatios = [];
    years.slice(0, 3).forEach(function (y) { if (y.np > 0) dedRatios.push(y.deduct / y.np); });
    var dedRatio = avg(dedRatios);
    if (dedRatios.length === 0) {
      l1.push({ item: '扣非/归母', value: '无数据', standard: '3年均值 ≥70%', verdict: '警告', note: '近 3 年归母净利为负或缺失' });
    } else if (dedRatio >= 0.8) {
      l1.push({ item: '扣非/归母', value: (dedRatio * 100).toFixed(0) + '%', standard: '3年均值 ≥70%', verdict: '通过', note: '利润主要来自主营' });
    } else if (dedRatio >= 0.6) {
      l1.push({ item: '扣非/归母', value: (dedRatio * 100).toFixed(0) + '%', standard: '3年均值 ≥70%', verdict: '警告', note: '非经常性损益占比偏高' });
    } else {
      l1.push({ item: '扣非/归母', value: (dedRatio * 100).toFixed(0) + '%', standard: '3年均值 ≥70%', verdict: '淘汰', note: '利润靠补贴/卖资产，质量差' });
    }

    var l1Kill = l1.filter(function (x) { return x.verdict === '淘汰'; }).length;
    var l1Warn = l1.filter(function (x) { return x.verdict === '警告'; }).length;
    var l1Tip = l1.filter(function (x) { return x.verdict === '提示'; }).length;
    var l1Verdict = '通过';
    if (l1Kill > 0) l1Verdict = '淘汰';
    else if (l1Warn > 0) l1Verdict = '警告';

    /* ---------------- L2 盈利质量 ---------------- */
    var years5 = years.slice(0, 5);
    var roeList = years5.map(function (y) { return y.roe; });
    var roeAvg = avg(roeList);
    var roeMin = Math.min.apply(null, roeList);
    var roeSd = stdev(roeList);
    var gmNow = years5[0].gm;
    var gmOld = years5[years5.length - 1].gm;
    var gmDelta = gmNow - gmOld;

    var s2 = 0;
    if (roeAvg >= MIN_ROE) s2 += 40;
    else if (roeAvg >= 12) s2 += 30;
    else if (roeAvg >= 10) s2 += 20;

    if (roeMin >= 10) s2 += 20;
    else if (roeMin >= 8) s2 += 12;

    if (roeSd <= 2) s2 += 20;
    else if (roeSd <= 4) s2 += 15;
    else if (roeSd <= 6) s2 += 8;

    if (gmDelta >= -2) s2 += 20;
    else if (gmDelta >= -5) s2 += 10;

    if (latest.roic >= 12) s2 += 5;
    else if (latest.roic < 8) s2 -= 10;

    var lev = 0;
    if (latest.equity > 0) lev = latest.totalAssets / latest.equity;
    if (lev > 2.5) s2 = s2 * 0.85;

    if (s2 < 0) s2 = 0;
    if (s2 > 100) s2 = 100;

    var l2Verdict = '差';
    if (s2 >= 75) l2Verdict = '优秀';
    else if (s2 >= 60) l2Verdict = '良好';
    else if (s2 >= 45) l2Verdict = '一般';

    var l2Series = years5.slice().sort(function (a, b) { return parseInt(a.year, 10) - parseInt(b.year, 10); }).map(function (y) {
      var nm = 0;
      if (y.revenue > 0) nm = y.np / y.revenue * 100.0;
      var dr = null;
      if (y.np > 0) dr = R1(y.deduct / y.np * 100.0);
      return { year: y.year, roe: y.roe, gm: y.gm, netMargin: R2(nm), deductRatio: dr };
    });

    /* ---------------- L3 增长稳定性 ---------------- */
    var revCagr = 0, dedCagr = 0;
    if (years.length >= 4) {
      var y0 = years[0], y3 = years[3];
      if (y3.revenue > 0 && y0.revenue > 0) revCagr = (Math.pow(y0.revenue / y3.revenue, 1.0 / 3.0) - 1.0) * 100.0;
      if (y3.deduct > 0 && y0.deduct > 0) dedCagr = (Math.pow(y0.deduct / y3.deduct, 1.0 / 3.0) - 1.0) * 100.0;
    }

    var growth = [];
    for (var gi = 0; gi < years.length - 1; gi++) {
      var ga = years[gi].revenue, gb = years[gi + 1].revenue;
      if (gb > 0) growth.push(((ga / gb - 1.0) * 100.0));
    }
    var growthSd = stdev(growth);

    var peg = 0;
    if (dedCagr > 0 && peTtm > 0) peg = peTtm / dedCagr;

    var capexDep = 0;
    if (latest.dep > 0) capexDep = latest.capex / latest.dep;

    var s3 = 0;
    if (revCagr >= 15) s3 += 30;
    else if (revCagr >= 8) s3 += 22;
    else if (revCagr >= 0) s3 += 12;

    if (dedCagr >= 15) s3 += 30;
    else if (dedCagr >= 8) s3 += 22;
    else if (dedCagr >= 0) s3 += 12;

    if (growthSd <= 10) s3 += 20;
    else if (growthSd <= 25) s3 += 12;
    else s3 += 4;

    if (peg > 0) {
      if (peg <= 1) s3 += 20;
      else if (peg <= 1.5) s3 += 14;
      else if (peg <= 2) s3 += 8;
      else s3 += 2;
    } else s3 += 8;

    if (s3 > 100) s3 = 100;
    if (s3 < 0) s3 = 0;

    var l3Verdict = '差';
    if (s3 >= 70) l3Verdict = '优秀';
    else if (s3 >= 55) l3Verdict = '良好';
    else if (s3 >= 40) l3Verdict = '一般';

    var quarters = quarterlySeries(mf);
    var latestCumNp = numOrNull(latestMf.PARENTNETPROFITTZ);
    var latestCumRev = numOrNull(latestMf.TOTALOPERATEREVETZ);
    var latestCumDed = numOrNull(latestMf.KCFJCXSYJLRTZ);
    var mom = momentum(quarters, latestCumNp, latestCumRev);

    var annualSeries = years.slice().sort(function (a, b) { return parseInt(a.year, 10) - parseInt(b.year, 10); }).map(function (y) {
      return {
        year: y.year, revenue: y.revenue, np: y.np, deduct: y.deduct,
        revGrowth: y.revGrowth, npGrowth: y.npGrowth, dedGrowth: y.dedGrowth,
        roe: y.roe, gm: y.gm, rd: y.rd, rdRatio: y.rdRatio
      };
    });

    var partial = {
      label: latestPeriod,
      revenue: R2(N(latestMf.TOTALOPERATEREVE) / 1e8),
      np: R2(N(latestMf.PARENTNETPROFIT) / 1e8),
      deduct: R2(N(latestMf.KCFJCXSYJLR) / 1e8),
      revGrowth: latestCumRev !== null ? R2(latestCumRev) : null,
      npGrowth: latestCumNp !== null ? R2(latestCumNp) : null,
      dedGrowth: latestCumDed !== null ? R2(latestCumDed) : null
    };

    var rdLatestRaw = N(latestMf.RDEXPEND);
    var rdLatest = R2(rdLatestRaw / 1e8);
    var rdRatioVal = 0;
    var latestRevRaw = N(latestMf.TOTALOPERATEREVE);
    if (latestRevRaw > 0) rdRatioVal = R2(rdLatestRaw / latestRevRaw * 100.0);
    var rdYoY = null;
    var prevYear = parseInt(latestMfDate.substring(0, 4), 10) - 1;
    var prevSameDate = String(prevYear) + latestMfDate.substring(4);
    var prevSame = mf.filter(function (x) { return date10(x.REPORT_DATE) === prevSameDate; });
    if (prevSame.length > 0) {
      var prevRd = N(prevSame[0].RDEXPEND);
      if (prevRd > 0) rdYoY = R1(((rdLatestRaw / prevRd) - 1.0) * 100.0);
    }
    var rdPersonnel = numOrNull(latestMf.RDPERSONNEL);
    var rdPersonnelRatio = numOrNull(latestMf.PRATIO);
    var rdHistory = years.slice().sort(function (a, b) { return parseInt(a.year, 10) - parseInt(b.year, 10); })
      .slice(-6).map(function (y) { return { year: y.year, rd: y.rd, ratio: y.rdRatio }; });

    var consensus = consensusData(bundle.Pred, price);

    /* ---------------- L4 估值 ---------------- */
    var pePctEff = pePct5 < 0 ? 50.0 : pePct5;
    var pbPctEff = pbPct5 < 0 ? 50.0 : pbPct5;
    var worstPct = Math.max(pePctEff, pbPctEff);

    var s4 = 0;
    if (worstPct < 50) s4 += 50;
    else if (worstPct < MAX_PE_PCT) s4 += 40;
    else if (worstPct < 90) s4 += 15;

    if (implied > 0 && dedCagr > 0) {
      if (implied <= (dedCagr + 20)) s4 += 30;
      else if (implied <= (dedCagr * 1.5 + 20)) s4 += 18;
      else s4 += 5;
    } else if (implied <= 0) {
      s4 += 30;
    } else {
      s4 += 15;
    }

    var divYield = 0, dps = 0;
    var cutDiv = addDays(new Date(), -365);
    (bundle.Div || []).forEach(function (d) {
      if (String(d.ASSIGN_PROGRESS) !== '实施分配') return;
      var ex = date10(d.EX_DIVIDEND_DATE);
      if (ex.length < 10) return;
      var dt = new Date(ex + 'T00:00:00');
      if (isNaN(dt.getTime())) return;
      if (dt >= cutDiv) dps += N(d.PRETAX_BONUS_RMB) / 10.0;
    });
    if (price > 0) divYield = R2(dps / price * 100.0);

    if (divYield >= 3) s4 += 20;
    else if (divYield >= 2) s4 += 15;
    else if (divYield >= 1) s4 += 10;
    else s4 += 4;

    if (s4 > 100) s4 = 100;
    if (s4 < 0) s4 = 0;

    var l4Verdict = '贵';
    if (s4 >= 70) l4Verdict = '便宜';
    else if (s4 >= 50) l4Verdict = '合理';
    else if (s4 >= 30) l4Verdict = '偏贵';

    var total = s2 * 0.40 + s3 * 0.25 + s4 * 0.35;

    var rating = 'D-不建议';
    if (l1Verdict === '淘汰') {
      rating = 'D-排除';
    } else if (total >= 75 && s4 >= 50 && roeAvg >= MIN_ROE && roeMin >= 10) {
      rating = 'A-可跟踪';
    } else if (total >= 65) {
      rating = 'B-观察';
    } else if (total >= 50) {
      rating = 'C-谨慎';
    }
    if (l1Verdict === '警告' && rating === 'A-可跟踪') rating = 'B-观察';
    if (l1Verdict === '淘汰') total = Math.min(total, 45.0);

    var notes = [];
    if (l1Verdict === '淘汰') {
      l1.filter(function (x) { return x.verdict === '淘汰'; }).slice(0, 2).forEach(function (b) { notes.push(b.item + '不达标'); });
    } else if (l1Verdict === '警告') {
      var w = l1.filter(function (x) { return x.verdict === '警告'; }).slice(0, 1);
      if (w.length > 0) notes.push(w[0].item + '需复核');
    }
    if (roeAvg < MIN_ROE) notes.push('ROE5年均值' + R1(roeAvg).toFixed(1) + '%<' + MIN_ROE + '%');
    if (pePct5 >= MAX_PE_PCT) notes.push('PE分位' + R1(pePct5).toFixed(0) + '%偏高');
    if (pbPct5 >= MAX_PE_PCT) notes.push('PB分位' + R1(pbPct5).toFixed(0) + '%偏高');
    if (dedCagr < 0) notes.push('扣非3年CAGR' + R1(dedCagr).toFixed(1) + '%');
    if (mom.label === '降档' || mom.label === '失速') notes.push('利润增速' + mom.label);
    if (notes.length === 0) notes.push('各项均在阈值内，仍需人工复核行业景气');
    var conclusion = notes.join('；');

    /* ---------------- L5 资金面 ---------------- */
    var mg = bundle.Margin || [];
    var marginRatio = null, rzTrend = null, marginTrend = [];
    if (mg.length > 0) {
      marginRatio = R2(N(mg[0].RZYEZB));
      if (mg.length >= 21) {
        var oldRz = N(mg[20].RZYE), newRz = N(mg[0].RZYE);
        if (oldRz > 0) rzTrend = R1(((newRz / oldRz) - 1.0) * 100.0);
      }
      marginTrend = mg.slice().sort(function (a, b) { return String(a.DATE).localeCompare(String(b.DATE)); })
        .map(function (x) { return { d: date10(x.DATE), value: R2(N(x.RZYE) / 1e8) }; });
    }

    /* ---------------- 摘要文案 ---------------- */
    var latestYear = latestDt.getFullYear();
    var cumSeq = [];
    if (years[0].npGrowth !== null) cumSeq.push({ label: years[0].year, value: years[0].npGrowth });
    var qLabelMap = { '03-31': 'Q1', '06-30': 'H1', '09-30': '前三季' };
    ['03-31', '06-30', '09-30'].forEach(function (mmdd) {
      var ds = String(latestYear) + '-' + mmdd;
      if (ds > latestMfDate) return;
      var r = mf.filter(function (x) { return date10(x.REPORT_DATE) === ds; });
      if (r.length > 0) {
        var v = numOrNull(r[0].PARENTNETPROFITTZ);
        if (v !== null) cumSeq.push({ label: qLabelMap[mmdd], value: R2(v) });
      }
    });
    var cumText = '—';
    if (cumSeq.length > 0) cumText = cumSeq.map(function (x) { return pctText(x.value) + '(' + x.label + ')'; }).join(' → ');

    var singleSeq = quarters.slice(-3);
    var singleText = '—';
    if (singleSeq.length > 0) singleText = singleSeq.map(function (x) { return pctText(x.npGrowth) + '(' + x.label + ')'; }).join(' → ');

    var revSeqItems = years.slice(0, 3).sort(function (a, b) { return parseInt(a.year, 10) - parseInt(b.year, 10); })
      .map(function (y) { return { year: y.year, value: y.revGrowth }; });
    var revSeqText = '—';
    if (revSeqItems.length > 0) revSeqText = revSeqItems.map(function (x) { return x.year + ' ' + pctText(x.value); }).join(' → ');

    var latestRevSingle = null, prevRevSingle = null;
    if (quarters.length > 0) latestRevSingle = quarters[quarters.length - 1].revGrowth;
    if (quarters.length > 1) prevRevSingle = quarters[quarters.length - 2].revGrowth;

    var growthText = '营收增速 ' + revSeqText + '；' + latestPeriod + ' 累计 ' + pctText(latestCumRev) + '，单季 ' + pctText(latestRevSingle) + '。';
    if (latestRevSingle !== null && prevRevSingle !== null) {
      if (latestRevSingle < prevRevSingle) growthText += ' 单季营收增速较上季放缓。';
      else if (latestRevSingle > prevRevSingle) growthText += ' 单季营收增速较上季加快。';
    }
    var growthTone = 'info';
    if (latestCumRev !== null && latestCumRev < 0) growthTone = 'bad';
    else if (latestCumRev !== null && years[0].revGrowth !== null && latestCumRev > years[0].revGrowth && (latestRevSingle === null || prevRevSingle === null || latestRevSingle >= prevRevSingle)) growthTone = 'good';
    else if (latestRevSingle !== null && prevRevSingle !== null && latestRevSingle < prevRevSingle) growthTone = 'warn';

    var profitText = '归母净利累计增速 ' + cumText + '；单季 ' + singleText + '。';
    var profitTone = mom.tone;

    var diffNpDed = null;
    if (latestCumNp !== null && latestCumDed !== null) diffNpDed = R2(latestCumNp - latestCumDed);
    var dedRatioPct = psRound(dedRatio * 100.0, 0);
    var deductText = latestPeriod + ' 扣非累计增速 ' + pctText(latestCumDed) + '，归母 ' + pctText(latestCumNp) + '，相差 ' + pctText(diffNpDed) + '；近3年扣非/归母均值 ' + dedRatioPct + '%。';
    var deductTone = 'info';
    if (diffNpDed !== null && diffNpDed > 5) deductTone = 'warn';
    else if (dedRatio >= 0.8) deductTone = 'good';

    var rdText = '研发投入 ' + rdLatest + ' 亿（占营收 ' + rdRatioVal + '%）';
    if (rdYoY !== null) rdText += '，同比 ' + pctText(rdYoY);
    if (rdPersonnelRatio !== null && rdPersonnelRatio > 0 && rdPersonnelRatio < 100) {
      rdText += '；研发人员占比 ' + rdPersonnelRatio + '%';
    }
    rdText += '。';
    if (rdLatest <= 0) rdText = '研发投入数据未披露。';
    var rdTone = 'info';
    if (rdRatioVal >= 3 && (rdYoY === null || rdYoY >= 0)) rdTone = 'good';
    else if (rdRatioVal < 1) rdTone = 'warn';

    var consText = '机构一致预期数据未取到。';
    var consTone = 'warn';
    if (consensus) {
      if (consensus.org !== null) {
        consText = '覆盖 ' + consensus.org + ' 家（' + consensus.ratingText + '）';
        consTone = 'info';
      } else {
        consText = '覆盖机构数缺失（' + consensus.ratingText + '）';
      }
      var forecastItems = consensus.forecasts.filter(function (x) { return x.mark === 'E' && x.growth !== null; }).slice(-3);
      if (forecastItems.length > 0) {
        consText += '；EPS 一致预期 ' + forecastItems.map(function (x) { return x.year + 'E ' + pctText(x.growth); }).join(' / ');
      }
      if (consensus.targetMid !== null) {
        if (consensus.targetMin !== null && consensus.targetMax !== null && consensus.targetMin !== consensus.targetMax) {
          consText += '；目标价 ' + consensus.targetMin + '–' + consensus.targetMax + '（中值 ' + consensus.targetMid + '）';
        } else {
          consText += '；目标价 ' + consensus.targetMid;
        }
        if (consensus.upside !== null) consText += '，较现价 ' + pctText(consensus.upside);
      }
      consText += '。';
      if (consensus.upside !== null && consensus.upside >= 20 && consensus.org !== null) consTone = 'good';
      else if (consensus.upside !== null && consensus.upside < 0) consTone = 'warn';
    }

    var spreadText = '差 ≥10%，盈利外推需谨慎';
    if (spread < 10) spreadText = '差 <10%，盈利可外推';
    var valText = '三档 PE：静态 ' + peStatic + ' / TTM ' + peTtm + ' / 动态 ' + peDyn + '，' + spreadText + '（最大差 ' + spread + '%）；PE 近6年分位 ' + pctText(pePct6) + '，PB ' + pctText(pbPct6) + '。';
    var valTone = 'info';
    if (pePct6 >= 0 && pbPct6 >= 0) {
      if (pePct6 <= 30 && pbPct6 <= 50) valTone = 'good';
      else if (pePct6 >= 80 || pbPct6 >= 80) valTone = 'warn';
      else if (spread >= 10) valTone = 'warn';
    }

    var indText = industry + ' 同行估值数据未取到。';
    var indTone = 'info';
    if (industryObj.count > 0) {
      var peRankText = '样本不足';
      if (industryObj.peRank >= 0) peRankText = industryObj.peRank + '%';
      var pbRankText = '样本不足';
      if (industryObj.pbRank >= 0) pbRankText = industryObj.pbRank + '%';
      indText = industry + ' ' + industryObj.count + ' 家：整体 PE ' + industryObj.peAgg + ' / PB ' + industryObj.pbAgg + '，中位 PE ' + industryObj.peMedian + ' / PB ' + industryObj.pbMedian + '；本股 PE ' + peTtm + ' / PB ' + pb + '，行业内 PE 分位 ' + peRankText + '、PB ' + pbRankText + '。';
      var peBelow = peTtm < industryObj.peMedian;
      var pbBelow = pb < industryObj.pbMedian;
      if (peBelow && pbBelow) indTone = 'good';
      else if (!peBelow && !pbBelow) indTone = 'warn';
    }

    var l1Note = '';
    var badL1 = l1.filter(function (x) { return x.verdict === '淘汰' || x.verdict === '警告'; }).slice(0, 1);
    if (badL1.length > 0) l1Note = '；' + badL1[0].item + '：' + badL1[0].note;
    var l1Text = 'L1 排雷：' + l1Verdict + '（淘汰 ' + l1Kill + ' 项 / 警告 ' + l1Warn + ' 项 / 提示 ' + l1Tip + ' 项）' + l1Note + '。';
    var l1Tone = 'good';
    if (l1Verdict === '警告') l1Tone = 'warn';
    else if (l1Verdict === '淘汰') l1Tone = 'bad';

    var ratingTone = 'info';
    if (rating.indexOf('A') === 0 || rating.indexOf('B') === 0) ratingTone = 'good';
    else if (rating.indexOf('D') === 0) ratingTone = 'warn';

    var summary = [
      insight('增长', growthText, growthTone),
      insight('利润', profitText, profitTone),
      insight('扣非', deductText, deductTone),
      insight('研发', rdText, rdTone),
      insight('预期', consText, consTone),
      insight('估值', valText, valTone),
      insight('行业', indText, indTone),
      insight('排雷', l1Text, l1Tone),
      insight('结论', '综合评分 ' + R1(total) + '，评级 ' + rating + '；' + conclusion + '。', ratingTone)
    ];

    var firstForecast = null;
    if (consensus) {
      var eItems = consensus.forecasts.filter(function (x) { return x.mark === 'E' && x.growth !== null; });
      if (eItems.length > 0) firstForecast = eItems[0];
    }
    var keyStats = [
      { label: '营收增速', value: pctText(latestCumRev), sub: latestPeriod, tone: growthTone },
      { label: '归母增速', value: pctText(latestCumNp), sub: latestPeriod, tone: profitTone },
      { label: '单季归母', value: pctText(quarters.length > 0 ? quarters[quarters.length - 1].npGrowth : null), sub: quarters.length > 0 ? quarters[quarters.length - 1].label : '', tone: profitTone },
      { label: '研发占营收', value: rdLatestRaw > 0 ? String(rdRatioVal) + '%' : '—', sub: rdLatestRaw > 0 ? String(rdLatest) + ' 亿' : '未披露', tone: rdTone },
      { label: '一致预期', value: firstForecast !== null ? pctText(firstForecast.growth) : '—', sub: firstForecast !== null ? String(firstForecast.year) + 'E' : '未覆盖', tone: consTone },
      { label: 'PE 6年分位', value: pctText(pePct6), sub: 'TTM ' + peTtm, tone: valTone }
    ];

    var elapsed = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
    var now = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };

    return {
      ok: true,
      code: code,
      name: name,
      industry: industry,
      boardCode: boardCode,
      price: price,
      marketCap: mcap,
      peTtm: peTtm,
      peStatic: peStatic,
      peDynamic: peDyn,
      pb: pb,
      dividendYield: divYield,
      total: R1(total),
      rating: rating,
      conclusion: conclusion,
      l1: { verdict: l1Verdict, kill: l1Kill, warn: l1Warn, tip: l1Tip, items: l1 },
      l2: {
        score: R1(s2), verdict: l2Verdict, roeAvg: R2(roeAvg), roeMin: R2(roeMin),
        roeSd: R2(roeSd), gmDelta: R2(gmDelta), lev: R2(lev), roic: R2(latest.roic), series: l2Series
      },
      l3: {
        score: R1(s3), verdict: l3Verdict, revCagr: R2(revCagr), dedCagr: R2(dedCagr),
        growthSd: R2(growthSd), peg: R2(peg), capexDep: R2(capexDep),
        annual: annualSeries, partial: partial, quarters: quarters, momentum: mom,
        rd: {
          latest: rdLatest, latestLabel: latestPeriod, ratio: rdRatioVal, yoy: rdYoY,
          personnel: rdPersonnel !== null ? rdPersonnel : null,
          personnelRatio: rdPersonnelRatio !== null ? R2(rdPersonnelRatio) : null,
          history: rdHistory
        },
        consensus: consensus
      },
      l4: {
        score: R1(s4), verdict: l4Verdict, peStatic: peStatic, peTtm: peTtm, peDynamic: peDyn,
        spread: spread, implied: implied, pb: pb,
        pePct5: pePct5, pbPct5: pbPct5, pePct6: pePct6, pbPct6: pbPct6,
        peStats: peStats6, pbStats: pbStats6, peSeries: peSeries, yearEnd: yearEnd, industry: industryObj
      },
      l5: {
        marginRatio: marginRatio, rzTrend: rzTrend, divYield: divYield, marginTrend: marginTrend
      },
      summary: summary,
      keyStats: keyStats,
      meta: {
        version: VERSION,
        generatedAt: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
        dataAsOf: latestDate,
        source: '东方财富 datacenter',
        cached: false,
        elapsedMs: Math.round(elapsed)
      }
    };
  }

  var API = { analyze: analyze, __test: { psRound: psRound, R2: R2, quantile: quantile, percentile: percentile } };
  root.ScoreEngine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
