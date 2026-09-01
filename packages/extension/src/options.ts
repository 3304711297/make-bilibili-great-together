const el = document.getElementById('status')!;
// 命名空间双解析 browser ?? chrome：Edge（Chromium 系）不提供 browser.*，仅 chrome.*
const api = (globalThis as unknown as { browser?: MbgtExtensionApi; chrome?: MbgtExtensionApi }).browser
  ?? (globalThis as unknown as { chrome?: MbgtExtensionApi }).chrome;
if (!api) throw new Error('extension storage API unavailable (browser/chrome)');
api.storage.local.get('mbgt:compat:status').then(v => {
  const status = v['mbgt:compat:status'];
  el.textContent = status ? JSON.stringify(status, null, 2) : '尚未结算（访问一次 bilibili.com 后再打开本页）';
}).catch(e => { el.textContent = '读取失败: ' + String(e); });
