/** 相机错误与轮询生命周期回归：本地模拟，不访问网络、麦克风或设备。 */
const assert = require('assert');
const { wx, storage, mount } = require('./wx-sim');
const api = require('../miniprogram/utils/api');
const config = require('../miniprogram/utils/config');

const bytes = (text) => {
  const data = Buffer.from(text, 'utf8');
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const jpeg = new Uint8Array([255, 216, 255, 217]).buffer;
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const raw = { request: wx.request, getFrame: api.getLatestFrame, interval: global.setInterval, clear: global.clearInterval };
const timers = new Map();
let timerId = 0;
let page;

(async () => {
  for (const code of ['latest_frame_stale', 'latest_frame_not_found']) {
    wx.request = (options) => options.success({ statusCode: 404, data: bytes(JSON.stringify({
      error: code, detail: '诊断路径 /server/private/example.jpg，图片已过期'
    })) });
    const res = await api.getLatestFrame();
    assert.strictEqual(res.error, code);
    assert.ok(!api.explain(res.error).includes('/server/'), '页面不应展示服务器诊断路径');
  }
  wx.request = (options) => options.success({ statusCode: 401, data: { detail: 'unauthorized' } });
  assert.strictEqual((await api.getState()).error, 'unauthorized', '普通 JSON 错误保持兼容');
  wx.request = (options) => options.success({ statusCode: 200, data: jpeg });
  assert.strictEqual((await api.getLatestFrame()).data, jpeg, '成功图片保持二进制内容');
  console.log('  ✓ 图片 UTF-8 错误解析、中文提示与正常响应兼容');

  wx.request = () => { throw new Error('测试不应访问网络'); };
  global.setInterval = (fn) => { const id = ++timerId; timers.set(id, fn); return id; };
  global.clearInterval = (id) => timers.delete(id);
  page = mount('pages/home/home');
  let resolve;
  let calls = 0;
  api.getLatestFrame = () => { calls++; return new Promise((done) => { resolve = done; }); };
  page.startFrames();
  const oldTick = timers.get(page.frameTimer);
  oldTick(); oldTick();
  assert.strictEqual(calls, 1, '慢请求期间不应重叠拉取');
  page.stopFrames(); oldTick();
  assert.strictEqual(calls, 1, '停止后已排队的回调也不应继续请求');
  resolve({ ok: true, data: jpeg }); await flush();
  assert.strictEqual(page.data.frameSrc, '', '隐藏或离开相机后的迟到图片应丢弃');
  console.log('  ✓ 轮询不重叠，停止后的回调和迟到响应失效');

  api.getLatestFrame = async () => ({ ok: true, data: jpeg });
  page.startFrames(); await flush();
  const lastFrame = page.data.frameSrc;
  assert.ok(lastFrame.startsWith('data:image/jpeg;base64,'));
  api.getLatestFrame = async () => ({ ok: false, status: 404, error: 'latest_frame_stale' });
  timers.get(page.frameTimer)(); await flush();
  assert.strictEqual(page.data.frameSrc, lastFrame, '短暂失败时保留最后一帧');
  assert.strictEqual(page.data.frameStale, true, '最后一帧必须明确标记过期');
  assert.ok(page.data.frameMsg.includes('已过期'));
  api.getLatestFrame = async () => ({ ok: true, data: jpeg });
  timers.get(page.frameTimer)(); await flush();
  assert.strictEqual(page.data.frameStale, false, '新画面恢复时解除过期标记');
  page.stopFrames();
  console.log('  ✓ 保留最后一帧并标记过期，新画面恢复后清除标记');

  storage.set(config.BASE_URL_STORAGE_KEY, 'https://old.local-test.invalid');
  api.getLatestFrame = () => new Promise((done) => { resolve = done; });
  page.startFrames();
  storage.set(config.BASE_URL_STORAGE_KEY, 'https://new.local-test.invalid');
  resolve({ ok: true, data: jpeg }); await flush();
  assert.strictEqual(page.data.frameSrc, '', '旧地址的图片不能写入当前页面');
  page.setData({ frameSrc: 'old-server-image' });
  api.getLatestFrame = async () => ({ ok: false, error: 'latest_frame_not_found' });
  page.startFrames();
  assert.strictEqual(page.data.frameSrc, '', '重新进入相机时清除旧地址的画面');
  await flush();
  console.log('  ✓ 切换服务地址后清空旧画面并忽略旧响应');
  console.log('相机检查通过（纯本地模拟）');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (page) page.stopFrames();
  storage.delete(config.BASE_URL_STORAGE_KEY);
  wx.request = raw.request;
  api.getLatestFrame = raw.getFrame;
  global.setInterval = raw.interval;
  global.clearInterval = raw.clear;
});
