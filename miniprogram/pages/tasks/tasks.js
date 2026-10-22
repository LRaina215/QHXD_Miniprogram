/**
 * 任务中心页面
 * 展示当前任务、历史任务、创建/取消任务
 */
const app = getApp();
const util = require('../../utils/util');
const api = require('../../utils/api');
const commandClient = require('../../utils/commandClient');

Page({
  data: {
    currentTask: null,
    tasks: [],
    taskEvents: [],
    commandLogs: [],
    waypoints: [],
    publicControlEnabled: false,
    hasToken: false,
    operationBusy: false,
    lastError: ''
  },

  onLoad() {
    this._bindEvents();
  },

  onShow() {
    this._loadTasks();
    this._loadTaskEvents();
    this._loadControlState();
    this._loadWaypoints();
    app.onEvent('telemetryUpdate', this._onTelemetry);
    app.onEvent('robotSyncStatusChange', this._onSyncStatus);
  },

  onHide() {
    app.offEvent('telemetryUpdate', this._onTelemetry);
    app.offEvent('robotSyncStatusChange', this._onSyncStatus);
  },

  onUnload() {
    app.offEvent('telemetryUpdate', this._onTelemetry);
    app.offEvent('robotSyncStatusChange', this._onSyncStatus);
  },

  _onTelemetry: null,
  _onSyncStatus: null,

  _bindEvents() {
    this._onTelemetry = () => {
      this._loadTasks();
      this._loadTaskEvents();
    };
    this._onSyncStatus = () => this._loadControlState();
  },

  _loadControlState() {
    this.setData({
      publicControlEnabled: !!app.globalData.publicControlEnabled,
      hasToken: !!commandClient.getToken(),
      lastError: app.globalData.lastError || '',
      commandLogs: (app.globalData.commandLogs || []).slice(0, 8)
    });
  },

  async _loadWaypoints() {
    const result = await api.getWaypoints();
    if (!result.ok) {
      this.setData({ waypoints: [] });
      return;
    }
    const payload = result.data || {};
    const waypoints = Array.isArray(payload.data) ? payload.data : [];
    this.setData({
      waypoints: waypoints.filter(item => item.enabled).map(item => Object.assign({}, item, {
        displayCode: item.waypoint_id === 'home' ? 'HM' : item.waypoint_id.replace('wp_', '').slice(-2),
        displayStatus: item.configured ? item.waypoint_id : '待配置坐标'
      }))
    });
  },

  /**
   * 加载任务数据
   */
  _loadTasks() {
    const telemetry = app.globalData.telemetry;
    let currentTask = null;
    let tasks = [];

    if (telemetry && telemetry.tasks) {
      const allTasks = telemetry.tasks;
      // 找到当前正在运行或待执行的任务
      currentTask = allTasks.find(t => t.status === 'running' || t.status === 'pending') || null;
      // 按时间排序，取最近10条
      tasks = allTasks.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 10);
    }

    this.setData({
      currentTask: currentTask ? this._decorateTask(currentTask) : null,
      tasks: tasks.map(task => this._decorateTask(task))
    });
  },

  _decorateTask(task) {
    return Object.assign({}, task, {
      displayGlyph: this.getTaskGlyph(task.type),
      displayTypeText: util.getTaskTypeText(task.type),
      displayTimeText: util.formatRelativeTime(task.timestamp),
      displayStatusText: util.getStatusText(task.status)
    });
  },

  async _loadTaskEvents() {
    const result = await api.getTaskEvents();
    if (!result.ok) {
      this.setData({ taskEvents: [] });
      return;
    }
    const payload = result.data || {};
    const events = Array.isArray(payload.data) ? payload.data : [];
    this.setData({
      taskEvents: events.slice(0, 12).map((event) => this._decorateTaskEvent(event))
    });
  },

  _decorateTaskEvent(event) {
    const type = event.event_type || event.task_state || 'event';
    const distance = event.remaining_distance !== undefined && event.remaining_distance !== null
      ? `${Number(event.remaining_distance).toFixed(2)}m`
      : '';
    return Object.assign({}, event, {
      displayType: this._formatTaskEventType(type),
      displayTime: this._formatIsoTime(event.timestamp),
      displayDetail: event.detail || event.task_state || '--',
      displayMeta: [event.waypoint_id, distance, event.progress !== undefined ? `${event.progress}%` : '']
        .filter(Boolean)
        .join(' · '),
      levelClass: ['failed', 'cancelled', 'rejected'].includes(type) ? 'bad' : ['completed', 'arrived'].includes(type) ? 'ok' : 'info'
    });
  },

  /**
   * 执行真实 mission 操作
   */
  runMissionAction(e) {
    const actionKey = e.currentTarget.dataset.action;
    if (!actionKey || this.data.operationBusy) return;

    if (!app.globalData.publicControlEnabled) {
      this._showToast('公网控制未开启');
      return;
    }
    if (!commandClient.getToken()) {
      this._showToast('请先在设置页保存公网 Token');
      return;
    }

    const actionMap = {
      patrol: {
        title: '开始巡检',
        content: '确定启动默认巡检任务吗？',
        done: '已提交巡检任务',
        run: () => commandClient.startPatrol()
      },
      pause: {
        title: '暂停任务',
        content: '确定暂停当前任务吗？',
        done: '已提交暂停任务',
        run: () => commandClient.pause()
      },
      resume: {
        title: '恢复任务',
        content: '确定恢复当前任务吗？',
        done: '已提交恢复任务',
        run: () => commandClient.resume()
      },
      return_home: {
        title: '返回 Home',
        content: '确定让机器人返回 Home 吗？',
        done: '已提交返航任务',
        run: () => commandClient.returnHome()
      },
      cancel: {
        title: '取消任务',
        content: '确定取消当前任务吗？取消后不能继续恢复。',
        done: '已提交取消任务',
        run: () => commandClient.cancel()
      }
    };
    if (actionKey === 'waypoint') {
      const waypointId = e.currentTarget.dataset.waypointId;
      const waypoint = this.data.waypoints.find(item => item.waypoint_id === waypointId);
      if (!waypoint) {
        this._showToast('目标点不存在');
        return;
      }
      if (!waypoint.configured) {
        this._showToast('该目标点尚未配置地图坐标');
        return;
      }
      actionMap.waypoint = {
        title: `前往${waypoint.name}`,
        content: `确定让机器人前往${waypoint.name}吗？`,
        done: `已提交${waypoint.name}导航`,
        run: () => commandClient.goToWaypoint(waypoint.waypoint_id)
      };
    }
    const action = actionMap[actionKey];
    if (!action) {
      this._showToast('暂未接入该任务操作');
      return;
    }

    wx.showModal({
      title: action.title,
      content: action.content,
      confirmText: '确认',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ operationBusy: true });
        action.run().then((result) => {
          if (!result.ok) {
            this._showToast(this._formatApiError(result.error));
            this.setData({ operationBusy: false });
            return;
          }
          this._showToast(action.done);
          app.refreshRobotSnapshot({ includeHealth: true });
          this._loadTaskEvents();
          this.setData({ operationBusy: false });
        }).catch(() => {
          this._showToast('任务接口调用失败');
          this.setData({ operationBusy: false });
        });
      }
    });
  },

  createTask(e) {
    const type = e.currentTarget.dataset.type;
    const map = {
      patrol: 'patrol',
      inspect: 'patrol',
      delivery: 'go_to_1',
      charge: 'return_home'
    };
    this.runMissionAction({ currentTarget: { dataset: { action: map[type] || type } } });
  },

  /**
   * 取消任务
   */
  cancelTask(e) {
    const taskId = e.currentTarget.dataset.id;
    const taskType = e.currentTarget.dataset.type;

    wx.showModal({
      title: '取消任务',
      content: `确定要取消「${util.getTaskTypeText(taskType)}」任务吗？`,
      confirmText: '确认取消',
      confirmColor: '#FF3B30',
      success: (res) => {
        if (res.confirm) {
          if (!app.globalData.publicControlEnabled) {
            this._showToast('公网控制未开启');
            return;
          }
          if (!commandClient.getToken()) {
            this._showToast('请先在设置页保存公网 Token');
            return;
          }
          commandClient.cancel().then((result) => {
            this._showToast(result.ok ? '已提交取消任务' : this._formatApiError(result.error));
            app.refreshRobotSnapshot({ includeHealth: true });
            this._loadTaskEvents();
          });
        }
      }
    });
  },

  /**
   * Toast 提示
   */
  _showToast(msg) {
    wx.showToast({
      title: msg,
      icon: 'none',
      duration: 2000
    });
  },

  _formatApiError(error) {
    const map = {
      missing_public_api_token: '请先在设置页保存公网 Token',
      public_control_disabled: '公网控制未开启',
      unauthorized: '公网 Token 无效或缺失',
      robot_offline: 'RK3588 当前离线'
    };
    return map[error] || error || '任务接口调用失败';
  },

  getTaskGlyph(type) {
    const map = {
      patrol: 'PT',
      inspect: 'IN',
      delivery: 'DL',
      charge: 'CH',
      go_to: 'GO',
      go_to_waypoint: 'GO',
      start_patrol: 'PT',
      return_home: 'HM',
      placeholder: '--',
      custom: 'CU'
    };
    return map[type] || 'TK';
  },

  _formatTaskEventType(type) {
    const map = {
      pending: '待发送',
      accepted: '已接收',
      started: '已开始',
      running: '运行中',
      feedback: '反馈',
      arrived: '已到达',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
      rejected: '已拒绝'
    };
    return map[type] || type || '事件';
  },

  _formatIsoTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  },

  // 工具函数
  getTaskTypeText: util.getTaskTypeText,
  getTaskTypeIcon: util.getTaskTypeIcon,
  getStatusText: util.getStatusText,
  formatRelativeTime: util.formatRelativeTime
});
