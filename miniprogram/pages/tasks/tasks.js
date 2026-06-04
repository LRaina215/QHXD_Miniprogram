/**
 * 任务中心页面
 * 展示当前任务、历史任务、创建/取消任务
 */
const app = getApp();
const util = require('../../utils/util');
const commandClient = require('../../utils/commandClient');

Page({
  data: {
    currentTask: null,
    tasks: [],
    publicControlEnabled: false,
    hasToken: false,
    lastError: ''
  },

  onLoad() {
    this._bindEvents();
  },

  onShow() {
    this._loadTasks();
    this._loadControlState();
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
    this._onTelemetry = () => this._loadTasks();
    this._onSyncStatus = () => this._loadControlState();
  },

  _loadControlState() {
    this.setData({
      publicControlEnabled: !!app.globalData.publicControlEnabled,
      hasToken: !!commandClient.getToken(),
      lastError: app.globalData.lastError || ''
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
      tasks = telemetry.tasks;
      // 找到当前正在运行或待执行的任务
      currentTask = tasks.find(t => t.status === 'running' || t.status === 'pending') || null;
      // 按时间排序，取最近10条
      tasks = tasks.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 10);
    }

    this.setData({
      currentTask,
      tasks
    });
  },

  /**
   * 新建任务
   */
  createTask(e) {
    const type = e.currentTarget.dataset.type;
    if (!type) return;

    if (!app.globalData.publicControlEnabled) {
      this._showToast('公网控制未开启');
      return;
    }
    if (!commandClient.getToken()) {
      this._showToast('请先在设置页保存公网 Token');
      return;
    }

    const actionMap = {
      patrol: () => commandClient.startPatrol(),
      inspect: () => commandClient.startPatrol('patrol_default'),
      delivery: () => commandClient.goToWaypoint('wp_201'),
      charge: () => commandClient.returnHome()
    };
    const run = actionMap[type];
    if (!run) {
      this._showToast('暂未接入该任务类型');
      return;
    }

    wx.showModal({
      title: '新建任务确认',
      content: `确定创建「${util.getTaskTypeText(type)}」任务吗？`,
      confirmText: '确认',
      success: (res) => {
        if (!res.confirm) return;
        run().then((result) => {
          if (!result.ok) {
            this._showToast(this._formatApiError(result.error));
            return;
          }
          this._showToast(`已提交${util.getTaskTypeText(type)}任务`);
          app.refreshRobotSnapshot({ includeHealth: true });
        });
      }
    });
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
          commandClient.pause().then((result) => {
            this._showToast(result.ok ? '已提交暂停任务' : this._formatApiError(result.error));
            app.refreshRobotSnapshot({ includeHealth: true });
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

  // 工具函数
  getTaskTypeText: util.getTaskTypeText,
  getTaskTypeIcon: util.getTaskTypeIcon,
  getStatusText: util.getStatusText,
  formatRelativeTime: util.formatRelativeTime
});
