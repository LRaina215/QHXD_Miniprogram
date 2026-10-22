/**
 * 设置页面
 * Cloud Gateway 配置、模式切换、告警中心、关于信息
 */
const app = getApp();
const util = require('../../utils/util');
const dataCache = require('../../utils/dataCache');
const config = require('../../utils/config');
const api = require('../../utils/api');
const commandClient = require('../../utils/commandClient');

Page({
  data: {
    baseUrl: config.BASE_URL,
    wsStateUrl: config.WS_STATE_URL,
    wsImuUrl: config.WS_IMU_URL,
    apiToken: '',
    hasToken: false,
    cloudOnline: false,
    rkOnline: false,
    publicControlEnabled: false,
    healthDetail: '等待检测',
    systemMode: '--',
    switchingMode: false,
    alarms: []
  },

  onShow() {
    this._loadToken();
    this._loadAlarms();
    this._loadSystemMode();
    this.refreshHealth();
  },

  /**
   * 加载保存的公网 Token
   */
  _loadToken() {
    const token = wx.getStorageSync(config.TOKEN_STORAGE_KEY) || '';
    this.setData({
      apiToken: token,
      hasToken: !!token
    });
  },

  saveApiToken() {
    const token = (this.data.apiToken || '').trim();
    if (token) {
      wx.setStorageSync(config.TOKEN_STORAGE_KEY, token);
      wx.showToast({ title: 'Token 已保存', icon: 'success' });
      this.setData({ apiToken: token, hasToken: true });
      return;
    }
    wx.removeStorageSync(config.TOKEN_STORAGE_KEY);
    wx.showToast({ title: 'Token 已清除', icon: 'none' });
    this.setData({ hasToken: false });
  },

  /**
   * 输入变更
   */
  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [field]: value });
  },

  async refreshHealth() {
    const result = await api.getHealth();
    if (!result.ok) {
      this.setData({
        cloudOnline: false,
        rkOnline: false,
        publicControlEnabled: false,
        healthDetail: `健康检查失败：${result.error}`
      });
      return;
    }
    const data = result.data || {};
    this.setData({
      cloudOnline: data.status === 'ok',
      rkOnline: !!data.rk_online,
      publicControlEnabled: !!data.public_control_enabled,
      healthDetail: `gateway=${data.service || 'unknown'} · rk=${data.rk_online ? 'online' : 'offline'}`
    });
  },

  _loadSystemMode() {
    const telemetry = app.globalData.telemetry;
    const mode = telemetry?.system?.mode || app.globalData.rawState?.system_mode?.mode || '--';
    this.setData({ systemMode: mode });
  },

  async switchSystemMode() {
    if (this.data.switchingMode) return;
    const currentMode = this.data.systemMode;
    const targetMode = currentMode === 'mock' ? 'real' : 'mock';

    if (!commandClient.getToken()) {
      wx.showToast({ title: '请先在 Token 卡片中保存公网 Token', icon: 'none', duration: 2500 });
      return;
    }

    if (currentMode === '--') {
      wx.showToast({ title: '尚未获取到当前模式，请等待状态同步', icon: 'none', duration: 2000 });
      return;
    }

    // 乐观更新：先切换 UI
    const previousMode = currentMode;
    this.setData({ systemMode: targetMode, switchingMode: true });

    try {
      const result = await new Promise((resolve) => {
        commandClient.switchMode(targetMode).then(resolve);
      });

      if (!result.ok) {
        // 失败：回滚 UI
        this.setData({ systemMode: previousMode, switchingMode: false });
        const errMsg = this._formatModeError(result.error);
        wx.showToast({ title: errMsg, icon: 'none', duration: 3000 });
        return;
      }

      // 成功：确认新 mode
      this.setData({ switchingMode: false });
      const data = result.data?.data;
      const newMode = data?.system_mode?.mode || targetMode;
      this.setData({ systemMode: newMode });
      wx.showToast({ title: `已切换到 ${newMode === 'mock' ? 'Mock' : 'Real'} 模式`, icon: 'success' });
      app.refreshRobotSnapshot({ includeHealth: true });
    } catch (err) {
      // 网络异常：回滚 UI
      this.setData({ systemMode: previousMode, switchingMode: false });
      wx.showToast({ title: '网络请求失败，请检查连接后重试', icon: 'none', duration: 2500 });
    }
  },

  _formatModeError(error) {
    if (!error) return '模式切换失败';
    const map = {
      missing_public_api_token: '请先在 Token 卡片中保存公网 Token',
      unauthorized: '公网 Token 无效，请重新保存',
      robot_offline: 'RK3588 当前离线，无法切换',
      rate_limited: '请求过于频繁，请稍后再试',
    };
    if (map[error]) return map[error];
    // 透传服务器返回的具体错误
    if (typeof error === 'string' && error.length < 60) return error;
    return '模式切换失败，请检查网络后重试';
  },

  /**
   * 加载告警历史
   */
  _loadAlarms() {
    const alarms = (app.globalData.alarms || []).map(item => Object.assign({}, item, {
      displayTime: util.formatTime((item.time || 0) / 1000)
    }));
    this.setData({
      alarms
    });
  },

  /**
   * 清除缓存
   */
  clearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '确定要清除所有本地缓存数据吗？公网 Token 不会被清除。',
      success: (res) => {
        if (res.confirm) {
          dataCache.clear();
          // 清除其他缓存
          try {
            wx.removeStorageSync('logs');
            wx.removeStorageSync('sentinel_history_data');
          } catch (e) {}

          this.setData({ alarms: [] });
          app.globalData.alarms = [];

          wx.showToast({ title: '缓存已清除', icon: 'success' });
        }
      }
    });
  },

  /**
   * 工具函数
   */
});
