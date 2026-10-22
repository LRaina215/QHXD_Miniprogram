/**
 * 公网实链路（YUNTUO_TOKEN=<公网 Token> node tests/live.js [地址]，默认 https://lingxunrobot.cn）：
 * 小程序逻辑 -> 云端网关 -> RK3588 后端（板载 LLM）-> fpga_bridge。补 e2e.js 在本机模拟里测不到的部分：
 * 网关鉴权与白名单、板载大模型助手的时延与确认流程、公网 WebSocket 长连接稳定性。
 * 会下发运动指令：只在 FPGA 导航与控制都是模拟链路（mock）、当前无任务、未急停时运行；
 * 前置检查通过后，失败收尾才允许取消任务、解除急停；检查未通过时不操作设备。Token 只从环境变量读，不打印。
 */
const assert = require('assert');
const { wx, sim, storage, mount, tap, startApp, log } = require('./wx-sim');

const BASE = (process.argv[2] || 'https://lingxunrobot.cn').replace(/\/+$/, '');
const TOKEN = process.env.YUNTUO_TOKEN || '';
if (!TOKEN) {
  console.error('需要环境变量 YUNTUO_TOKEN');
  process.exit(2);
}
storage.set('yuntuo_base_url', BASE);
storage.set('yuntuo_public_api_token', TOKEN);

const calls = [];
const rawRequest = wx.request.bind(wx);
wx.request = (o) => {
  const t0 = Date.now();
  const rec = (status) => calls.push({ method: o.method || 'GET', path: o.url.replace(BASE, '').split('?')[0], status, ms: Date.now() - t0 });
  return rawRequest(Object.assign({}, o, {
    success: (r) => { rec(r.statusCode); if (o.success) o.success(r); },
    fail: (e) => { rec('fail'); if (o.fail) o.fail(e); }
  }));
};
const posts = (path) => calls.filter((c) => c.method === 'POST' && c.path === path);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 15000)) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  throw new Error('等待超时：' + what);
}
const t00 = Date.now();
const step = (s) => console.log(`· [${((Date.now() - t00) / 1000).toFixed(0)}s] ${s}`);
const notes = [];

let store;
let actions;
let controlChecksPassed = false;
async function cleanup() {
  if (!store || !controlChecksPassed) return;
  try {
    if (store.estopActive()) await require('../miniprogram/utils/api').estop(false);
    if (store.taskActive()) await actions.run('cancel', {});
  } catch (e) { /* 尽力而为 */ }
}

(async () => {
  startApp();
  store = require('../miniprogram/utils/store');
  actions = require('../miniprogram/utils/actions');
  const sock = { state: { open: 0, close: 0 }, navigation: { open: 0, close: 0 }, heartbeat: 0 };
  [['state', store.stateSocket], ['navigation', store.navSocket]].forEach(([k, s]) => {
    s.on('open', () => sock[k].open++);
    s.on('close', () => sock[k].close++);
    s.on('message', (m) => { if (m && m.type === 'heartbeat') sock.heartbeat++; });
  });

  step('连接与安全前提');
  await until('收到 RK3588 状态', () => store.conn.rk && store.state);
  await until('两条 WebSocket', () => store.stateSocket.connected && store.navSocket.connected);
  await until('点位', () => store.waypoints.length > 0);
  const p0 = store.platform() || {};
  assert.ok(p0.nav_link === 'mock' && p0.control_link === 'mock',
    `FPGA 不是模拟链路（nav=${p0.nav_link} control=${p0.control_link}），不在实车上跑运动测试`);
  assert.ok(!store.taskActive(), '当前有任务在执行，先不打扰：' + JSON.stringify(store.task()));
  assert.ok(!store.estopActive(), '当前处于急停');
  controlChecksPassed = true;

  const me = mount('pages/me/me');
  me.onShow();
  await me.onRecheck();
  const conn = Object.fromEntries(me.data.conn.map((c) => [c.k, c.v]));
  assert.strictEqual(conn['云端网关'], '在线');
  assert.strictEqual(conn['公网运动控制'], '已开放', '网关健康里的 public_control_enabled');
  me.onHide();

  step('助手：查询（板载大模型）');
  const chat = mount('pages/assistant/assistant');
  chat.onLoad();
  chat.onShow();
  let t = Date.now();
  await chat.ask('现在机器人状态怎么样');
  const queryMs = Date.now() - t;
  let last = chat.data.messages[chat.data.messages.length - 1];
  assert.strictEqual(last.role, 'bot', '查询应有回答：' + last.text);
  assert.ok(!chat.data.sheet.show, '查询不应弹确认');
  notes.push(`查询 ${(queryMs / 1000).toFixed(1)} s：「${last.text.slice(0, 40)}」(${last.meta || ''})`);

  step('助手：示例问句逐个过板载大模型（弹确认的点取消）');
  const expectSheet = { '找到红色水瓶并移动到它旁边': true, '跟着我': true, '去 B 点': true, '开始巡检': true, '暂停': false, '你是谁': false };
  const parseFails = [];
  for (const q of chat.data.examples) {
    t = Date.now();
    await chat.ask(q);
    const ms = Date.now() - t;
    last = chat.data.messages[chat.data.messages.length - 1];
    const shown = chat.data.sheet.show;
    notes.push(`「${q}」${(ms / 1000).toFixed(1)} s -> ${shown ? '确认：' + chat.data.sheet.title : last.text.slice(0, 30)}`);
    if (q in expectSheet && expectSheet[q] !== shown) parseFails.push(q);
    if (shown) {
      await chat.onSheetCancel();
      assert.ok(!chat.data.sheet.show, '取消确认失败：' + chat.data.sheet.error);
    }
  }

  step('助手：去 B 点 -> 确认执行');
  t = Date.now();
  await chat.ask('去 B 点');
  const motionMs = Date.now() - t;
  assert.ok(chat.data.sheet.show, '运动指令应弹出确认：' + chat.data.messages[chat.data.messages.length - 1].text);
  notes.push(`运动解析 ${(motionMs / 1000).toFixed(1)} s，确认后执行`);
  await chat.onSheetConfirm();
  assert.ok(!chat.data.sheet.show, '确认失败：' + chat.data.sheet.error);
  await until('定点任务执行中', () => store.task().task_type === 'go_to_waypoint' && store.task().state === 'running', 10000);
  await until('导航有目标', () => store.nav && store.nav.goal, 8000);

  step('总览：暂停 -> 继续');
  const home = mount('pages/home/home');
  home.onLoad();
  home.onShow();
  await until('总览显示任务', () => home.data.hero.canPause, 4000);
  await home.quick('pause');
  await until('暂停生效', () => store.task().state === 'paused', 8000);
  await until('可以继续', () => home.data.hero.canResume, 4000);
  home.onResume();
  assert.ok(home.data.sheet.show, '继续应弹确认');
  await home.onSheetConfirm();
  assert.ok(!home.data.sheet.show, '继续失败：' + home.data.sheet.error);
  await until('继续执行', () => store.task().state === 'running', 8000);

  step('急停（应走 /api/platform/estop）与解除');
  const fab = mount('components/estop-fab/estop-fab');
  fab.attached();
  await fab.onTap();
  await until('急停生效', () => store.estopActive(), 8000);
  assert.ok(posts('/api/platform/estop').some((c) => c.status === 200), '急停没有走 /api/platform/estop：' + JSON.stringify(calls.slice(-3)));
  await until('按钮变为解除', () => fab.data.active, 4000);
  sim.modalAnswer = true;
  fab.onTap();
  await until('急停解除', () => !store.estopActive(), 8000);
  fab.detached();

  step('任务页：取消');
  const mission = mount('pages/mission/mission');
  mission.onShow();
  if (store.taskActive()) {
    tap(mission, 'onCancel');
    await until('取消生效', () => !store.taskActive(), 8000);
  }
  await until('事件里有本次任务', () => store.events.some((e) => e.task_id === store.task().task_id), 10000);

  step('保持连接到 90 s，观察公网 WebSocket');
  while (Date.now() - t00 < 90000) await sleep(1000);
  assert.ok(store.stateSocket.connected && store.navSocket.connected, '结束时 WebSocket 应仍在线');

  [home, mission, chat].forEach((pg) => pg.onHide && pg.onHide());
  store.stop();

  console.log('\n结果');
  notes.forEach((n) => console.log('  ' + n));
  const byPath = {};
  calls.filter((c) => c.method === 'POST').forEach((c) => { (byPath[c.path] = byPath[c.path] || []).push(c.status + '/' + c.ms + 'ms'); });
  Object.keys(byPath).forEach((k) => console.log(`  POST ${k}  ${byPath[k].join(', ')}`));
  const fails = calls.filter((c) => c.status === 'fail' || c.status >= 400);
  console.log(`  请求共 ${calls.length} 个，失败 ${fails.length} 个${fails.length ? '：' + JSON.stringify(fails.slice(0, 5)) : ''}`);
  console.log(`  WebSocket state 连接 ${sock.state.open} 次 / 断开 ${sock.state.close} 次；navigation 连接 ${sock.navigation.open} 次 / 断开 ${sock.navigation.close} 次；心跳 ${sock.heartbeat} 条（${((Date.now() - t00) / 1000).toFixed(0)} s）`);
  console.log('  提示 ' + log.toasts.length + ' 条：' + log.toasts.join(' | '));
  if (parseFails.length) {
    console.log('\n控制链路通过；示例问句解析不符合预期：' + parseFails.join('、'));
    process.exit(1);
  }
  console.log('\n全部通过');
  process.exit(0);
})().catch(async (e) => {
  console.error('\n失败：' + (e && e.stack || e));
  notes.forEach((n) => console.error('  ' + n));
  console.error('最近请求：' + JSON.stringify(calls.slice(-6)));
  await cleanup();
  process.exit(1);
});
