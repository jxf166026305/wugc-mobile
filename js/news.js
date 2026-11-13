/* =====================================================================
 * 资讯雷达（移植自 网页评分.ps1 的 Get-NewsPool / Get-NewsForStock）
 * 数据：东财 7x24 快讯 + 东财公告 + 东财搜索；新浪 7x24 作为补充源
 * ===================================================================== */
(function (root) {
  'use strict';

  // 主题 → 东财行业 + 关键词（与桌面版逐条一致）
  var THEMES = [
    { n: 'PCB / 覆铜板', inds: ['元件', '电子化学品Ⅱ'], kw: '覆铜板|PCB|印制电路|电路板|线路板|铜箔|载板|HDI|ABF' },
    { n: '半导体', inds: ['半导体', '电子化学品Ⅱ'], kw: '半导体|芯片|晶圆|光刻|封测|存储芯片|DRAM|NAND|EDA|IGBT|碳化硅|先进制程|晶圆厂' },
    { n: '面板 / 显示', inds: ['光学光电子'], kw: '面板|OLED|LCD|偏光片|MicroLED|显示屏' },
    { n: '消费电子', inds: ['消费电子'], kw: '苹果|iPhone|华为|手机|耳机|可穿戴|折叠屏|果链|VR|AR眼镜' },
    { n: 'AI 算力', inds: ['通信设备', '计算机设备', 'IT服务Ⅱ', '软件开发'], kw: '算力|GPU|服务器|数据中心|光模块|CPO|液冷|英伟达|智算|大模型' },
    { n: '机器人', inds: ['自动化设备', '通用设备', '电机Ⅱ'], kw: '机器人|减速器|伺服|灵巧手|谐波|人形' },
    { n: '锂电 / 储能', inds: ['电池'], kw: '锂电|动力电池|正极|负极|隔膜|电解液|固态电池|储能' },
    { n: '光伏', inds: ['光伏设备'], kw: '光伏|硅料|组件|逆变器|电池片|HJT|TOPCon|硅片' },
    { n: '风电', inds: ['风电设备'], kw: '风电|风机|海风|叶片|塔筒' },
    { n: '电网 / 电力', inds: ['电网设备', '电力'], kw: '特高压|电网|核电|水电|火电|电价|虚拟电厂|输配电|电改' },
    { n: '煤炭', inds: ['煤炭开采', '焦炭Ⅱ'], kw: '动力煤|焦煤|焦炭|煤炭' },
    { n: '石油石化', inds: ['炼化及贸易', '油气开采Ⅱ', '油服工程'], kw: '原油|油价|OPEC|炼化|成品油|油轮|霍尔木兹|天然气|油气' },
    { n: '有色金属', inds: ['工业金属', '小金属', '金属新材料', '贵金属', '能源金属'], kw: '铜价|铝价|锂价|稀土|黄金|白银|镍|钴|锡|钨|锑' },
    { n: '钢铁', inds: ['普钢', '特钢Ⅱ', '冶钢原料'], kw: '钢材|铁矿石|粗钢|螺纹钢' },
    { n: '化工', inds: ['化学制品', '化学原料', '化学纤维', '农化制品', '橡胶', '塑料'], kw: '化工|化肥|农药|MDI|钛白粉|纯碱|磷矿|制冷剂|维生素' },
    { n: '医药生物', inds: ['化学制药', '生物制品', '医疗服务', '医疗器械', '中药Ⅱ', '医药商业'], kw: '创新药|集采|医保|疫苗|CXO|GLP-1|药品|临床|器械|生物医药' },
    { n: '白酒', inds: ['白酒Ⅱ'], kw: '白酒|茅台|五粮液|泸州老窖|汾酒|酒企' },
    { n: '食品饮料', inds: ['饮料乳品', '食品加工', '休闲食品', '调味发酵品Ⅱ', '非白酒', '化妆品'], kw: '乳业|食品|调味品|啤酒|饮料|零食|化妆品' },
    { n: '农业', inds: ['养殖业', '种植业', '饲料', '农产品加工', '动物保健Ⅱ', '渔业', '林业Ⅱ'], kw: '猪价|生猪|种业|转基因|粮食|饲料|养殖|水产' },
    { n: '房地产', inds: ['房地产开发', '房地产服务'], kw: '楼市|房贷|限购|保交楼|土拍|房地产|地产' },
    { n: '银行', inds: ['银行Ⅱ'], kw: '降准|降息|LPR|存款利率|净息差|银行' },
    { n: '券商 / 多元金融', inds: ['证券Ⅱ', '多元金融'], kw: '券商|两融|注册制|IPO|并购重组|融资融券' },
    { n: '保险', inds: ['保险Ⅱ'], kw: '保险|保费|险资' },
    { n: '军工', inds: ['航空装备Ⅱ', '军工电子Ⅱ', '航天装备Ⅱ', '地面兵装Ⅱ', '航海装备Ⅱ'], kw: '军工|国防|军费|导弹|战机|舰船|卫星' },
    { n: '航运港口', inds: ['航运港口'], kw: '运价|集运|干散货|BDI|红海|绕行|港口' },
    { n: '航空机场', inds: ['航空机场'], kw: '航空|机票|机场|客座率|民航' },
    { n: '旅游酒店', inds: ['旅游及景区', '酒店餐饮', '旅游零售Ⅱ'], kw: '旅游|免签|出行|酒店|景区|免税' },
    { n: '传媒游戏', inds: ['游戏Ⅱ', '影视院线', '广告营销', '出版', '数字媒体', '电视广播Ⅱ'], kw: '游戏|版号|短剧|电影|票房|传媒|出版' },
    { n: '教育', inds: ['教育'], kw: '教培|教育|职教|高校' },
    { n: '汽车', inds: ['乘用车', '商用车', '汽车零部件', '汽车服务', '摩托车及其他'], kw: '汽车|整车|以旧换新|购置税|智驾|自动驾驶|新能源车|车企' },
    { n: '家电', inds: ['白色家电', '黑色家电', '小家电', '家电零部件Ⅱ', '厨卫电器', '照明设备Ⅱ'], kw: '家电|空调|冰箱|洗衣机|彩电' },
    { n: '建材', inds: ['水泥', '玻璃玻纤', '装修建材', '装修装饰Ⅱ'], kw: '水泥|玻璃|玻纤|防水|建材' },
    { n: '基建 / 建筑', inds: ['基础建设', '专业工程', '工程咨询服务Ⅱ', '房屋建设Ⅱ', '轨交设备Ⅱ', '铁路公路'], kw: '基建|专项债|水利|铁路|轨交|开工|中标' },
    { n: '环保公用', inds: ['环境治理', '环保设备Ⅱ', '燃气Ⅱ'], kw: '环保|污水|固废|燃气' },
    { n: '物流', inds: ['物流', '铁路公路'], kw: '物流|快递|公路|集运' },
    { n: '商贸零售', inds: ['一般零售', '专业连锁Ⅱ', '互联网电商', '贸易Ⅱ'], kw: '零售|电商|商超|百货' }
  ];
  var POLICIES = /国务院|国常会|政治局|中央经济工作会议|证监会|央行|人民银行|财政部|发改委|工信部|商务部|国资委|金融监管总局|降准|降息|LPR|特别国债|专项债|十五五|关税|出口管制|反倾销|实体清单|制裁|补贴|税收优惠|新规|征求意见稿/;
  var BAD = /火灾|起火|爆炸|停产|停工|召回|处罚|罚款|立案|调查|减持|亏损|预亏|下调|制裁|禁止|退市|暴跌|跌停|商誉减值|爆雷|暴雷|违规|冻结|诉讼|索赔|事故|泄漏|限产|取消订单/g;
  var GOOD = /中标|签订|签约|获批|批准|涨价|提价|回购|增持|超预期|突破|扩产|订单|合作|补贴|降准|降息|创新高|量产|投产|定点|进入供应/g;
  var HIGHKW = /火灾|爆炸|停产|制裁|出口管制|关税|降准|降息|重组|收购|退市|立案|爆雷|暴雷|重大/;

  var DC = 'https://datacenter-web.eastmoney.com/api/data/v1/get';
  var mktIdx = null;
  var poolCache = null;

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  async function getText(url, ms) {
    try {
      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); }, ms || 15000);
      var r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json, text/plain, */*' } });
      clearTimeout(t);
      if (!r.ok) return null;
      return await r.text();
    } catch (e) { return null; }
  }

  /* ---------- 全市场名称/行业索引 ---------- */
  async function marketIndex(force) {
    if (!force && mktIdx && (Date.now() - mktIdx.time) < 40 * 60 * 1000) return mktIdx;
    if (!force) {
      try {
        var raw = root.localStorage && localStorage.getItem('nf_mktidx');
        if (raw) {
          var c = JSON.parse(raw);
          if (c && c.t && (Date.now() - c.t) < 40 * 60 * 1000 && c.rows && c.rows.length > 100) {
            return buildIndex(c.rows, c.t);
          }
        }
      } catch (e) {}
    }
    var tradeDate = null;
    var probe = await getText(DC + '?reportName=RPT_VALUEANALYSIS_DET&columns=SECURITY_CODE,TRADE_DATE&pageSize=1&pageNumber=1&sortColumns=TRADE_DATE&sortTypes=-1', 8000);
    if (probe) {
      try {
        var pj = JSON.parse(probe);
        if (pj.result && pj.result.data && pj.result.data.length) tradeDate = String(pj.result.data[0].TRADE_DATE).slice(0, 10);
      } catch (e) {}
    }
    if (!tradeDate) {
      var d = new Date(Date.now() - 86400000);
      tradeDate = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    var rows = [];
    for (var pg = 1; pg <= 12; pg++) {
      var u = DC + '?reportName=RPT_VALUEANALYSIS_DET&columns=SECURITY_CODE,SECURITY_NAME_ABBR,BOARD_NAME,TOTAL_MARKET_CAP,TRADE_DATE&filter=' +
        encodeURIComponent("(TRADE_DATE='" + tradeDate + "')") + '&pageSize=500&pageNumber=' + pg;
      var txt = await getText(u, 12000);
      if (!txt) continue;
      try {
        var j = JSON.parse(txt);
        if (j.result && j.result.data) rows = rows.concat(j.result.data);
      } catch (e) {}
    }
    try {
      if (root.localStorage && rows.length > 100) localStorage.setItem('nf_mktidx', JSON.stringify({ t: Date.now(), rows: rows }));
    } catch (e) {}
    return buildIndex(rows, Date.now());
  }

  function buildIndex(rows, t) {
    var names = {}, byInd = {};
    rows.forEach(function (x) {
      var code = String(x.SECURITY_CODE || ''), nm = String(x.SECURITY_NAME_ABBR || ''), ind = String(x.BOARD_NAME || '');
      var cap = Number(x.TOTAL_MARKET_CAP) || 0;
      if (code.length === 6 && nm.length >= 3 && !names[nm]) names[nm] = code;
      if (ind) {
        (byInd[ind] = byInd[ind] || []).push({ c: code, n: nm, cap: cap });
      }
    });
    Object.keys(byInd).forEach(function (k) {
      byInd[k].sort(function (a, b) { return b.cap - a.cap; });
    });
    var keys = Object.keys(names).sort(function (a, b) { return b.length - a.length; });
    var rx = null;
    try { if (keys.length) rx = new RegExp(keys.map(esc).join('|'), 'g'); } catch (e) { rx = null; }
    mktIdx = { time: t || Date.now(), names: names, byInd: byInd, rx: rx, count: rows.length };
    return mktIdx;
  }

  /* ---------- 单条资讯加工 ---------- */
  function buildItem(idx, time, title, summary, src, url, codes) {
    var text = String(title || '') + ' ' + String(summary || '');
    var stocks = [], seen = {};

    (codes || []).forEach(function (sc) {
      var s = String(sc || '');
      var m = s.match(/^[01]\.(\d{6})$/);
      if (!m) return;
      var c = m[1];
      if (seen[c]) return;
      seen[c] = 1;
      var nm = c;
      for (var k in idx.names) { if (idx.names[k] === c) { nm = k; break; } }
      stocks.push({ c: c, n: nm });
    });

    if (idx.rx && stocks.length < 6) {
      var mm;
      idx.rx.lastIndex = 0;
      while ((mm = idx.rx.exec(text)) !== null) {
        var nm2 = mm[0];
        if (!idx.names[nm2]) continue;
        var c2 = idx.names[nm2];
        if (seen[c2]) continue;
        seen[c2] = 1;
        stocks.push({ c: c2, n: nm2 });
        if (stocks.length >= 6) break;
        if (mm.index === idx.rx.lastIndex) idx.rx.lastIndex++;
      }
    }

    var themes = [];
    for (var i = 0; i < THEMES.length; i++) {
      if (new RegExp(THEMES[i].kw).test(text)) themes.push(THEMES[i]);
      if (themes.length >= 4) break;
    }
    var secNames = [];
    themes.forEach(function (th) {
      if (secNames.indexOf(th.n) < 0) secNames.push(th.n);
      th.inds.forEach(function (ind) {
        var arr = idx.byInd[ind];
        if (!arr) return;
        var taken = 0;
        for (var j = 0; j < arr.length && taken < 2; j++) {
          var st = arr[j];
          if (stocks.length >= 6) break;
          if (seen[st.c]) continue;
          seen[st.c] = 1;
          stocks.push({ c: st.c, n: st.n, p: 1 });
          taken++;
        }
      });
    });

    var level = '中';
    if (POLICIES.test(text)) level = '高';
    if (HIGHKW.test(text)) level = '高';
    var direct = stocks.filter(function (s) { return !s.p; }).length;
    if (direct >= 3) level = '高';

    var bad = (text.match(BAD) || []).length;
    var good = (text.match(GOOD) || []).length;
    var dir = '中性';
    if (bad > good) dir = '利空'; else if (good > bad) dir = '利好';

    var out = {
      time: time, title: title, summary: summary, src: src, url: url,
      level: level, dir: dir, sectors: secNames, stocks: stocks, policy: POLICIES.test(text)
    };
    return out;
  }

  /* ---------- 原始资讯 ---------- */
  async function rawNews() {
    var out = [];
    var trace = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    var t1 = await getText('https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=100&req_trace=' + trace, 12000);
    if (t1) {
      try {
        var j1 = JSON.parse(t1);
        (j1.data && j1.data.fastNewsList ? j1.data.fastNewsList : []).forEach(function (x) {
          out.push({
            time: String(x.showTime || ''), title: String(x.title || ''), summary: String(x.summary || ''),
            src: '东财快讯', url: 'https://finance.eastmoney.com/a/' + String(x.code || '') + '.html', codes: x.stockList || []
          });
        });
      } catch (e) {}
    }
    var t2 = await getText('https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=50&zhibo_id=152&tag_id=0&dire=f&dpc=1', 12000);
    if (t2) {
      try {
        var j2 = JSON.parse(t2);
        var list = j2.result && j2.result.data && j2.result.data.feed ? j2.result.data.feed.list : [];
        (list || []).forEach(function (x) {
          var txt = String(x.rich_text || ''), url = '';
          try { var ext = JSON.parse(String(x.ext || '{}')); url = String(ext.docurl || ''); } catch (e) {}
          var title = txt, summary = '';
          var mm = txt.match(/^【([^】]+)】(.*)$/);
          if (mm) { title = mm[1]; summary = mm[2]; }
          else if (txt.length > 60) { title = txt.slice(0, 60) + '…'; summary = txt; }
          out.push({ time: String(x.create_time || ''), title: title, summary: summary, src: '新浪7x24', url: url, codes: [] });
        });
      } catch (e) {}
    }
    return out;
  }

  async function pool(force) {
    if (!force && poolCache && (Date.now() - poolCache.time) < 150000) return poolCache;
    var idx = await marketIndex();
    var raw = await rawNews();
    var list = [], seen = {};
    raw.forEach(function (r) {
      var key = String(r.title).split(' ').join('').replace(/[。，！？：]/g, '');
      if (key.length > 16) key = key.slice(0, 16);
      if (seen[key]) return;
      seen[key] = 1;
      list.push(buildItem(idx, r.time, r.title, r.summary, r.src, r.url, r.codes));
    });
    list.sort(function (a, b) { return String(b.time) < String(a.time) ? -1 : 1; });
    poolCache = { time: Date.now(), items: list };
    return poolCache;
  }

  /* ---------- 个股公告 / 搜索 / 个股资讯 ---------- */
  async function stockAnn(code, size) {
    var t = await getText('https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=' + (size || 20) + '&page_index=1&ann_type=A&client_source=web&stock_list=' + code, 12000);
    if (!t) return [];
    try {
      var j = JSON.parse(t);
      if (!j.success || !j.data) return [];
      return (j.data.list || []).map(function (x) {
        var col = '';
        if (x.columns && x.columns.length) col = String(x.columns[0].column_name || '');
        var d = String(x.notice_date || '');
        if (d.length >= 10) d = d.slice(0, 10);
        return { d: d, title: String(x.title || ''), col: col, url: 'https://data.eastmoney.com/notices/detail/' + code + '/' + String(x.art_code || '') + '.html' };
      });
    } catch (e) { return []; }
  }

  async function searchNews(kw, size) {
    var param = '{"uid":"","keyword":"' + kw + '","type":["cmsArticleWebOld"],"client":"web","clientType":"web","clientVersion":"curr","param":{"cmsArticleWebOld":{"searchScope":"default","sort":"default","pageIndex":1,"pageSize":' + (size || 20) + ',"preTag":"","postTag":""}}}';
    var t = await getText('https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=' + encodeURIComponent(param), 12000);
    if (!t) return [];
    var i = t.indexOf('('), j = t.lastIndexOf(')');
    if (i < 0 || j <= i) return [];
    var json = t.slice(i + 1, j);
    try {
      var o = JSON.parse(json);
      var arr = o.result && o.result.cmsArticleWebOld ? o.result.cmsArticleWebOld : [];
      return (arr || []).map(function (x) {
        return { d: String(x.date || ''), title: String(x.title || ''), summary: String(x.content || ''), media: String(x.mediaName || ''), url: String(x.url || '') };
      });
    } catch (e) { return []; }
  }

  async function forStock(code) {
    var idx = await marketIndex();
    var name = code;
    for (var k in idx.names) { if (idx.names[k] === code) { name = k; break; } }
    var ann = await stockAnn(code, 25);
    var news = [];
    if (name !== code) news = await searchNews(name, 24);
    var indName = '';
    Object.keys(idx.byInd).some(function (ind) {
      if (idx.byInd[ind].some(function (st) { return st.c === code; })) { indName = ind; return true; }
      return false;
    });
    var peers = [];
    if (indName && idx.byInd[indName]) {
      peers = idx.byInd[indName].slice(0, 8).map(function (x) { return { c: x.c, n: x.n }; });
    }
    return { ok: true, code: code, name: name, industry: indName, ann: ann, news: news, peers: peers };
  }

  async function feed(url, force) {
    var p = await pool(force === '1');
    var limit = 120, level = '', sector = '', q = '';
    limit = Number(url.searchParams.get('limit')) || 120;
    if (limit <= 0 || limit > 300) limit = 120;
    level = String(url.searchParams.get('level') || '').trim();
    sector = String(url.searchParams.get('sector') || '').trim();
    q = String(url.searchParams.get('q') || '').trim();
    var items = p.items.slice();
    if (level === 'high') items = items.filter(function (x) { return x.level === '高'; });
    else if (level === 'policy') items = items.filter(function (x) { return x.policy; });
    if (sector) items = items.filter(function (x) { return (x.sectors || []).join(',').indexOf(sector) >= 0; });
    if (q) items = items.filter(function (x) { return (x.title + x.summary).indexOf(q) >= 0; });
    var total = items.length;
    var d = new Date();
    var hh = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    return { ok: true, time: hh, total: total, items: items.slice(0, limit) };
  }

  root.NewsLayer = { feed: feed, forStock: forStock, search: searchNews, pool: pool, marketIndex: marketIndex };
})(typeof window !== 'undefined' ? window : globalThis);
