const el = document.getElementById('status')!;
browser.storage.local.get('mbgt:compat:status').then(v => {
  const status = v['mbgt:compat:status'];
  el.textContent = status ? JSON.stringify(status, null, 2) : '尚未结算（访问一次 bilibili.com 后再打开本页）';
}).catch(e => { el.textContent = '读取失败: ' + String(e); });
