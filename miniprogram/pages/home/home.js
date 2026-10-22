const view = require('../../utils/view');
const actions = require('../../utils/actions');
const fieldMap = require('../../utils/fieldMap');
const api = require('../../utils/api');
const config = require('../../utils/config');

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
    this.offs = [
      store.on('state', () => this.renderState()),
      store.on('nav', () => { this.renderHud(); this.drawField(); }),
      store.on('conn', () => this.renderConn()),
      store.on('events', () => this.setData({ events: view.events(store, 5) })),
      store.on('waypoints', () => { this.renderState(); this.drawField(); }),
      store.on('map', () => this.loadRaster())
    ];
    this.renderAll();
    this.initCanvas();
    this.anim = setInterval(() => { if (store.nav && store.nav.target) this.drawField(); }, 90);
    if (this.data.stageView === 'cam') this.startFrames();
  },

  onHide() {
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
      banner = '连不上云端（' + config.baseUrl() + '），请检查网络或服务器';
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
      if (!r || !r.node) return;
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
    const img = this.canvas.createImage();
    img.onload = () => {
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
      if (v === 'cam') this.startFrames();
      else { this.stopFrames(); this.drawField(); }
    });
  },

  /* ---------- 相机画面（最新检测帧，2 s 刷新） ---------- */
  startFrames() {
    this.stopFrames();
    const pull = async () => {
      const res = await api.getLatestFrame();
      if (res.ok && res.data && res.data.byteLength) {
        this.setData({ frameSrc: 'data:image/jpeg;base64,' + wx.arrayBufferToBase64(res.data) });
      } else if (!this.data.frameSrc) {
        this.setData({ frameMsg: res.status === 404 ? '相机还没有画面（感知节点未运行）' : '相机画面暂不可用' });
      }
    };
    pull();
    this.frameTimer = setInterval(pull, config.FRAME_INTERVAL_MS);
  },

  stopFrames() {
    clearInterval(this.frameTimer);
    this.frameTimer = null;
  },

  onPreviewFrame() {
    if (this.data.frameSrc) wx.previewImage({ urls: [this.data.frameSrc] });
  },

  /* ---------- 任务操作 ---------- */
  async quick(command) {
    wx.showLoading({ title: '发送中', mask: true });
    const r = await actions.run(command, {});
    wx.hideLoading();
    wx.showToast({ title: r.detail, icon: r.ok ? 'success' : 'none', duration: 2500 });
    store.refresh();
  },

  onPause() { if (this.data.hero.canPause) this.quick('pause'); },
  onCancel() { if (this.data.hero.canCancel) this.quick('cancel'); },
  onResume() { if (this.data.hero.canResume) this.ask('resume', {}); },
  onHome() { if (this.data.hero.canHome) this.ask('return_home', {}); },

  ask(command, body) {
    const s = actions.sheetFor(command, body, store);
    this.pending = { command, body };
    this.setData({ sheet: { show: true, title: s.title, rows: s.rows, loading: false, error: '' } });
  },

  async onSheetConfirm() {
    const p = this.pending;
    if (!p) return;
    this.setData({ 'sheet.loading': true, 'sheet.error': '' });
    const r = await actions.run(p.command, p.body);
    if (r.ok) {
      this.pending = null;
      this.setData({ sheet: { show: false, title: '', rows: [], loading: false, error: '' } });
      wx.showToast({ title: r.detail, icon: 'none', duration: 2500 });
      store.refresh();
    } else {
      this.setData({ 'sheet.loading': false, 'sheet.error': r.detail });
    }
  },

  onSheetCancel() {
    this.pending = null;
    this.setData({ 'sheet.show': false });
  },

  onAllEvents() {
    wx.switchTab({ url: '/pages/mission/mission' });
  },

  onShareAppMessage() {
    return { title: '云拓 · 多模态复杂地形轮腿机器人', path: '/pages/home/home' };
  }
});
