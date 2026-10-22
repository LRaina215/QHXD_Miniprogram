/**
 * 最小 wx 运行时（Node 18+，无依赖）：用真实 HTTP / WebSocket 跑小程序的 JS 逻辑，供 e2e.js 与预览使用。
 * 只模拟本项目用到的 API；Page/Component 定义被收集起来，由 mount() 实例化并驱动生命周期。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'miniprogram');
const log = { toasts: [], modals: [], switchTab: [], clipboard: [] };
const storage = new Map();
const defs = { pages: {}, components: {} };
let currentFile = '';
let appInstance = null;

const sim = {
  modalAnswer: true,      // showModal 自动点"确认"
  sttText: '暂停',        // 同声传译识别结果
  log
};

function setByPath(obj, keyPath, value) {
  const parts = keyPath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function socketTask(url) {
  const ws = new WebSocket(url);
  const h = { open: [], message: [], error: [], close: [] };
  ws.onopen = () => h.open.forEach((f) => f({}));
  ws.onmessage = (e) => h.message.forEach((f) => f({ data: e.data }));
  ws.onerror = () => h.error.forEach((f) => f({ errMsg: 'ws error' }));
  ws.onclose = () => h.close.forEach((f) => f({}));
  return {
    onOpen: (f) => h.open.push(f),
    onMessage: (f) => h.message.push(f),
    onError: (f) => h.error.push(f),
    onClose: (f) => h.close.push(f),
    send: ({ data }) => { if (ws.readyState === 1) ws.send(data); },
    close: () => { try { ws.close(); } catch (e) { /* ignore */ } }
  };
}

const wx = {
  getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
  setStorageSync: (k, v) => storage.set(k, JSON.parse(JSON.stringify(v))),
  removeStorageSync: (k) => storage.delete(k),
  request(opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 8000);
    const init = { method: opts.method || 'GET', headers: opts.header || {}, signal: ctrl.signal };
    if (opts.data !== undefined && init.method !== 'GET') init.body = typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data);
    fetch(opts.url, init).then(async (res) => {
      clearTimeout(timer);
      let data;
      if (opts.responseType === 'arraybuffer') data = await res.arrayBuffer();
      else {
        const text = await res.text();
        try { data = JSON.parse(text); } catch (e) { data = text; }
      }
      opts.success && opts.success({ statusCode: res.status, data, header: {} });
    }).catch((err) => {
      clearTimeout(timer);
      opts.fail && opts.fail({ errMsg: 'request:fail ' + (err.name === 'AbortError' ? 'timeout' : err.message) });
    });
  },
  downloadFile(opts) {
    fetch(opts.url).then(async (res) => {
      const file = path.join(os.tmpdir(), 'wxsim-' + Date.now() + '.png');
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      opts.success && opts.success({ statusCode: res.status, tempFilePath: file });
    }).catch(() => opts.fail && opts.fail({ errMsg: 'downloadFile:fail' }));
  },
  connectSocket: (opts) => socketTask(opts.url),
  arrayBufferToBase64: (buf) => Buffer.from(buf).toString('base64'),
  showToast: (o) => log.toasts.push(o.title),
  showLoading() {}, hideLoading() {}, vibrateShort() {}, stopPullDownRefresh() {}, previewImage() {},
  showModal(o) {
    log.modals.push(o.title);
    setTimeout(() => o.success && o.success({ confirm: sim.modalAnswer, cancel: !sim.modalAnswer }), 0);
  },
  authorize: (o) => setTimeout(() => o.success && o.success({}), 0),
  openSetting() {},
  setClipboardData: (o) => log.clipboard.push(o.data),
  switchTab: (o) => log.switchTab.push(o.url),
  getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 390, windowHeight: 844, pixelRatio: 3 }),
  getSystemInfoSync: () => ({ statusBarHeight: 44, windowWidth: 390, windowHeight: 844, pixelRatio: 3 }),
  getMenuButtonBoundingClientRect: () => ({ top: 50, height: 32, left: 301, width: 87 }),
  createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: (cb) => cb([null]) }) }) }),
  createOffscreenCanvas: () => { throw new Error('no canvas in node'); }
};

global.wx = wx;
global.App = (def) => { appInstance = def; };
global.getApp = () => appInstance;
global.Page = (def) => { defs.pages[currentFile] = def; };
global.Component = (def) => { defs.components[currentFile] = def; };
global.requirePlugin = () => ({
  getRecordRecognitionManager() {
    const m = {
      start() { m.started = true; },
      stop() { setTimeout(() => m.onStop && m.onStop({ result: sim.sttText + '。' }), 0); }
    };
    return m;
  }
});

function load(rel) {
  currentFile = rel;
  require(path.join(ROOT, rel));
  return defs.pages[rel] || defs.components[rel];
}

/** 实例化页面：data 深拷贝，setData 支持路径键，方法绑定到实例 */
function mount(rel) {
  const def = load(rel + '.js');
  const isComponent = !!defs.components[rel + '.js'];
  const inst = {
    route: rel,
    data: JSON.parse(JSON.stringify(def.data || {})),
    setData(patch, cb) {
      Object.keys(patch).forEach((k) => setByPath(this.data, k, JSON.parse(JSON.stringify(patch[k] === undefined ? null : patch[k]))));
      if (cb) cb();
    },
    triggerEvent(name, detail) { (this.events = this.events || []).push({ name, detail }); }
  };
  const methods = isComponent ? Object.assign({}, def.methods) : def;
  Object.keys(methods).forEach((k) => {
    if (typeof methods[k] === 'function') inst[k] = methods[k].bind(inst);
    else if (k !== 'data' && !isComponent) inst[k] = methods[k];
  });
  if (isComponent) {
    Object.keys(def.properties || {}).forEach((k) => { inst.data[k] = def.properties[k].value; });
    const life = def.lifetimes || {};
    Object.keys(life).forEach((k) => { inst[k] = life[k].bind(inst); });
  }
  return inst;
}

function tap(inst, method, dataset) {
  return inst[method]({ currentTarget: { dataset: dataset || {} }, detail: {} });
}

function startApp() {
  load('app.js');
  appInstance.onLaunch && appInstance.onLaunch();
  appInstance.onShow && appInstance.onShow();
  return appInstance;
}

module.exports = { wx, sim, storage, mount, tap, load, startApp, ROOT, log };
