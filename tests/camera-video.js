/** New video session and page lifecycle checks; fake clock and media only. */
const assert = require('assert');
const { storage, mount } = require('./wx-sim');
const api = require('../miniprogram/utils/api');
const config = require('../miniprogram/utils/config');
const CameraVideo = require('../miniprogram/utils/cameraVideo');
const raw = { now: Date.now, interval: global.setInterval, clear: global.clearInterval, session: api.createVideoSession, frame: api.getLatestFrame };
const timers = new Map();
let now = 1000000, timerId = 0, video, page, calls = 0;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const result = () => ({ ok: true, data: { success: true, data: {
  protocol: 'hls', expires_in: 600,
  playback_url: '/api/video/miniprogram/hls/2000000000.' + 'a'.repeat(64) + '/robot/front/index.m3u8'
} } });
const fresh = () => {
  if (video) video.stop();
  storage.clear();
  storage.set(config.TOKEN_STORAGE_KEY, 'fake-test-token');
  calls = 0;
  api.createVideoSession = async () => { calls++; return result(); };
  video = new CameraVideo(() => {});
  return video;
};

(async () => {
  Date.now = () => now;
  global.setInterval = (fn) => { const id = ++timerId; timers.set(id, fn); return id; };
  global.clearInterval = (id) => timers.delete(id);

  fresh(); storage.clear(); video.start(); await flush();
  assert.equal(calls, 0); assert.equal(video.state.mode, 'image');
  assert.match(video.state.hint, /Token/);
  storage.set(config.TOKEN_STORAGE_KEY, 'fake-test-token'); video.tick(); await flush();
  assert.equal(calls, 1); assert.ok(video.state.src.startsWith(config.baseUrl() + '/api/video/'));
  assert.ok(!video.state.src.includes('fake-test-token'));
  console.log('  ✓ 无 Token 保留图片；设置后获取同源限时视频地址');

  const ticket = video.state.ticket;
  video.progress(ticket - 1, 1); assert.equal(video.state.mode, 'connecting');
  video.progress(ticket, 0); assert.equal(video.state.mode, 'connecting');
  video.progress(ticket, 1); assert.equal(video.state.mode, 'video');
  now += 8001; video.progress(ticket, 1); video.tick();
  assert.equal(video.state.mode, 'image'); assert.equal(video.state.src, '');
  now += 5000; video.tick(); await flush(); assert.equal(calls, 2);
  video.progress(ticket, 100); assert.equal(video.state.mode, 'connecting');
  console.log('  ✓ 确认播放进度后才显示视频；卡帧回退，迟到事件不复活旧播放');

  fresh(); api.createVideoSession = async () => { calls++; return { ok: false, status: 401, error: 'unauthorized' }; };
  video.start(); await flush(); now += 120000; video.tick(); await flush();
  assert.equal(calls, 1); assert.equal(video.state.mode, 'image');
  assert.match(video.state.hint, /Token/);
  console.log('  ✓ 鉴权拒绝不持续重试，保留图片与明确提示');

  fresh(); let resolve;
  api.createVideoSession = () => { calls++; return new Promise((done) => { resolve = done; }); };
  video.start(); video.retry(); video.tick(); assert.equal(calls, 1);
  video.stop(); resolve(result()); await flush();
  assert.equal(video.state.src, ''); assert.equal(video.timer, null);
  console.log('  ✓ 会话慢请求不重叠；离开后的响应与计时器失效');

  fresh(); video.start(); await flush();
  const original = video.state.ticket;
  video.progress(original, 1);
  now += 570001; video.tick(); await flush();
  assert.equal(calls, 2); assert.notEqual(video.state.ticket, original);
  video.failed(original); assert.ok(video.state.src);
  video.progress(video.state.ticket, 1); assert.equal(video.state.mode, 'video');
  console.log('  ✓ 会话到期前续期，旧播放器事件不影响新播放器');

  fresh(); const pending = [];
  api.createVideoSession = () => new Promise((done) => pending.push(done));
  video.start(); storage.set(config.BASE_URL_STORAGE_KEY, 'https://new.invalid');
  pending[0](result()); await flush(); assert.equal(video.state.src, '');
  video.tick(); pending[1](result()); await flush();
  assert.ok(video.state.src.startsWith('https://new.invalid/'));
  storage.set(config.TOKEN_STORAGE_KEY, 'other-fake-token'); video.tick();
  assert.equal(video.state.src, ''); pending[2](result()); await flush();
  assert.ok(video.state.src.startsWith('https://new.invalid/'));
  console.log('  ✓ 地址与 Token 变化销毁旧播放，旧会话不能写回新连接');

  fresh(); api.createVideoSession = async () => {
    const bad = result(); bad.data.data.playback_url = 'https://other.invalid/movie.m3u8'; return bad;
  };
  video.start(); await flush(); assert.equal(video.state.mode, 'image'); assert.equal(video.state.src, '');
  console.log('  ✓ 不接受跨站播放地址，不把长期 Token 交给播放器');

  fresh(); video.stop();
  api.getLatestFrame = async () => ({ ok: true, data: new Uint8Array([255, 216, 255, 217]).buffer });
  page = mount('pages/home/home'); page.setData({ stageView: 'cam' });
  page.startCamera(); await flush();
  assert.ok(page.frameTimer); assert.ok(page.data.frameSrc);
  const player = page.data.video.ticket;
  page.onCameraProgress({ currentTarget: { dataset: { ticket: player } }, detail: { currentTime: 1 } });
  assert.equal(page.frameTimer, null); assert.equal(page.data.video.mode, 'video');
  page.onCameraError({ currentTarget: { dataset: { ticket: player } } }); await flush();
  assert.ok(page.frameTimer); assert.equal(page.data.video.mode, 'image');
  page.onHide(); assert.equal(page.frameTimer, null); assert.equal(page.cameraVideo.timer, null);
  assert.deepEqual(page.data.videoPlayers, []);
  assert.equal(timers.size, 0);
  console.log('  ✓ 页面播放成功后停止取图，失败恢复取图，隐藏后销毁全部播放器与计时器');
  console.log('连续视频检查通过（8 组本地模拟，无网络或设备控制）');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  if (page) page.stopCamera();
  if (video) video.stop();
  storage.clear(); Date.now = raw.now;
  global.setInterval = raw.interval; global.clearInterval = raw.clear;
  api.createVideoSession = raw.session; api.getLatestFrame = raw.frame;
});
