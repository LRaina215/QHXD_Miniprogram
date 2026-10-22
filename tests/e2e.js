/**
 * 端到端（node tests/e2e.js [后端地址]）：用 wx-sim 跑真实小程序逻辑，连本机的
 * 云拓后端 + fpga_bridge + mock_fpga（QHXD_Web: scripts/start_yuntuo_sim.sh），后端需处于实车（real）模式。
 * 流程：实时推送 -> 总览渲染 -> 语音「找到红色水瓶」确认执行到完成 -> 定点 B 点 -> 按住说话「暂停」-> 急停与解除 -> 我的页。
 */
const assert = require('assert');
const { sim, storage, mount, tap, startApp, log } = require('./wx-sim');

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
storage.set('yuntuo_base_url', BASE);
storage.set('yuntuo_public_api_token', 'local-test-token');

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
const step = (s) => console.log('· ' + s);

(async () => {
  startApp();
  const store = require('../miniprogram/utils/store');

  step('实时推送与状态');
  await until('收到 RK3588 状态', () => store.conn.rk && store.state);
  await until('WebSocket 已连接', () => store.stateSocket.connected && store.navSocket.connected);
  assert.strictEqual(store.isMock(), false, '后端应处于实车（real）模式');
  await until('点位', () => store.waypoints.length >= 4);
  await until('导航快照', () => store.nav && store.nav.pose);
  if (store.taskActive()) {
    await require('../miniprogram/utils/actions').run('cancel', {});
    await until('任务空闲', () => !store.taskActive(), 8000);
  }

  step('总览页');
  const home = mount('pages/home/home');
  home.onLoad();
  home.onShow();
  assert.ok(home.data.navHeight > 30, '自定义导航栏高度');
  const links = Object.fromEntries(home.data.links.map((l) => [l.key, l.value]));
  assert.strictEqual(links.rk, '在线');
  assert.strictEqual(links.nav, '模拟');
  assert.ok(home.data.hud.length === 3 && home.data.hud[1].v !== '--', '位姿 HUD');
  assert.ok(['空闲', '到达'].indexOf(home.data.platform.state) >= 0, 'FPGA 状态 ' + home.data.platform.state);

  step('助手：找到红色水瓶 -> 确认 -> 完成');
  const chat = mount('pages/assistant/assistant');
  chat.onLoad();
  chat.onShow();
  await chat.ask('找到红色水瓶并移动到它旁边');
  assert.ok(chat.data.sheet.show, '应弹出运动确认');
  assert.ok(chat.data.sheet.title.indexOf('红色水瓶') >= 0, chat.data.sheet.title);
  await chat.onSheetConfirm();
  assert.ok(!chat.data.sheet.show, "确认失败：" + chat.data.sheet.error);
  const last = chat.data.messages[chat.data.messages.length - 1];
  assert.ok(/红色水瓶/.test(last.text), last.text);
  await until('寻找任务开始', () => store.task() && store.task().task_type === 'search_target', 6000);
  await until('首页显示寻找任务', () => home.data.hero.title === '寻找「红色水瓶」', 6000);
  await until('找到并停在红瓶旁', () => store.task().state === 'completed', 60000);
  assert.strictEqual(home.data.hero.stateText, '已完成');
  await until('事件里有到达', () => store.events.some((e) => /红色水瓶/.test(e.detail) && e.event_type === 'arrived'), 10000);
  await until('首页动态', () => home.data.events.length > 0, 8000);

  step('任务页：定点 B 点');
  const mission = mount('pages/mission/mission');
  mission.onShow();
  assert.ok(mission.data.points.length >= 4, '点位列表');
  tap(mission, 'onTab', { tab: 'goto' });
  tap(mission, 'onPoint', { id: 'wp_b' });
  assert.strictEqual(mission.data.selectedName, 'B 点（斜坡区）');
  mission.onGoto();
  assert.ok(mission.data.sheet.show && mission.data.sheet.title.indexOf('B 点') >= 0, mission.data.sheet.title);
  await mission.onSheetConfirm();
  assert.ok(!mission.data.sheet.show, '确认后面板关闭：' + mission.data.sheet.error);
  await until('定点任务执行中', () => store.task().task_type === 'go_to_waypoint' && store.task().state === 'running', 6000);
  await until('任务页显示进行中', () => mission.data.hero.active, 4000);

  step('助手：按住说话「暂停」');
  sim.sttText = '暂停';
  chat.onTalkStart();
  await sleep(50);
  assert.ok(chat.data.recording, '应进入录音');
  chat.onTalkEnd();
  await until('暂停生效', () => store.task().state === 'paused', 8000);
  tap(mission, 'onCancel');
  await until('取消生效', () => store.task().state === 'cancelled', 8000);

  step('急停与解除');
  const fab = mount('components/estop-fab/estop-fab');
  fab.attached();
  await fab.onTap();
  await until('急停生效', () => store.estopActive(), 6000);
  await until('按钮变为解除', () => fab.data.active, 4000);
  sim.modalAnswer = true;
  fab.onTap();
  await until('急停解除', () => !store.estopActive(), 8000);

  step('我的页');
  const me = mount('pages/me/me');
  me.onShow();
  await me.onRecheck();
  const conn = Object.fromEntries(me.data.conn.map((c) => [c.k, c.v]));
  assert.strictEqual(conn['RK3588'], '在线');
  assert.strictEqual(conn['实时推送'], 'WebSocket');
  assert.strictEqual(me.data.mode, 'real');
  me.onTokenInput({ detail: { value: 'abc' } });
  me.onSaveToken();
  assert.strictEqual(storage.get('yuntuo_public_api_token'), 'abc');
  me.onClearToken();
  assert.ok(!storage.has('yuntuo_public_api_token'));
  storage.set('yuntuo_public_api_token', 'local-test-token');

  [home, mission, me].forEach((p) => p.onHide());
  fab.detached();
  require('fs').writeFileSync(require('path').join(__dirname, 'preview', 'snapshot.json'), JSON.stringify({
    store: { state: store.state, nav: store.nav, mapMeta: store.mapMeta, waypoints: store.waypoints, trail: store.trail, events: store.events },
    pages: { home: home.data, mission: mission.data, assistant: chat.data, me: me.data }
  }, null, 1));
  store.stop();
  console.log('\n全部通过；提示 ' + log.toasts.length + ' 条，弹窗 ' + log.modals.length + ' 个');
  process.exit(0);
})().catch((e) => {
  console.error('\n失败：' + (e && e.stack || e));
  process.exit(1);
});
