/**
 * 首页 - 仪表盘
 * 展示实时遥测数据、实时图像、快捷指令
 */
const app = getApp();
const util = require('../../utils/util');
const dataCache = require('../../utils/dataCache');
const commandClient = require('../../utils/commandClient');

Page({
  data: {
    mqttConnected: false,
    restOnline: false,
    wsConnected: false,
    cloudOnline: false,
    rkOnline: false,
    publicControlEnabled: false,
    dataSource: 'rest',
    lastError: '',
    staleWarning: '',
    frameStatusText: '视觉状态待检测',
    sensors: { co: '--', ch4: '--', air_quality: '--', flame: 0, temperature: '--', humidity: '--', status: '--' },
    robot: {
      battery: 0, status: 'idle', emergency_stop: false, fault_code: '--',
      pose: { x: 0, y: 0, yaw: 0 }, current_target: '--',
      remaining_distance: '--', running_hours: '--', firmware_version: '--'
    },
    perception: { detection: '--', confidence: 0 },
    alarmActive: false,
    alarmMessage: '',
    imageUrl: '',
    hasImage: false,
    imageFadeIn: false,
    statusText: '等待数据',
    airQualityLevel: '--',
    airQualityColor: '#8E8E93',
    batteryColor: '#34C759',
    coBarWidth: 0,
    ch4BarWidth: 0,
    confidenceBarWidth: 0,
    confidencePct: '0',
    batteryBarWidth: 0,
    lastUpdateTime: '--',
    currentTaskText: '--',
    currentTaskProgress: 0,
    voiceText: '',
    isRecording: false,
    toastVisible: false,
    toastMessage: '',
    toastTimer: null
  },

  onLoad() {
    dataCache.load();
    this._bindEvents();
    // 如果已有数据，先更新
    if (app.globalData.telemetry) {
      this._updateUI(app.globalData.telemetry);
    }
    this.setData({ mqttConnected: app.globalData.mqttConnected });
  },

  onShow() {
    // 监听全局事件
    app.onEvent('telemetryUpdate', this._onTelemetry);
    app.onEvent('mqttStatusChange', this._onConnectionChange);
    app.onEvent('robotSyncStatusChange', this._onRobotSyncStatus);

    this.setData({ mqttConnected: app.globalData.mqttConnected });
    this._updateSyncStatus();

    // 如果已经连接但还没有数据，检查一遍
    if (app.globalData.telemetry) {
      this._updateUI(app.globalData.telemetry);
    }

    this._scheduleNavCanvas();
  },

  onHide() {
    app.offEvent('telemetryUpdate', this._onTelemetry);
    app.offEvent('mqttStatusChange', this._onConnectionChange);
    app.offEvent('robotSyncStatusChange', this._onRobotSyncStatus);
    this._clearTimers();
  },

  onUnload() {
    app.offEvent('telemetryUpdate', this._onTelemetry);
    app.offEvent('mqttStatusChange', this._onConnectionChange);
    app.offEvent('robotSyncStatusChange', this._onRobotSyncStatus);
    this._clearTimers();
  },

  /**
   * 全局事件回调
   */
  _onTelemetry: null,
  _onConnectionChange: null,
  _onRobotSyncStatus: null,

  _bindEvents() {
    const that = this;
    this._onTelemetry = function (data) { that._updateUI(data); };
    this._onConnectionChange = function (connected) {
      that.setData({ mqttConnected: connected });
    };
    this._onRobotSyncStatus = function () {
      that._updateSyncStatus();
    };
  },

  _updateSyncStatus() {
    const gd = app.globalData || {};
    this.setData({
      restOnline: !!gd.restOnline,
      wsConnected: !!gd.wsConnected,
      cloudOnline: !!gd.cloudOnline,
      rkOnline: !!gd.rkOnline,
      publicControlEnabled: !!gd.publicControlEnabled,
      dataSource: gd.wsConnected ? 'websocket' : 'rest',
      lastError: gd.lastError || ''
    });
  },

  /**
   * 更新 UI
   */
  _updateUI(data) {
    if (!data) return;

    const update = {};
    const now = util.formatTime(Math.floor(Date.now() / 1000), true);
    update.lastUpdateTime = now;
    update.staleWarning = data.meta && data.meta.isStale ? (data.meta.staleReason || '状态可能已过期') : '';
    update.frameStatusText = data.meta ? data.meta.frameStatusText : '视觉状态待检测';
    update.restOnline = !!(data.meta && data.meta.restOnline);
    update.wsConnected = !!(data.meta && data.meta.wsConnected);
    update.cloudOnline = !!(data.meta && data.meta.cloudOnline);
    update.rkOnline = !!(data.meta && data.meta.rkOnline);
    update.publicControlEnabled = !!(data.meta && data.meta.publicControlEnabled);
    update.dataSource = data.meta ? data.meta.dataSource : 'rest';
    update.lastError = data.meta ? data.meta.lastError : '';

    // 传感器
    if (data.sensors) {
      const co = data.sensors.co;
      const ch4 = data.sensors.ch4;
      update['sensors.co'] = co !== undefined ? util.formatDecimal(co, 1) : '--';
      update['sensors.ch4'] = ch4 !== undefined ? util.formatDecimal(ch4, 1) : '--';
      update['sensors.air_quality'] = data.sensors.air_quality !== undefined ? data.sensors.air_quality : '--';
      update['sensors.flame'] = data.sensors.flame !== undefined ? data.sensors.flame : 0;
      update['sensors.temperature'] = data.sensors.temperature !== undefined && data.sensors.temperature !== null ? util.formatDecimal(data.sensors.temperature, 1) : '--';
      update['sensors.humidity'] = data.sensors.humidity !== undefined && data.sensors.humidity !== null ? util.formatDecimal(data.sensors.humidity, 1) : '--';
      update['sensors.status'] = data.sensors.status || '--';

      // 进度条宽度（模板中用，避免 WXML 中做复杂运算）
      update.coBarWidth = co !== undefined ? Math.min((co / 50) * 100, 100) : 0;
      update.ch4BarWidth = ch4 !== undefined ? Math.min((ch4 / 20) * 100, 100) : 0;

      // 空气质量等级
      if (data.sensors.air_quality !== undefined) {
        const level = util.getAirQualityLevel(data.sensors.air_quality);
        update.airQualityLevel = level.level;
        update.airQualityColor = level.color;
      }
    }

    // 机器人
    if (data.robot) {
      const r = data.robot;
      update['robot.battery'] = r.battery !== undefined ? r.battery : 0;
      update['robot.status'] = r.status || 'idle';
      update['robot.emergency_stop'] = !!r.emergency_stop;
      update['robot.fault_code'] = r.fault_code !== undefined ? r.fault_code : '--';
      update['robot.pose'] = r.pose || { x: 0, y: 0, yaw: 0 };
      update['robot.current_target'] = r.current_target || '--';
      update['robot.remaining_distance'] = r.remaining_distance !== undefined && r.remaining_distance !== null ? r.remaining_distance : '--';
      update['robot.running_hours'] = r.running_hours !== undefined ? r.running_hours : '--';
      update['robot.firmware_version'] = r.firmware_version || '--';
      update.statusText = util.getStatusText(r.status);

      // 电量颜色 + 进度条宽度
      const battery = r.battery || 0;
      update.batteryBarWidth = battery;
      update.batteryColor = battery > 60 ? '#3A3A3C' : battery > 20 ? '#B87D2B' : '#C42E2A';
    }

    if (data.currentTask) {
      update.currentTaskText = `${util.getTaskTypeText(data.currentTask.type)} / ${util.getStatusText(data.currentTask.status)}`;
      update.currentTaskProgress = data.currentTask.progress || 0;
    } else {
      update.currentTaskText = '暂无任务';
      update.currentTaskProgress = 0;
    }

    // 感知
    if (data.perception) {
      const conf = data.perception.confidence || 0;
      update['perception.detection'] = data.perception.yolo_detection || '--';
      update['perception.confidence'] = conf;
      update.confidenceBarWidth = conf * 100;
      update.confidencePct = (conf * 100).toFixed(0);
    }

    // 告警
    if (data.alarm) {
      update.alarmActive = !!data.alarm.active;
      update.alarmMessage = data.alarm.message || '';
    }

    // 图像（URL 变化时才更新）
    if (data.image && data.image.url && data.image.url !== this.data.imageUrl) {
      update.imageUrl = data.image.url;
      update.hasImage = data.image.available !== false;
      update.imageFadeIn = false;
      setTimeout(() => { this.setData({ imageFadeIn: true }); }, 50);
    }

    this.setData(update);
    dataCache.updateFromTelemetry(data);

    // 导航画布
    if (data.robot) this._drawNavCanvas(data.robot);
  },

  /**
   * 发送公网 mission 指令（带 token 与二次确认保护）
   */
  sendCommand(e) {
    const cmd = e.currentTarget.dataset.cmd;
    if (!cmd) return;
    if (!app.globalData.publicControlEnabled) {
      this.showToast('公网控制未开启，任务按钮已保护');
      return;
    }
    if (!commandClient.getToken()) {
      this.showToast('请先在设置页保存公网 Token');
      return;
    }

    const actionMap = {
      auto: { text: '开始默认巡检', run: () => commandClient.startPatrol() },
      stop: { text: '暂停当前任务', run: () => commandClient.pause() },
      go_to_1: { text: '前往一号点', run: () => commandClient.goToWaypoint('wp_001') },
      go_to_2: { text: '前往二号点', run: () => commandClient.goToWaypoint('wp_002') },
      back_charge: { text: '返回起点', run: () => commandClient.returnHome() }
    };
    const action = actionMap[cmd];
    if (!action) {
      this.showToast('暂未接入该任务接口');
      return;
    }

    wx.showModal({
      title: '任务确认',
      content: `确定要执行「${action.text}」吗？`,
      confirmText: '确认执行',
      success: (res) => {
        if (!res.confirm) return;
        action.run().then((result) => {
          if (!result.ok) {
            this.showToast(this._formatApiError(result.error));
            return;
          }
          const detail = result.data && result.data.data ? result.data.data.detail : action.text;
          this.showToast(detail || '任务已发送');
          app.refreshRobotSnapshot({ includeHealth: true, includeFrame: false });
        });
      }
    });
  },

  /**
   * 急停（含确认）
   */
  emergencyStop() {
    wx.showModal({
      title: '急停确认',
      content: '确定要触发紧急停止吗？机器人将立即停止所有运动！',
      confirmText: '确认急停',
      confirmColor: '#FF3B30',
      success: (res) => {
        if (res.confirm) {
          this.showToast('后端暂未开放公网急停接口，请使用现场急停');
        }
      }
    });
  },

  /**
   * 语音输入相关
   */
  onVoiceInput(e) { this.setData({ voiceText: e.detail.value }); },

  sendVoiceCommand() {
    const text = this.data.voiceText.trim();
    if (!text) { this.showToast('请输入指令'); return; }
    if (!commandClient.getToken()) {
      this.showToast('智能助手需要先在设置页保存公网 Token');
      return;
    }
    commandClient.smartCommand(text).then((result) => {
      if (!result.ok) {
        this.showToast(this._formatApiError(result.error));
        return;
      }
      const payload = result.data && result.data.data;
      if (!payload) {
        this.showToast('智能助手未返回结果');
        return;
      }
      if (payload.pending_command_id) {
        wx.showModal({
          title: '语音任务确认',
          content: payload.reply_text || '是否执行该任务？',
          confirmText: '确认执行',
          success: (res) => {
            commandClient.confirmVoiceCommand(payload.pending_command_id, !!res.confirm).then((confirmResult) => {
              this.showToast(confirmResult.ok ? '确认结果已提交' : this._formatApiError(confirmResult.error));
              app.refreshRobotSnapshot({ includeHealth: true });
            });
          }
        });
      } else {
        this.showToast(payload.reply_text || '智能助手已处理');
      }
      this.setData({ voiceText: '' });
    });
  },

  _parseCommand(text) {
    const t = text.replace(/[，。,.\s]/g, '');
    if (/启动|开始|运行|auto/.test(t)) return 'auto';
    if (/停止|停下|暂停|stop/.test(t)) return 'stop';
    if (/一号|1号|点1/.test(t)) return 'go_to_1';
    if (/二号|2号|点2/.test(t)) return 'go_to_2';
    if (/回充|充电|回去/.test(t)) return 'back_charge';
    if (/急停|紧急|emergency/.test(t)) return 'emergency_stop';
    return null;
  },

  /**
   * 语音识别
   * 优先使用微信同声传译插件（需在微信公众平台添加插件），不可用时提示用户
   */
  startVoiceRecognition() {
    if (this.data.isRecording) return;

    // 检查录音权限
    wx.authorize({
      scope: 'scope.record',
      success: () => this._tryVoicePlugin(),
      fail: () => {
        wx.showModal({
          title: '需要录音权限',
          content: '请在设置中允许使用麦克风',
          success: (r) => { if (r.confirm) wx.openSetting(); }
        });
      }
    });
  },

  _tryVoicePlugin() {
    const that = this;
    let siPlugin = null;
    try {
      siPlugin = requirePlugin('WechatSI');
    } catch (e) {
      // 插件不可用，提示用户
      wx.showModal({
        title: '语音功能未开通',
        content: '如需使用语音识别，请在微信公众平台 -> 设置 -> 第三方服务，添加「同声传译」插件。\n当前可直接输入文字指令。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    // 插件可用，进入录音
    this.setData({ isRecording: true });
    try {
      const manager = siPlugin.getRecordRecognitionManager();
      manager.onStop = function (res) {
        that.setData({ isRecording: false });
        if (res.result) {
          that.setData({ voiceText: res.result });
          that.sendVoiceCommand();
        }
      };
      manager.onError = function () {
        that.setData({ isRecording: false });
        that.showToast('语音识别失败，请重试');
      };
      manager.start({ duration: 5000, lang: 'zh_CN' });

      // 5秒超时自动停止
      setTimeout(() => {
        if (that.data.isRecording) {
          try { manager.stop(); } catch (e) { /* ignore */ }
          that.setData({ isRecording: false });
        }
      }, 5000);
    } catch (e) {
      this.setData({ isRecording: false });
      this.showToast('语音启动失败');
    }
  },

  /**
   * 预览图片
   */
  previewImage() {
    if (this.data.imageUrl) {
      wx.previewImage({ current: this.data.imageUrl, urls: [this.data.imageUrl] });
    }
  },

  onImageError() {
    this.setData({
      hasImage: false,
      imageFadeIn: false,
      frameStatusText: '暂无最新检测画面，请确认相机/YOLO 服务已启动'
    });
  },

  /**
   * 导航画布
   */
  _drawNavCanvas(robotData) {
    const robot = robotData || this.data.robot;
    if (!robot || !robot.pose) return;
    const query = wx.createSelectorQuery();
    query.select('#navCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0]) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getWindowInfo().pixelRatio;
      const w = res[0].width, h = res[0].height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // 网格
      ctx.strokeStyle = '#E8E8ED'; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      const cx = w / 2, cy = h / 2;
      // 目标点
      if (robot.current_target && robot.current_target !== '--') {
        ctx.beginPath(); ctx.arc(cx + 40, cy - 30, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#34C759'; ctx.fill();
        ctx.fillStyle = '#1C1C1E'; ctx.font = '12px sans-serif'; ctx.fillText('🎯 目标', cx + 50, cy - 25);
      }
      // 机器人
      const yaw = robot.pose.yaw || 0;
      ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.fillStyle = '#007AFF'; ctx.fill();
      ctx.strokeStyle = '#0055CC'; ctx.lineWidth = 3; ctx.stroke();
      // 方向箭头
      const al = 25;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(yaw) * al, cy + Math.sin(yaw) * al);
      ctx.strokeStyle = '#FF9500'; ctx.lineWidth = 3; ctx.stroke();
      const as = 8, ha = Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(yaw) * al, cy + Math.sin(yaw) * al);
      ctx.lineTo(cx + Math.cos(yaw - ha) * (al - as), cy + Math.sin(yaw - ha) * (al - as));
      ctx.moveTo(cx + Math.cos(yaw) * al, cy + Math.sin(yaw) * al);
      ctx.lineTo(cx + Math.cos(yaw + ha) * (al - as), cy + Math.sin(yaw + ha) * (al - as));
      ctx.stroke();
      ctx.fillStyle = '#007AFF'; ctx.font = 'bold 11px sans-serif'; ctx.fillText('🤖', cx - 8, cy + 4);
    });
  },

  _scheduleNavCanvas() {
    this._clearTimers();
    this._navTimer = setInterval(() => this._drawNavCanvas(), 2000);
  },

  _clearTimers() {
    if (this._navTimer) { clearInterval(this._navTimer); this._navTimer = null; }
    if (this.data.toastTimer) { clearTimeout(this.data.toastTimer); }
  },

  showToast(msg, duration = 2000) {
    if (this.data.toastTimer) clearTimeout(this.data.toastTimer);
    this.setData({ toastVisible: true, toastMessage: msg });
    const timer = setTimeout(() => this.setData({ toastVisible: false }), duration);
    this.setData({ toastTimer: timer });
  },

  _formatApiError(error) {
    const map = {
      missing_public_api_token: '请先在设置页保存公网 Token',
      public_control_disabled: '公网控制未开启',
      unauthorized: '公网 Token 无效或缺失',
      robot_offline: 'RK3588 当前离线',
      rate_limited: '请求过于频繁'
    };
    return map[error] || error || '接口调用失败';
  },

  goToAlarms() { wx.switchTab({ url: '/pages/settings/settings' }); },

  formatDecimal: util.formatDecimal,
  formatYaw: util.formatYaw
});
