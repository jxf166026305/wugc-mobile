/* =====================================================================
 * 全球指数（移植自 网页评分.ps1 的 Get-GlobalIndices）
 * 桌面版用 腾讯 + 新浪(hq.sinajs.cn) + CNBC 多源择优；新浪接口在浏览器
 * 里无 Referer 会 403，因此手机版统一走东财 push2 快照（带跨域头）。
 * ===================================================================== */
(function (root) {
  'use strict';

  var DEFS = [
    { g: '中国内地', code: '000001', secid: '1.000001', name: '上证指数' },
    { g: '中国内地', code: '399001', secid: '0.399001', name: '深证成指' },
    { g: '中国内地', code: '399006', secid: '0.399006', name: '创业板指' },
    { g: '中国内地', code: '000300', secid: '1.000300', name: '沪深300' },
    { g: '中国内地', code: '000905', secid: '1.000905', name: '中证500' },
    { g: '中国内地', code: '000016', secid: '1.000016', name: '上证50' },
    { g: '中国内地', code: '000688', secid: '1.000688', name: '科创50' },
    { g: '中国香港', code: 'HSI', secid: '100.HSI', name: '恒生指数' },
    { g: '中国香港', code: 'HSTECH', secid: '124.HSTECH', name: '恒生科技' },
    { g: '中国香港', code: 'HSCEI', secid: '100.HSCEI', name: '国企指数' },
    { g: '亚太', code: 'N225', secid: '100.N225', name: '日经225' },
    { g: '亚太', code: 'KS11', secid: '100.KS11', name: '韩国KOSPI' },
    { g: '亚太', code: 'AS51', secid: '100.AS51', name: '澳大利亚标普200' },
    { g: '亚太', code: 'SENSEX', secid: '100.SENSEX', name: '印度SENSEX' },
    { g: '亚太', code: 'STI', secid: '100.STI', name: '新加坡海峡时报' },
    { g: '亚太', code: 'SET', secid: '100.SET', name: '泰国SET' },
    { g: '亚太', code: 'KLSE', secid: '100.KLSE', name: '马来西亚KLCI' },
    { g: '欧洲', code: 'FTSE', secid: '100.FTSE', name: '英国富时100' },
    { g: '欧洲', code: 'GDAXI', secid: '100.GDAXI', name: '德国DAX30' },
    { g: '欧洲', code: 'FCHI', secid: '100.FCHI', name: '法国CAC40' },
    { g: '欧洲', code: 'SX5E', secid: '100.SX5E', name: '欧洲斯托克50' },
    { g: '欧洲', code: 'RTS', secid: '100.RTS', name: '俄罗斯RTS' },
    { g: '美洲', code: 'DJIA', secid: '100.DJIA', name: '道琼斯' },
    { g: '美洲', code: 'NDX', secid: '100.NDX', name: '纳斯达克' },
    { g: '美洲', code: 'SPX', secid: '100.SPX', name: '标普500' },
    { g: '美洲', code: 'TSX', secid: '100.TSX', name: '加拿大S&P/TSX' },
    { g: '美洲', code: 'MXX', secid: '100.MXX', name: '墨西哥BOLSA' }
  ];

  var GROUPS = ['中国内地', '中国香港', '亚太', '欧洲', '美洲'];
  var cache = null;

  function num(v) {
    if (v === null || v === undefined || v === '' || v === '-') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function hhmmss(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }

  // 东财 f124 是行情时间（秒）；0 表示无
  function labelFromTs(ts) {
    if (!ts) return '';
    var d = new Date(ts * 1000);
    return (d.getMonth() + 1 < 10 ? '0' + (d.getMonth() + 1) : (d.getMonth() + 1)) + '-' +
      pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  async function fetchList(force) {
    if (!force && cache && (Date.now() - cache.t) < 12000) return cache.data;
    var secids = DEFS.map(function (d) { return d.secid; }).join(',');
    var u = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=' + secids +
      '&fields=f1,f2,f3,f4,f5,f6,f12,f13,f14,f15,f16,f17,f18,f124&_=' + Date.now();
    var rows = [];
    try {
      var r = await fetch(u, { headers: { Accept: 'application/json' } });
      var j = await r.json();
      rows = (j.data && j.data.diff) ? j.data.diff : [];
      if (Array.isArray(rows) === false) {
        rows = Object.keys(rows).map(function (k) { return rows[k]; });
      }
    } catch (e) {
      return { ok: false, error: '全球指数拉取失败：' + (e && e.message ? e.message : e) };
    }
    if (!rows || !rows.length) return { ok: false, error: '全球指数暂无数据（接口未返回内容）' };

    var bySec = {};
    rows.forEach(function (x) {
      if (!x) return;
      var mk = String(x.f13 || ''), cd = String(x.f12 || '');
      bySec[mk + '.' + cd] = x;
      // f13 有时是 0/1/100 之外的值；再按代码兜底
      if (!bySec['@' + cd]) bySec['@' + cd] = x;
    });

    var now = Date.now();
    var items = DEFS.map(function (d) {
      var x = bySec[d.secid] || bySec['@' + d.code];
      if (!x) {
        return { ok: false, code: d.code, name: d.name, price: null, change: null, pct: null, high: null, low: null, open: null, prevClose: null, status: 'unknown', statusText: '暂无数据', source: '东方财富', quoteTime: '', quoteLabel: '' };
      }
      var price = num(x.f2), pct = num(x.f3), change = num(x.f4);
      var high = num(x.f15), low = num(x.f16), open = num(x.f17), prev = num(x.f18);
      var ts = num(x.f124);
      var name = String(x.f14 || d.name);
      var qLabel = labelFromTs(ts);
      var ageSec = ts ? (now / 1000 - ts) : null;
      var status = 'unknown', statusText = '时间未知';
      if (ageSec !== null && ageSec >= 0) {
        if (ageSec <= 300) { status = 'live'; statusText = '实时'; }
        else {
          var dq = new Date(ts * 1000);
          var today = new Date();
          var sameDay = dq.getFullYear() === today.getFullYear() && dq.getMonth() === today.getMonth() && dq.getDate() === today.getDate();
          if (sameDay && now / 1000 - ts > 300 && now / 1000 - ts < 900) { status = 'delayed'; statusText = '延迟'; }
          else { status = 'closed'; statusText = '非交易时段'; }
        }
      }
      var ok = price !== null && price > 0;
      return {
        ok: ok, code: d.code, name: name, price: price, change: change, pct: pct,
        high: high, low: low, open: open, prevClose: prev,
        status: ok ? status : 'unknown', statusText: ok ? statusText : '暂无数据',
        source: '东方财富', quoteTime: qLabel, quoteLabel: qLabel
      };
    });

    var groups = GROUPS.map(function (g) {
      return { name: g, items: items.filter(function (x, i) { return DEFS[i].g === g; }) };
    });
    var okCount = items.filter(function (x) { return x.ok; }).length;
    var data = {
      ok: true, time: hhmmss(new Date()), total: items.length, okCount: okCount,
      source: '东方财富 push2', groups: groups, items: items
    };
    cache = { t: Date.now(), data: data };
    return data;
  }

  root.IndexLayer = { list: fetchList, defs: DEFS };
})(typeof window !== 'undefined' ? window : globalThis);
