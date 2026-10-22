const api = require('../../utils/api');
const config = require('../../utils/config');
const store = require('../../utils/store');
const L = require('../../utils/labels');

Page({
  data: {
    conn: [],
    baseUrl: '',
    defaultBase: config.DEFAULT_BASE_URL,
    tokenDraft: '',
    hasToken: false,
    mode: 'mock',
    alerts: [],
    debugOpen: false,
    baseDraft: ''
  },

  onShow() {
    this.offs = [
      store.on('conn', () => this.render()),
      store.on('state', () => this.render()),
      store.on('alerts', () => this.renderAlerts())
    ];
    const token = api.getToken();
    this.setData({ tokenDraft: token, hasToken: !!token, baseDraft: config.storedBaseUrl() });
    this.render();
    this.renderAlerts();
  },

  onHide() {
    (this.offs || []).forEach((off) => off());
    this.offs = [];
  },

  onUnload() {
    this.onHide();
  },

  onPullDownRefresh() {
    this.onRecheck().then(() => wx.stopPullDownRefresh());
  },

  render() {
    const c = store.conn;
    const p = store.platform() || {};
    const pc = c.publicControl;
    this.setData({
      baseUrl: config.baseUrl(),
      mode: store.isMock() ? 'mock' : 'real',
      conn: [
        { k: '云端网关', tone: c.gateway === 'online' ? 'ok' : (c.gateway === 'offline' ? 'bad' : 'off'), v: c.gateway === 'online' ? '在线' : (c.gateway === 'offline' ? '不可达' : '检测中') },
        { k: 'RK3588', tone: c.rk ? 'ok' : 'bad', v: c.rk ? '在线' : '离线' },
        { k: '实时推送', tone: c.live ? 'ok' : 'wait', v: c.live ? 'WebSocket' : '轮询兜底' },
        { k: 'FPGA 导航', tone: L.linkTone(p.nav_link), v: L.linkLabel(p.nav_link) },
        { k: 'FPGA 控制', tone: L.linkTone(p.control_link), v: L.linkLabel(p.control_link) },
        { k: '公网运动控制', tone: pc === true ? 'ok' : (pc === false ? 'wait' : 'off'), v: pc === true ? '已开放' : (pc === false ? '已关闭' : '未知') }
      ]
    });
  },

  renderAlerts() {
    this.setData({
      alerts: store.alerts.slice(0, 20).map((a) => ({
        id: a.alert_id,
        tone: L.eventTone(a.level === 'info' ? 'run' : a.level),
        text: a.message,
        time: L.clock(a.timestamp),
        source: a.source
      }))
    });
  },

  async onRecheck() {
    store.lastHealthAt = 0;
    await store.refresh();
    this.render();
  },

  onTokenInput(e) {
    this.setData({ tokenDraft: e.detail.value });
  },

  onSaveToken() {
    const token = (this.data.tokenDraft || '').trim();
    if (!token) {
      wx.showToast({ title: '请先粘贴 Token', icon: 'none' });
      return;
    }
    api.setToken(token);
    this.setData({ hasToken: true });
    wx.showToast({ title: 'Token 已保存', icon: 'success' });
  },

  onClearToken() {
    api.setToken('');
    this.setData({ tokenDraft: '', hasToken: false });
    wx.showToast({ title: 'Token 已清除', icon: 'none' });
  },

  async onMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    wx.showLoading({ title: '切换中', mask: true });
    const res = await api.switchMode(mode);
    wx.hideLoading();
    const data = api.unwrap(res);
    if (res.ok && data) {
      wx.showToast({ title: mode === 'real' ? '已切到实车模式' : '已切到模拟模式', icon: 'success' });
      store.trail = [];
      store.refresh();
    } else {
      wx.showModal({ title: '切换失败', content: api.explain(res.error), showCancel: false });
    }
  },

  onToggleDebug() {
    this.setData({ debugOpen: !this.data.debugOpen });
  },

  onBaseInput(e) {
    this.setData({ baseDraft: e.detail.value });
  },

  onSaveBase() {
    const value = (this.data.baseDraft || '').trim().replace(/\/+$/, '');
    if (value && !/^https?:\/\/[^\s]+$/i.test(value)) {
      wx.showToast({ title: '地址要以 http:// 或 https:// 开头', icon: 'none' });
      return;
    }
    if (value) wx.setStorageSync(config.BASE_URL_STORAGE_KEY, value);
    else wx.removeStorageSync(config.BASE_URL_STORAGE_KEY);
    store.restart();
    this.render();
    wx.showToast({ title: value ? '已切换服务器' : '已恢复默认地址', icon: 'none' });
  },

  onCopyDomains() {
    const host = config.DEFAULT_BASE_URL.replace(/^https?:\/\//, '');
    wx.setClipboardData({
      data: 'request 合法域名：https://' + host + '\nsocket 合法域名：wss://' + host + '\ndownloadFile 合法域名：https://' + host
    });
  }
});
