/* 注册 Service Worker：只在 https 或 localhost 下生效（PWA 安装的硬要求） */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!secure) {
    console.log('[PWA] 当前不是 https，浏览器不允许安装到桌面；页面功能不受影响。');
    return;
  }
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      console.log('[PWA] Service Worker 已注册');
      reg.addEventListener('updatefound', function () { console.log('[PWA] 有新版本，刷新后生效'); });
    }).catch(function (e) {
      console.warn('[PWA] 注册失败', e);
    });
  });
})();
