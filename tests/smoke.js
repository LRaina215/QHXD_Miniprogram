/**
 * 只读冒烟（node tests/smoke.js [地址]，默认 https://lingxunrobot.cn）：用真实数据层连一遍公网，
 * 检查小程序用到的每个读接口、两条 WebSocket、页面渲染，并标出后端缺哪些云拓字段。
 * 不发任何 POST，不需要 Token，可以随时对线上跑。
 */
const { storage, mount, startApp } = require('./wx-sim');

const BASE = process.argv[2] || 'https://lingxunrobot.cn';
storage.set('yuntuo_base_url', BASE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const mark = (ok, name, detail) => rows.push({ ok, name, detail: detail || '' });

(async () => {
  startApp();
  const api = require('../miniprogram/utils/api');
  const store = require('../miniprogram/utils/store');

  const reads = [
    ['网关健康', () => api.getGatewayHealth()],
    ['状态 /api/state/latest', () => api.getState()],
    ['导航 /api/navigation/latest', () => api.getNavigation()],
    ['地图元数据', () => api.getMapMetadata()],
    ['航点 /api/waypoints', () => api.getWaypoints()],
    ['任务事件', () => api.getTaskEvents(5)],
    ['告警', () => api.getAlerts()],
    ['相机帧 latest_frame', () => api.getLatestFrame()]
  ];
  let state = null;
  for (const [name, fn] of reads) {
    const t0 = Date.now();
    const res = await fn();
    const ms = Date.now() - t0;
    const data = res.data && res.data.data !== undefined ? res.data.data : res.data;
    if (name.startsWith('状态') && res.ok) state = data;
    let detail = res.ok ? ms + ' ms' : (res.status || '') + ' ' + api.explain(res.error);
    if (res.ok && name === '网关健康') detail += ` · rk_online=${data.rk_online} · public_control=${'public_control_enabled' in data ? data.public_control_enabled : '未知（旧网关只有 /health）'}`;
    if (res.ok && name.startsWith('相机')) detail += ' · ' + (res.data && res.data.byteLength ? res.data.byteLength + ' 字节' : '空');
    mark(res.ok, name, detail);
  }

  if (state) {
    ['platform_status', 'detection_status', 'task_status', 'nav_status'].forEach((k) => {
      mark(state[k] != null, '云拓字段 ' + k, state[k] != null ? '有' : '缺：后端可能还是旧版');
    });
  }

  for (let i = 0; i < 40 && !(store.conn.live && store.conn.navLive); i++) await sleep(250);
  mark(store.conn.live, 'WS /ws/state', store.conn.live ? '已连接' : '未连上（会回退轮询）');
  mark(store.conn.navLive, 'WS /ws/navigation', store.conn.navLive ? '已连接' : '未连上（会回退轮询）');

  const pages = ['pages/home/home', 'pages/mission/mission', 'pages/me/me'];
  for (const p of pages) {
    try {
      const page = mount(p);
      if (page.onLoad) await page.onLoad({});
      if (page.onShow) await page.onShow();
      await sleep(300);
      mark(true, '渲染 ' + p);
      if (page.onUnload) page.onUnload();
    } catch (e) {
      mark(false, '渲染 ' + p, e.message);
    }
  }

  store.stop();
  console.log('目标：' + BASE);
  rows.forEach((r) => console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.detail ? '  ' + r.detail : '')));
  const bad = rows.filter((r) => !r.ok).length;
  console.log(bad ? `\n${bad} 项未通过` : '\n全部通过');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
