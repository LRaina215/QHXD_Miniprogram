/**
 * 自动重连的 WebSocket（/ws/state、/ws/navigation）。后端只推送不读内容，心跳发 "ping" 文本保活；
 * 15 s 没有任何消息视为断线并重连，重连间隔 2 s 起、上限 20 s。
 */
class LiveSocket {
  constructor(urlFn, name) {
    this.urlFn = urlFn;
    this.name = name;
    this.task = null;
    this.connected = false;
    this.wanted = false;
    this.retry = 0;
    this.lastMessageAt = 0;
    this.timer = null;
    this.beat = null;
    this.handlers = { open: [], message: [], close: [] };
  }

  on(event, fn) {
    this.handlers[event].push(fn);
  }

  _emit(event, payload) {
    this.handlers[event].forEach((fn) => {
      try { fn(payload); } catch (e) { console.error('[socket]', this.name, e); }
    });
  }

  connect() {
    this.wanted = true;
    if (this.task) return;
    clearTimeout(this.timer);
    let task;
    try {
      task = wx.connectSocket({ url: this.urlFn(), timeout: 8000, fail: () => this._dropped(task) });
    } catch (e) {
      this._schedule();
      return;
    }
    this.task = task;
    task.onOpen(() => {
      if (this.task !== task) return;
      this.connected = true;
      this.retry = 0;
      this.lastMessageAt = Date.now();
      this._startBeat(task);
      this._emit('open');
    });
    task.onMessage((event) => {
      if (this.task !== task) return;
      this.lastMessageAt = Date.now();
      let payload = event.data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (e) { return; }
      }
      this._emit('message', payload);
    });
    task.onError(() => this._dropped(task));
    task.onClose(() => this._dropped(task));
  }

  disconnect() {
    this.wanted = false;
    clearTimeout(this.timer);
    const task = this.task;
    this._reset();
    if (task) {
      try { task.close({}); } catch (e) { /* 已关闭 */ }
    }
  }

  _reset() {
    clearInterval(this.beat);
    this.beat = null;
    const was = this.connected;
    this.task = null;
    this.connected = false;
    if (was) this._emit('close');
  }

  _dropped(task) {
    if (task && this.task !== task) return;
    this._reset();
    this._schedule();
  }

  _schedule() {
    if (!this.wanted) return;
    clearTimeout(this.timer);
    const delay = Math.min(20000, 2000 * Math.pow(1.6, this.retry));
    this.retry += 1;
    this.timer = setTimeout(() => this.connect(), delay);
  }

  _startBeat(task) {
    clearInterval(this.beat);
    this.beat = setInterval(() => {
      if (this.task !== task) return;
      if (Date.now() - this.lastMessageAt > 15000) {
        try { task.close({}); } catch (e) { /* 忽略 */ }
        this._dropped(task);
        return;
      }
      try { task.send({ data: 'ping' }); } catch (e) { /* 下次心跳再判断 */ }
    }, 5000);
  }
}

module.exports = LiveSocket;
