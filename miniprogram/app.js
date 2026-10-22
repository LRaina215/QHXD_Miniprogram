const store = require('./utils/store');

App({
  onLaunch() {
    this.store = store;
  },

  onShow() {
    store.start();
  },

  onHide() {
    store.stop();
  }
});
