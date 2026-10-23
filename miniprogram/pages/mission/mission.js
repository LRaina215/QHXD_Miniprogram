const store = require('../../utils/store');
const view = require('../../utils/view');
const actions = require('../../utils/actions');
const L = require('../../utils/labels');
const confirmation = require('../../utils/confirmation');

const CLASSES = L.CLASSES.map((c) => ({ id: c.id, name: c.name, icon: c.icon || c.id }));

Page({
  data: {
    tab: 'vision',
    classes: CLASSES,
    colors: L.COLORS,
    cls: 'bottle',
    color: 'red',
    label: '红色水瓶',
    points: [],
    selected: '',
    selectedName: '',
    route: [],
    hero: view.hero(store),
    events: [],
    sheet: { show: false, title: '', rows: [], loading: false, error: '' }
  },

  onShow() {
    confirmation.show(this);
    this.offs = [
      store.on('state', () => this.setData({ hero: view.hero(store) })),
      store.on('waypoints', () => this.renderPoints()),
      store.on('events', () => this.setData({ events: view.events(store, 30) }))
    ];
    this.renderPoints();
    this.setData({ hero: view.hero(store), events: view.events(store, 30) });
  },

  onHide() {
    confirmation.leave(this);
    clearTimeout(this.homeTimer);
    (this.offs || []).forEach((off) => off());
    this.offs = [];
  },

  onUnload() {
    this.onHide();
  },

  onPullDownRefresh() {
    store.refresh().then(() => wx.stopPullDownRefresh());
  },

  renderPoints() {
    const points = store.waypoints.filter((w) => w.configured !== false && w.pose).map((w) => ({
      waypoint_id: w.waypoint_id,
      name: w.name,
      xy: L.fmt(w.pose.x, 1) + ', ' + L.fmt(w.pose.y, 1)
    }));
    let selected = this.data.selected;
    if (!points.some((p) => p.waypoint_id === selected)) {
      const first = points.find((p) => p.waypoint_id !== 'home') || points[0];
      selected = first ? first.waypoint_id : '';
    }
    const route = store.waypoints.filter((w) => w.group === 'patrol').map((w) => w.name);
    this.setData({ points, selected, selectedName: view.waypointName(store, selected), route });
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onClass(e) {
    const cls = e.currentTarget.dataset.id;
    this.setData({ cls, label: L.targetLabel(cls, this.data.color) });
  },

  onColor(e) {
    const id = e.currentTarget.dataset.id;
    const color = this.data.color === id ? '' : id;
    this.setData({ color, label: L.targetLabel(this.data.cls, color) });
  },

  onPoint(e) {
    const selected = e.currentTarget.dataset.id;
    this.setData({ selected, selectedName: view.waypointName(store, selected) });
  },

  busyGuard() {
    if (!store.taskActive()) return false;
    wx.showToast({ title: '已有任务在执行，请先取消', icon: 'none' });
    return true;
  },

  onSearch() {
    if (this.busyGuard()) return;
    this.ask('search_target', { target_class: this.data.cls, color: this.data.color || null, label: this.data.label, timeout_s: 180 });
  },

  onFollow() {
    if (this.busyGuard()) return;
    this.ask('follow_target', { target_class: 'person', label: '我', timeout_s: 300 });
  },

  onGoto() {
    if (this.busyGuard() || !this.data.selected) return;
    this.ask('go_to_waypoint', { waypoint_id: this.data.selected });
  },

  onPatrol() {
    if (this.busyGuard()) return;
    this.ask('start_patrol', { patrol_id: 'default_patrol' });
  },

  onResume() {
    this.ask('resume', {});
  },

  async onPause() {
    if (this._confirmationHidden || !this.data.hero.canPause || this.pauseRequest) return;
    const visit = confirmation.capture(this);
    this.pauseRequest = visit;
    try {
      const r = await actions.run('pause', {});
      if (confirmation.current(this, visit)) wx.showToast({ title: r.detail, icon: 'none', duration: 3500 });
    } finally { this.pauseRequest = null; store.refresh(); }
  },

  onCancel() {
    if (this._confirmationHidden || !this.data.hero.canCancel || this.cancelRequest) return;
    const visit = confirmation.capture(this);
    const taskId = store.task() && store.task().task_id;
    this.cancelRequest = visit;
    wx.showModal({
      title: '取消当前任务？',
      content: 'FPGA 会立即停车，任务不能恢复。',
      confirmText: '取消任务',
      confirmColor: '#e5263b',
      cancelText: '再想想',
      success: async (res) => {
        try {
          if (!res.confirm || !confirmation.current(this, visit)) return;
          if (!store.task() || store.task().task_id !== taskId) {
            wx.showToast({ title: '任务已变化，请重新操作', icon: 'none' });
            return;
          }
          const r = await actions.run('cancel', {});
          if (confirmation.current(this, visit)) wx.showToast({ title: r.detail, icon: 'none', duration: 3500 });
          store.refresh();
        } finally { this.cancelRequest = null; }
      },
      fail: () => { this.cancelRequest = null; }
    });
  },

  ask(command, body) {
    const s = actions.sheetFor(command, body, store);
    confirmation.open(this, { command, body, taskId: store.task() && store.task().task_id }, s);
  },

  async onSheetConfirm() {
    let command;
    const r = await confirmation.run(this, (p) => {
      command = p.command;
      if (command === 'resume' && (!store.task() || store.task().task_id !== p.taskId)) return { ok: false, detail: '任务已变化，请重新确认' };
      if (command !== 'resume' && store.taskActive()) return { ok: false, detail: '已有任务在执行，请先查看当前任务' };
      return actions.run(command, p.body);
    });
    if (!r) return;
    store.refresh();
    if (!r.ok) {
      wx.showModal({ title: r.uncertain ? '执行结果未确认' : '任务未受理', content: r.detail, showCancel: false });
      return;
    }
    wx.showToast({ title: r.detail, icon: 'none', duration: 2500 });
    const visit = confirmation.capture(this);
    if (command !== 'resume') this.homeTimer = setTimeout(() => {
      if (confirmation.current(this, visit)) wx.switchTab({ url: '/pages/home/home' });
    }, 600);
  },

  onSheetCancel() {
    if (!this._confirmationRequest) confirmation.close(this);
  }
});
