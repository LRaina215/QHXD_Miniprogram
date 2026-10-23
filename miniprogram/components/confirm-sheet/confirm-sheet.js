Component({
  options: { addGlobalClass: true },
  properties: {
    show: { type: Boolean, value: false },
    kicker: { type: String, value: '运动任务确认' },
    title: { type: String, value: '' },
    note: { type: String, value: '请在30秒内确认，离开页面需重新发起。任务由 RK3588 后端下发，执行状态请查看总览。' },
    rows: { type: Array, value: [] },
    confirmText: { type: String, value: '确认执行' },
    cancelText: { type: String, value: '取消' },
    loading: { type: Boolean, value: false },
    error: { type: String, value: '' }
  },
  methods: {
    onConfirm() {
      if (!this.data.loading) this.triggerEvent('confirm');
    },
    onCancel() {
      if (!this.data.loading) this.triggerEvent('cancel');
    },
    noop() {}
  }
});
