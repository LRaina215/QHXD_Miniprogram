/**
 * 首页 - 仪表盘
 * 展示实时遥测数据、实时图像、快捷指令
 */
const app = getApp();
const util = require('../../utils/util');
const dataCache = require('../../utils/dataCache');
const api = require('../../utils/api');
const commandClient = require('../../utils/commandClient');
const navigationMap = require('../../utils/navigationMap');

Page({
  data: {
    restOnline: false,
    wsConnected: false,
    cloudOnline: false,
    rkOnline: false,
    publicControlEnabled: false,
    navigationWsConnected: false,
    dataSource: 'rest',
    lastError: '',
    staleWarning: '',
    frameStatusText: '视觉状态待检测',
    systemMode: '--',
    backendUpdatedAt: '--',
    imuText: '暂无 IMU 数据',
    detectionEventText: '暂无视觉事件',
    perceptionEvents: [],
    videoHealthStatusText: '视频健康待检测',
    videoHealthDetail: '等待视频健康数据',
    yoloStatusText: '--',
    frameFreshText: '--',
    weather: null,
    weatherStatusText: '天气待刷新',
    weatherAdvice: '暂无出行建议',
    navigationStatusText: '导航状态待检测',
    navigationDetailText: '等待导航状态',
    navMapStatusText: '地图待检测',
    navMapDetailText: '未加载真实导航地图',
    commandLogText: '暂无命令日志',
    sensors: { co: '--', ch4: '--', air_quality: '--', flame: 0, temperature: '--', humidity: '--', status: '--' },
    robot: {
      battery: 0, status: 'idle', emergency_stop: false, fault_code: '--',
      pose: { x: 0, y: 0, yaw: 0 }, current_target: '--',
      remaining_distance: '--', running_hours: '--', firmware_version: '--'
    },
    perception: { detection: '--', confidence: 0 },
    alarmActive: false,
    alarmMessage: '',
    imageDataUri: '',
    hasImage: false,
    _lastImageUrl: '',
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
    poseDisplayX: '0',
    poseDisplayY: '0',
    poseDisplayYaw: '0°',
    voiceText: '',
    quickQuestions: [
      '现在导航前方有什么',
      '前方安全吗',
      '当前导航怎么样',
      '天气怎么样，适合出门吗'
    ],
    smartReply: '等待语音或文本指令',
    smartRecognizedText: '--',
    smartIntent: '--',
    smartParser: '--',
    smartTtsStatus: '--',
    smartNeedConfirm: false,
    smartPendingId: '',
    smartError: '',
    showSmartDebug: false,
    confirmingMission: false,
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
  },

  onShow() {
    // 监听全局事件
    app.onEvent('telemetryUpdate', this._onTelemetry);
    app.onEvent('robotSyncStatusChange', this._onRobotSyncStatus);

    this._updateSyncStatus();

    // 如果已经连接但还没有数据，检查一遍
    if (app.globalData.telemetry) {
      this._updateUI(app.globalData.telemetry);
    }

    this._scheduleNavCanvas();
    this._loadAuxiliaryData();
    this._scheduleAuxiliaryData();
  },

  onHide() {
    app.offEvent('telemetryUpdate', this._onTelemetry);
    app.offEvent('robotSyncStatusChange', this._onRobotSyncStatus);
    this._clearTimers();
  },

  onUnload() {
    app.offEvent('telemetryUpdate', this._onTelemetry);
    app.offEvent('robotSyncStatusChange', this._onRobotSyncStatus);
    this._clearTimers();
  },

  /**
   * 全局事件回调
   */
  _onTelemetry: null,
  _onRobotSyncStatus: null,

  _bindEvents() {
    const that = this;
    this._onTelemetry = function (data) { that._updateUI(data); };
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
    update.navigationWsConnected = !!(data.meta && data.meta.navigationWsConnected);
    update.dataSource = data.meta ? data.meta.dataSource : 'rest';
    update.lastError = data.meta ? data.meta.lastError : '';
    update.systemMode = data.system ? data.system.mode : '--';
    update.backendUpdatedAt = data.meta && data.meta.updatedAt ? this._formatIsoTime(data.meta.updatedAt) : '--';
    update.imuText = this._formatImu(data.imu);
    update.commandLogText = this._formatCommandLog(data.commandLogs);
    update.navigationStatusText = this._formatNavigationStatus(data.navigation || app.globalData.navigation);
    update.navigationDetailText = this._formatNavigationDetail(data.navigation || app.globalData.navigation);

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
      update['robot.fault_code'] = r.fault_code !== undefined && r.fault_code !== null ? r.fault_code : '--';
      update['robot.pose'] = r.pose || { x: 0, y: 0, yaw: 0 };
      update.poseDisplayX = util.formatDecimal(r.pose ? r.pose.x : 0);
      update.poseDisplayY = util.formatDecimal(r.pose ? r.pose.y : 0);
      update.poseDisplayYaw = util.formatYaw(r.pose ? r.pose.yaw : 0);
      update['robot.current_target'] = r.current_target || '--';
      update['robot.remaining_distance'] = r.remaining_distance !== undefined && r.remaining_distance !== null ? r.remaining_distance : '--';
      update['robot.running_hours'] = r.running_hours !== undefined && r.running_hours !== null ? r.running_hours : '--';
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
      update['perception.detection'] = data.perception.detection || '--';
      update['perception.confidence'] = conf;
      update.confidenceBarWidth = conf * 100;
      update.confidencePct = (conf * 100).toFixed(0);
      update.detectionEventText = this._formatDetectionEvents(data.perception.events);
      if (!this.data.perceptionEvents.length) {
        update.perceptionEvents = this._decoratePerceptionEvents(data.perception.events || []).slice(0, 5);
      }
    }

    // 告警
    if (data.alarm) {
      update.alarmActive = !!data.alarm.active;
      update.alarmMessage = data.alarm.message || '';
    }

    if (data.image && data.image.url && data.image.url !== this._lastImageUrl) {
      this._lastImageUrl = data.image.url;
      this._loadImageAsDataUri(data.image.url);
    }

    this.setData(update);
    dataCache.updateFromTelemetry(data);

    // 导航画布
    if (data.robot) this._drawNavCanvas(data.robot);
  },

  _scheduleAuxiliaryData() {
    if (this._auxTimer) clearInterval(this._auxTimer);
    this._auxTimer = setInterval(() => this._loadAuxiliaryData(), 15000);
  },

  async _loadAuxiliaryData() {
    const results = await Promise.all([
      api.getPerceptionEvents(10),
      api.getVideoHealth(),
      api.getWeatherLatest(),
      api.getNavigationLatest(),
      api.getNavigationMapMetadata()
    ]);
    const eventsResult = results[0];
    const videoResult = results[1];
    const weatherResult = results[2];
    const navigationResult = results[3];
    const mapResult = results[4];
    const update = {};

    if (eventsResult.ok) {
      const events = this._extractDataList(eventsResult.data);
      update.perceptionEvents = this._decoratePerceptionEvents(events).slice(0, 6);
      update.detectionEventText = this._formatDetectionEvents(events);
    }

    if (videoResult.ok) {
      const video = this._extractDataObject(videoResult.data);
      Object.assign(update, this._decorateVideoHealth(video));
    } else {
      update.videoHealthStatusText = '视频健康不可用';
      update.videoHealthDetail = this._formatApiError(videoResult.error);
      update.yoloStatusText = '--';
      update.frameFreshText = '--';
    }

    if (weatherResult.ok) {
      const weather = this._extractDataObject(weatherResult.data);
      update.weather = this._decorateWeather(weather);
      update.weatherStatusText = weather && weather.is_stale ? '缓存天气' : '实时天气';
      update.weatherAdvice = weather && weather.advice ? weather.advice : '暂无出行建议';
    } else {
      update.weatherStatusText = '天气不可用';
      update.weatherAdvice = this._formatApiError(weatherResult.error);
    }

    if (navigationResult.ok) {
      const navigation = this._extractDataObject(navigationResult.data);
      app.globalData.navigation = navigation || app.globalData.navigation;
      update.navigationStatusText = this._formatNavigationStatus(navigation);
      update.navigationDetailText = this._formatNavigationDetail(navigation);
    }

    if (mapResult.ok) {
      const metadata = navigationMap.getMapMetadata(mapResult.data);
      if (metadata) {
        this._navigationMapMeta = metadata;
        update.navMapStatusText = '真实地图';
        update.navMapDetailText = `${metadata.mapId} · ${metadata.width}×${metadata.height} · ${metadata.resolution}m`;
        this._ensureNavigationMapImage(metadata);
      }
    } else {
      this._navigationMapMeta = null;
      this._navigationMapImagePath = '';
      update.navMapStatusText = '地图不可用';
      update.navMapDetailText = this._formatApiError(mapResult.error);
    }

    this.setData(update);
    this._drawNavCanvas();
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

  useQuickQuestion(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    this.setData({ voiceText: text });
    this.sendVoiceCommand();
  },

  sendVoiceCommand() {
    const text = this.data.voiceText.trim();
    if (!text) { this.showToast('请输入指令'); return; }
    commandClient.smartCommand(text).then((result) => {
      if (!result.ok) {
        this.setData({
          smartReply: this._formatApiError(result.error),
          smartError: result.error || '接口调用失败',
          smartRecognizedText: text,
          smartIntent: '--',
          smartParser: '--',
          smartTtsStatus: '--',
          smartNeedConfirm: false,
          smartPendingId: ''
        });
        this.showToast(this._formatApiError(result.error));
        return;
      }
      const payload = result.data && result.data.data;
      if (!payload) {
        this.showToast('智能助手未返回结果');
        return;
      }
      this._setSmartResult(payload);
      if (payload.need_confirm && payload.pending_command_id) {
        // 内联确认卡片已显示，不弹窗
      } else {
        this.showToast(payload.reply_text || '智能助手已处理');
      }
      this.setData({ voiceText: '' });
    });
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

  _loadImageAsDataUri(imageUrl) {
    if (this._imageLoading) return;
    this._imageLoading = true;
    const that = this;
    wx.request({
      url: imageUrl,
      responseType: 'arraybuffer',
      timeout: 6000,
      success(res) {
        that._imageLoading = false;
        if (res.statusCode !== 200 || !res.data) return;
        const base64 = wx.arrayBufferToBase64(res.data);
        that.setData({ imageDataUri: 'data:image/jpeg;base64,' + base64, hasImage: true });
      },
      fail() {
        that._imageLoading = false;
        that.setData({ hasImage: false });
      }
    });
  },

  previewImage() {
    if (this.data.imageDataUri) {
      wx.previewImage({ urls: [this.data.imageDataUri] });
    }
  },

  /**
   * 导航画布
   */
  _drawNavCanvas(robotData) {
    const robot = robotData || this.data.robot;
    const navigation = app.globalData.navigation || null;
    const navPose = navigationMap.getPose(navigation);
    if ((!robot || !robot.pose) && !navPose) return;
    const drawRobot = robot && robot.pose ? robot : { pose: navPose, current_target: '--' };
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

      const metadata = this._navigationMapMeta;
      const viewport = navigationMap.createViewport(metadata, w, h, 12);
      if (metadata && viewport && this._navigationMapImagePath) {
        this._drawNavigationMap(ctx, canvas, viewport, metadata, navigation, drawRobot);
        return;
      }
      this._drawFallbackNavCanvas(ctx, w, h, drawRobot);
    });
  },

  _drawFallbackNavCanvas(ctx, w, h, robot) {
      // 网格
      ctx.strokeStyle = '#E8E8ED'; ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      const cx = w / 2, cy = h / 2;
      // 目标点
      if (robot.current_target && robot.current_target !== '--') {
        ctx.beginPath(); ctx.arc(cx + 40, cy - 30, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#34C759'; ctx.fill();
        ctx.fillStyle = '#1C1C1E'; ctx.font = '12px sans-serif'; ctx.fillText('TARGET', cx + 52, cy - 25);
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
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BOT', cx, cy + 4);
      ctx.textAlign = 'start';
  },

  _drawNavigationMap(ctx, canvas, viewport, metadata, navigation, robot) {
    const image = this._navigationMapCanvasImage;
    if (image) {
      ctx.drawImage(image, viewport.x, viewport.y, viewport.width, viewport.height);
    } else if (this._navigationMapImagePath && !this._navigationMapCanvasImageLoading) {
      this._navigationMapCanvasImageLoading = true;
      const canvasImage = canvas.createImage();
      canvasImage.onload = () => {
        this._navigationMapCanvasImageLoading = false;
        this._navigationMapCanvasImage = canvasImage;
        this._drawNavCanvas();
      };
      canvasImage.onerror = () => {
        this._navigationMapCanvasImageLoading = false;
      };
      canvasImage.src = this._navigationMapImagePath;
      ctx.fillStyle = '#F9F9FB';
      ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
    } else {
      ctx.fillStyle = '#F9F9FB';
      ctx.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
    }

    ctx.strokeStyle = '#D1D8E2';
    ctx.lineWidth = 1;
    ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);

    const globalPath = navigationMap.getPath(navigation, 'global_path');
    const localPath = navigationMap.getPath(navigation, 'local_path');
    this._drawMapPath(ctx, globalPath, metadata, viewport, '#F5A623', 2.5, [8, 7]);
    this._drawMapPath(ctx, localPath, metadata, viewport, '#1A6DD4', 3, []);

    const goal = navigationMap.getGoal(navigation);
    if (goal) {
      const point = navigationMap.worldToCanvas(goal, metadata, viewport);
      if (point) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#34C759';
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    const pose = navigationMap.getPose(navigation) || (robot && robot.pose);
    if (pose) {
      const point = navigationMap.worldToCanvas(pose, metadata, viewport);
      if (point) this._drawRobotMarker(ctx, point.x, point.y, pose.yaw || 0);
    }
  },

  _drawMapPath(ctx, path, metadata, viewport, color, width, dash) {
    if (!Array.isArray(path) || path.length < 2) return;
    ctx.save();
    ctx.beginPath();
    path.forEach((item, index) => {
      const point = navigationMap.worldToCanvas(item, metadata, viewport);
      if (!point) return;
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash || []);
    ctx.stroke();
    ctx.restore();
  },

  _drawRobotMarker(ctx, x, y, yaw) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(yaw);
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = '#1A6DD4';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-6, -7);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = '#1A6DD4';
    ctx.fill();
    ctx.restore();
  },

  _ensureNavigationMapImage(metadata) {
    const version = metadata && metadata.version ? metadata.version : '';
    if (this._navigationMapImageVersion === version && this._navigationMapImagePath) return;
    this._navigationMapImageVersion = version;
    wx.getImageInfo({
      src: api.getNavigationMapImageUrl(),
      success: (res) => {
        this._navigationMapImagePath = res.path;
        this._navigationMapCanvasImage = null;
        this._navigationMapCanvasImageLoading = false;
        this._drawNavCanvas();
      },
      fail: () => {
        this._navigationMapImagePath = '';
        this._navigationMapCanvasImage = null;
        this._navigationMapCanvasImageLoading = false;
        this.setData({
          navMapStatusText: '地图图像不可用',
          navMapDetailText: '已读取 metadata，但地图图片未加载'
        });
      }
    });
  },

  _scheduleNavCanvas() {
    this._clearTimers();
    this._navTimer = setInterval(() => this._drawNavCanvas(), 2000);
  },

  _clearTimers() {
    if (this._navTimer) { clearInterval(this._navTimer); this._navTimer = null; }
    if (this._auxTimer) { clearInterval(this._auxTimer); this._auxTimer = null; }
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
      rate_limited: '请求过于频繁',
      http_404: '接口暂不可用'
    };
    return map[error] || error || '接口调用失败';
  },

  _setSmartResult(payload) {
    this.setData({
      smartReply: payload.reply_text || payload.error_reason || '智能助手已处理',
      smartRecognizedText: payload.recognized_text || '--',
      smartIntent: payload.intent || '--',
      smartParser: payload.parser || '--',
      smartTtsStatus: payload.tts_status ? payload.tts_status.status : '--',
      smartNeedConfirm: !!payload.need_confirm,
      smartPendingId: payload.pending_command_id || '',
      smartError: payload.error_reason || '',
      showSmartDebug: false
    });
  },

  toggleSmartDebug() {
    this.setData({ showSmartDebug: !this.data.showSmartDebug });
  },

  confirmMissionCommand() {
    const pendingId = this.data.smartPendingId;
    if (!pendingId || this.data.confirmingMission) return;
    this.setData({ confirmingMission: true });
    commandClient.confirmVoiceCommand(pendingId, true).then((result) => {
      this.setData({ confirmingMission: false });
      if (result.ok) {
        this.setData({
          smartReply: '指令已确认执行',
          smartNeedConfirm: false,
          smartPendingId: ''
        });
      } else {
        this.setData({
          smartReply: this._formatApiError(result.error) || '确认失败',
          smartError: result.error || 'confirm_failed'
        });
      }
      this.showToast(result.ok ? '指令已确认执行' : this._formatApiError(result.error));
      app.refreshRobotSnapshot({ includeHealth: true });
    }).catch(() => {
      this.setData({ confirmingMission: false });
      this.showToast('确认接口调用失败');
    });
  },

  cancelMissionCommand() {
    const pendingId = this.data.smartPendingId;
    if (!pendingId || this.data.confirmingMission) return;
    this.setData({ confirmingMission: true });
    commandClient.confirmVoiceCommand(pendingId, false).then(() => {
      this.setData({
        confirmingMission: false,
        smartReply: '指令已取消',
        smartNeedConfirm: false,
        smartPendingId: '',
        smartError: ''
      });
      this.showToast('指令已取消');
    }).catch(() => {
      this.setData({ confirmingMission: false });
      this.showToast('取消接口调用失败');
    });
  },

  _formatIsoTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  },

  _formatImu(imu) {
    if (!imu || !imu.imu) {
      return '暂无 IMU 数据';
    }
    console.log('[index] _formatImu yaw=', imu.imu.euler_deg?.yaw, 'source=', imu.source);
    const euler = imu.imu.euler_deg;
    if (euler) {
      return `yaw ${util.formatDecimal(euler.yaw, 1)}° · pitch ${util.formatDecimal(euler.pitch, 1)}° · roll ${util.formatDecimal(euler.roll, 1)}°`;
    }
    const av = imu.imu.angular_velocity || {};
    return `角速度 x ${util.formatDecimal(av.x, 2)} · y ${util.formatDecimal(av.y, 2)} · z ${util.formatDecimal(av.z, 2)}`;
  },

  _formatDetectionEvents(events) {
    if (!Array.isArray(events) || events.length === 0) return '暂无视觉事件';
    return events.slice(0, 2).map(item => item.message || item.event_type || '视觉事件').join('；');
  },

  _extractDataObject(payload) {
    if (!payload) return null;
    return payload.data !== undefined ? payload.data : payload;
  },

  _extractDataList(payload) {
    const data = this._extractDataObject(payload);
    return Array.isArray(data) ? data : [];
  },

  _decoratePerceptionEvents(events) {
    if (!Array.isArray(events)) return [];
    return events.map((item, index) => {
      const confidence = item.max_confidence || item.confidence || 0;
      return {
        id: item.event_id || `vision-${index}`,
        typeText: this._formatEventType(item.event_type),
        className: item.class_name || item.label || '--',
        message: item.message || item.event_type || '视觉事件',
        confidenceText: confidence ? `${Math.round(confidence * 100)}%` : '--',
        countText: item.count !== undefined ? `${item.count} 次` : '--',
        timeText: this._formatIsoTime(item.last_seen_at || item.timestamp || item.updated_at),
        level: item.level || 'info'
      };
    });
  },

  _decorateVideoHealth(video) {
    if (!video) {
      return {
        videoHealthStatusText: '视频健康无数据',
        videoHealthDetail: '等待相机服务上报',
        yoloStatusText: '--',
        frameFreshText: '--'
      };
    }
    const ok = video.status === 'ok' && video.latest_frame_fresh && video.yolo_camera_running;
    const frameAge = video.latest_frame_age_s !== undefined && video.latest_frame_age_s !== null
      ? `${Number(video.latest_frame_age_s).toFixed(1)} 秒`
      : '--';
    return {
      videoHealthStatusText: ok ? '视觉链路正常' : '视觉链路未刷新',
      videoHealthDetail: video.detail || (video.latest_frame_fresh ? '最新帧可用' : '最新帧过期或缺失'),
      yoloStatusText: video.yolo_camera_running ? 'YOLO 运行中' : '相机服务未运行',
      frameFreshText: video.latest_frame_fresh ? `最新帧 ${frameAge}` : `未刷新 ${frameAge}`
    };
  },

  _decorateWeather(weather) {
    if (!weather) return null;
    return {
      location: weather.location || '--',
      temperature: this._formatNumber(weather.temperature_c, 1),
      apparent: this._formatNumber(weather.apparent_temperature_c, 1),
      humidity: this._formatNumber(weather.humidity_percent, 0),
      rain: this._formatNumber(weather.precipitation_probability_percent, 0),
      uv: this._formatNumber(weather.uv_index, 1),
      weather: weather.weather || '--',
      wind: weather.wind || '--',
      staleText: weather.is_stale ? '缓存' : '实时'
    };
  },

  _formatNavigationStatus(navigation) {
    if (!navigation) return '导航状态待检测';
    return navigation.state || navigation.status || navigation.nav_state || '导航状态可用';
  },

  _formatNavigationDetail(navigation) {
    if (!navigation) return '等待导航状态';
    const goal = navigation.current_goal || navigation.goal || navigation.target || '';
    const distance = navigation.remaining_distance !== undefined && navigation.remaining_distance !== null
      ? `${this._formatNumber(navigation.remaining_distance, 2)}m`
      : '';
    const parts = [];
    if (goal) parts.push(`目标 ${goal}`);
    if (distance) parts.push(`距离 ${distance}`);
    if (navigation.map_id) parts.push(`地图 ${navigation.map_id}`);
    return parts.join(' · ') || '导航数据已连接';
  },

  _formatEventType(type) {
    const map = {
      person_detected: '人员',
      obstacle_detected: '障碍',
      camera_offline: '相机离线',
      camera_recovered: '相机恢复'
    };
    return map[type] || type || '视觉';
  },

  _formatNumber(value, digits = 1) {
    if (value === undefined || value === null || value === '') return '--';
    const number = Number(value);
    if (!Number.isFinite(number)) return '--';
    return number.toFixed(digits);
  },

  _formatCommandLog(logs) {
    if (!Array.isArray(logs) || logs.length === 0) return '暂无命令日志';
    const latest = logs[0];
    return `${latest.command || '--'} · ${latest.accepted ? 'accepted' : 'rejected'}`;
  },

  goToAlarms() { wx.switchTab({ url: '/pages/settings/settings' }); },

  formatDecimal: util.formatDecimal,
  formatYaw: util.formatYaw
});
