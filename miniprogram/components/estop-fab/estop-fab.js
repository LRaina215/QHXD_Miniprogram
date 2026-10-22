/**
 * 常驻急停按钮：触发不二次确认（一键可达）；解除急停需要确认。
 * 急停走 /api/platform/estop（FPGA MODE estop）；网关不支持时退回取消当前任务（MODE idle 停车）。
 */
const api = require('../../utils/api');
const store = require('../../utils/store');

Component({
  options: { addGlobalClass: true },
  data: { active: false, busy: false },
  lifetimes: {
    attached() {
      this.off = store.on('state', () => this.sync());
      this.sync();
    },
    detached() {
      if (this.off) this.off();
    }
  },
  methods: {
    sync() {
      const active = store.estopActive();
      if (active !== this.data.active) this.setData({ active });
    },
    onTap() {
      if (this.data.busy) return;
      if (this.data.active) {
        wx.showModal({
          title: '解除急停？',
          content: '解除后 FPGA 导航回到空闲状态；底盘控制侧锁存的急停需要在控制板上复位。',
          confirmText: '解除',
          success: (res) => { if (res.confirm) this.send(false); }
        });
        return;
      }
      wx.vibrateShort({ type: 'heavy' });
      this.send(true);
    },
    async send(engage) {
      this.setData({ busy: true });
      let res = await api.estop(engage);
      if (!res.ok && engage && (res.status === 404 || res.error === 'not_in_public_whitelist')) {
        res = await api.mission('cancel', {});
        if (res.ok) {
          wx.showToast({ title: '网关未更新，已改为取消任务停车', icon: 'none', duration: 3000 });
          this.setData({ busy: false });
          return;
        }
      }
      this.setData({ busy: false });
      const data = api.unwrap(res);
      if (res.ok && data && data.accepted !== false) {
        wx.showToast({ title: engage ? '急停已下发' : '已解除导航急停', icon: engage ? 'error' : 'success' });
        store.refresh();
      } else {
        wx.showModal({ title: engage ? '急停未送达' : '解除失败', content: (data && data.detail) || api.explain(res.error), showCancel: false });
      }
    }
  }
});
