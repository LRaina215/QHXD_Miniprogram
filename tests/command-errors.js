/** 命令异常场景：使用本地假响应和时钟，不连接公网、麦克风或硬件。 */
const assert = require('assert');
const { wx, storage, mount, log } = require('./wx-sim');
const api = require('../miniprogram/utils/api');
const config = require('../miniprogram/utils/config');
const store = require('../miniprogram/utils/store');
const actions = require('../miniprogram/utils/actions');
const confirmation = require('../miniprogram/utils/confirmation');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const ok = (data) => ({ ok: true, status: 200, data: { success: true, data } });
const candidate = (id = 'local-pending') => ok({
  reply_text: '请确认前往 B 点', recognized_text: '去 B 点', intent: 'go_to_waypoint', need_confirm: true,
  mission_candidate: { command: 'go_to_waypoint', pending_command_id: id, payload: { waypoint_id: 'wp_b' } }
});
let count = 0;
function pass(text) { count++; console.log('  ✓ ' + text); }
const raw = { request: wx.request, modal: wx.showModal, toast: wx.showToast, plugin: global.requirePlugin,
  authorize: wx.authorize, now: Date.now, timeout: global.setTimeout, clear: global.clearTimeout,
  smart: api.smartCommand, confirm: api.confirmCommand, mission: api.mission, estop: api.estop, mode: api.switchMode,
  run: actions.run, refresh: store.refresh };
const timers = new Map();
const pages = [];
const modals = [];
const toasts = [];
let nextTimer = 0;
let now = 1000;
let authorization;
const recorder = { starts: 0, stops: 0, start() { this.starts++; }, stop() { this.stops++; } };
function clock(ms) {
  now += ms;
  for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.fn();
}
function chat() { const p = mount('pages/assistant/assistant'); p.onLoad(); p.onShow(); pages.push(p); return p; }
function mission() { const p = mount('pages/mission/mission'); p.onShow(); pages.push(p); return p; }
function resetTask(state = 'idle', id = 'local-task') {
  store.state = { task_status: { task_id: id, state, task_type: 'go_to_waypoint', progress: 0 },
    device_status: { online: true, emergency_stop: false }, system_mode: { mode: 'mock' } };
}

(async () => {
  global.setTimeout = (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; };
  global.clearTimeout = (id) => timers.delete(id);
  Date.now = () => now;
  wx.showModal = (options) => modals.push(options);
  wx.showToast = (options) => toasts.push(options.title);
  global.requirePlugin = () => ({ getRecordRecognitionManager: () => recorder });
  wx.authorize = (options) => { authorization = options; };
  store.refresh = async () => {};
  store.waypoints = [{ waypoint_id: 'wp_b', name: 'B 点', configured: true, pose: { x: 1, y: 1 } }];
  resetTask();
  storage.set(config.BASE_URL_STORAGE_KEY, 'https://local-test.invalid');
  wx.request = () => { throw new Error('本地测试禁止访问网络'); };

  assert.strictEqual((await api.mission('pause', {})).error, 'missing_token');
  storage.set(config.TOKEN_STORAGE_KEY, 'local-test-token');
  wx.request = (o) => o.success({ statusCode: 401, data: '<html>denied</html>' });
  const denied = await api.mission('pause', {});
  assert.match(api.failureText(denied), /Token.*失效/);
  assert.strictEqual(storage.get(config.TOKEN_STORAGE_KEY), 'local-test-token', '鉴权失败不能静默删除用户配置');
  pass('缺少 Token 不发送请求，非标准 401 正确提示重新设置 Token');

  let calls = [];
  wx.request = (o) => calls.push(o);
  const first = api.mission('go_to_waypoint', { waypoint_id: 'wp_b' });
  const duplicate = api.mission('go_to_waypoint', { waypoint_id: 'wp_b' });
  const stop = api.estop(true);
  assert.strictEqual(calls.length, 2, '相同任务只发一次，急停仍独立立即发出');
  calls[0].fail({ errMsg: 'request:fail timeout' });
  calls[1].success({ statusCode: 200, data: { data: { accepted: true } } });
  const timedOut = await first;
  await Promise.all([duplicate, stop]);
  assert.strictEqual(timedOut.uncertain, true);
  assert.match(api.failureText(timedOut), /可能已被接收/);
  await flush();
  assert.strictEqual(calls.length, 2, '超时不能自动重试');
  pass('重复提交合并、急停不排队、写请求超时保留结果未知且不重试');

  wx.request = (o) => o.fail({ errMsg: 'request:fail network unavailable' });
  assert.strictEqual((await api.getState()).uncertain, false);
  assert.strictEqual((await api.mission('pause', {})).uncertain, true);
  wx.request = (o) => o.success({ statusCode: 502, data: {} });
  assert.strictEqual((await api.mission('pause', {})).uncertain, true);
  wx.request = () => { throw new Error('本地同步异常'); };
  assert.strictEqual((await api.mission('pause', {})).ok, false, '请求封装必须 resolve，不能卡住页面锁');
  wx.request = () => { throw new Error('本地测试禁止访问网络'); };
  pass('断网、网关故障和同步异常均正常结束请求；读写结果区别处理');

  api.mission = async () => ok({ accepted: false, detail: '当前任务不允许执行' });
  assert.strictEqual((await actions.run('resume', {})).ok, false);
  api.mission = async () => ok({});
  assert.strictEqual((await actions.run('resume', {})).uncertain, true);
  api.mission = async () => ({ ok: true, status: 200, data: null });
  assert.strictEqual((await actions.run('resume', {})).uncertain, true);
  pass('HTTP 成功但任务被拒绝或响应缺少受理字段时，不显示执行成功');
  api.mission = raw.mission;

  let p = chat();
  const slow = deferred();
  api.smartCommand = () => slow.promise;
  const ask = p.ask('去 B 点');
  p.setData({ text: '保留这段输入' });
  p.onSend();
  assert.strictEqual(p.data.text, '保留这段输入');
  p.onHide(); p.onShow();
  slow.resolve(candidate()); await ask;
  assert.strictEqual(p.data.sheet.show, false);
  assert.strictEqual(p.data.thinking, false);
  assert.strictEqual(p.data.messages.length, 1, '迟到回复不能重新弹确认或写入旧回复');
  pass('请求中再次发送保留草稿；切页再返回后迟到助手回复失效');

  api.smartCommand = async () => candidate();
  await p.ask('去 B 点');
  const original = p.pending;
  p.setData({ text: '跟着我' }); p.onSend();
  assert.strictEqual(p.pending, original);
  assert.strictEqual(p.data.text, '跟着我');
  let confirms = 0;
  const waiting = deferred();
  api.confirmCommand = () => { confirms++; return waiting.promise; };
  const confirmed = p.onSheetConfirm();
  await p.onSheetConfirm(); await p.onSheetCancel();
  assert.strictEqual(confirms, 1);
  waiting.resolve(ok({ accepted: true, detail: '已受理' })); await confirmed;
  assert.strictEqual(p.data.sheet.show, false);
  assert.strictEqual(p._confirmationRequest, null);
  pass('待确认命令不被新输入覆盖，确认与取消竞态只发送一次');

  await p.ask('去 B 点');
  clock(30000);
  await p.onSheetConfirm();
  assert.strictEqual(confirms, 1);
  assert.strictEqual(p.data.sheet.show, false);
  assert.ok(toasts.some((s) => /确认已过期/.test(s)));
  pass('本地确认窗口过期后关闭面板，旧点击不再发送命令');

  await p.ask('去 B 点');
  p.onHide(); p.onShow();
  await p.onSheetConfirm();
  assert.strictEqual(confirms, 1);
  await p.ask('去 B 点');
  storage.set(config.TOKEN_STORAGE_KEY, 'changed-local-token');
  await p.onSheetConfirm();
  assert.strictEqual(confirms, 1);
  await p.ask('去 B 点');
  storage.set(config.BASE_URL_STORAGE_KEY, 'https://other-local.invalid');
  await p.onSheetConfirm();
  assert.strictEqual(confirms, 1);
  pass('离开页面、更换 Token 或服务器后，旧确认均不能发送');

  await p.ask('去 B 点');
  api.confirmCommand = async () => ok({ accepted: false, detail: '待确认命令不存在或已过期，未触发任务。' });
  await p.onSheetConfirm();
  assert.strictEqual(p.data.sheet.show, false);
  assert.match(p.data.messages.at(-1).text, /过期/);
  assert.strictEqual(p.data.messages.at(-1).role, 'sys');
  await p.ask('去 B 点');
  api.confirmCommand = async () => ({ ok: false, uncertain: true });
  await p.onSheetConfirm();
  assert.strictEqual(p.pending, null);
  assert.match(p.data.messages.at(-1).text, /结果未确认/);
  pass('后端过期拒绝清除旧确认；确认超时关闭重试入口并提示结果未知');

  const stale = deferred();
  api.smartCommand = () => stale.promise;
  const old = p.ask('去 B 点');
  storage.set(config.TOKEN_STORAGE_KEY, 'next-local-token');
  stale.resolve(candidate()); await old;
  assert.strictEqual(p.data.sheet.show, false);
  assert.strictEqual(p.data.thinking, false);
  api.smartCommand = async () => { throw new Error('本地故障'); };
  await p.ask('你是谁');
  assert.strictEqual(p.data.thinking, false);
  assert.strictEqual(p._askRequest, null);
  api.smartCommand = async () => ({ ok: true, status: 200, data: null });
  await p.ask('你是谁');
  assert.match(p.data.messages.at(-1).text, /结果未确认/);
  pass('鉴权上下文变化或异常抛出后，不产生旧确认且结束等待状态');

  api.smartCommand = async () => candidate();
  p.onTalkStart(); p.onTalkEnd(); authorization.success();
  assert.strictEqual(recorder.starts, 0, '授权返回前松手不能留下后台录音');
  p.onTalkStart(); authorization.success();
  assert.strictEqual(recorder.starts, 1);
  const beforeHide = p.data.messages.length;
  p.onHide(); p.onShow();
  p.onTalkStart();
  assert.strictEqual(recorder.starts, 1, '旧停止回调返回前不能开始新录音');
  recorder.onStop({ result: '去 B 点。' });
  await flush();
  assert.strictEqual(p.data.messages.length, beforeHide);
  assert.strictEqual(p.data.recording, false);
  pass('授权迟到不启动录音，离开页面停止并丢弃旧识别结果');

  p.onTalkStart(); authorization.success(); p.onTalkEnd();
  recorder.onStop({ result: '去 B 点。' }); await flush();
  assert.strictEqual(p.data.sheet.show, true);
  const decisions = [];
  api.confirmCommand = async (id, accepted) => { decisions.push({ id, accepted }); return ok({ accepted: false, detail: '待确认命令已取消' }); };
  await p.onSheetCancel();
  assert.deepStrictEqual(decisions, [{ id: 'local-pending', accepted: false }]);
  assert.strictEqual(p.pending, null);
  pass('正常按住松开仍可识别并打开确认，取消只发送否定决定');

  await p.ask('去 B 点');
  const hiddenConfirm = deferred();
  api.confirmCommand = () => hiddenConfirm.promise;
  const oldConfirmation = p.onSheetConfirm();
  const messageCount = p.data.messages.length;
  p.onHide(); p.onShow();
  hiddenConfirm.resolve(ok({ accepted: true, detail: '已受理' })); await oldConfirmation;
  assert.strictEqual(p.data.messages.length, messageCount);
  assert.strictEqual(p._confirmationRequest, null);
  pass('确认已发出后离开页面，不将迟到受理结果写回旧对话');

  const m = mission();
  const h = mount('pages/home/home');
  confirmation.show(h); pages.push(h);
  for (const page of [m, h]) {
    const queued = deferred(); let writes = 0;
    actions.run = () => { writes++; return queued.promise; };
    page.ask('go_to_waypoint', { waypoint_id: 'wp_b' });
    const sending = page.onSheetConfirm();
    await page.onSheetConfirm();
    assert.strictEqual(writes, 1);
    if (page === m) page.onHide(); else confirmation.leave(page);
    queued.resolve({ ok: true, detail: '已受理' }); await sending;
    clock(700);
    assert.strictEqual(page.data.sheet.show, false);
  }
  assert.strictEqual(modals.filter((x) => x.title === '任务已受理').length, 0);
  pass('总览与任务页防止重复确认，隐藏后的响应不弹窗或把用户切回首页');

  m.onShow();
  actions.run = async () => ({ ok: true, detail: '已受理' });
  m.ask('go_to_waypoint', { waypoint_id: 'wp_b' });
  await m.onSheetConfirm();
  assert.strictEqual(m.data.sheet.show, false);
  const tabChanges = log.switchTab.length;
  m.onHide(); clock(700);
  assert.strictEqual(log.switchTab.length, tabChanges);
  pass('正常任务受理后关闭面板；随后离开页面取消尚未发生的自动跳转');

  m.onShow();
  actions.run = async () => ({ ok: false, uncertain: true, detail: '请求结果未确认' });
  m.ask('go_to_waypoint', { waypoint_id: 'wp_b' });
  await m.onSheetConfirm();
  assert.strictEqual(m.pending, null);
  assert.strictEqual(modals.at(-1).title, '执行结果未确认');
  resetTask('paused', 'original-task');
  m.ask('resume', {});
  resetTask('paused', 'replacement-task');
  let resumed = 0; actions.run = async () => { resumed++; return { ok: true, detail: '已受理' }; };
  await m.onSheetConfirm();
  assert.strictEqual(resumed, 0);
  pass('任务提交超时不保留一键重试，旧继续确认不能作用到新任务');

  m.setData({ hero: { canCancel: true } });
  m.onCancel(); m.onCancel();
  const cancelModal = modals.at(-1);
  resetTask('running', 'another-task');
  await cancelModal.success({ confirm: true });
  assert.strictEqual(resumed, 0, '取消弹窗不能取消后来替换的任务');
  pass('取消弹窗只保留一个，确认前任务已变更则不发送取消');

  resetTask();
  const me = mount('pages/me/me'); me.onShow(); pages.push(me);
  const modePending = deferred(); let modes = 0;
  api.switchMode = () => { modes++; return modePending.promise; };
  const switching = me.onMode({ currentTarget: { dataset: { mode: 'real' } } });
  await me.onMode({ currentTarget: { dataset: { mode: 'real' } } });
  assert.strictEqual(modes, 1);
  modePending.resolve({ ok: false, uncertain: true }); await switching;
  assert.strictEqual(me.modeRequest, null);
  assert.strictEqual(modals.at(-1).title, '切换结果未确认');
  pass('运行模式切换防重入，超时释放等待并明确结果未知');

  let hiddenWrites = 0;
  actions.run = async () => { hiddenWrites++; return { ok: true, detail: '已受理' }; };
  m.onHide(); confirmation.leave(h); me.onHide();
  m.setData({ hero: { canPause: true, canCancel: true } });
  const modalCount = modals.length;
  await m.onPause(); m.onCancel(); await h.quick('pause');
  await me.onMode({ currentTarget: { dataset: { mode: 'real' } } });
  assert.strictEqual(hiddenWrites, 0);
  assert.strictEqual(modes, 1);
  assert.strictEqual(modals.length, modalCount);
  pass('页面隐藏后排队到达的暂停、取消和模式事件不再发起操作');

  const fab = mount('components/estop-fab/estop-fab'); fab.attached();
  api.estop = async () => ({ ok: false, status: 404, error: 'not_in_public_whitelist' });
  let fallback = 0;
  api.mission = async () => { fallback++; return ok({ accepted: false, detail: '取消被拒绝' }); };
  const toastCount = toasts.length;
  await fab.send(true);
  assert.strictEqual(fallback, 1);
  assert.strictEqual(toasts.length, toastCount, '取消被拒绝不能报告停车成功');
  assert.match(modals.at(-1).content, /取消被拒绝/);
  const lateEstop = deferred(); api.estop = () => lateEstop.promise;
  const stopRequest = fab.send(true);
  storage.set(config.BASE_URL_STORAGE_KEY, 'https://new-local.invalid');
  lateEstop.resolve({ ok: false, status: 404 }); await stopRequest;
  assert.strictEqual(fallback, 1, '旧服务器响应不能向新服务器追加取消');
  fab.detached();
  pass('急停兼容路径不把拒绝当停车成功，也不跨服务器发送取消');

  console.log('命令异常检查通过：' + count + ' 组（全部本地模拟）');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  pages.forEach((p) => { if (p.onHide) p.onHide(); else confirmation.leave(p); });
  Object.assign(api, { smartCommand: raw.smart, confirmCommand: raw.confirm, mission: raw.mission, estop: raw.estop, switchMode: raw.mode });
  Object.assign(wx, { request: raw.request, showModal: raw.modal, showToast: raw.toast, authorize: raw.authorize });
  actions.run = raw.run; store.refresh = raw.refresh;
  global.requirePlugin = raw.plugin; global.setTimeout = raw.timeout; global.clearTimeout = raw.clear; Date.now = raw.now;
  storage.clear();
});
