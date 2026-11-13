/* =====================================================================
 * 前端接管层：把 app.js 的 /api/* 请求接到本地 JS 实现
 * ---------------------------------------------------------------------
 * 电脑版是 PowerShell 服务端提供这些接口；手机独立版没有后端，
 * 这里用 fetch 拦截把同源 /api/* 转成本地计算，前端代码一行不用改。
 * ===================================================================== */
(function (root) {
  'use strict';

  var Engine = root.ScoreEngine;
  var Data = root.DataLayer;
  var CACHE_MS = 10 * 60 * 1000;
  var analyzeCache = {}; // { code: { t, data } }

  function json(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function notYet(moduleName) {
    return {
      ok: false,
      error: '「' + moduleName + '」正在移植到手机独立版（第二阶段），当前版本暂未开放。主评分、行情、K线、自选股已经可用。'
    };
  }

  var routes = {
    '/api/health': async function () {
      return { ok: true, version: 'v1.2-mobile', time: stamp(), mode: 'standalone' };
    },

    '/api/analyze': async function (u) {
      var code = (u.searchParams.get('code') || '').trim();
      if (!/^\d{6}$/.test(code)) return { ok: false, error: '请输入 6 位 A 股代码' };
      var force = u.searchParams.get('refresh') === '1';
      var hit = analyzeCache[code];
      if (!force && hit && (Date.now() - hit.t < CACHE_MS)) {
        var copy = JSON.parse(JSON.stringify(hit.data));
        copy.meta.cached = true;
        return copy;
      }
      var res = await Engine.analyze(code);
      analyzeCache[code] = { t: Date.now(), data: res };
      return res;
    },

    '/api/quote': async function (u) {
      var code = (u.searchParams.get('code') || '').trim();
      return await Data.quote(code);
    },

    '/api/kline': async function (u) {
      var code = (u.searchParams.get('code') || '').trim();
      if (!/^\d{6}$/.test(code)) return { ok: false, error: '请输入 6 位 A 股代码' };
      return await Data.kline(code, u.searchParams.get('period'), u.searchParams.get('limit'));
    },

    '/api/watchlist': async function () {
      return await Data.watchSnapshot();
    },

    '/api/watchlist/add': async function (u) {
      return await Data.watchAdd((u.searchParams.get('code') || '').trim());
    },

    '/api/watchlist/remove': async function (u) {
      return await Data.watchRemove((u.searchParams.get('code') || '').trim());
    },

    '/api/watchlist/settings': async function (u) {
      return await Data.watchSettings(u.searchParams);
    },

    '/api/news': async function (u) {
      if (!root.NewsLayer) return { ok: false, error: '资讯模块未加载' };
      return await root.NewsLayer.feed(u, u.searchParams.get('refresh'));
    },

    '/api/news/stock': async function (u) {
      var code = (u.searchParams.get('code') || '').trim();
      var q = (u.searchParams.get('q') || '').trim();
      if (!root.NewsLayer) return { ok: false, error: '资讯模块未加载' };
      if (q) {
        var list = await root.NewsLayer.search(q, 20);
        return { ok: true, code: '', name: q, industry: '', ann: [], news: list, peers: [] };
      }
      if (!/^\d{6}$/.test(code)) return { ok: false, error: '请输入 6 位 A 股代码' };
      return await root.NewsLayer.forStock(code);
    },
    '/api/indices': async function (u) {
      if (!root.IndexLayer) return { ok: false, error: '指数模块未加载' };
      return await root.IndexLayer.list(u.searchParams.get('refresh') === '1');
    },
    '/api/uspremarket': async function (u) {
      if (!root.PremarketLayer) return { ok: false, error: '盘前模块未加载' };
      var preset = u.searchParams.get('preset') || '';
      var codes = String(u.searchParams.get('codes') || '').split(/[,，\s]+/).filter(function (x) { return x; });
      return await root.PremarketLayer.list(preset, codes, u.searchParams.get('refresh') === '1');
    },
    '/api/limitup': async function (u) {
      if (!root.LimitUpLayer) return { ok: false, error: '涨停模块未加载' };
      return await root.LimitUpLayer.list(u.searchParams);
    },
    '/api/limitup/detail': async function (u) {
      if (!root.LimitUpLayer) return { ok: false, error: '涨停模块未加载' };
      return await root.LimitUpLayer.detail(u.searchParams);
    },
    '/api/deep': async function (u) {
      var code = (u.searchParams.get('code') || '').trim();
      if (!/^\d{6}$/.test(code)) return { ok: false, error: '请输入 6 位 A 股代码' };
      var force = u.searchParams.get('refresh') === '1';
      if (!root.DeepLayer) return { ok: false, error: '深度模块未加载' };
      return await root.DeepLayer.deep(code, force);
    },
    '/api/scan/start': async function () { return notYet('全 A 股扫描'); },
    '/api/scan/status': async function () { return { ok: true, running: false, done: 0, total: 0, rows: [], error: '手机独立版暂未开放扫描' }; },
    '/api/scan/result': async function () { return { ok: true, rows: [] }; }
  };

  var originalFetch = root.fetch.bind(root);

  // 告诉 app.js：数据由本地接手，file:// 打开也不需要后端服务
  root.STANDALONE_MODE = true;

  root.fetch = function (input, init) {
    var raw = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
    var url;
    try { url = new URL(raw, root.location ? root.location.href : 'http://localhost/'); }
    catch (e) { return originalFetch(input, init); }

    if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);

    // 只接管本页面自己的 /api/*：东方财富数据接口的路径也是 /api/data/...，
    // 若只看前缀会把它们误拦成 404，这里必须同时校验同源。
    var here = root.location ? root.location.origin : '';
    if (url.origin !== here) return originalFetch(input, init);

    var handler = routes[url.pathname];
    if (!handler) return json({ ok: false, error: '手机版没有这个接口：' + url.pathname });

    console.log('[独立版] ' + url.pathname);
    return Promise.resolve()
      .then(function () { return handler(url); })
      .then(function (body) { return json(body, 200); })
      .catch(function (e) {
        console.error('[独立版] 接口失败', url.pathname, e);
        return json({ ok: false, error: (e && e.message) ? e.message : String(e) });
      });
  };

  // 自选股首次运行：把电脑版 watchlist.json 的内容灌进本地存储
  if (Data && Data.__seedIfEmpty) {
    root.addEventListener && root.addEventListener('DOMContentLoaded', function () { Data.__seedIfEmpty(); });
  }
})(typeof window !== 'undefined' ? window : globalThis);
