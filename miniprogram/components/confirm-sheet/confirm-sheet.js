Component({
  options: { addGlobalClass: true },
  properties: {
    show: { type: Boolean, value: false },
    kicker: { type: String, value: '运动任务确认' },
    title: { type: String, value: '' },
    note: { type: String, value: '确认后任务交给 FPGA 导航执行，速度由 FPGA 安全限幅；随时可以按急停。' },
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
