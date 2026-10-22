const config = require('./utils/config');
const api = require('./utils/api');
const stateAdapter = require('./utils/stateAdapter');
const wsClient = require('./utils/wsClient');
const navigationWsClient = require('./utils/navigationWsClient');

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
      commandLogs: [],
      wsConnected: false,
      navigationWsConnected: false,
      navigation: null,
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

    this._setupWSCallbacks();
    this._setupNavigationWSCallbacks();
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
  _syncInFlight: false,

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

  _setupNavigationWSCallbacks() {
    navigationWsClient.on('open', () => {
      this.globalData.navigationWsConnected = true;
      this._emitEvent('navigationStatusChange', this.globalData.navigation);
      this._emitEvent('robotSyncStatusChange', this._syncStatus());
    });

    navigationWsClient.on('message', (payload) => {
      const data = payload && payload.data !== undefined ? payload.data : payload;
      if (data) {
        this.globalData.navigation = data;
        this._emitEvent('navigationStatusChange', data);
      }
    });

    navigationWsClient.on('error', () => {
      this.globalData.navigationWsConnected = false;
      this._emitEvent('robotSyncStatusChange', this._syncStatus());
    });

    navigationWsClient.on('close', () => {
      this.globalData.navigationWsConnected = false;
      this._emitEvent('robotSyncStatusChange', this._syncStatus());
    });
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
    navigationWsClient.connect();
  },

  stopRobotSync() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    wsClient.disconnect();
    navigationWsClient.disconnect();
  },

  async refreshRobotSnapshot(options = {}) {
    if (this._syncInFlight) return;
    this._syncInFlight = true;
    try {
      await this._refreshRobotSnapshot(options);
    } finally {
      this._syncInFlight = false;
    }
  },

  async _refreshRobotSnapshot(options = {}) {
    const includeHealth = options.includeHealth !== false;
    const includeFrame = !!options.includeFrame;

    if (includeHealth) {
      const healthResult = await api.getHealth();
      this._applyHealthResult(healthResult);
      if (healthResult.ok && !this.globalData.rkOnline) {
        this._markRkUnavailable();
        return;
      }
    } else if (this.globalData.cloudOnline && !this.globalData.rkOnline) {
      this._markRkUnavailable();
      return;
    }

    const tasks = [
      api.getStateLatest(),
      api.getAlerts(),
      api.getImuLatest(),
      api.getCommandLogs(),
      api.getNavigationLatest()
    ];
    if (includeFrame) tasks.push(api.checkLatestFrame());

    const results = await Promise.all(tasks);
    const stateResult = results[0];
    const alertsResult = results[1];
    const imuResult = results[2];
    const logsResult = results[3];
    const navigationResult = results[4];
    const frameResult = includeFrame ? results[5] : null;

    if (alertsResult.ok) {
      this.globalData.alarms = stateAdapter.adaptAlerts((alertsResult.data && alertsResult.data.data) || []);
    }

    if (imuResult.ok) {
      this.globalData.imu = imuResult.data ? imuResult.data.data : null;
      if (this.globalData.imu) {
        const imu = this.globalData.imu;
        console.log('[IMU] received source=', imu.source, 'has_imu=', !!imu.imu, 'yaw=', imu.imu?.euler_deg?.yaw);
      } else {
        console.warn('[IMU] ok but data is null/empty');
      }
    } else {
      console.warn('[IMU] request failed:', imuResult.error, 'status:', imuResult.statusCode);
    }

    if (logsResult.ok) {
      this.globalData.commandLogs = (logsResult.data && logsResult.data.data) || [];
    }

    if (navigationResult.ok) {
      this.globalData.navigation = navigationResult.data ? navigationResult.data.data : null;
      this._emitEvent('navigationStatusChange', this.globalData.navigation);
    }

    if (frameResult) {
      if (frameResult.ok) {
        this.globalData.frameStatus = 'ok';
      } else {
        this.globalData.frameStatus = frameResult.statusCode === 404 ? 'missing' : 'error';
        if (this.globalData.frameStatus === 'missing') {
          this.globalData.lastError = '视觉最新帧 404，请确认 YOLO 相机服务已启动';
        }
      }
    } else {
      this.globalData.frameStatus = 'ok';
    }

    if (stateResult.ok && stateResult.data && stateResult.data.data) {
      this.globalData.restOnline = true;
      this.globalData.lastError = '';
      this._handleRawState(stateResult.data.data, 'rest');
    } else {
      this.globalData.restOnline = false;
      this.globalData.lastError = this.globalData.cloudOnline && !this.globalData.rkOnline
        ? '云端在线，RK3588 未连接或后端未启动'
        : `状态请求失败：${stateResult.error}`;
      this._emitEvent('robotSyncStatusChange', this._syncStatus());
    }
  },

  _applyHealthResult(healthResult) {
    if (!healthResult) return;

    if (healthResult.ok) {
      const data = healthResult.data || {};
      this.globalData.health = data;
      this.globalData.cloudOnline = data.status === 'ok';
      this.globalData.rkOnline = !!data.rk_online;
      this.globalData.publicControlEnabled = !!data.public_control_enabled;
    } else {
      this.globalData.cloudOnline = false;
      this.globalData.rkOnline = false;
      this.globalData.publicControlEnabled = false;
      this.globalData.lastError = `健康检查失败：${healthResult.error}`;
    }
    this._emitEvent('robotSyncStatusChange', this._syncStatus());
  },

  _markRkUnavailable() {
    this.globalData.restOnline = false;
    this.globalData.frameStatus = 'unknown';
    this.globalData.lastError = '云端在线，RK3588 未连接或后端未启动';
    this._emitEvent('robotSyncStatusChange', this._syncStatus());
  },

  _handleRawState(rawState, dataSource) {
    this.globalData.rawState = rawState;
    const telemetry = stateAdapter.adaptState(rawState, {
      alerts: this.globalData.alarms,
      health: this.globalData.health,
      imu: this.globalData.imu,
      commandLogs: this.globalData.commandLogs,
      navigation: this.globalData.navigation,
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
      navigationWsConnected: this.globalData.navigationWsConnected,
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

  getConnectionStatus() {
    return this.globalData.restOnline || this.globalData.wsConnected;
  }
});
