/**
 * 设置页面
 * Cloud Gateway 配置、legacy MQTT、告警中心、关于信息
 */
const app = getApp();
const util = require('../../utils/util');
const dataCache = require('../../utils/dataCache');
const config = require('../../utils/config');
const api = require('../../utils/api');

Page({
  data: {
    mqttConnected: false,
    baseUrl: config.BASE_URL,
    wsStateUrl: config.WS_STATE_URL,
    wsImuUrl: config.WS_IMU_URL,
    apiToken: '',
    cloudOnline: false,
    rkOnline: false,
    publicControlEnabled: false,
    healthDetail: '等待检测',
    brokerUrl: '',
    mqttUsername: '',
    mqttPassword: '',
    subscribeTopic: config.LEGACY_MQTT_CONFIG.subscribeTopic,
    publishTopic: config.LEGACY_MQTT_CONFIG.publishTopic,
    alarms: []
  },

  onShow() {
    this._loadConfig();
    this._loadAlarms();
    this._checkConnection();
    this.refreshHealth();
  },

  /**
   * 加载保存的公网 Token 与 legacy MQTT 配置
   */
  _loadConfig() {
    const saved = wx.getStorageSync('mqtt_config');
    const savedConfig = saved ? JSON.parse(saved) : {};
    this.setData({
      apiToken: wx.getStorageSync(config.TOKEN_STORAGE_KEY) || '',
      brokerUrl: savedConfig.brokerUrl || app.globalData.mqttConfig.brokerUrl,
      mqttUsername: savedConfig.username || app.globalData.mqttConfig.username || '',
      mqttPassword: savedConfig.password || app.globalData.mqttConfig.password || '',
      subscribeTopic: savedConfig.subscribeTopic || app.globalData.mqttConfig.subscribeTopic,
      publishTopic: savedConfig.publishTopic || app.globalData.mqttConfig.publishTopic
    });
  },

  /**
   * 保存配置
   */
  saveConfig() {
    const config = {
      brokerUrl: this.data.brokerUrl,
      username: this.data.mqttUsername,
      password: this.data.mqttPassword,
      subscribeTopic: this.data.subscribeTopic,
      publishTopic: this.data.publishTopic
    };

    wx.setStorageSync('mqtt_config', JSON.stringify(config));

    // 更新全局配置
    Object.assign(app.globalData.mqttConfig, config);

    wx.showToast({
      title: '配置已保存',
      icon: 'success',
      duration: 1500
    });
  },

  saveApiToken() {
    const token = (this.data.apiToken || '').trim();
    if (token) {
      wx.setStorageSync(config.TOKEN_STORAGE_KEY, token);
      wx.showToast({ title: 'Token 已保存', icon: 'success' });
      this.setData({ apiToken: token });
      return;
    }
    wx.removeStorageSync(config.TOKEN_STORAGE_KEY);
    wx.showToast({ title: 'Token 已清除', icon: 'none' });
  },

  /**
   * 输入变更
   */
  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [field]: value });
  },

  /**
   * 切换 legacy MQTT 连接
   */
  toggleMQTT() {
    if (this.data.mqttConnected) {
      // 断开
      app.disconnectMQTT();
      this.setData({ mqttConnected: false });
      wx.showToast({ title: '已断开', icon: 'none' });
    } else {
      // 连接
      const config = {
        brokerUrl: this.data.brokerUrl,
        username: this.data.mqttUsername,
        password: this.data.mqttPassword,
        subscribeTopic: this.data.subscribeTopic,
        publishTopic: this.data.publishTopic
      };

      wx.showLoading({ title: '连接中...' });

      // 先传入配置
      Object.assign(app.globalData.mqttConfig, config);

      try {
        app.connectMQTT(config);

        // 等待连接结果
        setTimeout(() => {
          wx.hideLoading();
          this._checkConnection();
        }, 2000);
      } catch (e) {
        wx.hideLoading();
        wx.showToast({ title: '连接失败', icon: 'none' });
      }
    }
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

  /**
   * 检查连接状态
   */
  _checkConnection() {
    this.setData({
      mqttConnected: app.globalData.mqttConnected
    });
  },

  /**
   * 加载告警历史
   */
  _loadAlarms() {
    this.setData({
      alarms: app.globalData.alarms || []
    });
  },

  /**
   * 清除缓存
   */
  clearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '确定要清除所有本地缓存数据吗？(不包括MQTT配置)',
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
  formatTime: util.formatTime
});
