const view = require('../../utils/view');
const actions = require('../../utils/actions');
const fieldMap = require('../../utils/fieldMap');
const api = require('../../utils/api');
const config = require('../../utils/config');
const confirmation = require('../../utils/confirmation');

const store = require('../../utils/store');

Page({
  data: {
    navTop: 20,
    navHeight: 44,
    capsuleGap: 100,
    links: [],
    banner: '',
    bannerTone: 'off',
    hero: view.hero(store),
    hud: [],
    platform: view.platform(store),
    objects: { meta: '', items: [], locked: false },
    events: [],
    stageView: 'map',
    mapCtx: '无先验图 · 里程计坐标系',
    frameSrc: '',
    frameMsg: '正在获取相机画面…',
    frameStale: false,
    sheet: { show: false, title: '', rows: [], loading: false, error: '' }
  },

  onLoad() {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    const top = win.statusBarHeight || 20;
    if (menu && menu.height) {
      const gap = menu.top - top;
      this.setData({ navTop: top, navHeight: menu.height + gap * 2, capsuleGap: win.windowWidth - menu.left + 8 });
    } else {
      this.setData({ navTop: top });
    }
  },

  onShow() {
    confirmation.show(this);
    this.offs = [
      store.on('state', () => this.renderState()),
      store.on('nav', () => { this.renderHud(); this.drawField(); }),
      store.on('conn', () => this.renderConn()),
      store.on('events', () => this.setData({ events: view.events(store, 5) })),
      store.on('waypoints', () => { this.renderState(); this.drawField(); }),
      store.on('map', () => this.loadRaster())
    ];
    this.renderAll();
    if (this.data.stageView === 'map') this.initCanvas();
    this.anim = setInterval(() => { if (store.nav && store.nav.target) this.drawField(); }, 90);
    if (this.data.stageView === 'cam') this.startFrames();
  },

  onHide() {
    confirmation.leave(this);
    (this.offs || []).forEach((off) => off());
    this.offs = [];
    clearInterval(this.anim);
    this.stopFrames();
  },

  onUnload() {
    this.onHide();
  },

  onPullDownRefresh() {
    store.refresh().then(() => wx.stopPullDownRefresh());
  },

  /* ---------- 渲染 ---------- */
  renderAll() {
    this.renderState();
    this.renderConn();
    this.setData({ events: view.events(store, 5) });
  },

  renderState() {
    const meta = store.mapMeta;
    this.setData({
      hero: view.hero(store),
      platform: view.platform(store),
      objects: view.objects(store),
      hud: view.hud(store),
      mapCtx: fieldMap.hasPrior(meta) ? '先验地图坐标系' : '无先验图 · 里程计坐标系'
    });
  },

  renderHud() {
    this.setData({ hud: view.hud(store) });
  },

  renderConn() {
    const c = store.conn;
    let banner = '';
    let tone = 'off';
    if (c.gateway === 'offline' && !store.lastStateAt) {
      banner = c.error ? c.error + '（' + config.baseUrl() + '）' : '连不上云端（' + config.baseUrl() + '），请检查网络或服务器';
      tone = 'bad';
    } else if (!c.rk) {
      banner = store.lastStateAt ? 'RK3588 已离线，下面是最后一次收到的数据' : '正在连接云拓…' + (c.error ? '（' + c.error + '）' : '');
      tone = store.lastStateAt ? 'bad' : 'off';
    } else if (store.isMock()) {
      banner = '当前是模拟模式，数据来自后端模拟器；到「我的」切换为实车';
      tone = 'mock';
    }
    this.setData({ links: view.links(store), banner, bannerTone: tone });
  },

  /* ---------- 场地画布 ---------- */
  initCanvas() {
    if (this.ctx) {
      this.drawField();
      return;
    }
    wx.createSelectorQuery().select('#field').fields({ node: true, size: true }).exec((res) => {
      const r = res && res[0];
      if (!r || !r.node || this.data.stageView !== 'map') return;
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
      r.node.width = Math.round(r.width * dpr);
      r.node.height = Math.round(r.height * dpr);
      this.canvas = r.node;
      this.ctx = r.node.getContext('2d');
      this.ctx.scale(dpr, dpr);
      this.size = { w: r.width, h: r.height };
      this.loadRaster();
      this.drawField();
    });
  },

  loadRaster() {
    this.renderState();
    this.raster = null;
    if (!this.canvas || !store.mapImagePath || !fieldMap.hasPrior(store.mapMeta)) {
      this.drawField();
      return;
    }
    const canvas = this.canvas;
    const img = canvas.createImage();
    img.onload = () => {
      if (this.canvas !== canvas) return;
      this.raster = fieldMap.prepareRaster(img, (w, h) => wx.createOffscreenCanvas({ type: '2d', width: w, height: h }));
      this.drawField();
    };
    img.onerror = () => this.drawField();
    img.src = store.mapImagePath;
  },

  drawField() {
    if (!this.ctx || this.data.stageView !== 'map') return;
    const nav = store.nav || {};
    fieldMap.draw(this.ctx, this.size.w, this.size.h, {
      meta: store.mapMeta,
      raster: this.raster,
      waypoints: store.waypoints,
      trail: store.trail,
      pose: nav.pose,
      goal: nav.goal,
      target: nav.target,
      compact: false
    }, Date.now());
  },

  onStageView(e) {
    const v = e.currentTarget.dataset.v;
    if (v === this.data.stageView) return;
    this.setData({ stageView: v }, () => {
      if (v === 'cam') {
        this.canvas = this.ctx = this.size = this.raster = null;
        this.startFrames();
      } else {
        this.stopFrames();
        this.initCanvas();
      }
    });
  },

  /* ---------- 相机画面（最新检测帧，2 s 刷新） ---------- */
  startFrames() {
    this.stopFrames();
    const session = this.frameSession;
    const base = config.baseUrl();
    if (this.frameBase !== base) {
      this.frameBase = base;
      this.setData({ frameSrc: '', frameStale: false, frameMsg: '正在获取相机画面…' });
    }
    let pending = false;
    const pull = async () => {
      if (pending || session !== this.frameSession || base !== config.baseUrl()) return;
      pending = true;
      try {
        const res = await api.getLatestFrame();
        if (session !== this.frameSession || base !== config.baseUrl()) return;
        if (res.ok && res.data && res.data.byteLength) {
          this.setData({ frameSrc: 'data:image/jpeg;base64,' + wx.arrayBufferToBase64(res.data), frameStale: false, frameMsg: '' });
        } else {
          this.setData({ frameStale: !!this.data.frameSrc, frameMsg: res.ok ? '相机画面暂不可用' : api.explain(res.error) });
        }
      } finally {
        pending = false;
      }
    };
    pull();
    this.frameTimer = setInterval(pull, config.FRAME_INTERVAL_MS);
  },

  stopFrames() {
    this.frameSession = (this.frameSession || 0) + 1;
    clearInterval(this.frameTimer);
    this.frameTimer = null;
  },

  onPreviewFrame() {
    if (this.data.frameSrc) wx.previewImage({ urls: [this.data.frameSrc] });
  },

  /* ---------- 任务操作 ---------- */
  async quick(command) {
    if (this._confirmationHidden) return;
    this.quickRequests = this.quickRequests || {};
    if (this.quickRequests[command]) return;
    const visit = confirmation.capture(this);
    this.quickRequests[command] = visit;
    try {
      const r = await actions.run(command, {});
      if (confirmation.current(this, visit)) wx.showToast({ title: r.detail, icon: r.ok ? 'success' : 'none', duration: 3500 });
    } finally {
      delete this.quickRequests[command];
      store.refresh();
    }
  },

  onPause() { if (this.data.hero.canPause) this.quick('pause'); },
  onCancel() { if (this.data.hero.canCancel) this.quick('cancel'); },
  onResume() { if (this.data.hero.canResume) this.ask('resume', {}); },
  onHome() { if (this.data.hero.canHome) this.ask('return_home', {}); },

  ask(command, body) {
    const s = actions.sheetFor(command, body, store);
    confirmation.open(this, { command, body, taskId: store.task() && store.task().task_id }, s);
  },

  async onSheetConfirm() {
    const r = await confirmation.run(this, (p) => {
      if (p.command === 'resume' && (!store.task() || store.task().task_id !== p.taskId)) return { ok: false, detail: '任务已变化，请重新确认' };
      if (p.command !== 'resume' && store.taskActive()) return { ok: false, detail: '已有任务在执行，请先查看当前任务' };
      return actions.run(p.command, p.body);
    });
    if (!r) return;
    if (r.ok) wx.showToast({ title: r.detail, icon: 'none', duration: 2500 });
    else wx.showModal({ title: r.uncertain ? '执行结果未确认' : '任务未受理', content: r.detail, showCancel: false });
    store.refresh();
  },

  onSheetCancel() {
    if (!this._confirmationRequest) confirmation.close(this);
  },

  onAllEvents() {
    wx.switchTab({ url: '/pages/mission/mission' });
  },

  onShareAppMessage() {
    return { title: '云拓 · 多模态复杂地形轮腿机器人', path: '/pages/home/home' };
  }
});
