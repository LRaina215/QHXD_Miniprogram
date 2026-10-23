/**
 * 常驻急停按钮：触发不二次确认（一键可达）；解除急停需要确认。
 * 急停走 /api/platform/estop（FPGA MODE estop）；网关不支持时退回取消当前任务（MODE idle 停车）。
 */
const api = require('../../utils/api');
const store = require('../../utils/store');
const confirmation = require('../../utils/confirmation');

Component({
  options: { addGlobalClass: true },
  data: { active: false, busy: false },
  lifetimes: {
    attached() {
      confirmation.show(this);
      this.off = store.on('state', () => this.sync());
      this.sync();
    },
    detached() {
      this._confirmationHidden = true;
      if (this.off) this.off();
    }
  },
  methods: {
    sync() {
      const active = store.estopActive();
      if (active !== this.data.active) this.setData({ active });
    },
    onTap() {
      if (this.data.busy || this.releasePrompt) return;
      if (this.data.active) {
        const visit = confirmation.capture(this);
        this.releasePrompt = true;
        wx.showModal({
          title: '解除急停？',
          content: '解除后 FPGA 导航回到空闲状态；底盘控制侧锁存的急停需要在控制板上复位。',
          confirmText: '解除',
          success: (res) => {
            this.releasePrompt = false;
            if (res.confirm && confirmation.current(this, visit)) this.send(false);
          },
          fail: () => { this.releasePrompt = false; }
        });
        return;
      }
      wx.vibrateShort({ type: 'heavy' });
      this.send(true);
    },
    async send(engage) {
      if (this.data.busy || this._confirmationHidden) return;
      const visit = confirmation.capture(this);
      this.setData({ busy: true });
      let res = await api.estop(engage);
      if (!res.ok && engage && confirmation.sameContext(visit.context) && (res.status === 404 || res.error === 'not_in_public_whitelist')) {
        res = await api.mission('cancel', {});
        const fallback = api.unwrap(res);
        if (res.ok && fallback && res.data.success !== false && fallback.accepted === true && confirmation.current(this, visit)) {
          wx.showToast({ title: '网关未更新，已改为取消任务停车', icon: 'none', duration: 3000 });
          this.setData({ busy: false });
          store.refresh();
          return;
        }
      }
      this.setData({ busy: false });
      if (!confirmation.current(this, visit)) return;
      const data = api.unwrap(res);
      if (res.ok && data && res.data.success !== false && data.accepted === true) {
        wx.showToast({ title: engage ? '急停已下发' : '已解除导航急停', icon: engage ? 'error' : 'success' });
        store.refresh();
      } else {
        const unknown = res.uncertain || (res.ok && (!data || typeof data.accepted !== 'boolean'));
        wx.showModal({ title: unknown ? '急停操作结果未确认' : (engage ? '急停未受理' : '解除失败'), content: (data && data.detail) || api.failureText(unknown ? { uncertain: true } : res), showCancel: false });
        store.refresh();
      }
    }
  }
});
