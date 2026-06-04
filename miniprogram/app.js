const mqttManager = require('./utils/mqtt');
const config = require('./utils/config');
const api = require('./utils/api');
const stateAdapter = require('./utils/stateAdapter');
const wsClient = require('./utils/wsClient');

App({
  onLaunch() {
    const logs = wx.getStorageSync('logs') || [];
    logs.unshift(Date.now());
    wx.setStorageSync('logs', logs);

    this.globalData = {
      apiConfig: config,
      health: null,
      rawState: null,
      telemetry: null,
      imu: null,
      mqttConfig: { ...config.LEGACY_MQTT_CONFIG },
      mqttConnected: false,
      wsConnected: false,
      restOnline: false,
      cloudOnline: false,
      rkOnline: false,
      publicControlEnabled: false,
      frameStatus: 'unknown',
      lastError: '',
      historyData: {
        battery: [],
        temperature: [],
        humidity: []
      },
      alarms: [],
      tasks: []
    };

    this._setupMQTTCallbacks();
    this._setupWSCallbacks();
    this._loadSavedConfig();
    this.startRobotSync();
  },

  onShow() {
    this.startRobotSync();
  },

  onHide() {
    this.stopRobotSync();
  },

  _pollTimer: null,
  _healthTick: 0,

  _setupMQTTCallbacks() {
    mqttManager.onConnect(() => {
      this.globalData.mqttConnected = true;
      this._emitEvent('mqttStatusChange', true);
    });

    mqttManager.onDisconnect(() => {
      this.globalData.mqttConnected = false;
      this._emitEvent('mqttStatusChange', false);
    });

    mqttManager.onError(() => {
      this.globalData.mqttConnected = false;
      this._emitEvent('mqttStatusChange', false);
    });

    mqttManager.onMessage((topic, data) => {
      if (topic === this.globalData.mqttConfig.subscribeTopic) {
        this._handleTelemetry(data, 'legacy-mqtt');
      }
    });
  },

  _setupWSCallbacks() {
    wsClient.on('open', () => {
      this.globalData.wsConnected = true;
      this.globalData.lastError = '';
      this._emitEvent('robotSyncStatusChange', this._syncStatus());
    });

    wsClient.on('message', (payload) => {
      if (payload && payload.type === 'robot_state') {
        this._handleRawState(payload.data, 'websocket');
      }
    });

    wsClient.on('error', (err) => {
      this.globalData.wsConnected = false;
      this.globalData.lastError = err.errMsg || err.error || err.message || 'WebSocket 连接异常，已降级轮询';
      this._emitEvent('robotSyncStatusChange', this._syncStatus());
    });

    wsClient.on('close', () => {
      this.globalData.wsConnected = false;
      this._emitEvent('robotSyncStatusChange', this._syncStatus());
    });
  },

  _loadSavedConfig() {
    try {
      const saved = wx.getStorageSync(config.LEGACY_MQTT_STORAGE_KEY);
      if (saved) {
        Object.assign(this.globalData.mqttConfig, JSON.parse(saved));
      }
    } catch (e) {}
  },

  startRobotSync() {
    if (!this._pollTimer) {
      this.refreshRobotSnapshot({ includeHealth: true, includeFrame: true });
      this._pollTimer = setInterval(() => {
        this._healthTick += 1;
        this.refreshRobotSnapshot({
          includeHealth: this._healthTick % 5 === 0,
          includeFrame: this._healthTick % 3 === 0
        });
      }, config.POLL_INTERVAL_MS);
    }
    wsClient.connect();
  },

  stopRobotSync() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    wsClient.disconnect();
  },

  async refreshRobotSnapshot(options = {}) {
    const includeHealth = options.includeHealth !== false;
    const includeFrame = !!options.includeFrame;

    const tasks = [
      api.getStateLatest(),
      api.getAlerts(),
      api.getImuLatest()
    ];
    if (includeHealth) tasks.push(api.getHealth());
    if (includeFrame) tasks.push(api.checkLatestFrame());

    const results = await Promise.all(tasks);
    const stateResult = results[0];
    const alertsResult = results[1];
    const imuResult = results[2];
    const healthResult = includeHealth ? results[3] : null;
    const frameResult = includeFrame ? results[includeHealth ? 4 : 3] : null;

    if (healthResult) {
      if (healthResult.ok) {
        this.globalData.health = healthResult.data;
        this.globalData.cloudOnline = healthResult.data && healthResult.data.status === 'ok';
        this.globalData.rkOnline = !!(healthResult.data && healthResult.data.rk_online);
        this.globalData.publicControlEnabled = !!(healthResult.data && healthResult.data.public_control_enabled);
      } else {
        this.globalData.cloudOnline = false;
        this.globalData.rkOnline = false;
        this.globalData.lastError = `健康检查失败：${healthResult.error}`;
      }
    }

    if (alertsResult.ok) {
      this.globalData.alarms = stateAdapter.adaptAlerts((alertsResult.data && alertsResult.data.data) || []);
    }

    if (imuResult.ok) {
      this.globalData.imu = imuResult.data ? imuResult.data.data : null;
    }

    if (frameResult) {
      this.globalData.frameStatus = frameResult.ok ? 'ok' : frameResult.statusCode === 404 ? 'missing' : 'error';
    }

    if (stateResult.ok && stateResult.data && stateResult.data.data) {
      this.globalData.restOnline = true;
      this.globalData.lastError = '';
      this._handleRawState(stateResult.data.data, 'rest');
    } else {
      this.globalData.restOnline = false;
      this.globalData.lastError = `状态请求失败：${stateResult.error}`;
      this._emitEvent('robotSyncStatusChange', this._syncStatus());
    }
  },

  _handleRawState(rawState, dataSource) {
    this.globalData.rawState = rawState;
    const telemetry = stateAdapter.adaptState(rawState, {
      alerts: this.globalData.alarms,
      health: this.globalData.health,
      imu: this.globalData.imu,
      frameStatus: this.globalData.frameStatus,
      dataSource,
      restOnline: this.globalData.restOnline,
      wsConnected: this.globalData.wsConnected,
      lastError: this.globalData.lastError
    });
    this._handleTelemetry(telemetry, dataSource);
  },

  _handleTelemetry(data, dataSource) {
    if (!data) return;
    this.globalData.telemetry = data;
    this._cacheHistoryData(data);
    this.globalData.tasks = data.tasks || [];
    if (data.alarm && Array.isArray(data.alarm.list)) {
      this.globalData.alarms = data.alarm.list;
    }
    this._emitEvent('telemetryUpdate', data);
    this._emitEvent('robotSyncStatusChange', this._syncStatus(dataSource));
  },

  _cacheHistoryData(data) {
    const timestamp = Date.now();
    const history = this.globalData.historyData;
    const maxPoints = 200;

    if (data.robot && data.robot.battery !== undefined && data.robot.battery !== null) {
      history.battery.push({ time: timestamp, value: data.robot.battery });
      if (history.battery.length > maxPoints) history.battery.shift();
    }
    if (data.sensors && data.sensors.temperature !== undefined && data.sensors.temperature !== null) {
      history.temperature.push({ time: timestamp, value: data.sensors.temperature });
      if (history.temperature.length > maxPoints) history.temperature.shift();
    }
    if (data.sensors && data.sensors.humidity !== undefined && data.sensors.humidity !== null) {
      history.humidity.push({ time: timestamp, value: data.sensors.humidity });
      if (history.humidity.length > maxPoints) history.humidity.shift();
    }
  },

  _syncStatus(dataSource) {
    return {
      restOnline: this.globalData.restOnline,
      wsConnected: this.globalData.wsConnected,
      cloudOnline: this.globalData.cloudOnline,
      rkOnline: this.globalData.rkOnline,
      publicControlEnabled: this.globalData.publicControlEnabled,
      frameStatus: this.globalData.frameStatus,
      dataSource: dataSource || (this.globalData.wsConnected ? 'websocket' : 'rest'),
      lastError: this.globalData.lastError
    };
  },

  _eventListeners: {},
  onEvent(event, callback) {
    if (!this._eventListeners[event]) this._eventListeners[event] = [];
    this._eventListeners[event].push(callback);
  },
  offEvent(event, callback) {
    if (!this._eventListeners[event]) return;
    this._eventListeners[event] = this._eventListeners[event].filter(cb => cb !== callback);
  },
  _emitEvent(event, data) {
    (this._eventListeners[event] || []).forEach(cb => cb(data));
  },

  connectMQTT(legacyConfig) {
    if (legacyConfig) Object.assign(this.globalData.mqttConfig, legacyConfig);
    try {
      mqttManager.connect(this.globalData.mqttConfig);
      return true;
    } catch (e) {
      return false;
    }
  },

  disconnectMQTT() {
    mqttManager.disconnect();
    this.globalData.mqttConnected = false;
  },

  publishCommand(command) {
    const topic = this.globalData.mqttConfig.publishTopic;
    return mqttManager.publish(topic, JSON.stringify({
      command,
      timestamp: Math.floor(Date.now() / 1000),
      source: 'wechat_miniprogram_legacy_mqtt'
    }));
  },

  getConnectionStatus() {
    return this.globalData.restOnline || this.globalData.wsConnected;
  }
});
